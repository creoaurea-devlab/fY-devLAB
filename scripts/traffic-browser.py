"""TRAFFIC browser acceptance in a disposable source and data copy."""
import json
import hashlib
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

try:
    from playwright.sync_api import expect, sync_playwright
except ModuleNotFoundError:
    if sys.executable != '/usr/bin/python3':
        os.execv('/usr/bin/python3', ['/usr/bin/python3', __file__, *sys.argv[1:]])
    raise

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(os.environ.get('TRAFFIC_EVIDENCE_DIR', '/tmp/devlab-traffic-evidence'))
OUT.mkdir(parents=True, exist_ok=True)


def api(base, path, body):
    with urlopen(Request(base + path, data=json.dumps(body).encode(),
                         headers={'Content-Type': 'application/json'}), timeout=25) as response:
        return json.load(response)


def snapshot(project, path):
    return {'projectId': project, 'observedAt': datetime.now(timezone.utc).isoformat(),
            'status': 'ready', 'totalSessions': 1, 'totalClaims': 1, 'truncated': False,
            'sessions': [{'id': 'session-' + project, 'stepId': 'TRAFFIC-UI',
                          'owner': 'workspace-shell', 'stage': 'WORK',
                          'updatedAt': '2020-01-01T00:00:00Z'}],
            'claims': [{'path': path, 'sessionId': 'session-' + project}]}


def run(page, settings, width):
    project_settings = Path(settings['root']) / '.agents/project.yaml'
    original_settings = project_settings.read_text()
    assert original_settings.count('history_roots:\n') == 1
    project_settings.write_text(original_settings.replace('history_roots:\n',
        'history_roots:\n- ' + str(ROOT) + '\n', 1))
    other = api(settings['url'], '/api/projects', {'id': 'traffic-second', 'label': 'Traffic second'})['id']
    frontend = api(settings['url'], '/api/servers/default/start', {})
    assert frontend['status'] == 'ready', frontend
    mode = {'error': False, 'requests': 0}
    def traffic(route):
        mode['requests'] += 1
        assert route.request.method == 'GET'
        project = parse_qs(urlparse(route.request.url).query)['projectId'][0]
        if mode['error']:
            route.fulfill(status=503, content_type='application/json', body='{}')
        else:
            path = 'plugins/ui-shell/src/traffic.tsx' if project == 'default' else 'src/second-project.tsx'
            route.fulfill(status=200, content_type='application/json', body=json.dumps(snapshot(project, path)))
    page.route('**/api/rules/activity?*', traffic)
    page.route('**/api/harness/activity', lambda route: route.fulfill(status=200, content_type='application/json',
        body=json.dumps({'runs': [{'id': 'run-a', 'projectId': 'default', 'taskId': 'TRAFFIC-UI',
                                  'status': 'running', 'output': '', 'updatedAt': datetime.now(timezone.utc).isoformat()}],
                         'batches': []})))
    page.goto(settings['frontendURL'], wait_until='domcontentloaded')
    tab = page.get_by_test_id('workspace-view-traffic')
    expect(tab).to_be_visible()
    tab.focus()
    page.keyboard.press('Enter')
    expect(tab).to_have_attribute('aria-pressed', 'true')
    board = page.get_by_test_id('traffic-board')
    expect(board).to_be_visible()
    expect(board.get_by_text('Claims: ready', exact=False)).to_be_visible()
    expect(board.get_by_text('Harness: current', exact=True)).to_be_visible()
    expect(board.get_by_text('Planner: current', exact=True)).to_be_visible()
    expect(board.locator('.traffic-warning')).to_have_count(0)
    for lane in ['Running', 'Reserved', 'Waiting', 'Review']:
        expect(board.get_by_role('heading', name=lane, exact=False)).to_be_visible()
    expect(board.locator('code').filter(has_text='plugins/ui-shell/src/traffic.tsx')).to_be_visible()
    expect(board.get_by_text('Session session-default')).to_be_visible()
    expect(board.get_by_text('Live run confirmed', exact=False)).to_be_visible()
    assert board.evaluate('(node) => node.scrollWidth <= node.clientWidth + 2'), 'TRAFFIC board overflows horizontally'

    mode['error'] = True
    board.get_by_role('button', name='Refresh').click()
    expect(board.get_by_text('Some sources are unavailable or stale', exact=False)).to_be_visible()
    expect(board.get_by_text('Claims: ready', exact=False)).to_contain_text('stale')
    expect(board.locator('code').filter(has_text='plugins/ui-shell/src/traffic.tsx')).to_be_visible()
    mode['error'] = False
    board.get_by_role('button', name='Refresh').click()
    expect(board.get_by_text('Claims: ready', exact=False)).to_be_visible()

    page.get_by_role('combobox', name='Active project').select_option(other)
    expect(board.locator('code').filter(has_text='src/second-project.tsx')).to_be_visible()
    expect(board.locator('code').filter(has_text='plugins/ui-shell/src/traffic.tsx')).to_have_count(0)
    assert board.get_by_text('default · Harness run run-a').count() == 1

    canvas = page.locator('.project-flow-stage').first
    canvas.evaluate('(node) => { window.__trafficCanvas = node; }')
    page.get_by_role('button', name='Workflow', exact=True).click()
    expect(canvas).to_be_visible()
    page.get_by_test_id('workspace-view-whiteboard').click()
    expect(page.locator('.workspace-whiteboard-stage')).to_be_visible()
    tab.click()
    expect(board).to_be_visible()
    assert page.evaluate('document.querySelector(".project-flow-stage") === window.__trafficCanvas')

    css = Path(settings['root']) / 'plugins/ui-shell/src/devlab.css'
    original = css.read_text()
    try:
        css.write_text(original + '\n.traffic-board{outline:3px solid rgb(1, 2, 3)}\n')
        expect(board).to_have_css('outline-color', 'rgb(1, 2, 3)', timeout=15000)
        assert page.evaluate('document.querySelector(".project-flow-stage") === window.__trafficCanvas')
    finally:
        css.write_text(original)
    page.screenshot(path=str(OUT / f'traffic-{width}.png'), full_page=True)
    return {'width': width, 'projectFence': True, 'staleError': True, 'retainedCanvas': True,
            'cssHmr': True, 'requests': mode['requests']}


