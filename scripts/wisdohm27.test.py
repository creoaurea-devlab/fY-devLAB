"""Disposable integration checks for the installed devLAB WISDOHM 2.7 runtime."""
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest

import yaml


ROOT = Path(os.environ.get('WISDOHM27_TEST_ROOT', Path(__file__).resolve().parents[1])).resolve()
RUNTIME = Path(os.environ.get('WISDOHM27_RUNTIME', ROOT / '.agents/runtime' if (ROOT / '.agents/runtime/router.py').is_file() else ROOT / '.wisdohm')).resolve()
CONTROL = RUNTIME.parent if RUNTIME.name == 'runtime' else RUNTIME
REINSTALL = Path(os.environ.get('WISDOHM27_REINSTALL', ROOT / 'scripts/wisdohm27-reinstall.py')).resolve()


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(encoded(value).encode()).hexdigest()


class RuntimeFixture(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='devlab-wisdohm27-test-')
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.root = self.base / 'project'
        self.root.mkdir()
        self.assertIn('(version 2.7.0)', (CONTROL / 'BOOT.md').read_text())
        shutil.copytree(RUNTIME, self.root / '.wisdohm',
                        ignore=shutil.ignore_patterns('memory.sqlite*', '.locks', 'backups', '__pycache__', '*.wisdohm-new*'))
        if RUNTIME.name == 'runtime':
            # This suite retains an independent legacy SQL-authority fixture to
            # prove schema/history migration remains supported after relocation.
            for name in ['BOOT.md', 'policy.yaml']:
                shutil.copyfile(CONTROL / name, self.root / '.wisdohm' / name)
            shutil.copytree(CONTROL / 'protocols', self.root / '.wisdohm/protocols', dirs_exist_ok=True)
            presentation = yaml.safe_load((CONTROL / 'project.yaml').read_text())['journey']
            kinds = [yaml.safe_load(path.read_text())['kind'] for path in sorted((CONTROL / 'workflows').glob('*/workflow.yaml'))]
            self.write_yaml('.wisdohm/journey.yaml', dict(presentation, task_kinds=kinds))
        self.write('src/value.py', 'before\n')
        self.write('src/other.py', 'other\n')
        self.write('docs/profile/SKILL.md', '# Fixture profile\n1. Preserve owned scope and evidence.\n')
        self.write('docs/pinned.md', '# Reviewed fixture guidance\n1. Keep current evidence.\n')
        pin = hashlib.sha256((self.root / 'docs/pinned.md').read_bytes()).hexdigest()
        self.write('.wisdohm/protocols/maintenance.md', '# Fixture maintenance\n1. Validate reviewed guidance.\n\n[pinned]: ../../docs/pinned.md "sha256:' + pin + '"\n')
        self.write_yaml('.wisdohm/config/agents.yaml', {'schema_version': 1, 'profiles': {
            'fixture': {'description': 'Test scoped execution.', 'skills': ['docs/profile/SKILL.md']}}})
        self.write_yaml('.wisdohm/config/owner-profiles.yaml', {'schema_version': 1, 'assignments': {'example': 'fixture', 'other': 'fixture'}})
        self.write_yaml('.wisdohm/config/project.yaml', {'project': 'fixture', 'mode': 'autonomous', 'commands': {},
                                                       'rules': {'protected_paths': ['.git/', '.env']}, 'ownership': {}})
        self.write_yaml('.wisdohm/policy.yaml', {'context_limit_percent': 33, 'measurement_max_age_seconds': 60,
                                              'context_mode': 'advisory'})

    def write(self, relative, text):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        return path

    def write_yaml(self, relative, value):
        return self.write(relative, yaml.safe_dump(value, sort_keys=False))

    def command(self, *arguments, ok=True):
        result = subprocess.run([sys.executable, '-B', str(self.root / '.wisdohm/router.py'),
                                 '--target', str(self.root), *arguments], cwd=self.root,
                                text=True, capture_output=True, timeout=30)
        if ok:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def plan(self, changes, ok=True):
        proposal = self.write_yaml('proposal.yaml', {'actor': 'integration-test',
            'scope': [change['type'] + '/' + change['value']['id'] for change in changes], 'changes': changes})
        return self.command('plan', 'apply', '--file', str(proposal), ok=ok)

    def initialize(self):
        self.command('db', 'init')
        capabilities = []
        for owner, path in [('example', 'src/value.py'), ('other', 'src/other.py')]:
            capabilities.append({'type': 'capability', 'value': {'id': owner, 'revision': 0,
                'purpose': 'Own ' + path, 'paths': [path], 'public': [path], 'uses': [],
                'guidance': ['docs/profile/SKILL.md']}})
        self.plan(capabilities)

    def step(self, revision=0, **overrides):
        value = {'id': 'value-change', 'revision': revision, 'kind': 'bugfix', 'effect': 'change_source',
                 'title': 'Change fixture value', 'outcome': 'The fixture value is after.',
                 'acceptance': ['src/value.py contains after followed by newline.'],
                 'owner': 'example', 'read': [], 'write': ['src/value.py'], 'needs': [], 'questions': [],
                 'checks': ["python3 -c \"from pathlib import Path; assert Path('src/value.py').read_text() == 'after\\n'\""]}
        value.update(overrides)
        return {'type': 'step', 'value': value}

    def state(self, identity='worker'):
        with closing(sqlite3.connect(self.root / '.wisdohm/memory.sqlite')) as connection:
            row = connection.execute('SELECT data FROM sessions WHERE id=?', (identity,)).fetchone()
            return None if row is None else json.loads(row[0])

    def claims(self):
        with closing(sqlite3.connect(self.root / '.wisdohm/memory.sqlite')) as connection:
            return connection.execute('SELECT path,task_id FROM claims ORDER BY path').fetchall()

    def prepare_verified(self):
        self.initialize()
        self.plan([self.step()])
        self.command('agent', 'start', '--id', 'worker', '--step', 'value-change', '--expected-revision', '1')
        self.assertIsNone(self.state()['context'])
        self.command('agent', 'check', '--id', 'worker', '--path', 'src/value.py')
        self.write('src/value.py', 'after\n')
        for kind in ('changelog', 'progress'):
            self.command('agent', 'remember', '--id', 'worker', '--kind', kind,
                         '--key', 'fixture-value', '--text', 'Changed fixture value; ready for current verification.')
        assessment = {group: {'status': 'updated' if group in ('changelog', 'state') else 'unchanged',
                             'reason': 'Recorded value change and progress.' if group in ('changelog', 'state')
                                       else 'No capability or codebase observation changed.'}
                      for group in ('changelog', 'codebase', 'registry', 'state')}
        review = self.write_yaml('review.yaml', assessment)
        self.command('agent', 'memory', '--id', 'worker', '--file', str(review))
        self.command('agent', 'verify', '--id', 'worker')
        self.assertTrue(all(check['exit'] == 0 for check in self.state()['checks']))


