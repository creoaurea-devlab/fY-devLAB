"""Configured guidance is part of the default rule receipt, without unsafe traversal."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest

CONTEXT = Path(__file__).parents[1]
sys.path.insert(0, str(CONTEXT))
spec = importlib.util.spec_from_file_location('devtest_rule_session', CONTEXT / 'session.py')
session = importlib.util.module_from_spec(spec)
spec.loader.exec_module(session)


class ConfiguredRules(unittest.TestCase):
    def fixture(self, root, source):
        for name in ['state/index.json', 'memory.py', 'policy.yaml', 'router.py', 'session.py', 'common.py']:
            path = root / '.context' / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes((CONTEXT / name).read_bytes())
        for name in ['BOOT.md', 'protocols/rules.md', 'protocols/updates.md']:
            path = root / '.context' / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('** CA_WISDOM - ON **\n1. Preserve behavior.\n')
        path = root / '.context/config/project.yaml'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('rules:\n  sources:\n    - ' + source + '\n')
        return session.Session(root, 'test-rules')

    def test_default_receipt_hashes_configured_guidance(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            instance = self.fixture(root, '.context/protocols/maintenance.md')
            rule = root / '.context/protocols/maintenance.md'
            rule.write_text('1. Read the actual source rules.\n')
            state = dict(rules=[], read=[], write=[])
            hashes, receipt = instance.inputs(state)
            self.assertIn('.context/protocols/maintenance.md', receipt)
            before = hashes['.context/protocols/maintenance.md']
            rule.write_text('1. Changed reviewed guidance.\n')
            self.assertNotEqual(before, instance.inputs(state)[0]['.context/protocols/maintenance.md'])

    def test_missing_configured_guidance_is_not_silently_ignored(self):
        with tempfile.TemporaryDirectory() as name:
            instance = self.fixture(Path(name), '.context/protocols/missing.md')
            with self.assertRaisesRegex(ValueError, 'missing configured rules'):
                instance.inputs(dict(rules=[], read=[], write=[]))

    def test_configured_guidance_cannot_escape_the_project(self):
        with tempfile.TemporaryDirectory() as name:
            instance = self.fixture(Path(name), '../outside.md')
            with self.assertRaises(ValueError):
                instance.inputs(dict(rules=[], read=[], write=[]))
