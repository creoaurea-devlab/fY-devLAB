"""Exercise only the copied2.6 maintenance adapter; fixture telemetry is never invented."""
import importlib.util
from pathlib import Path
import shutil
import json
import re
import subprocess
import sys
import tempfile
import unittest
import yaml
ROOT = Path(__file__).resolve().parent.parent
RUNTIME = ROOT / '.wisdohm'

@unittest.skipUnless((RUNTIME / 'session.py').exists(), '2.6 not installed in this edition yet')
class LocalRules(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(RUNTIME))
        spec = importlib.util.spec_from_file_location('devtest_wisdohm26_session', RUNTIME / 'session.py')
        cls.runtime = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.runtime)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='devtest-rules26-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        shutil.copytree(RUNTIME, self.root / '.wisdohm', ignore=shutil.ignore_patterns('*.sqlite*', '.locks', '__pycache__'))
        shutil.copytree(ROOT / 'docs/rules/sources', self.root / 'docs/rules/sources')
        shutil.copytree(ROOT / '.agents/skills', self.root / '.agents/skills')
        (self.root / '.context/modules').mkdir(parents=True)
        shutil.copy2(ROOT / '.context/modules/registry.yaml', self.root / '.context/modules/registry.yaml')
        shutil.copy2(ROOT / 'AGENTS.md', self.root / 'AGENTS.md')
        self.session = self.runtime.Session(self.root, 'local-rules-test')
        self.state = dict(owner='governance-runtime', rules=[], read=[], write=[])

    def agent(self, *args):
        return subprocess.run([sys.executable, str(self.root / '.wisdohm/router.py'), '--target',
                               str(self.root), 'agent', *args], capture_output=True, text=True, timeout=20)

    def test_default_receipt_covers_local_reviewed_sources(self):
        hashes, receipt = self.session.inputs(self.state)
        self.assertIn('.wisdohm/protocols/maintenance.md', hashes)
        self.assertIn('.context/modules/registry.yaml', hashes)
        self.assertIn('docs/rules/sources/Proto/SOLID/rules/dependency-inversion.md', hashes)
        self.assertIn('docs/rules/sources/Proto/Code-Maintenance-Skills-and-Rules/RULES.md', receipt)
        self.session.ownership({'owner':'rules-service','write':[]})

    def test_missing_or_drifted_pin_refuses_input_receipt(self):
        file = self.root / 'docs/rules/sources/Proto/SOLID/rules/single-responsibility.md'
        file.write_text(file.read_text() + '\nchanged\n')
        with self.assertRaisesRegex(ValueError, 'review before repinning'):
            self.session.inputs(self.state)
        file.unlink()
        with self.assertRaisesRegex(ValueError, 'missing maintenance source'):
            self.session.inputs(self.state)

    def test_missing_route_does_not_silently_deactivate_rules(self):
        (self.root / '.wisdohm/protocols/maintenance.md').unlink()
        with self.assertRaises((ValueError, FileNotFoundError)):
            self.session.inputs(self.state)

    def test_pinned_reference_cannot_escape_project(self):
        file = self.root / '.wisdohm/protocols/maintenance.md'
        file.write_text('[escape]: ../../../outside.md "sha256:' + '0' * 64 + '"\n')
        with self.assertRaisesRegex(ValueError, 'escapes project'):
            self.session.inputs(self.state)

    def test_competing_config_ownership_is_refused(self):
        file = self.root / '.wisdohm/config/project.yaml'
        data = yaml.safe_load(file.read_text());data['ownership']['invented']=['src/**']
        file.write_text(yaml.safe_dump(data))
        with self.assertRaisesRegex(ValueError, 'ownership lives in canonical registry'):
            self.session.ownership({'owner':'invented','write':[]})

    def test_canonical_scope_and_revocation_are_checked_directly(self):
        own = 'plugins/rules-local/src/index.ts'
        self.session.ownership({'owner':'rules-service','write':[own]})
        with self.assertRaisesRegex(ValueError, 'write exceeds'):
            self.session.ownership({'owner':'rules-service','write':['src/server.ts']})
        file = self.root / '.context/modules/registry.yaml'
        data = yaml.safe_load(file.read_text());data['modules']['rules-service']['paths'].remove(own)
        file.write_text(yaml.safe_dump(data))
        with self.assertRaisesRegex(ValueError, 'write exceeds'):
            self.session.ownership({'owner':'rules-service','write':[own]})
        # No mirrored project.yaml list must be edited to apply the revocation.
        self.assertEqual(yaml.safe_load((self.root / '.wisdohm/config/project.yaml').read_text())['ownership'], {})

    def test_real_start_with_unknown_context_cannot_pass_work_guard(self):
        from argparse import Namespace
        state = self.session.start(Namespace(kind='audit',owner='rules-service',task='Read-only adapter probe',write=[],read=[],rules=[],verify=[]))
        self.assertIsNone(state['context'])
        with self.assertRaises(ValueError):
            self.session.guard(state)
        self.assertNotEqual(self.session.load()['stage'], 'DONE')

    def test_route_is_read_only_and_groups_actual_owner_profiles(self):
        before = (self.root / '.wisdohm/memory.sqlite').read_bytes()
        result = self.agent('route', '--path', 'src/server.ts', '--path', 'plugins/ui-preview/src/view.tsx')
        self.assertEqual(result.returncode, 0, result.stderr)
        routes = json.loads(result.stdout)['routes']
        self.assertEqual([route['owner'] for route in routes], ['backend-host', 'preview-view'])
        self.assertTrue(all(route['agent'] and route['skills'] for route in routes))
        self.assertEqual((self.root / '.wisdohm/memory.sqlite').read_bytes(), before)
        self.assertRegex(result.stderr, r'CA_WISDOHM - ON \* R[1-9][0-9]* \| BEFORE \| route')
        self.assertRegex(result.stderr, r'CA_WISDOHM - ON \* R[1-9][0-9]* \| AFTER \| route')
        (self.root / '.wisdohm/memory.sqlite').unlink()
        result = self.agent('route', '--path', 'src/server.ts')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.root / '.wisdohm/memory.sqlite').exists())

    def test_every_owner_needs_a_known_profile(self):
        path = self.root / '.context/modules/registry.yaml'
        data = yaml.safe_load(path.read_text())
        for agent in (None, 'missing-profile'):
            data['modules']['rules-service']['agent'] = agent
            path.write_text(yaml.safe_dump(data))
            with self.assertRaisesRegex(ValueError, 'known agent profile'):
                self.session.ownership({'owner':'rules-service','write':[]})

    def test_missing_escaping_and_duplicate_skills_fail_closed(self):
        path = self.root / '.wisdohm/config/agents.yaml'
        original = yaml.safe_load(path.read_text())
        profile = next(iter(original['profiles']))
        for skills in (['.agents/missing/SKILL.md'], ['../outside/SKILL.md'],
                       original['profiles'][profile]['skills'] * 2):
            data = yaml.safe_load(path.read_text())
            data['profiles'][profile]['skills'] = skills
            path.write_text(yaml.safe_dump(data))
            with self.assertRaises(ValueError):
                self.session.inputs(self.state)
            path.write_text(yaml.safe_dump(original))

    def test_selected_profile_skills_are_fingerprinted(self):
        hashes, _ = self.session.inputs(self.state)
        self.assertIn('.wisdohm/orchestration.py', hashes)
        self.assertIn('.wisdohm/config/agents.yaml', hashes)
        skill = '.agents/skills/wisdohm-owner/SKILL.md'
        self.assertIn(skill, hashes)
        path = self.root / skill
        path.write_text(path.read_text() + '\nChanged reviewed guidance.\n')
        updated, _ = self.session.inputs(self.state)
        self.assertNotEqual(hashes[skill], updated[skill])

    def test_routes_refuse_unowned_ambiguous_and_unsafe_targets(self):
        for path in ('unknown/new.ts', '../outside.ts', '.env'):
            result = self.agent('route', '--path', path)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('CA_WISDOHM - ON * R0 | BEFORE', result.stderr)
            self.assertIn('CA_WISDOHM - ON * R0 | AFTER', result.stderr)
        path = self.root / '.context/modules/registry.yaml'
        data = yaml.safe_load(path.read_text())
        data['modules']['browser-bootstrap']['paths'].append('src/server.ts')
        path.write_text(yaml.safe_dump(data))
        result = self.agent('route', '--path', 'src/server.ts')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('exactly one owner', result.stderr)

    def test_declarations_count_loaded_occurrences_and_survive_guard_failure(self):
        result = self.agent('start', '--id', 'declaration-test', '--owner', 'governance-runtime',
                            '--kind', 'audit', '--task', 'Fixture declaration check')
        self.assertEqual(result.returncode, 0, result.stderr)
        _, receipt = self.session.inputs(self.state)
        expected = sum(len(rules) for rules in receipt.values())
        self.assertEqual(re.findall(r'CA_WISDOHM - ON \* R(\d+)', result.stderr), [str(expected)] * 2)
        result = self.agent('check', '--id', 'declaration-test')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('HANDOVER', result.stderr)
        self.assertIn('| AFTER | check', result.stderr)
        self.assertIn('failed:', result.stderr)
        (self.root / '.wisdohm/protocols/maintenance.md').unlink()
        result = self.agent('status', '--id', 'declaration-test')
        self.assertIn('CA_WISDOHM - ON * R0 | BEFORE', result.stderr)
        self.assertIn('CA_WISDOHM - ON * R0 | AFTER', result.stderr)

    def test_malformed_arguments_and_missing_project_have_zero_rule_declarations(self):
        result = self.agent('start')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(re.findall(r'CA_WISDOHM - ON \* R0', result.stderr)), 2)
        (self.root / '.wisdohm/BOOT.md').unlink()
        result = self.agent('route', '--path', 'src/server.ts')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(re.findall(r'CA_WISDOHM - ON \* R0', result.stderr)), 2)

    def test_drift_uses_zero_count_while_recovery_remains_accessible(self):
        result = self.agent('start', '--id', 'drift-test', '--owner', 'governance-runtime',
                            '--kind', 'audit', '--task', 'Fixture drift and recovery')
        self.assertEqual(result.returncode, 0, result.stderr)
        rules = self.root / '.wisdohm/protocols/rules.md'
        rules.write_text(rules.read_text() + '\n999. Added fixture rule after accepted inputs.\n')
        for args in (('status', '--id', 'drift-test'),
                     ('checkpoint', '--id', 'drift-test', '--summary', 'Fixture drift', '--next', 'Review'),
                     ('abandon', '--id', 'drift-test', '--reason', 'Fixture recovery complete')):
            result = self.agent(*args)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(len(re.findall(r'CA_WISDOHM - ON \* R0', result.stderr)), 2)
            self.assertIn('resume required', result.stderr)

    def test_route_honors_custom_protected_paths_and_competing_map_refusal(self):
        path = self.root / '.wisdohm/config/project.yaml'
        data = yaml.safe_load(path.read_text())
        data['rules']['protected_paths'].append('src/server.ts')
        path.write_text(yaml.safe_dump(data))
        result = self.agent('route', '--path', 'src/server.ts')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('protected path', result.stderr)
        data['ownership'] = {'other': ['src/server.ts']}
        path.write_text(yaml.safe_dump(data))
        result = self.agent('route', '--path', 'plugins/ui-preview/src/view.tsx')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('ownership lives in canonical registry', result.stderr)

if __name__ == '__main__':
    unittest.main()