class RuntimeIntegrationTests(RuntimeFixture):
    def test_sql_path_routing_and_unowned_refusal(self):
        self.initialize()
        result = self.command('agent', 'route', '--path', 'src/value.py', '--path', 'src/other.py')
        parsed = json.loads(result.stdout)
        self.assertEqual({item['owner'] for item in parsed['routes']}, {'example', 'other'})
        self.assertTrue(all(item['agent'] == 'fixture' for item in parsed['routes']))
        self.assertFalse((self.root / '.context/modules/registry.yaml').exists())
        denied = self.command('agent', 'route', '--path', 'src/unowned.py', ok=False)
        self.assertIn('exactly one owner', denied.stderr)

    def test_maintenance_pin_drift_rejected_before_session(self):
        self.initialize()
        self.plan([self.step()])
        self.write('docs/pinned.md', 'unreviewed replacement\n')
        result = self.command('agent', 'start', '--id', 'worker', '--step', 'value-change', ok=False)
        self.assertIn('maintenance source changed', result.stderr)
        self.assertIsNone(self.state())
        self.assertEqual(self.claims(), [])

    def test_wrong_owner_and_stale_plan_revisions_rejected(self):
        self.initialize()
        wrong = self.plan([self.step(owner='other')], ok=False)
        self.assertIn('owner', wrong.stderr)
        self.plan([self.step()])
        self.command('agent', 'start', '--id', 'wrong-owner', '--step', 'value-change', '--owner', 'other', ok=False)
        stale_start = self.command('agent', 'start', '--id', 'wrong-revision', '--step', 'value-change',
                                   '--expected-revision', '0', ok=False)
        self.assertIn('revision', stale_start.stderr)
        self.plan([self.step(revision=0, title='Stale proposal')], ok=False)
        current = json.loads(self.command('plan', 'show', 'value-change').stdout)
        self.assertEqual(current['revision'], 1)
        self.assertEqual(current['title'], 'Change fixture value')
        self.assertEqual(self.claims(), [])

    def test_advisory_unknown_real_lifecycle_and_claim_release(self):
        self.prepare_verified()
        self.command('agent', 'finish', '--id', 'worker')
        state = self.state()
        self.assertEqual(state['stage'], 'DONE')
        self.assertIsNone(state['context'])
        self.assertEqual(set(state['memory']['assessment']), {'changelog', 'codebase', 'registry', 'state'})
        self.assertEqual(self.claims(), [])
        route = json.loads(self.command('route', '--step', 'value-change').stdout)
        self.assertEqual(route['action'], 'complete')

    def test_changed_output_invalidates_verified_completion(self):
        self.prepare_verified()
        self.write('src/value.py', 'changed after verification\n')
        self.command('agent', 'finish', '--id', 'worker', ok=False)
        self.assertNotEqual(self.state()['stage'], 'DONE')
        self.assertEqual(self.claims(), [('src/value.py', 'worker')])

    def test_changed_definition_invalidates_verified_completion(self):
        self.prepare_verified()
        self.plan([self.step(revision=1, outcome='A newly reviewed outcome with new acceptance.',
                             acceptance=['The value is after, and the revised outcome was verified.'])])
        self.command('agent', 'finish', '--id', 'worker', ok=False)
        self.assertNotEqual(self.state()['stage'], 'DONE')
        self.assertEqual(self.claims(), [('src/value.py', 'worker')])


