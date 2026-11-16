#!/usr/bin/env python3
"""Explicit, backed-up devLAB history relocation after reviewed 2.7 installation.

Never copies the release database or modifies historical events/memory. A full,
byte-preserving copy of each replaced session row is appended as an event.
Requires exclusive operator coordination; refuses active claims and mixed roots.
"""
import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
from urllib.parse import quote


def require(condition, message):
    if not condition:
        raise ValueError(message)


def connect(path, readonly=False):
    connection = sqlite3.connect('file:' + quote(str(path)) + ('?mode=ro' if readonly else '?mode=rw'), uri=True, timeout=5)
    connection.execute('PRAGMA foreign_keys=ON')
    connection.execute('PRAGMA trusted_schema=OFF')
    return connection


def rows(connection, table):
    # All names are fixed internal constants, never user-controlled SQL.
    order = {'sessions': 'id', 'memory': 'kind,key', 'events': 'seq', 'claims': 'path'}[table]
    return connection.execute('SELECT * FROM ' + table + ' ORDER BY ' + order).fetchall()


def snapshot(connection):
    return {table: rows(connection, table) for table in ('sessions', 'memory', 'events', 'claims')}


def check_integrity(connection):
    require(connection.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'SQLite integrity check failed')
    require(not connection.execute('PRAGMA foreign_key_check').fetchall(), 'SQLite foreign-key check failed')


def counts(value):
    return {key: len(records) for key, records in value.items()}


