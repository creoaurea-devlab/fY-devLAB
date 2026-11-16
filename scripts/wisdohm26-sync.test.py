#!/usr/bin/env python3
"""Exercise sync in disposable project fixtures, preserving legacy history and gates."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
import yaml

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


fixtures = load('bootstrap_fixtures', ROOT / 'scripts/wisdohm26-bootstrap.test.py')
sync = load('sync', ROOT / 'scripts/wisdohm26-sync.py')


class SyncTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixtures.BootstrapTests.setUpClass()

    def setUp(self):
        self.fixture = fixtures.BootstrapTests('test_official_migration_and_population_are_repeatable_without_done')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = self.fixture.root
        self.fixture.write('.agents/skills/fixture/SKILL.md', '---\nname: fixture\ndescription: Fixture only.\n---\nRead actual source.\n')
        self.fixture.write('.wisdohm/config/agents.yaml', yaml.safe_dump(dict(schema_version=1, profiles=dict(
            fixture=dict(description='Fixture owner', skills=['.agents/skills/fixture/SKILL.md'])))))
        registry_path = self.root / '.context/modules/registry.yaml'
        registry = yaml.safe_load(registry_path.read_text())
        for module in registry['modules'].values():
            module['agent'] = 'fixture'
        registry_path.write_text(yaml.safe_dump(registry))
        self.fixture.run_tool()

    def test_audit_does_not_mutate_database_or_initialize_missing_one(self):
        before = self.fixture.database()
        report = sync.audit(self.root)
        self.assertTrue(report['current'], report)
        self.assertEqual(report['agent_coverage']['status'], 'valid')
        self.assertEqual(before, self.fixture.database())
        empty = self.root / 'empty'
        empty.mkdir()
        with self.assertRaises((ValueError, OSError)):
            sync.audit(empty)
        self.assertFalse((empty / '.wisdohm/memory.sqlite').exists())

    def test_refresh_records_actual_source_and_prior_fact_in_history(self):
        package = self.root / 'package.json'
        package.write_text('{"name":"changed-fixture","version":"2.0.0"}\n')
        audit = sync.audit(self.root)
        self.assertEqual(audit['source_counts']['changed'], 1)
        result = sync.synchronize(self.root, [])
        self.assertEqual((result['stage'], result['changed'], result['audit']['current']), ('IMPORTED', 1, True))
        store, _, _ = sync.runtime_api(self.root)
        db = store(self.root)
        record = next(item for item in db.records() if item['key'] == 'app/identity')
        self.assertEqual(record['body']['text'], package.read_text())
        state = db.load(result['session'])
        self.assertEqual((state['stage'], state['write'], state['checks'], state['context']), ('IMPORTED', [], [], None))
        changes = [entry for event in db.history() for entry in event['payload'].get('entries', [])
                   if entry['key'] == 'app/identity']
        self.assertIn('bootstrap-fixture', changes[-1]['before']['text'])
        self.assertIn('changed-fixture', changes[-1]['after']['text'])
        before = self.fixture.database()
        self.assertTrue(sync.synchronize(self.root, [])['current_facts_unchanged'])
        self.assertEqual(before, self.fixture.database())

    def test_new_reviewed_sources_are_repeatable_and_legacy_records_survive(self):
        before = self.fixture.database()
        self.fixture.write('docs/new.md', '# Reviewed source\n')
        result = sync.synchronize(self.root, ['docs/new.md'])
        self.assertEqual(result['changed'], 1)
        after = self.fixture.database()
        legacy_before = [row for row in before['memory'] if json.loads(row[2]).get('legacy')]
        self.assertTrue(legacy_before)
        self.assertTrue(all(row in after['memory'] for row in legacy_before))
        self.assertEqual(sync.synchronize(self.root, ['docs/new.md'])['changed'], 0)
        self.assertEqual(after, self.fixture.database())

    def test_invalid_pins_and_profile_coverage_refuse_apply_atomically(self):
        before = self.fixture.database()
        self.fixture.write('.agents/skills/fixture/SKILL.md', 'Original skills still present.\n')
        (self.root / '.agents/skills/fixture/SKILL.md').unlink()
        self.assertFalse(sync.audit(self.root)['current'])
        with self.assertRaisesRegex(ValueError, 'routing is invalid'):
            sync.synchronize(self.root, [])
        self.assertEqual(before, self.fixture.database())
        self.fixture.write('.agents/skills/fixture/SKILL.md', 'Fixture\n')
        self.fixture.write('docs/rules/sources/fixture-rules.md', 'Unreviewed policy drift\n')
        with self.assertRaisesRegex(ValueError, 'maintenance pins'):
            sync.synchronize(self.root, [])
        self.assertEqual(before, self.fixture.database())

    def test_authorization_and_source_escape_refuse_mutation(self):
        before = self.fixture.database()
        result = subprocess.run([sys.executable, str(ROOT / 'scripts/wisdohm26-sync.py'),
                                 '--root', str(self.root), '--apply'], capture_output=True, text=True,
                                env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        self.assertNotEqual(result.returncode, 0)
        for path in ('../outside.md', '/etc/passwd'):
            with self.assertRaises(ValueError):
                sync.synchronize(self.root, [path])
        outside = self.root.parent / 'outside.md'
        outside.write_text('Outside source\n')
        (self.root / 'alias.md').symlink_to(outside)
        with self.assertRaises(ValueError):
            sync.synchronize(self.root, ['alias.md'])
        self.assertEqual(before, self.fixture.database())

    def test_unfinished_fact_owner_rolls_back_other_entries(self):
        Store, digest, _ = sync.runtime_api(self.root)
        store = Store(self.root)
        old = next(item['body'] for item in store.records() if item['key'] == 'app/identity')
        state = dict(schema_version=2, id='unfinished-sync-holder', root=str(self.root),
                     stage='START', write=[], checks=[], summary='Disposable conflict fixture.')
        state['digest'] = digest(state)
        store.save(state, entries=[dict(kind='codebase', key='app/identity', body=old)])
        self.fixture.write('package.json', '{"name":"changed-fixture"}\n')
        self.fixture.write('docs/new.md', '# New reviewed source\n')
        before = self.fixture.database()
        with self.assertRaisesRegex(ValueError, 'unfinished task'):
            sync.synchronize(self.root, ['docs/new.md'])
        self.assertEqual(before, self.fixture.database())

    def test_missing_source_refuses_apply_and_product_state_stays_unchanged(self):
        before = self.fixture.database()
        progress = self.root / '.context/state/progress.json'
        original = progress.read_bytes()
        (self.root / 'src/profile.ts').unlink()
        with self.assertRaisesRegex(ValueError, 'missing or unsafe'):
            sync.synchronize(self.root, [])
        self.assertEqual(before, self.fixture.database())
        self.assertEqual(progress.read_bytes(), original)

    def test_require_current_cli_fails_on_drift_and_foreign_identity_conflicts(self):
        self.fixture.write('package.json', '{"name":"changed-fixture"}\n')
        result = subprocess.run([sys.executable, str(ROOT / 'scripts/wisdohm26-sync.py'),
                                 '--root', str(self.root), '--require-current'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertFalse(json.loads(result.stdout)['current'])
        Store, digest, _ = sync.runtime_api(self.root)
        store = Store(self.root)
        path = 'package.json'
        text, checksum = sync.source(self.root, path)
        entry = dict(kind='codebase', key='app/identity', body=dict(source_path=path, sha256=checksum,
                     text=text, provenance='host-authorized-administrative-sync',
                     evidence='Current source observation; not behavioral verification or guarded DONE.'))
        foreign = dict(schema_version=2, id='admin-sync-' + digest([entry])[:24], root=str(self.root),
                       stage='IMPORTED', _legacy=True, write=[], checks=[], context=None,
                       summary='Foreign administrative fixture.')
        foreign['digest'] = digest(foreign)
        store.save(foreign)
        before = self.fixture.database()
        with self.assertRaisesRegex(ValueError, 'identity conflicts'):
            sync.synchronize(self.root, [])
        self.assertEqual(before, self.fixture.database())


if __name__ == '__main__':
    unittest.main()
