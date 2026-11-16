#!/usr/bin/env python3
"""Audit current WISDOHM observations; explicitly authorized sync never asserts DONE."""
import argparse
from collections import Counter
from contextlib import closing
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sqlite3
import sys

sys.dont_write_bytecode = True
MAPS = ('STACK', 'INTEGRATIONS', 'ARCHITECTURE', 'STRUCTURE', 'CONVENTIONS', 'TESTING', 'CONCERNS')


def source(root, name):
    path = root / name
    if (not isinstance(name, str) or Path(name).is_absolute() or
            path.resolve() != path or not path.is_relative_to(root) or
            path.relative_to(root).as_posix() != name or not path.is_file() or path.stat().st_nlink != 1):
        raise ValueError('Expected independent project source: ' + str(name))
    raw = path.read_bytes()
    if len(raw) > 8 * 1024 * 1024:
        raise ValueError('Source exceeds 8 MiB: ' + name)
    return raw.decode('utf-8'), hashlib.sha256(raw).hexdigest()


def records(root):
    database = root / '.wisdohm/memory.sqlite'
    source(root, '.wisdohm/BOOT.md')
    if database.resolve() != database or not database.is_file():
        raise ValueError('Missing independent memory database')
    with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)) as db:
        if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise ValueError('Memory database integrity check failed')
        return [dict(kind=kind, key=key, body=json.loads(body))
                for kind, key, body in db.execute('SELECT kind,key,body FROM memory ORDER BY kind,key')]


def audit(root):
    current = records(root)
    observations = []
    for record in current:
        body = record['body']
        if not body.get('source_path') or not body.get('sha256'):
            continue  # Immutable legacy imports have their own provenance, not current-source assertions.
        name = body['source_path']
        try:
            _, actual = source(root, name)
            status = 'match' if actual == body['sha256'] else 'changed'
            error = None
        except (ValueError, OSError, UnicodeError) as exc:
            actual, status, error = None, 'unavailable', str(exc)
        observations.append(dict(kind=record['kind'], key=record['key'], path=name,
                                 expected=body['sha256'], actual=actual, status=status, error=error))
    pins = []
    maintenance = '.wisdohm/protocols/maintenance.md'
    text, _ = source(root, maintenance)
    for relative, expected in re.findall(r'^\[[^\]]+\]: (\S+) "sha256:([a-f0-9]{64})"$', text, re.MULTILINE):
        path = (root / maintenance).parent / relative
        try:
            resolved = Path(os.path.normpath(path))
            if not resolved.is_relative_to(root):
                raise ValueError('maintenance source escapes project')
            # Relative parent components are legitimate in maintenance references.
            name = resolved.relative_to(root).as_posix()
            if path.is_symlink():
                raise ValueError('maintenance source alias')
            _, actual = source(root, name)
            pins.append(dict(path=name, status='match' if actual == expected else 'changed'))
        except (ValueError, OSError, UnicodeError) as exc:
            pins.append(dict(path=relative, status='unavailable', error=str(exc)))
    maps = []
    by_key = {(entry['kind'], entry['key']): entry for entry in observations}
    for name in MAPS:
        entry = by_key.get(('codebase', 'map/' + name))
        maps.append(dict(name=name, status=entry['status'] if entry else 'unrecorded'))
    blockers = []
    if not pins or any(item['status'] != 'match' for item in pins):
        blockers.append('Reviewed maintenance pins are missing or changed; review before repinning.')
    if any(item['status'] == 'unavailable' for item in observations):
        blockers.append('Current observation source is missing or unsafe.')
    if any(item['status'] == 'unrecorded' for item in maps):
        blockers.append('Seven current codebase map observations are required.')
    try:
        Store, digest, routing = runtime_api(root)
        modules, profiles = routing.load_routes(root)
        coverage = dict(status='valid', owners=len(modules), profiles=len(profiles))
    except (ValueError, OSError, ImportError) as exc:
        coverage = dict(status='invalid', error=str(exc))
        blockers.append('Ownership agent/skill routing is invalid: ' + str(exc))
    return dict(version=1, integrity='ok', memory_records=len(current),
                source_counts=dict(Counter(item['status'] for item in observations)),
                observations=observations, maps=maps, maintenance_pins=pins,
                agent_coverage=coverage, blockers=blockers,
                current=not blockers and all(item['status'] == 'match' for item in observations))