class MigrationIntegrationTests(RuntimeFixture):
    def synthetic_history(self, *, claimed=False, mixed=False):
        database = self.root / '.wisdohm/memory.sqlite'
        with closing(sqlite3.connect(database)) as connection:
            connection.executescript('''
CREATE TABLE sessions (id TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE memory (kind TEXT NOT NULL, key TEXT NOT NULL, body TEXT NOT NULL, task_id TEXT NOT NULL REFERENCES sessions(id), updated_at TEXT NOT NULL, PRIMARY KEY(kind,key));
CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT REFERENCES sessions(id), action TEXT NOT NULL, payload TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE claims (path TEXT PRIMARY KEY NOT NULL, task_id TEXT NOT NULL REFERENCES sessions(id));
PRAGMA user_version=1;
''')
            for index in range(2):
                identity = 'old-' + str(index)
                state = {'schema_version': 2, 'id': identity, 'root': '/old/devlab' if not mixed or not index else '/other/project',
                         'task': 'Historical work', 'kind': 'maintenance', 'owner': 'example', 'stage': 'DONE',
                         'write': ['src/value.py'], 'read': [], 'verify': ['historical command'],
                         'checks': [{'command': 'historical command', 'exit': 0, 'output_digest': 'a' * 64}],
                         'outputs': {'src/value.py': 'b' * 64}, 'context': {'used_tokens': 9, 'window_tokens': 100}}
                state['digest'] = digest(state)
                connection.execute('INSERT INTO sessions VALUES (?,?,?)', (identity, index + 1, encoded(state)))
                connection.execute('INSERT INTO events(task_id,action,payload,at) VALUES (?,?,?,?)',
                                   (identity, 'FINISH', '{"original":true}', '2026-01-01'))
            connection.execute('INSERT INTO memory VALUES (?,?,?,?,?)', ('audit', 'historical-note', '{"text":"Keep exact bytes"}', 'old-0', '2026-01-01'))
            if claimed:
                connection.execute('INSERT INTO claims VALUES (?,?)', ('src/value.py', 'old-0'))
            connection.commit()
        self.backup = self.base / 'online-before.sqlite'
        self.make_backup()
        return self.raw_tables()

    def make_backup(self):
        with closing(sqlite3.connect(self.root / '.wisdohm/memory.sqlite')) as source, closing(sqlite3.connect(self.backup)) as target:
            source.backup(target)

    def raw_tables(self):
        with closing(sqlite3.connect(self.root / '.wisdohm/memory.sqlite')) as connection:
            return {table: connection.execute('SELECT * FROM ' + table + ' ORDER BY 1').fetchall()
                    for table in ('sessions', 'memory', 'events', 'claims')}

    def migrate(self, ok=True):
        result = subprocess.run([sys.executable, '-B', str(REINSTALL), '--root', str(self.root), '--backup', str(self.backup)],
                                text=True, capture_output=True, timeout=30)
        if ok:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def test_migration_preserves_history_and_is_idempotent(self):
        before = self.synthetic_history()
        result = json.loads(self.migrate().stdout)
        self.assertEqual(result['relocated_sessions'], 2)
        after = self.raw_tables()
        self.assertEqual(before['memory'], after['memory'])
        self.assertEqual(before['events'], after['events'][:2])
        self.assertEqual(before['claims'], after['claims'])
        originals = {row[0]: row for row in before['sessions']}
        for row in after['events'][2:]:
            preserved = json.loads(row[3])['original_row']
            self.assertEqual((preserved['id'], preserved['revision'], preserved['data']), originals[preserved['id']])
        for identity, revision, raw in after['sessions']:
            state = json.loads(raw)
            self.assertEqual(state['stage'], 'IMPORTED')
            self.assertEqual(state['root'], str(self.root))
            self.assertEqual(state['checks'], [])
            self.assertEqual(state['outputs'], {})
            self.assertIsNone(state['context'])
            self.assertEqual(revision, originals[identity][1] + 1)
        self.assertFalse(json.loads(self.migrate().stdout)['changed'])
        self.assertEqual(after, self.raw_tables())

    def test_migration_refuses_claims_without_changes(self):
        before = self.synthetic_history(claimed=True)
        self.assertIn('active source claims', self.migrate(ok=False).stderr)
        self.assertEqual(before, self.raw_tables())

    def test_migration_refuses_mixed_roots_without_changes(self):
        before = self.synthetic_history(mixed=True)
        self.assertIn('mixed session roots', self.migrate(ok=False).stderr)
        self.assertEqual(before, self.raw_tables())

    def test_migration_refuses_tampered_session_digest(self):
        self.synthetic_history()
        with closing(sqlite3.connect(self.root / '.wisdohm/memory.sqlite')) as connection:
            state = json.loads(connection.execute("SELECT data FROM sessions WHERE id='old-0'").fetchone()[0])
            state['task'] = 'Unverified edit without updating its receipt digest'
            connection.execute("UPDATE sessions SET data=? WHERE id='old-0'", (encoded(state),))
            connection.commit()
        self.backup = self.base / 'tampered-online.sqlite'
        self.make_backup()
        before = self.raw_tables()
        self.assertIn('session digest mismatch', self.migrate(ok=False).stderr)
        self.assertEqual(before, self.raw_tables())

    def test_migration_rolls_back_partial_relocation(self):
        self.synthetic_history()
        self.command('db', 'upgrade', '--output', str(self.base / 'schema1.sqlite'))
        self.backup = self.base / 'online-schema2.sqlite'
        self.make_backup()
        before = self.raw_tables()
        with closing(sqlite3.connect(self.root / '.wisdohm/memory.sqlite')) as connection:
            connection.executescript("""CREATE TRIGGER reject_second_relocation BEFORE INSERT ON events
WHEN NEW.action='RELOCATE_HISTORY' AND NEW.task_id='old-1'
BEGIN SELECT RAISE(ABORT,'fixture second-row failure'); END;""")
        self.assertIn('fixture second-row failure', self.migrate(ok=False).stderr)
        self.assertEqual(before, self.raw_tables())


if __name__ == '__main__':
    unittest.main()
