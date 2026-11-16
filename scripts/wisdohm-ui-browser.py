"""Real private-profile acceptance for sidebar, harness and Dagre memory layers."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import time
from urllib.parse import quote
from urllib.request import Request, urlopen
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/evidence/wisdohm-ui/browser'

def api(base, path, body=None):
    with urlopen(Request(base + path, data=None if body is None else json.dumps(body).encode(),
                         headers={} if body is None else {'Content-Type': 'application/json'}), timeout=20) as response:
        return json.load(response)

def seed(root):
    def write(name, text):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    for name in ['BOOT.md', 'protocols/rules.md', 'protocols/updates.md', 'policy.yaml', 'journey.yaml']:
        write('.wisdohm/' + name, (ROOT / '.wisdohm' / name).read_text())
    for name in ['router.py', 'session.py', 'common.py', 'store.py', 'orchestration.py']:
        write('.wisdohm/' + name, 'raise RuntimeError("FIXTURE RUNTIME MUST NOT EXECUTE")\n')
    guidance = '1. Keep private observations read-only.\n'
    write('docs/guidance.md', guidance)
    write('.wisdohm/protocols/maintenance.md', '# Maintenance\n1. Preserve data.\n[reviewed]: ../../docs/guidance.md "sha256:' + hashlib.sha256(guidance.encode()).hexdigest() + '"\n')
    write('.wisdohm/config/project.yaml', 'project: private-ui-fixture\nmode: autonomous\ncommands: {}\nrules:\n  protected_paths: []\nownership: {}\n')
    write('AGENTS.md', 'Read .wisdohm/BOOT.md and .context/modules/registry.yaml.\n')
    write('.context/modules/registry.yaml', 'schema_version: 1\nmodules:\n  fixture-owner:\n    agent: fixture\n    paths: [owned.txt]\n    purpose: Private fixture\n    depends_on: []\n    public_surfaces: []\n')
    write('.wisdohm/config/agents.yaml', 'schema_version: 1\nprofiles:\n  fixture:\n    description: Private fixture executor\n    skills: [docs/fixture/SKILL.md]\n')
    write('docs/fixture/SKILL.md', '# Fixture skill\n1. Preserve read-only inspection.\n')
    # Project entry skills are real text, never executed.
    for name in ['wisdohm-orchestrate', 'wisdohm-owner']:
        write('.agents/skills/' + name + '/SKILL.md', '# Private fixture skill\n1. Preserve data.\n')
    database = root / '.wisdohm/memory.sqlite'
    with sqlite3.connect(database) as db:
        for statement in [
            'CREATE TABLE sessions(id TEXT PRIMARY KEY,revision INTEGER,data TEXT)',
            'CREATE TABLE memory(kind TEXT,key TEXT,body TEXT,task_id TEXT REFERENCES sessions(id),updated_at TEXT,PRIMARY KEY(kind,key))',
            'CREATE TABLE events(seq INTEGER PRIMARY KEY,task_id TEXT REFERENCES sessions(id),action TEXT,payload TEXT,at TEXT)',
            'CREATE TABLE claims(path TEXT PRIMARY KEY,task_id TEXT REFERENCES sessions(id))', 'PRAGMA user_version=1']:
            db.execute(statement)
        state = dict(schema_version=2, id='fixture-admin', root=str(root), kind='maintenance', owner='fixture-owner',
                     task='Private administrative memory fixture', stage='IMPORTED', _legacy=True,
                     read=[], write=[], rules=[], verify=[], checks=[], context=None, outputs=None,
                     memory=None, receipt={}, inputs={}, summary='Synthetic fixture only.', next='Inspect.')
        state['digest'] = hashlib.sha256(json.dumps(state, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        db.execute('INSERT INTO sessions VALUES(?,?,?)', ('fixture-admin', 1, json.dumps(state)))
        body = dict(text='Private observed source', source_path='owned.txt', sha256=hashlib.sha256((root / 'owned.txt').read_bytes()).hexdigest())
        for number in range(40):
            db.execute('INSERT INTO memory VALUES(?,?,?,?,?)', ('codebase', 'fixture/' + str(number), json.dumps(body), 'fixture-admin', '2026-11-01T00:00:00Z'))
        db.execute('INSERT INTO events VALUES(?,?,?,?,?)', (1, 'fixture-admin', 'ADMIN_IMPORT', '{}', '2026-11-01T00:00:00Z'))
    return database

def exercise(page, settings, width):
    base, project, root = settings['url'], settings['projectId'], Path(settings['root'])
    database = seed(root)
    before = database.read_bytes()
    real = api(base, '/api/rules?projectId=' + quote(project))
    assert real['harness']['memoryGraph']['status'] == 'ready', real
    assert real['harness']['memory']['integrity'] == 'ok'
    assert real['harness']['routing']['status'] == 'valid'
    page.goto(base + '?projectId=' + quote(project), wait_until='domcontentloaded')
    page.get_by_role('button', name='Build canvas', exact=True).click()
    expand = page.get_by_role('button', name='Expand project explorer', exact=True)
    if expand.is_visible():
        expand.click()
    # An asynchronous file tree is distinct from a collapsed explorer.
    expect(page.get_by_role('button', name='Open owned.txt', exact=True)).to_be_visible()
    page.get_by_role('button', name='Open owned.txt', exact=True).click()
    editor = page.get_by_role('textbox', name='File contents', exact=True, include_hidden=True)
    editor.fill('unsaved WISDOHM panel draft')
    editor.evaluate("el => el.dataset.retention = 'wis-editor'")
    frame = page.frame_locator('iframe[title^="Project UI"]').first
    frame.get_by_role('textbox', name='Preview input', exact=True).fill('retained WISDOHM preview')
    control = page.get_by_test_id('wisdohm-controls')
    expect(control).to_be_visible()
    assert control.evaluate("el => !!el.closest('.project-file-tree')")
    expect(control).to_contain_text('40 records')
    expect(control).to_contain_text('healthy')
    control.get_by_role('button', name='Inspect WISDOHM harness', exact=True).click()
    board = page.get_by_role('dialog', name='Rules Board', exact=True)
    expect(board.get_by_test_id('wisdohm-harness')).to_contain_text('Step 1 of 5')
    for number in range(2, 6):
        board.get_by_role('button', name='Next step', exact=True).click()
        expect(board.get_by_test_id('wisdohm-harness')).to_contain_text('Step ' + str(number) + ' of 5')
    expect(board.get_by_role('button', name='Next step', exact=True)).to_be_disabled()
    board.get_by_text('Open step source', exact=True).click()
    expect(board.locator('.wisdohm-gate-source pre')).to_contain_text('CA_WISDOHM')
    page.screenshot(path=str(OUT / ('harness-' + str(width) + '.png')), full_page=True)
    page.keyboard.press('Escape')
    expect(board).to_have_count(0)
    expect(control.get_by_role('button', name='Inspect WISDOHM harness')).to_be_focused()
    control.get_by_role('button', name='Inspect WISDOHM memory', exact=True).click()
    memory = board.get_by_test_id('wisdohm-memory')
    expect(memory).to_be_visible()
    expect(memory.locator('.react-flow__node').first).to_be_visible()
    expect(memory).to_contain_text('32')
    expect(memory).to_contain_text('40')
    # Existing inspector and layout controls remain real, rather than a drawn mock graph.
    memory.get_by_role('button', name='Layout', exact=True).click()
    memory.get_by_role('combobox', name='Layout direction', exact=True).select_option('TB')
    memory.get_by_role('button', name='Dagre layout', exact=True).click()
    page.screenshot(path=str(OUT / ('memory-' + str(width) + '.png')), full_page=True)
    page.keyboard.press('Escape')
    # Escape closes a local graph drawer first, then the enclosing inspection.
    if board.count(): page.keyboard.press('Escape')
    expect(board).to_have_count(0)
    page.get_by_role('button', name='Pop the Hood', exact=True).click()
    hood = page.get_by_role('dialog', name='Pop the Hood', exact=True)
    expect(hood).to_be_visible()
    hood.get_by_role('tab', name='Memory', exact=True).click()
    expect(hood.get_by_test_id('wisdohm-memory')).to_be_visible()
    hood.get_by_role('tab', name='WISDOHM harness', exact=True).click()
    expect(hood.get_by_test_id('wisdohm-harness')).to_contain_text('Step 1 of 5')
    hood.get_by_role('tab', name='Architecture', exact=True).click()
    expect(hood.locator('.react-flow__node').first).to_be_visible()
    page.keyboard.press('Escape')
    expect(hood).to_have_count(0)
    expect(editor).to_have_value('unsaved WISDOHM panel draft')
    expect(editor).to_have_attribute('data-retention', 'wis-editor')
    expect(frame.get_by_role('textbox', name='Preview input', exact=True)).to_have_value('retained WISDOHM preview')
    # A failed refresh keeps a clearly stale observation; a later refresh recovers.
    def fail(route): route.fulfill(status=503, content_type='application/json', body='{"error":"private fixture unavailable"}')
    page.route('**/api/rules?*', fail)
    control.get_by_role('button', name='Refresh WISDOHM status', exact=True).click()
    expect(control.get_by_role('alert')).to_contain_text('last observation')
    page.unroute('**/api/rules?*', fail)
    control.get_by_role('button', name='Refresh WISDOHM status', exact=True).click()
    expect(control.get_by_role('alert')).to_have_count(0)
    assert database.read_bytes() == before, 'Inspection mutated operational memory'
    assert (root / 'owned.txt').read_text() == 'owned original\n', 'Inspection saved the unsaved editor draft'
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Page overflow'
    return dict(width=width, realReader=True, panelInsideFileTree=True, fiveSourceBackedSteps=True,
                dagreMemoryLayer=True, separateHoodLayers=True, draftAndPreviewRetained=True,
                failureAndRecovery=True, sqliteUnchanged=True)

def main():
    args = argparse.ArgumentParser(); args.add_argument('--width', type=int, choices=[1440, 820]); width = args.parse_args().width
    build = Path(os.environ['DEVLAB_BUILD_DIR']).resolve(); OUT.mkdir(parents=True, exist_ok=True)
    results, errors = [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True)
        try:
            for size in ([width] if width else [1440, 820]):
                with tempfile.TemporaryDirectory(prefix='wis-ui-', dir='/dev/shm') as private, tempfile.TemporaryFile(mode='w+', dir='/dev/shm') as log:
                    fixture = subprocess.Popen(['node', 'scripts/terminal-fixture.ts'], cwd=ROOT,
                        env={**os.environ, 'TMPDIR': private, 'DEVLAB_BUILD_DIR': str(build)},
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, text=True)
                    context = None
                    try:
                        line = fixture.stdout.readline()
                        if not line: log.seek(0); raise AssertionError(log.read())
                        settings = json.loads(line); assert Path(settings['root']).is_relative_to(private)
                        context = browser.new_context(viewport={'width': size, 'height': 1000})
                        page = context.new_page(); page.set_default_timeout(15000)
                        page.on('pageerror', lambda e: errors.append(str(e)))
                        results.append(exercise(page, settings, size))
                    except Exception:
                        if context: page.screenshot(path=str(OUT / ('failure-' + str(size) + '.png')), full_page=True)
                        raise
                    finally:
                        if context: context.close()
                        if fixture.poll() is None:
                            fixture.stdin.write('close\n'); fixture.stdin.flush()
                        stdout, _ = fixture.communicate(timeout=25)
                        log.seek(0); assert fixture.returncode == 0, log.read()
                        assert any('"processesGone":true' in line for line in stdout.splitlines()), stdout
            assert not errors, errors
        finally: browser.close()
    report = dict(passed=True, results=results, javascriptErrors=errors, liveUserStateUsed=False)
    (OUT / 'acceptance.json').write_text(json.dumps(report, indent=2) + '\n'); print(json.dumps(report, indent=2))
if __name__ == '__main__': main()