def runtime_api(root):
    previous = sys.modules.get('common')
    loaded = {}
    try:
        for name in ('common', 'store', 'orchestration'):
            spec = importlib.util.spec_from_file_location(name, root / '.wisdohm' / (name + '.py'))
            module = importlib.util.module_from_spec(spec)
            if name == 'common':
                sys.modules[name] = module
            spec.loader.exec_module(module)
            loaded[name] = module
    finally:
        if previous is None:
            sys.modules.pop('common', None)
        else:
            sys.modules['common'] = previous
    return loaded['store'].Store, loaded['common'].digest, loaded['orchestration']


def synchronize(root, paths):
    before = audit(root)
    if before['blockers']:
        raise ValueError('; '.join(before['blockers']))
    Store, digest, routing = runtime_api(root)
    store = Store(root)
    baseline = store.snapshot()
    requested = {(item['kind'], item['key']): item['path'] for item in before['observations']
                 if item['status'] == 'changed'}
    for path in paths:
        requested[('codebase', 'source/' + path)] = path
    entries = []
    current = {(item['kind'], item['key']): item['body'] for item in store.records()}
    for (kind, key), path in sorted(requested.items()):
        text, checksum = source(root, path)
        body = dict(source_path=path, sha256=checksum, text=text,
                    provenance='host-authorized-administrative-sync',
                    evidence='Current source observation; not behavioral verification or guarded DONE.')
        if current.get((kind, key)) != body:
            entries.append(dict(kind=kind, key=key, body=body))
    if not entries:
        if store.snapshot() != baseline:
            raise ValueError('Memory changed during review; retry after coordinating writers.')
        return dict(stage='IMPORTED', changed=0, current_facts_unchanged=True, audit=audit(root))
    identity = 'admin-sync-' + digest(entries)[:24]
    state = dict(schema_version=2, id=identity, root=str(root), kind='maintenance',
                 owner='governance-runtime', task='Synchronize reviewed current source observations',
                 stage='IMPORTED', _legacy=True, write=[], rules=[], verify=[], checks=[],
                 context=None, outputs=None, memory=None, receipt={}, inputs={},
                 read=sorted({entry['body']['source_path'] for entry in entries}),
                 summary='Administrative source synchronization; history retained; no guarded completion.',
                 next='Use normal measured-context gates for future authoring.',
                 provenance='host-authorized-administrative-sync')
    state['digest'] = digest({key: value for key, value in state.items() if key != 'digest'})
    for entry in entries:
        if source(root, entry['body']['source_path'])[1] != entry['body']['sha256']:
            raise ValueError('Source changed during review; retry after coordinating writers.')
    existing = next((item for item in store.sessions() if item['id'] == identity), None)
    if existing is not None:
        if (existing.get('stage') != 'IMPORTED' or not existing.get('_legacy') or
                existing.get('write') or existing.get('checks') or existing.get('context') or
                existing.get('provenance') != state['provenance'] or
                existing.get('owner') != state['owner'] or existing.get('read') != state['read']):
            raise ValueError('Administrative identity conflicts with guarded work')
        state = existing
    store.save(state, action='ADMIN_SYNC', entries=entries, expected_memory=baseline)
    return dict(stage='IMPORTED', session=identity, changed=len(entries), current_facts_unchanged=False,
                audit=audit(root))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--audit', action='store_true', help='Read-only, also the default')
    mode.add_argument('--apply', action='store_true')
    parser.add_argument('--authorized-administration', action='store_true')
    parser.add_argument('--require-current', action='store_true', help='Exit 1 when audit detects drift or blockers')
    parser.add_argument('--path', action='append', default=[], help='Additional reviewed project source')
    args = parser.parse_args()
    if args.apply and not args.authorized_administration:
        parser.error('--apply requires --authorized-administration and explicit host authorization')
    if args.path and not args.apply:
        parser.error('--path is only accepted with --apply')
    try:
        root = args.root.resolve()
        result = synchronize(root, args.path) if args.apply else audit(root)
        print(json.dumps(result, indent=2))
        report = result['audit'] if args.apply else result
        return 1 if args.require_current and not report['current'] else 0
    except (ValueError, OSError, sqlite3.Error) as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