def run(args):
    root = Path(args.root).absolute()
    require(root == root.resolve() and root.is_dir(), 'root must be an existing canonical directory')
    runtime = root / '.wisdohm'
    require(runtime == runtime.resolve(), 'runtime cannot be a symlink')
    database = runtime / 'memory.sqlite'
    backup = Path(args.backup).absolute()
    require(backup == backup.resolve() and backup.is_file(), 'backup must be an existing canonical online SQLite backup')
    require(database.is_file() and database == database.resolve() and database != backup, 'invalid target database')
    boot = (runtime / 'BOOT.md').read_text()
    require('2.7.0' in boot, 'reviewed installed WISDOHM 2.7 runtime is required')
    for name in ('common.py', 'store.py', 'planning.py', 'routing.py', 'workspaces.py'):
        require((runtime / name).is_file() and (runtime / name) == (runtime / name).resolve(), 'missing or unsafe installed runtime: ' + name)
    sys.path.insert(0, str(runtime))
    from common import digest, parse_json
    from store import Store, encoded

    with closing(connect(backup, True)) as connection:
        check_integrity(connection)
        backup_schema = connection.execute('PRAGMA user_version').fetchone()[0]
        require(backup_schema in (1, 2), 'unsupported backup schema')
        saved = snapshot(connection)
    with closing(connect(database, True)) as connection:
        check_integrity(connection)
        schema = connection.execute('PRAGMA user_version').fetchone()[0]
        require(schema in (1, 2), 'unsupported target schema')
        before = snapshot(connection)
    require(not before['claims'], 'active source claims exist; coordinate workers before migration')
    states = [parse_json(row[2]) for row in before['sessions']]
    roots = {state.get('root') for state in states}
    require(all(isinstance(value, str) and value for value in roots), 'invalid session root')
    require(len(roots) <= 1, 'mixed session roots require explicit individual review')
    for row, state in zip(before['sessions'], states):
        require(state.get('id') == row[0], 'session ID mismatch')
        require(state.get('digest') == digest({key: value for key, value in state.items() if key not in ('digest', '_revision')}), 'session digest mismatch: ' + row[0])

    if schema == 2 and (not roots or roots == {str(root)}):
        # Idempotent rerun must still prove this backup was the recorded source.
        saved_hash = hashlib.sha256(backup.read_bytes()).hexdigest()
        relocation_events = [json.loads(row[3]) for row in before['events'] if row[2] == 'RELOCATE_HISTORY']
        require(before == saved or any(event.get('backup_sha256') == saved_hash for event in relocation_events), 'backup does not match current database or relocation provenance')
        require(before['memory'] == saved['memory'] and before['claims'] == saved['claims'], 'backup memory/claims changed; review required')
        require(before['events'][:len(saved['events'])] == saved['events'], 'historical events differ from backup')
        return {'changed': False, 'schema': 2, 'reason': 'session roots already current', 'counts': counts(before), 'integrity': 'ok'}

    require(before == saved, 'online backup contents differ from current target; take a fresh backup after coordinating writers')
    old_root = next(iter(roots), None)
    require(old_root != str(root) or schema == 1, 'unexpected current-root migration')
    backup_sha = hashlib.sha256(backup.read_bytes()).hexdigest()
    upgrade_result = {'upgraded': False, 'schema': schema}
    if schema == 1:
        upgrade_backup = backup.with_name(backup.name + '.schema1-before-upgrade.sqlite')
        require(not upgrade_backup.exists(), 'schema upgrade backup already exists; inspect previous attempt before retrying')
        upgrade_result = Store.upgrade(root, upgrade_backup)

    validator = Store(root, readonly=True)
    with closing(connect(database)) as connection:
        connection.execute('BEGIN IMMEDIATE')
        try:
            require(snapshot(connection) == before, 'database changed during schema upgrade; relocation refused')
            require(connection.execute('PRAGMA user_version').fetchone()[0] == 2, 'schema upgrade did not complete')
            now = datetime.now(timezone.utc).isoformat()
            migrated = 0
            for row, original in zip(before['sessions'], states):
                identity, revision, original_json = row
                if original['root'] == str(root):
                    continue
                provenance = {'source_root': original['root'], 'target_root': str(root),
                              'backup': str(backup), 'backup_sha256': backup_sha,
                              'original_row': {'id': identity, 'revision': revision, 'data': original_json},
                              'reason': 'Explicit 2.7 reinstall: relocated history is IMPORTED and cannot be resumed as current evidence.'}
                normalized = {'schema_version': 2, 'id': identity, 'root': str(root),
                              'task': original.get('task', 'Relocated historical session'),
                              'kind': original.get('kind', 'maintenance'), 'owner': original.get('owner', 'migration'),
                              'write': [], 'read': [], 'verify': [], 'rules': [],
                              'checks': [], 'outputs': {}, 'inputs': {}, 'context': None,
                              'stage': 'IMPORTED', '_legacy': True,
                              'legacy_origin_root': original['root'],
                              'summary': 'Historical session preserved in RELOCATE_HISTORY event; no current execution evidence.',
                              'updated_at': now}
                normalized['digest'] = digest(normalized)
                validator._payload(normalized)
                connection.execute('INSERT INTO events(task_id,action,payload,at) VALUES (?,?,?,?)',
                                   (identity, 'RELOCATE_HISTORY', encoded(provenance), now))
                updated = connection.execute('UPDATE sessions SET revision=?,data=? WHERE id=? AND revision=? AND data=?',
                                             (revision + 1, encoded(normalized), identity, revision, original_json))
                require(updated.rowcount == 1, 'session changed concurrently: ' + identity)
                migrated += 1
            after = snapshot(connection)
            require(after['memory'] == before['memory'], 'memory changed unexpectedly')
            require(after['claims'] == before['claims'], 'claims changed unexpectedly')
            require(after['events'][:len(before['events'])] == before['events'], 'historical events changed unexpectedly')
            require(len(after['sessions']) == len(before['sessions']), 'session count changed unexpectedly')
            require(len(after['events']) == len(before['events']) + migrated, 'migration event count differs')
            check_integrity(connection)
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
    # Exercise the installed public read path after committing, not just raw SQL.
    require(len(Store(root, readonly=True).sessions()) == len(before['sessions']), 'installed session reader cannot read migrated state')
    return {'changed': bool(migrated or upgrade_result.get('upgraded')), 'schema': 2,
            'relocated_sessions': migrated, 'previous_root': old_root, 'current_root': str(root),
            'backup': str(backup), 'backup_sha256': backup_sha, 'upgrade': upgrade_result,
            'before': counts(before), 'after': counts(after), 'integrity': 'ok',
            'historical_events_unchanged': True, 'memory_unchanged': True, 'claims_unchanged': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True)
    parser.add_argument('--backup', required=True, help='Existing online SQLite backup matching target pre-migration rows')
    options = parser.parse_args()
    try:
        print(json.dumps(run(options), indent=2))
    except Exception as error:
        print(json.dumps({'error': str(error), 'status': 'refused; inspect schema and retain backups before retry'}), file=sys.stderr)
        raise SystemExit(1)