def main():
    report = {'results': [], 'pageErrors': [], 'cleanup': []}
    paths = ['plugins/ui-shell/src/view.tsx', 'plugins/ui-shell/src/traffic.tsx', 'plugins/ui-shell/src/devlab.css']
    live = {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in paths}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='chrome', headless=True)
        try:
            for width in (1440, 820):
                with tempfile.TemporaryFile(mode='w+') as log:
                    fixture = subprocess.Popen(['node', 'scripts/ui-elements-fixture.ts'], cwd=ROOT,
                        env=os.environ.copy(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                        stderr=log, text=True, bufsize=1)
                    context = None
                    try:
                        first = fixture.stdout.readline()
                        assert first, 'Private fixture did not start'
                        settings = json.loads(first)
                        context = browser.new_context(viewport={'width': width, 'height': 900})
                        page = context.new_page()
                        page.on('pageerror', lambda error: report['pageErrors'].append(str(error)))
                        report['results'].append(run(page, settings, width))
                    except Exception:
                        if context:
                            page.screenshot(path=str(OUT / f'failure-{width}.png'), full_page=True)
                        log.seek(0)
                        print(log.read()[-8000:])
                        raise
                    finally:
                        if context:
                            context.close()
                        if fixture.poll() is None:
                            fixture.stdin.write('close\n')
                            fixture.stdin.flush()
                        stdout, _ = fixture.communicate(timeout=40)
                        log.seek(0)
                        assert fixture.returncode == 0, log.read()
                        cleanup = next((json.loads(line) for line in stdout.splitlines() if line.startswith('{"closed":')), None)
                        assert cleanup and cleanup['closed'] and cleanup['processesGone'] and cleanup['removed'] and not cleanup['forcedPids'], stdout
                        report['cleanup'].append(cleanup)
            assert not report['pageErrors'], report['pageErrors']
            assert len(report['results']) == 2
            assert live == {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in paths}
            report['passed'] = True
        finally:
            browser.close()
    (OUT / 'browser.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
