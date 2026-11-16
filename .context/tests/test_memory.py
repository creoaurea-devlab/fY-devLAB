"""DevTest close-gate checks; all records are isolated in-memory fixtures."""
import importlib.util
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('devtest_memory', Path(__file__).parents[1] / 'memory.py')
memory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(memory)


class RequiredStateUpdates(unittest.TestCase):
    def fixture(self, updated=()):
        baseline = {key: {f'{key}.md': 'before'} for key in memory.MEMORY}
        current = {key: dict(paths) for key, paths in baseline.items()}
        reviews = {key: dict(status='unchanged', reason='Reviewed; no affected facts.')
                   for key in memory.MEMORY}
        for key in updated:
            current[key][f'{key}.md'] = 'after'
            reviews[key] = dict(status='updated', reason='Recorded task outcome.',
                                artifacts=[dict(path=f'{key}.md', sha256='after')])
        writes = ['src/change.ts', 'changelog.md', 'progress.md']
        return reviews, baseline, current, writes

    def test_modifying_task_requires_both_state_updates(self):
        for updated in ((), ('changelog',), ('progress',)):
            for status in ('unchanged', 'not_applicable'):
                with self.subTest(updated=updated, status=status):
                    reviews, baseline, current, writes = self.fixture(updated)
                    for key in ('changelog', 'progress'):
                        if key not in updated:
                            reviews[key]['status'] = status
                    with self.assertRaisesRegex(ValueError, 'modifying task requires.*updated'):
                        memory.assess_memory(reviews, baseline, current, writes)

    def test_actual_declared_updates_allow_completion(self):
        args = self.fixture(('changelog', 'progress'))
        self.assertEqual(memory.assess_memory(*args), args[0])

    def test_updated_label_without_changed_bytes_is_rejected(self):
        reviews, baseline, current, writes = self.fixture(('changelog', 'progress'))
        current['progress'] = dict(baseline['progress'])
        with self.assertRaisesRegex(ValueError, 'actual changed artifact digest'):
            memory.assess_memory(reviews, baseline, current, writes)

    def test_undeclared_or_stale_update_is_rejected(self):
        for invalid in ('undeclared', 'stale'):
            with self.subTest(invalid=invalid):
                reviews, baseline, current, writes = self.fixture(('changelog', 'progress'))
                if invalid == 'undeclared':
                    writes.remove('progress.md')
                else:
                    reviews['progress']['artifacts'][0]['sha256'] = 'stale'
                with self.assertRaises(ValueError):
                    memory.assess_memory(reviews, baseline, current, writes)

    def test_read_only_task_needs_no_memory_edits(self):
        reviews, baseline, current, _ = self.fixture()
        for review in reviews.values():
            review['status'] = 'not_applicable'
        memory.assess_memory(reviews, baseline, current, [])

    def test_partial_review_still_requires_affected_mandatory_category(self):
        reviews, baseline, current, writes = self.fixture()
        with self.assertRaisesRegex(ValueError, 'modifying task requires.*updated'):
            memory.assess_memory({'changelog': reviews['changelog']},
                                 {'changelog': baseline['changelog']},
                                 {'changelog': current['changelog']}, writes)

    def test_real_cli_blocks_close_until_both_records_change(self):
        with tempfile.TemporaryDirectory(prefix='devtest-memory-test-') as directory:
            root = Path(directory)
            context = Path(__file__).parents[1]
            shutil.copytree(context, root / '.context',
                            ignore=shutil.ignore_patterns('__pycache__', 'agents'))
            # This regression targets the preserved2.4 CLI, whose current BOOT is
            # deliberately retired after2.6 cutover. Use its saved fixture entry.
            legacy = context.parent / '.recovery'
            boot = legacy / 'BOOT.context24.md'
            agent = legacy / 'AGENTS.context24.md'
            if boot.is_file():
                shutil.copyfile(boot, root / '.context/BOOT.md')
            shutil.copyfile(agent if agent.is_file() else context.parent / 'AGENTS.md', root / 'AGENTS.md')
            (root / 'change.txt').write_text('isolated fixture\n')

            def cli(*args, passed=True):
                result = subprocess.run(
                    [sys.executable, '-B', '.context/router.py', 'agent', *args],
                    cwd=root, text=True, capture_output=True, timeout=20,
                    env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
                self.assertEqual(result.returncode == 0, passed, result.stdout + result.stderr)
                return result.stdout + result.stderr

            cli('start', '--id', 'fixture', '--task', 'Test required state updates',
                '--write', 'change.txt', '--write', '.context/state/changelog.md',
                '--write', '.context/state/progress.md', '--verify',
                shlex.quote(sys.executable) + ' -c ' + shlex.quote('print("fixture check")'))
            # This measurement belongs only to the disposable test host.
            cli('context', '--id', 'fixture', '--used-tokens', '1',
                '--window-tokens', '1000', '--source', 'isolated-test-host')
            cli('verify', '--id', 'fixture')
            for category in ('changelog', 'progress'):
                output = cli('review', '--id', 'fixture', '--category', category,
                             '--status', 'unchanged', '--reason', 'Fixture missing update.', passed=False)
                self.assertIn('modifying task requires an updated record', output)
            cli('finish', '--id', 'fixture', passed=False)
            for category in ('changelog', 'progress'):
                path = root / '.context/state' / (category + '.md')
                path.write_text(path.read_text() + '\nIsolated fixture outcome recorded.\n')
            cli('verify', '--id', 'fixture')
            for category in memory.MEMORY:
                cli('review', '--id', 'fixture', '--category', category,
                    '--status', 'updated' if category in ('changelog', 'progress') else 'unchanged',
                    '--reason', 'Fixture memory reviewed.')
            self.assertIn('CA_WISDOM - COMPLETED', cli('finish', '--id', 'fixture'))


if __name__ == '__main__':
    unittest.main()
