#!/usr/bin/env python3
"""Disposable integration probes; installed host code inspects only fixture data."""
from contextlib import closing
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / '.agents/runtime/definitions.py'
RUNTIME = ROOT / '.agents/runtime' if (ROOT / '.agents/runtime/router.py').is_file() else ROOT / '.wisdohm'
CONTROL = ROOT / '.agents' if RUNTIME.name == 'runtime' else ROOT / '.wisdohm'
spec = importlib.util.spec_from_file_location('independent_fixture', ROOT / 'scripts/agent-home-fixture.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class AgentHomeRuntimeTests(unittest.TestCase):
    def test_declared_history_root_is_readable_without_allowing_foreign_writes(self):
        sys.path.insert(0, str(RUNTIME))
        from store import Store
        from common import digest
        store = Store.__new__(Store)
        store.root = self.root
        old = str(self.base / 'former-project')
        store.history_roots = [old]
        state = dict(id='retained', root=old, stage='HANDOVER', write=[], checks=[])
        state['digest'] = digest(state)
        row = dict(id='retained', revision=1, data=json.dumps(state))
        self.assertEqual(store._state(row)['root'], old)
        with self.assertRaisesRegex(ValueError, 'another project'):
            store._payload(state)
        store.history_roots = []
        with self.assertRaisesRegex(ValueError, 'another project'):
            store._state(row)

    def test_historical_memory_is_labelled_and_not_current_source_proof(self):
        sys.path.insert(0, str(RUNTIME))
        from store import Store
        from session import Session
        store = Store.__new__(Store)
        store.history_roots = ['/absent/former-project']
        with sqlite3.connect(':memory:') as db:
            db.row_factory = sqlite3.Row
            db.execute('CREATE TABLE sessions(id TEXT,data TEXT)')
            db.execute('CREATE TABLE memory(kind TEXT,key TEXT,body TEXT,task_id TEXT,updated_at TEXT)')
            db.execute('INSERT INTO sessions VALUES (?,?)', ('old', json.dumps(dict(root=store.history_roots[0]))))
            db.execute('INSERT INTO memory VALUES (?,?,?,?,?)', ('codebase','retained',json.dumps(dict(text='Historical source',source_root=store.history_roots[0],source_path='gone.txt',sha256='a'*64)),'old','2026-01-01'))
            records = store._records(db)
        self.assertTrue(records[0]['historical'])
        session = Session.__new__(Session)
        session.identity = 'fresh'
        session.root = self.root
        session.source = self.root
        session.memory_snapshot = lambda state: {'codebase': {'codebase/retained': 'digest'}}
        session.validate_observations({'memory_scope': {'paths': ['gone.txt']}}, records)
        del records[0]['historical']
        with self.assertRaisesRegex(ValueError, 'observation is stale'):
            session.validate_observations({'memory_scope': {'paths': ['gone.txt']}}, records)

    def test_recreated_history_directory_does_not_block_fresh_execution_proof(self):
        old = self.base / 'former-project'
        old.mkdir()
        config = self.root / '.agents/project.yaml'
        settings = json.loads(config.read_text())
        settings['history_roots'] = [str(old)]
        config.write_text(json.dumps(settings))
        state = dict(id='retained-source', root=str(old), stage='IMPORTED', write=[], checks=[])
        state['digest'] = hashlib.sha256(json.dumps(state, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        body = dict(text='Historical source evidence', source_root=str(old), source_path='docs/history.md', sha256='a'*64)
        with closing(sqlite3.connect(self.database())) as db:
            db.execute('INSERT INTO sessions VALUES (?,?,?)', ('retained-source', 1, json.dumps(state)))
            db.execute('INSERT INTO memory VALUES (?,?,?,?,?)', ('codebase','historical-source',json.dumps(body),'retained-source','2026-01-01'))
            db.commit()
        self.finish_baseline()
        proof = json.loads(self.command('route', '--step', 'BASELINE').stdout)['evidence']
        self.assertEqual(proof['session'], 'baseline')
        self.assertEqual(proof['kind'], 'verified')
        self.assertEqual(json.loads(self.command('route', '--step', 'BUGFIX').stdout)['reason'], 'start_ready')

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='agent-home-runtime-')
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.root = self.base / 'project'
        fixture.build_fixture(self.root)
        # This execution prerequisite characterizes retained docs. Reading the bug's
        # output would correctly invalidate its proof as soon as the bug is fixed.
        baseline = self.root / '.agents/plans/fixture/steps/BASELINE/step.yaml'
        body = json.loads(baseline.read_text())
        body['read'] = ['docs/history.md']
        body['verification']['checks'] = ["python3 -c \"from pathlib import Path; assert Path('docs/history.md').read_text().startswith('# Baseline\\n')\""]
        baseline.write_text(json.dumps(body))
        self.control = self.root / ('.agents' if RUNTIME.name == 'runtime' else '.wisdohm')
        target = self.control / 'runtime' if RUNTIME.name == 'runtime' else self.control
        shutil.copytree(RUNTIME, target, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns('memory.sqlite*', '.locks', 'backups', '__pycache__', '*.wisdohm-new*'))
        (self.root / '.agents/runtime').mkdir(parents=True, exist_ok=True)
        shutil.copyfile(HELPER, self.root / '.agents/runtime/definitions.py')
        for name in ['BOOT.md', 'policy.yaml'] + ([] if RUNTIME.name == 'runtime' else ['journey.yaml']):
            shutil.copyfile(CONTROL / name, self.control / name)
        shutil.copytree(CONTROL / 'protocols', self.control / 'protocols', dirs_exist_ok=True)
        project = self.control / ('project.yaml' if RUNTIME.name == 'runtime' else 'config/project.yaml')
        project.parent.mkdir(parents=True, exist_ok=True)
        settings = dict(project='fixture', mode='autonomous', commands={}, rules=dict(protected_paths=['.git/', '.env']), ownership={})
        if RUNTIME.name == 'runtime':
            import yaml
            settings['journey'] = yaml.safe_load((CONTROL / 'project.yaml').read_text())['journey']
        project.write_text(json.dumps(settings))
        pin = self.root / 'docs/pinned.md'
        pin.write_text('# Reviewed fixture guidance\n1. Preserve current source evidence.\n')
        (self.control / 'protocols/maintenance.md').write_text(
            '[pin]: ../../docs/pinned.md "sha256:' + hashlib.sha256(pin.read_bytes()).hexdigest() + '"\n')
        self.router = target / 'router.py'
        # Keep an explicit legacy database input for the relocation regression;
        # pristine agent-home installations may initialize directly in .agents.
        (self.root / '.wisdohm').mkdir(exist_ok=True)
        (self.root / '.wisdohm/memory.sqlite').touch(exist_ok=False)
        self.command('db', 'init')
        self.facade('progress-upgrade', '--output', str(self.base / 'schema2.sqlite'))
        # Execution fixtures represent fresh admission. Migration tests separately
        # retain all reported Running/Review owners without reopening their work.
        reports = fixture.fixture_document()['progress']
        reports['states'] = {}
        self.facade('progress-save', '--expected-revision', '0', payload=reports)

    def command(self, *args, ok=True):
        result = subprocess.run([sys.executable, '-B', str(self.router), '--target', str(self.root), *args],
                                cwd=self.root, text=True, capture_output=True, timeout=40)
        self.assertEqual(result.returncode == 0, ok, result.stdout + result.stderr)
        return result

    def facade(self, action, *args, payload=None, ok=True):
        result = subprocess.run([sys.executable, '-B', str(HELPER), action, '--root', str(self.root), *args],
                                input=None if payload is None else json.dumps(payload), text=True,
                                capture_output=True, timeout=15)
        self.assertEqual(result.returncode == 0, ok, result.stdout + result.stderr)
        return json.loads(result.stdout) if ok else result

    def database(self):
        current = self.root / '.agents/state/memory.sqlite'
        return current if current.is_file() else self.root / '.wisdohm/memory.sqlite'

    def state(self, identity):
        with closing(sqlite3.connect(self.database())) as connection:
            row = connection.execute('SELECT data FROM sessions WHERE id=?', (identity,)).fetchone()
            return None if row is None else json.loads(row[0])

    def claims(self):
        with closing(sqlite3.connect(self.database())) as connection:
            return connection.execute('SELECT path,task_id FROM claims ORDER BY path').fetchall()

    def start(self, task, identity=None, ok=True, extra=()):
        identity = identity or task.lower()
        route = json.loads(self.command('route', '--step', task).stdout)
        resolution = self.facade('resolve', '--task', task)
        return self.command('agent', 'start', '--id', identity, '--step', task,
                            '--expected-revision', str(route['revision']), '--expected-generation', resolution['generation'],
                            *extra, ok=ok)

    def record(self, identity, changed):
        for kind in (['changelog', 'progress'] if changed else ['audit']):
            self.command('agent', 'remember', '--id', identity, '--kind', kind,
                         '--key', identity, '--text', 'Recorded the concrete fixture outcome and its actual limitations.')
        review = {group: dict(status='updated' if group in ({'changelog', 'state'} if changed else {'state'}) else 'unchanged',
                              reason='Recorded actual scoped changes.' if changed else 'Read-only source assessment.')
                  for group in ['changelog', 'codebase', 'registry', 'state']}
        path = self.root / ('review-' + identity + '.json')
        path.write_text(json.dumps(review))
        self.command('agent', 'memory', '--id', identity, '--file', str(path))

    def finish_baseline(self):
        self.start('BASELINE')
        self.command('agent', 'check', '--id', 'baseline', '--path', 'docs/history.md')
        self.record('baseline', False)
        self.command('agent', 'verify', '--id', 'baseline')
        self.command('agent', 'finish', '--id', 'baseline')

    def test_actual_bugfix_dispatch_requires_real_receipts_and_preserves_failed_check(self):
        self.assertEqual(json.loads(self.command('route', '--step', 'BUGFIX').stdout)['reason'], 'prerequisites_pending')
        self.finish_baseline()
        self.start('BUGFIX')
        self.command('agent', 'check', '--id', 'bugfix', '--path', 'src/value.ts')
        self.record('bugfix', False)
        self.command('agent', 'verify', '--id', 'bugfix', ok=False)
        failed = self.state('bugfix')
        self.assertNotEqual(failed['checks'][0]['exit'], 0)
        self.assertEqual(len(failed['checks'][0]['output_digest']), 64)
        self.command('agent', 'finish', '--id', 'bugfix', ok=False)
        self.assertEqual(self.claims(), [('src/value.ts', 'bugfix')])
        self.command('agent', 'repair', '--id', 'bugfix', '--reason', 'Change the reproduced value from 1 to 2.')
        self.command('agent', 'check', '--id', 'bugfix', '--path', 'src/value.ts')
        (self.root / 'src/value.ts').write_text('export const value = 2;\n')
        self.record('bugfix', True)
        self.command('agent', 'verify', '--id', 'bugfix')
        self.command('agent', 'finish', '--id', 'bugfix')
        self.assertEqual(self.state('bugfix')['stage'], 'DONE')
        self.assertEqual(self.state('bugfix')['checks'][0]['exit'], 0)
        self.assertEqual(self.claims(), [])
        self.assertEqual(json.loads(self.command('route', '--step', 'BUGFIX').stdout)['evidence']['kind'], 'verified')
        with closing(sqlite3.connect(self.database())) as connection:
            history = [json.loads(row[0]) for row in connection.execute("SELECT payload FROM events WHERE task_id='bugfix'")]
        self.assertTrue(any(any(check['exit'] != 0 for check in event.get('checks', [])) for event in history), 'Failed receipt remains in history')

    def test_read_only_audit_and_prose_change_use_attributed_assessment_without_fake_tests(self):
        self.start('AUDIT')
        self.command('agent', 'assess', '--id', 'audit', '--text', 'Inspected src/value.ts: value is 1; no behavioral command was run.')
        self.record('audit', False)
        self.command('agent', 'verify', '--id', 'audit')
        self.command('agent', 'finish', '--id', 'audit')
        self.assertEqual(self.state('audit')['checks'], [])
        self.assertEqual(json.loads(self.command('route', '--step', 'AUDIT').stdout)['evidence']['kind'], 'assessed')
        self.start('DOCS')
        self.command('agent', 'check', '--id', 'docs', '--path', 'docs/guide.md')
        (self.root / 'docs/guide.md').write_text('# Fixture ownership\nThe fixture-docs owner maintains this guide.\n')
        self.record('docs', True)
        self.command('agent', 'verify', '--id', 'docs', ok=False)
        self.command('agent', 'assess', '--id', 'docs', '--text', 'Read the final guide: fixture-docs ownership is stated clearly.')
        self.command('agent', 'verify', '--id', 'docs')
        self.command('agent', 'finish', '--id', 'docs')
        state = self.state('docs')
        self.assertEqual(state['checks'], [])
        self.assertEqual(state['assessment']['actor'], 'docs')
        self.assertEqual(json.loads(self.command('route', '--step', 'DOCS').stdout)['evidence']['kind'], 'assessed')
        # The observer sees the final single-database agent home, rather than the
        # intentionally retained legacy database input used by this test class.
        relocated = subprocess.run([sys.executable, '-B', '-c',
            'import sys;sys.path.insert(0,sys.argv[1]);from store import Store;Store.relocate(sys.argv[2],sys.argv[3])',
            str(RUNTIME), str(self.root), str(self.base / 'before-observation.sqlite')], text=True, capture_output=True, timeout=20)
        self.assertEqual(relocated.returncode, 0, relocated.stdout + relocated.stderr)
        observed = subprocess.run(['/usr/bin/python3', '-I', '-B', str(ROOT / 'plugins/rules-local/src/read-memory.py'),
                                   str(self.root), 'fixture'], text=True, capture_output=True, timeout=15)
        self.assertEqual(observed.returncode, 0, observed.stdout + observed.stderr)
        snapshot = json.loads(observed.stdout)
        assessment = next(value for value in snapshot['assessments'] if value['step_id'] == 'DOCS')
        self.assertEqual(assessment['actor'], 'docs')
        self.assertEqual(assessment['kind'], 'assessed')
        self.assertFalse(assessment['accepted'], 'The observer displays attribution without certifying acceptance itself')
        self.assertFalse(any(check['sessionId'] == 'docs' for check in snapshot['checks']))

    def test_wrong_owner_stale_generation_changed_inputs_and_handoff_collision_refuse(self):
        self.start('DOCS', 'wrong-owner', ok=False, extra=('--owner', 'fixture-source'))
        self.assertIsNone(self.state('wrong-owner'))
        route = json.loads(self.command('route', '--step', 'DOCS').stdout)
        self.command('agent', 'start', '--id', 'stale', '--step', 'DOCS', '--expected-revision', str(route['revision']),
                     '--expected-generation', '0' * 64, ok=False)
        self.assertIsNone(self.state('stale'))
        self.start('DOCS', 'owner')
        self.command('agent', 'check', '--id', 'owner', '--path', 'docs/guide.md')
        self.command('agent', 'checkpoint', '--id', 'owner', '--summary', 'Retained work', '--next', 'Original owner resumes')
        self.start('DOCS', 'collision', ok=False)
        self.assertEqual(self.claims(), [('docs/guide.md', 'owner')])
        self.assertEqual(json.loads(self.command('route', '--step', 'DOCS').stdout)['action'], 'handover')
        self.command('agent', 'resume', '--id', 'owner')
        (self.root / 'src/value.ts').write_text('export const value = 3;\n')
        self.command('agent', 'check', '--id', 'owner', '--path', 'docs/guide.md', ok=False)
        self.assertEqual(self.claims(), [('docs/guide.md', 'owner')])

    def test_reported_running_review_and_other_owned_writes_need_real_handoff_even_without_claims(self):
        catalog_path = self.root / '.agents/plans/catalog.yaml'
        catalog = json.loads(catalog_path.read_text())
        for original, identity in [('BUGFIX', 'OVERLAP'), ('AUDIT', 'FRESH-AUDIT')]:
            step = json.loads((self.root / '.agents/plans/fixture/steps' / original / 'step.yaml').read_text())
            step.update(id=identity, needs=[])
            path = '.agents/plans/fixture/steps/' + identity + '/step.yaml'
            (self.root / path).parent.mkdir(parents=True)
            (self.root / path).write_text(json.dumps(step))
            catalog['steps'].append(dict(id=identity, path=path, agent='general'))
        catalog_path.write_text(json.dumps(catalog))
        self.finish_baseline()
        current = self.facade('progress-read')
        self.facade('progress-save', '--expected-revision', str(current['revision']), payload=fixture.fixture_document()['progress'])
        self.assertEqual(self.claims(), [])
        for task in ['BUGFIX', 'AUDIT', 'OVERLAP']:
            with self.subTest(task=task):
                identity = 'denied-' + task.lower()
                try:
                    rejected = self.start(task, identity, ok=False)
                    self.assertIn('reported Running/Review work requires a handoff', rejected.stderr)
                    self.assertIsNone(self.state(identity))
                    self.assertEqual(self.claims(), [])
                finally:
                    if self.state(identity): self.command('agent', 'abandon', '--id', identity, '--reason', 'Clean up rejected-admission probe.')
        self.start('FRESH-AUDIT', 'independent-reader')
        self.assertEqual(self.claims(), [])
        self.command('agent', 'abandon', '--id', 'independent-reader', '--reason', 'Admission probe complete; no source modified.')

    def test_original_session_can_resume_while_its_task_is_reported_running(self):
        self.start('DOCS', 'original-owner')
        self.command('agent', 'checkpoint', '--id', 'original-owner', '--summary', 'Retained source work', '--next', 'Original owner resumes')
        current = self.facade('progress-read')
        reports = fixture.fixture_document()['progress']
        reports['states'] = {'DOCS': dict(reports['states']['DOCS'], status='running', reportedBy='original-owner')}
        self.facade('progress-save', '--expected-revision', str(current['revision']), payload=reports)
        self.command('agent', 'resume', '--id', 'original-owner')
        self.command('agent', 'check', '--id', 'original-owner', '--path', 'docs/guide.md')
        self.assertEqual(self.claims(), [('docs/guide.md', 'original-owner')])
        current = self.facade('progress-read')
        reports['states']['DOCS'].update(status='pending', note='Original owner explicitly reopens the report; its operational claim remains held.')
        self.facade('progress-save', '--expected-revision', str(current['revision']), payload=reports)
        rejected = self.start('DOCS', 'competing-runner', ok=False)
        self.assertIn('write path claimed by another task', rejected.stderr)
        self.assertEqual(self.claims(), [('docs/guide.md', 'original-owner')])

    def test_reader_rejects_duplicate_escape_symlink_and_ownership_collision(self):
        catalog = self.root / '.agents/plans/catalog.yaml'
        original = catalog.read_text()
        catalog.write_text('schema_version: 1\nschema_version: 1\n')
        self.assertIn('duplicate', self.facade('snapshot', ok=False).stderr)
        catalog.write_text(original)
        for unsafe in ['../outside/step.yaml', '/outside/step.yaml', '.agents/unsafe-source-link']:
            value = json.loads(original); value['steps'][0]['path'] = unsafe
            catalog.write_text(json.dumps(value))
            self.facade('snapshot', ok=False)
        catalog.write_text(original)
        step = self.root / '.agents/plans/fixture/steps/DOCS/step.yaml'
        saved = step.read_bytes(); step.unlink(); step.symlink_to(self.root / 'docs/guide.md')
        self.assertIn('symlink', self.facade('snapshot', ok=False).stderr)
        step.unlink(); step.write_bytes(saved)
        owner = self.root / '.agents/ownership/backend/fixture-source.yaml'
        body = json.loads(owner.read_text()); body['paths'].append('docs/**'); owner.write_text(json.dumps(body))
        self.facade('snapshot', ok=False)

    def test_every_versioned_definition_rejects_boolean_schema_versions(self):
        for relative in ['.agents/plans/authority.yaml', '.agents/plans/catalog.yaml',
                         '.agents/plans/fixture/steps/DOCS/step.yaml', '.agents/agents/implementer/agent.yaml',
                         '.agents/workflows/bugfix/workflow.yaml', '.agents/ownership/backend/fixture-source.yaml']:
            with self.subTest(source=relative):
                path = self.root / relative
                original = path.read_text()
                body = json.loads(original); body['schema_version'] = True
                try:
                    path.write_text(json.dumps(body))
                    self.facade('snapshot', ok=False)
                finally:
                    path.write_text(original)

    def test_file_definition_ids_keep_public_dots_and_96_character_limit(self):
        identity = 'with.' + 'd' * 91
        catalog = self.root / '.agents/plans/catalog.yaml'
        value = json.loads(catalog.read_text())
        step = json.loads((self.root / '.agents/plans/fixture/steps/AUDIT/step.yaml').read_text())
        step['id'] = identity
        path = '.agents/plans/fixture/steps/' + identity + '/step.yaml'
        (self.root / path).parent.mkdir(parents=True)
        (self.root / path).write_text(json.dumps(step))
        value['steps'].append(dict(id=identity, path=path, agent='general'))
        catalog.write_text(json.dumps(value))
        self.assertEqual(len(identity), 96)
        self.start(identity, 'public-id-session')
        self.command('agent', 'assess', '--id', 'public-id-session', '--text', 'Inspected the declared source without changing it.')
        self.record('public-id-session', False)
        self.command('agent', 'verify', '--id', 'public-id-session')
        self.command('agent', 'finish', '--id', 'public-id-session')
        self.assertEqual(json.loads(self.command('route', '--step', identity).stdout)['evidence']['kind'], 'assessed')

    def test_selected_file_authority_refuses_second_editable_sql_plan(self):
        before = self.facade('snapshot')
        proposal = self.root / 'unauthorized-second-definition.json'
        proposal.write_text(json.dumps(dict(actor='fixture', scope=['capability/second-owner'], changes=[dict(type='capability',
            value=dict(id='second-owner', revision=0, purpose='Competing ownership', paths=['src/value.ts'], public=[], uses=[], guidance=[]))])))
        rejected = self.command('plan', 'apply', '--file', str(proposal), ok=False)
        self.assertIn('canonical planner writer', rejected.stderr)
        self.assertEqual(self.facade('snapshot')['generation'], before['generation'])
        with closing(sqlite3.connect(self.database())) as connection:
            self.assertEqual(connection.execute('SELECT count(*) FROM capabilities').fetchone(), (0,))

    def test_retired_control_writes_need_refined_followup_instead_of_recreating_old_authority(self):
        owner = self.root / '.agents/ownership/coordination/fixture-docs.yaml'
        value = json.loads(owner.read_text()); value['paths'].append('.wisdohm/policy.yaml'); owner.write_text(json.dumps(value))
        step = json.loads((self.root / '.agents/plans/fixture/steps/DOCS/step.yaml').read_text())
        step.update(id='RETIRED', write=['.wisdohm/policy.yaml'])
        path = '.agents/plans/fixture/steps/RETIRED/step.yaml'
        (self.root / path).parent.mkdir(parents=True); (self.root / path).write_text(json.dumps(step))
        catalog = self.root / '.agents/plans/catalog.yaml'
        value = json.loads(catalog.read_text()); value['steps'].append(dict(id='RETIRED', path=path, agent='general')); catalog.write_text(json.dumps(value))
        denied = self.start('RETIRED', 'retired-plan', ok=False)
        self.assertIn('retired control paths require a refined follow-up', denied.stderr.lower())
        denied = self.command('agent', 'start', '--id', 'retired-explicit', '--kind', 'docs', '--owner', 'fixture-docs',
                              '--task', 'Attempt to recreate retired policy', '--write', '.wisdohm/policy.yaml',
                              '--verify', "python3 -c \"from pathlib import Path; import yaml; assert yaml.safe_load(Path('.wisdohm/policy.yaml').read_text())['context_mode'] == 'advisory'\"", ok=False)
        self.assertIn('retired control paths require a refined follow-up', denied.stderr.lower())
        self.assertFalse((self.root / '.wisdohm/policy.yaml').exists())
        self.assertEqual(self.claims(), [])

    def test_schema_upgrade_backup_restores_exact_operational_rows_and_claims(self):
        self.start('DOCS', 'retained')
        self.command('agent', 'checkpoint', '--id', 'retained', '--summary', 'Unfinished prose', '--next', 'Resume original owner')
        backup = self.base / 'online-backup.sqlite'
        self.command('db', 'backup', '--output', str(backup))
        def signature(path):
            with closing(sqlite3.connect(path)) as connection:
                return {table: connection.execute('SELECT * FROM ' + table + ' ORDER BY 1').fetchall()
                        for table in ['sessions', 'memory', 'events', 'claims', 'workflow', 'capabilities', 'steps', 'step_dependencies']}
        self.assertEqual(signature(backup), signature(self.database()))
        restore = self.base / 'restored.sqlite'
        with closing(sqlite3.connect(backup)) as source, closing(sqlite3.connect(restore)) as destination:
            source.backup(destination)
        self.assertEqual(signature(restore), signature(self.database()))
        self.assertEqual(self.claims(), [('docs/guide.md', 'retained')])
        self.assertEqual(self.state('retained')['stage'], 'HANDOVER')

    def test_explicit_database_relocation_keeps_history_reports_and_active_claims(self):
        self.start('DOCS', 'retained')
        self.command('agent', 'checkpoint', '--id', 'retained', '--summary', 'Unfinished prose', '--next', 'Original owner resumes')
        before = self.database()
        saved = self.state('retained')
        backup = self.base / 'before-relocation.sqlite'
        result = subprocess.run([sys.executable, '-B', '-c',
            'import json,sys;sys.path.insert(0,sys.argv[1]);from store import Store;print(json.dumps(Store.relocate(sys.argv[2],sys.argv[3])))',
            str(RUNTIME), str(self.root), str(backup)], text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(before.exists())
        self.assertEqual(self.database(), self.root / '.agents/state/memory.sqlite')
        self.assertEqual(self.state('retained'), saved)
        self.assertEqual(self.claims(), [('docs/guide.md', 'retained')])
        self.start('DOCS', 'collision', ok=False)
        with closing(sqlite3.connect(backup)) as source, closing(sqlite3.connect(self.database())) as current:
            self.assertEqual(source.execute('PRAGMA user_version').fetchone(), (3,))
            for table in ['sessions', 'memory', 'events', 'claims', 'workflow', 'capabilities', 'steps', 'step_dependencies']:
                self.assertEqual(source.execute('SELECT * FROM ' + table + ' ORDER BY 1').fetchall(),
                                 current.execute('SELECT * FROM ' + table + ' ORDER BY 1').fetchall(), table)


    def test_observation_unicode_and_stale_scope(self):
        definition_spec = importlib.util.spec_from_file_location('trusted_definitions', HELPER)
        definitions = importlib.util.module_from_spec(definition_spec)
        definition_spec.loader.exec_module(definitions)
        root = self.root
        catalog_path = root / '.agents/plans/catalog.yaml'
        catalog = json.loads(catalog_path.read_text())
        docs = root / '.agents/plans/fixture/steps/DOCS/step.yaml'
        original = json.loads(docs.read_text())
        original.update(title='Saugus būdas — Ω', needs=['BASELINE'])
        docs.write_text(json.dumps(original, ensure_ascii=False))
        registry = self.facade('planner-read')['registry']
        task = next((t for t in registry['tasks'] if t['id'] == 'DOCS'))
        payload = dict(task=task, dependencies=[next((t for t in registry['tasks'] if t['id'] == key)) for key in task['depends_on']])
        node = "import {canonicalJson} from '@devlab/contracts'; import {createHash} from 'node:crypto'; import {readFileSync} from 'node:fs'; process.stdout.write(createHash('sha256').update(canonicalJson(JSON.parse(readFileSync(0,'utf8')))).digest('hex'));"
        js = subprocess.run(['node', '--input-type=module', '-e', node], cwd=ROOT, input=json.dumps(payload, ensure_ascii=False), text=True, capture_output=True, check=True).stdout
        assert js == definitions.planner_task_digest(registry, task) == self.facade('resolve', '--task', 'DOCS')['definition_digest']
        current = self.facade('progress-read')
        reports = current['body']
        reported = copy.deepcopy(fixture.fixture_document()['progress']['states']['DOCS'])
        reported.update(status='review', reportedBy='original-owner', definitionDigest=js)
        reports['states'] = {'DOCS': reported}
        self.facade('progress-save', '--expected-revision', str(current['revision']), payload=reports)
        assert self.claims() == []
        self.start('DOCS', 'review-observer', extra=('--observation',))
        observer = self.state('review-observer')
        assert observer['observation'] and observer['plan']['inputs']['observation']
        assert observer['write'] == [] and observer['verify'] == [] and ('docs/guide.md' in observer['read'])
        assert observer['plan']['item']['effect'] == 'change_source' and observer['plan']['item']['needs'] == ['BASELINE']
        assert self.claims() == []
        self.command('agent', 'check', '--id', 'review-observer', '--path', 'docs/guide.md', ok=False)
        self.command('agent', 'assess', '--id', 'review-observer', '--text', 'Inspected retained source and unresolved prerequisite; no implementation performed.')
        self.command('agent', 'verify', '--id', 'review-observer')
        assert self.state('review-observer')['checks'] == []
        rejected = self.command('agent', 'finish', '--id', 'review-observer', ok=False)
        assert 'observation cannot produce implementation completion' in rejected.stderr
        self.command('agent', 'repair', '--id', 'review-observer', '--reason', 'Read-only observation cannot acquire implementation repair authority.', ok=False)
        self.finish_baseline()
        code = "import sys,json;sys.path.insert(0,sys.argv[1]);from store import Store;from planning import Planning;assert Planning(Store(sys.argv[2],readonly=True)).evidence('DOCS') is None;print('no implementation proof')"
        result = subprocess.run(['/usr/bin/python3', '-I', '-B', '-c', code, str(ROOT / '.agents/runtime'), str(root)], text=True, capture_output=True, check=True)
        assert 'no implementation proof' in result.stdout
        self.command('agent', 'checkpoint', '--id', 'review-observer', '--summary', 'Read-only findings retained; no implementation evidence.', '--next', 'Return findings to existing owner.')
        self.command('agent', 'abandon', '--id', 'review-observer', '--reason', 'Observation returned; source authority remains with original owner.')
        self.start('BUGFIX', 'targeted-observer', extra=('--observation',))
        assert self.state('targeted-observer')['verify'] == [] and self.claims() == []
        self.command('agent', 'abandon', '--id', 'targeted-observer', '--reason', 'Read-only targeted task observation complete.')
        drift = copy.deepcopy(original)
        drift['write'] = ['docs/history.md']
        docs.write_text(json.dumps(drift, ensure_ascii=False))
        fresh = copy.deepcopy(original)
        fresh.update(id='FRESH', title='Independent source change', needs=[], write=['docs/guide.md'])
        path = '.agents/plans/fixture/steps/FRESH/step.yaml'
        (root / path).parent.mkdir(parents=True)
        (root / path).write_text(json.dumps(fresh))
        catalog['steps'].append(dict(id='FRESH', path=path, agent='general'))
        catalog_path.write_text(json.dumps(catalog))
        rejected = self.start('FRESH', 'denied-stale-scope', ok=False)
        assert 'stale definition' in rejected.stderr and self.state('denied-stale-scope') is None and (self.claims() == [])
        self.start('AUDIT', 'independent-audit')
        assert self.claims() == []
        self.command('agent', 'abandon', '--id', 'independent-audit', '--reason', 'Independent read-only inspection remains admissible.')
        self.start('DOCS', 'stale-report-observer', extra=('--observation',))
        assert self.claims() == []
        self.command('agent', 'abandon', '--id', 'stale-report-observer', '--reason', 'Readonly inspection of stale handoff remains admissible.')
        current = self.facade('progress-read')
        reports = current['body']
        registry = self.facade('planner-read')['registry']
        task = next((t for t in registry['tasks'] if t['id'] == 'DOCS'))
        reports['states']['DOCS'].update(status='pending', note='Original owner reviewed raw scope drift and explicitly handed off the report.', definitionDigest=definitions.planner_task_digest(registry, task))
        self.facade('progress-save', '--expected-revision', str(current['revision']), payload=reports)
        self.start('FRESH', 'source-owner')
        assert self.claims() == [('docs/guide.md', 'source-owner')]
        rejected = self.start('FRESH', 'competing-source-owner', ok=False)
        assert 'claimed by another task' in rejected.stderr
        self.command('agent', 'abandon', '--id', 'source-owner', '--reason', 'Disposable source admission probe complete; no source modified.')
        unbuilt = copy.deepcopy(fresh)
        unbuilt.update(id='UNBUILT', write=['docs/new-output.md'])
        path = '.agents/plans/fixture/steps/UNBUILT/step.yaml'
        (root / path).parent.mkdir(parents=True)
        (root / path).write_text(json.dumps(unbuilt))
        catalog['steps'].append(dict(id='UNBUILT', path=path, agent='general'))
        catalog_path.write_text(json.dumps(catalog))
        self.start('UNBUILT', 'missing-output-observer', extra=('--observation',))
        assert self.state('missing-output-observer')['inputs']['read:docs/new-output.md'] is None
        (root / 'docs/new-output.md').write_text('Created by a separate fixture actor.\n')
        rejected = self.command('agent', 'check', '--id', 'missing-output-observer', ok=False)
        assert 'read inputs changed' in rejected.stderr
        self.command('agent', 'abandon', '--id', 'missing-output-observer', '--reason', 'Observed source change requires refreshed inputs.')

    def test_assessed_source_proof_admits_dependency_without_observer_ownership(self):
        baseline = self.root / '.agents/plans/fixture/steps/BASELINE/step.yaml'
        body = json.loads(baseline.read_text())
        body['needs'] = ['DOCS']
        baseline.write_text(json.dumps(body))
        route = lambda task: json.loads(self.command('route', '--step', task).stdout)
        assert route('DOCS')['evidence']['required'] == 'assessed'
        assert route('BASELINE')['reason'] == 'prerequisites_pending'
        self.start('DOCS', 'observer', extra=('--observation',))
        assert self.claims() == []
        assert route('DOCS')['reason'] == 'start_ready' and route('DOCS')['evidence']['required'] == 'assessed'
        self.start('DOCS', 'docs')
        assert route('DOCS')['reason'] == 'acceptance_assessment_needed'
        self.command('agent', 'check', '--id', 'docs', '--path', 'docs/guide.md')
        (self.root / 'docs/guide.md').write_text('# Fixture ownership\nThe fixture-docs owner maintains this guide.\n')
        self.record('docs', True)
        self.command('agent', 'assess', '--id', 'docs', '--text', 'Read actual guide and confirmed fixture-docs ownership against the acceptance; no executable check is selected.')
        self.command('agent', 'verify', '--id', 'docs')
        self.command('agent', 'finish', '--id', 'docs')
        state = self.state('docs')
        assert state['evidence_kind'] == 'assessed' and state['checks'] == [] and (state['verify'] == [])
        assert route('DOCS')['reason'] == 'current_evidence' and route('DOCS')['evidence']['kind'] == 'assessed'
        assert route('BASELINE')['reason'] == 'start_ready'
        self.start('BASELINE', 'dependent')
        proofs = self.state('dependent')['plan']['inputs']['prerequisites']
        assert proofs[0]['step'] == 'DOCS' and proofs[0]['kind'] == 'assessed'
        self.command('agent', 'abandon', '--id', 'dependent', '--reason', 'Disposable admission proves assessed source prerequisite; no dependent source changed.')
        self.command('agent', 'abandon', '--id', 'observer', '--reason', 'Read-only observer never owns implementation admission.')

if __name__ == '__main__':
    unittest.main()
