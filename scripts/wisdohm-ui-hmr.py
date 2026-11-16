"""Compatible TSX refresh acceptance; source edits occur only in a physical fixture."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
from urllib.request import Request, urlopen

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/evidence/wisdohm-ui/hmr'
SOURCE = 'plugins/ui-rules/src/view.tsx'


def api(base, path, body=None):
    request = Request(base + path, data=None if body is None else json.dumps(body).encode(),
                      headers={} if body is None else {'Content-Type': 'application/json'})
    with urlopen(request, timeout=30) as response:
        return json.load(response)


def until(check, message, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        time.sleep(.05)
    raise AssertionError(message)


def live_hashes():
    names = [SOURCE, 'plugins/ui-rules/src/index.ts', 'plugins/ui-rules/src/controls.tsx',
             'plugins/ui-rules/src/harness.tsx', 'plugins/ui-rules/src/use-snapshot.ts',
             'plugins/ui-rules/src/memory.tsx', 'plugins/ui-rules/src/rules.css',
             'plugins/ui-rules/src/memory.css', 'plugins/ui-projects/src/view.tsx',
             'plugins/ui-hood/src/view.tsx', 'src/shell.tsx']
    return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in names}


def seed_clone(root):
    assert root.is_relative_to(ROOT.parent / '.qa-fixtures'), 'Expected owned physical fixture'
    assert (root / 'node_modules/@devlab/ui-rules').resolve().is_relative_to(root), 'Rules source alias escapes fixture'
    (root / 'owned.txt').write_text('owned original\n')
    spec = importlib.util.spec_from_file_location('wisdohm_ui_seed', ROOT / 'scripts/wisdohm-ui-browser.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.seed(root)
    # A real retained iframe independent of the edited Rules Board component.
    (root / 'hmr-preview.html').write_text('<!doctype html><title>HMR retained preview</title>'
                                         '<label>Preview input <input aria-label="Preview input"></label>')
    descriptor = root / 'devlab.preview.json'
    data = json.loads(descriptor.read_text())
    data['views'] = [{'id': 'qa-hmr-preview', 'label': 'QA retained preview', 'path': '/hmr-preview.html'}]
    descriptor.write_text(json.dumps(data) + '\n')


def exercise(page, settings):
    base, root = settings['url'], Path(settings['root'])
    seed_clone(root)
    api(base, '/api/canvas', {'projectId': 'default', 'expectedRevision': 0,
        'graph': {'name': 'Private WISDOHM HMR retention', 'nodes': [{
            'id': 'wis-hmr-terminal', 'type': 'terminal', 'position': {'x': 80, 'y': 60},
            'data': {'label': 'HMR retained terminal', 'cwd': '.', 'shell': 'bash',
                     'ownership': {'mode': 'off'}}}], 'edges': []}})
    frontend = api(base, '/api/servers/default/start', {})
    assert frontend['status'] == 'ready', frontend
    assert frontend['url'].rstrip('/') == settings['frontendURL'], frontend
    page.goto(settings['frontendURL'], wait_until='domcontentloaded')
    page.get_by_test_id('workspace-view-terminals').click()
    sessions = lambda: api(base, '/api/terminals?projectId=default')
    terminal = until(lambda: next((item for item in sessions() if item['nodeId'] == 'wis-hmr-terminal'
                                  and item['status'] == 'running'), None), 'Private terminal did not become ready')
    page.get_by_role('button', name='Build canvas', exact=True).click()
    file_button = page.get_by_role('button', name='Open owned.txt', exact=True)
    if not file_button.is_visible():
        page.get_by_role('button', name='Expand project explorer', exact=True).click()
    file_button.click()
    editor = page.get_by_role('textbox', name='File contents', exact=True, include_hidden=True)
    editor.fill('unsaved WISDOHM compatible refresh draft')
    editor.evaluate('el => window.__wisHmrEditor = el')
    outer_id = page.evaluate('window.__wisHmrDocument = crypto.randomUUID()')
    frame = page.frame_locator('iframe[title^="Project UI"]').first
    preview = frame.get_by_role('textbox', name='Preview input', exact=True)
    preview.fill('retained WISDOHM HMR preview')
    frame_id = frame.locator('body').evaluate('() => window.__wisHmrPreview = crypto.randomUUID()')
    controls = page.get_by_test_id('wisdohm-controls')
    expect(controls).to_contain_text('40 records')
    controls.get_by_role('button', name='Inspect WISDOHM harness', exact=True).click()
    board = page.get_by_role('dialog', name='Rules Board', exact=True)
    harness = board.get_by_test_id('wisdohm-harness')
    board.get_by_role('button', name='Next step', exact=True).click()
    board.get_by_role('button', name='Next step', exact=True).click()
    expect(harness).to_contain_text('Step 3 of 5')
    board.get_by_role('tab', name='Rules and guidance', exact=True).click()
    search = board.get_by_role('searchbox', name='Search rules and evidence', exact=True)
    search.fill('YAGNI')
    search.evaluate('el => window.__wisHmrSearch = el')
    source = root / SOURCE
    original = source.read_text()
    anchor = "embedded ? 'WISDOHM' : 'Rules Board'"
    assert original.count(anchor) == 1, 'Compatible title anchor changed; review the HMR stimulus'
    started = time.monotonic()
    source.write_text(original.replace(anchor, "embedded ? 'WISDOHM' : 'Rules Board HMR QA'", 1))
    refreshed = page.get_by_role('dialog', name='Rules Board HMR QA', exact=True)
    expect(refreshed).to_be_visible(timeout=20000)
    first_ms = round((time.monotonic() - started) * 1000, 1)
    search = refreshed.get_by_role('searchbox', name='Search rules and evidence', exact=True)
    expect(search).to_have_value('YAGNI')
    assert search.evaluate('el => el === window.__wisHmrSearch'), 'Rules search input was remounted'
    refreshed.get_by_role('tab', name='Harness', exact=True).click()
    expect(refreshed.get_by_test_id('wisdohm-harness')).to_contain_text('Step 3 of 5')
    started = time.monotonic()
    source.write_text(source.read_text().replace("'Rules Board HMR QA'", "'Rules Board HMR QA 2'", 1))
    refreshed = page.get_by_role('dialog', name='Rules Board HMR QA 2', exact=True)
    expect(refreshed).to_be_visible(timeout=20000)
    second_ms = round((time.monotonic() - started) * 1000, 1)
    expect(refreshed.get_by_test_id('wisdohm-harness')).to_contain_text('Step 3 of 5')
    refreshed.get_by_role('tab', name='Rules and guidance', exact=True).click()
    expect(refreshed.get_by_role('searchbox', name='Search rules and evidence', exact=True)).to_have_value('YAGNI')
    assert page.evaluate('window.__wisHmrDocument') == outer_id, 'Outer document reloaded'
    expect(editor).to_have_value('unsaved WISDOHM compatible refresh draft')
    assert editor.evaluate('el => el === window.__wisHmrEditor'), 'Outer editor input remounted'
    expect(preview).to_have_value('retained WISDOHM HMR preview')
    assert frame.locator('body').evaluate('() => window.__wisHmrPreview') == frame_id, 'Preview document reloaded'
    same_terminal = next(item for item in sessions() if item['id'] == terminal['id'])
    assert same_terminal['pid'] == terminal['pid'] and same_terminal['status'] == 'running', same_terminal
    assert (root / 'owned.txt').read_text() == 'owned original\n', 'HMR saved the unsaved editor draft'
    page.screenshot(path=str(OUT / 'retained-search.png'), full_page=True)
    refreshed.get_by_role('tab', name='Harness', exact=True).click()
    page.screenshot(path=str(OUT / 'retained-harness.png'), full_page=True)
    return dict(width=1440, compatibleTsxChanges=2, sameSearchInput=True, searchRetained=True,
                harnessStepRetained=3, sameEditorInput=True, unsavedDraftRetained=True,
                sameOuterDocument=True, samePreviewDocument=True, previewInputRetained=True,
                sameTerminalPid=terminal['pid'], terminalSessionId=terminal['id'],
                firstRefreshMs=first_ms, secondRefreshMs=second_ms)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    before = live_hashes()
    report = dict(passed=False, liveSourceHashes=before, javascriptErrors=[], cleanup=None)
    fixture = None
    with tempfile.TemporaryFile(mode='w+', dir='/dev/shm') as log:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel='chrome', headless=True)
            context = None
            try:
                fixture = subprocess.Popen(['node', 'scripts/ui-elements-fixture.ts'], cwd=ROOT,
                    env=os.environ.copy(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                    stderr=log, text=True, bufsize=1)
                line = fixture.stdout.readline()
                if not line:
                    log.seek(0)
                    raise AssertionError('Physical fixture failed before readiness: ' + log.read()[-8000:])
                settings = json.loads(line)
                context = browser.new_context(viewport={'width': 1440, 'height': 1000})
                page = context.new_page()
                page.set_default_timeout(20000)
                page.on('pageerror', lambda error: report['javascriptErrors'].append(str(error)))
                report['result'] = exercise(page, settings)
                assert not report['javascriptErrors'], report['javascriptErrors']
                report['passed'] = True
            except Exception as error:
                report['error'] = str(error)
                if context:
                    page.screenshot(path=str(OUT / 'failure.png'), full_page=True)
                raise
            finally:
                if context:
                    context.close()
                try:
                    if fixture:
                        if fixture.poll() is None:
                            fixture.stdin.write('close\n')
                            fixture.stdin.flush()
                        stdout, _ = fixture.communicate(timeout=45)
                        log.seek(0)
                        (OUT / 'fixture.log').write_text(log.read())
                        cleanup = next((json.loads(item) for item in stdout.splitlines()
                                        if item.startswith('{"closed":')), None)
                        report['cleanup'] = cleanup
                        assert fixture.returncode == 0, 'Fixture cleanup failed; see fixture.log'
                        assert cleanup and cleanup['closed'] and cleanup['processesGone'] and cleanup['removed'], cleanup
                        assert not cleanup['forcedPids'], cleanup
                    report['liveSourceUnchanged'] = live_hashes() == before
                    assert report['liveSourceUnchanged'], 'HMR stimulus changed the live source'
                except Exception as error:
                    report['passed'] = False
                    report['cleanupError'] = str(error)
                    raise
                finally:
                    browser.close()
                    (OUT / 'acceptance.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
