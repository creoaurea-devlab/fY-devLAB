"""Private browser/real-PTY acceptance; Codex is an explicit local stub, never a model call."""
import argparse
from copy import deepcopy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
from urllib.parse import quote
from urllib.request import Request, urlopen
import uuid

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/evidence/spec-agent/browser'


def api(base, path, body=None):
    with urlopen(Request(base + path, data=None if body is None else json.dumps(body).encode(),
                         headers={} if body is None else {'Content-Type': 'application/json'}), timeout=20) as response:
        return json.load(response)


def until(check, message, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        time.sleep(.05)
    raise AssertionError(message)


def stub(private):
    binary = private / 'bin/codex'
    binary.parent.mkdir()
    binary.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys, time
request = sys.stdin.read()
with open(STUB_LOG_PATH, 'a') as log:
    log.write(json.dumps({'pid': os.getpid(), 'argv': sys.argv[1:], 'request': request}) + '\\n')
if 'CANCEL_FIXTURE' in request:
    time.sleep(120)
if 'FAIL_FIXTURE' in request:
    print('Explicit provider fixture failure', flush=True)
    sys.exit(17)
artifact = sys.argv[sys.argv.index('--output-last-message') + 1]
draft = {'title':'Fixture SPEC', 'specification':'# Fixture specification\\nPreserve existing work and implement the reviewed owned change.', 'questions':[], 'slices':[{'title':'Fixture slice', 'tasks':[{'title':'Fixture atomic task', 'moduleId':'fixture-owner', 'read':['owned.txt'], 'write':['owned.txt'], 'verify':['node --version'], 'acceptance':['The reviewed owned change is observable.']}]}]}
pathlib.Path(artifact).write_text(json.dumps(draft))
'''.replace('STUB_LOG_PATH', repr(str(private / 'invocations.jsonl'))))
    binary.chmod(0o700)
    return binary


def exercise(page, settings, private, width):
    base, project, root = settings['url'], settings['projectId'], Path(settings['root'])
    (root / '.context/state').mkdir(parents=True, exist_ok=True)
    (root / '.context/BOOT.md').write_text('# Disposable SPEC Agent planning fixture\n')
    (root / '.context/state/tasks.json').write_text(json.dumps(dict(schema_version=1, goals=[], milestones=[], slices=[], tasks=[])))
    endpoint = '/api/planning/workspace?projectId=' + quote(project)
    workspace = api(base, endpoint)
    registry = deepcopy(workspace['registry'])
    registry['goals'].append({'id': 'EXISTING-G', 'title': 'Existing goal'})
    registry['milestones'].append({'id': 'EXISTING-M', 'goal': 'EXISTING-G', 'title': 'Existing milestone'})
    registry['slices'].append({'id': 'EXISTING-S', 'milestone': 'EXISTING-M', 'title': 'Existing slice'})
    registry['tasks'].append({'id': 'EXISTING-T', 'slice': 'EXISTING-S', 'title': 'Existing task', 'effect': 'feature',
                              'agent': 'general', 'module': 'fixture-owner', 'mode': 'worker', 'depends_on': [],
                              'read': ['owned.txt'], 'write': ['owned.txt'], 'verify': ['node --version'],
                              'acceptance': ['Existing task remains unchanged.']})
    api(base, '/api/planning/workspace/command', {'projectId': project, 'commandId': str(uuid.uuid4()),
        'expectedRevision': workspace['revision'], 'expectedDigest': workspace['digest'], 'actor': 'fixture-seed',
        'operation': {'kind': 'import', 'registry': registry}})
    before = api(base, endpoint)
    canonical = {name: (root / '.context/state' / name).read_bytes() for name in ['tasks.json', 'progress.json']}
    retained = api(base, '/api/terminals', {'projectId': project, 'nodeId': 'fixture-retained', 'cwd': '.', 'shell': 'bash', 'cols': 80, 'rows': 24})
    sessions = lambda: api(base, '/api/terminals?projectId=' + quote(project))
    plan_posts = []
    page.on('request', lambda request: plan_posts.append(request.url) if request.method == 'POST' and '/api/planning/' in request.url else None)
    page.goto(base + '?projectId=' + quote(project), wait_until='domcontentloaded')
    page.get_by_role('button', name='Build canvas', exact=True).click()
    expand = page.get_by_role('button', name='Expand project explorer', exact=True)
    if expand.is_visible():
        expand.click()
    page.get_by_role('button', name='Open owned.txt', exact=True).click()
    editor = page.get_by_role('textbox', name='File contents', exact=True, include_hidden=True)
    editor.fill('unsaved SPEC workspace draft')
    editor.evaluate("el => el.dataset.specRetention = 'editor'")
    iframe = page.locator('iframe[title^="Project UI"]').first
    iframe.evaluate("el => el.dataset.specRetention = 'frame'")
    preview = page.frame_locator('iframe[title^="Project UI"]').first.get_by_role('textbox', name='Preview input', exact=True)
    preview.fill('retained SPEC preview')
    expect(page.locator('[data-feature-id="PROTOTYPING"]').first).to_be_visible()
    expect(page.get_by_text('PROTOTYPING', exact=True).first).to_be_visible()
    button = page.get_by_test_id('btn-spec-agent')
    button.click()
    dialog = page.get_by_role('dialog', name='SPEC Agent', exact=True)
    expect(dialog).to_be_visible()
    assert dialog.evaluate('el => el.contains(document.activeElement)'), 'Native dialog did not own focus'
    goal = dialog.get_by_role('textbox', name='What are you building?', exact=True)
    injection = private / 'unexpected-shell-expansion'
    request = 'Build "quoted" owner\nwith a tab\tand literal `touch ' + str(injection) + '` and $(touch ' + str(injection) + ") and apostrophe ' retained."
    goal.fill(request)
    page.keyboard.press('Escape')
    expect(dialog).to_have_count(0)
    expect(button).to_be_focused()
    button.click()
    expect(goal).to_have_value(request)
    dialog.get_by_role('button', name='Generate specification', exact=True).click()
    expect(dialog.get_by_role('region', name='Generated specification', exact=True)).to_be_visible(timeout=25000)
    assert not injection.exists(), 'User request was executed by the shell'
    assert not plan_posts, 'Generation wrote planning before review'
    for name, content in canonical.items():
        assert (root / '.context/state' / name).read_bytes() == content, name + ' changed before explicit review'
    invocations = [json.loads(line) for line in (private / 'invocations.jsonl').read_text().splitlines()]
    assert len(invocations) == 1 and request in invocations[0]['request']
    assert invocations[0]['argv'][:3] == ['exec', '--sandbox', 'read-only']
    page.screenshot(path=str(OUT / ('review-' + str(width) + '.png')), full_page=True)
    dialog.get_by_role('button', name='Add reviewed spec to Kanban', exact=True).click()
    expect(dialog.get_by_role('button', name='Added to Kanban', exact=True)).to_be_disabled()
    after = api(base, endpoint)
    for group in ['goals', 'milestones', 'slices', 'tasks']:
        for item in before['registry'][group]:
            assert item in after['registry'][group], 'Import changed existing ' + group
    assert len(after['registry']['tasks']) == len(before['registry']['tasks']) + 1
    progress = json.loads((root / '.context/state/progress.json').read_text())
    new_tasks = [task for task in after['registry']['tasks'] if task not in before['registry']['tasks']]
    assert all(progress.get('states', {}).get(task['id'], {}).get('status') not in ['complete', 'DONE'] for task in new_tasks), progress
    dialog.get_by_role('button', name='Open Kanban', exact=True).click()
    expect(dialog).to_have_count(0)
    expect(page.get_by_role('button', name='SPEC Agent', exact=True).last).to_be_visible()
    button.click()
    goal.fill('CANCEL_FIXTURE: retain all other workspace owners')
    dialog.get_by_role('button', name='Generate specification', exact=True).click()
    expect(dialog.get_by_role('button', name='Cancel generation', exact=True)).to_be_visible()
    running = until(lambda: next((item for item in sessions() if item['nodeId'].startswith('spec-agent-') and item['status'] == 'running'), None), 'SPEC PTY did not start')
    cancel_pid = running['pid']
    until(lambda: len((private / 'invocations.jsonl').read_text().splitlines()) == 2, 'Cancellation stub did not launch')
    close_endpoint = base + '/api/terminals/' + running['id'] + '/close'
    close_attempts = []
    def reject_close(route):
        close_attempts.append(route.request.method)
        route.fulfill(status=503, content_type='application/json', body='{"error":"Explicit fixture: cancellation temporarily unavailable"}')
    page.route(close_endpoint, reject_close)
    dialog.get_by_role('button', name='Cancel generation', exact=True).click()
    expect(dialog.get_by_role('alert')).to_contain_text(running['id'])
    expect(dialog).to_be_visible()
    expect(dialog.get_by_role('button', name='Generate specification', exact=True)).to_be_disabled()
    assert close_attempts == ['POST'], close_attempts
    assert any(item['id'] == running['id'] and item['status'] == 'running' for item in sessions()), 'Failed close lost owned session'
    assert any(item['id'] == retained['id'] and item['pid'] == retained['pid'] and item['status'] == 'running' for item in sessions())
    page.screenshot(path=str(OUT / ('cancellation-retry-' + str(width) + '.png')), full_page=True)
    page.unroute(close_endpoint, reject_close)
    dialog.get_by_role('button', name='Cancel generation', exact=True).click()
    expect(dialog.get_by_role('alert')).to_contain_text('cancelled')
    until(lambda: not any(item['id'] == running['id'] and item['status'] == 'running' for item in sessions()), 'Owned PTY not closed')
    until(lambda: not Path('/proc/' + str(cancel_pid)).exists(), 'Cancelled shell PID survived')
    assert any(item['id'] == retained['id'] and item['pid'] == retained['pid'] and item['status'] == 'running' for item in sessions())
    goal.fill('FAIL_FIXTURE: report provider failure')
    dialog.get_by_role('button', name='Generate specification', exact=True).click()
    expect(dialog.get_by_role('alert')).to_contain_text('status 17', timeout=25000)
    assert len(api(base, endpoint)['registry']['tasks']) == len(after['registry']['tasks'])
    page.screenshot(path=str(OUT / ('failure-handling-' + str(width) + '.png')), full_page=True)
    page.keyboard.press('Escape')
    page.get_by_role('button', name='Build canvas', exact=True).click()
    expect(editor).to_have_value('unsaved SPEC workspace draft')
    expect(editor).to_have_attribute('data-spec-retention', 'editor')
    expect(iframe).to_have_attribute('data-spec-retention', 'frame')
    expect(preview).to_have_value('retained SPEC preview')
    assert (root / 'owned.txt').read_text() == 'owned original\n'
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Page overflow'
    kernel = page.context.new_page()
    kernel.set_default_timeout(15000)
    try:
        kernel.goto(base + '?view=kernel&projectId=' + quote(project), wait_until='domcontentloaded')
        contribution = kernel.get_by_role('checkbox', name='SPEC Agent', exact=True)
        contribution.check()
        launcher = kernel.get_by_role('button', name='Open SPEC Agent', exact=True)
        launcher.click()
        generic = kernel.get_by_role('dialog', name='SPEC Agent', exact=True)
        expect(generic).to_be_visible()
        assert generic.evaluate('el => el.contains(document.activeElement)')
        kernel.keyboard.press('Escape')
        expect(generic).to_have_count(0)
        expect(launcher).to_be_focused()
    except Exception:
        (OUT / ('kernel-failure-' + str(width) + '.txt')).write_text(kernel.locator('body').inner_text())
        kernel.screenshot(path=str(OUT / ('kernel-failure-' + str(width) + '.png')), full_page=True)
        raise
    finally:
        kernel.close()
    return dict(width=width, realPty=True, explicitProviderStub=True, providerNetworkUsed=False,
                reviewRequired=True, existingPlanningPreserved=True, cancellationOwnedOnly=True, cancellationFailureRetry=True,
                providerFailureVisible=True, nativeFocusAndEscape=True, draftPreviewAndFrameRetained=True,
                prototypingFeatureVisible=True, shellExpansionPrevented=True, genericPanelLaunchEscapeFocus=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--width', type=int, choices=[1440, 820])
    width = parser.parse_args().width
    build = Path(os.environ['DEVLAB_BUILD_DIR']).resolve()
    OUT.mkdir(parents=True, exist_ok=True)
    results, errors = [], []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='chrome', headless=True)
        try:
            for size in ([width] if width else [1440, 820]):
                with tempfile.TemporaryDirectory(prefix='spec-ui-', dir='/dev/shm') as temp, tempfile.TemporaryFile(mode='w+', dir='/dev/shm') as log:
                    private = Path(temp)
                    binary = stub(private)
                    fixture = subprocess.Popen(['node', 'scripts/terminal-fixture.ts'], cwd=ROOT,
                        env={**os.environ, 'TMPDIR': temp, 'DEVLAB_BUILD_DIR': str(build),
                             'PATH': str(binary.parent) + os.pathsep + os.environ['PATH'], 'SPEC_STUB_LOG': str(private / 'invocations.jsonl')},
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, text=True)
                    context = None
                    try:
                        line = fixture.stdout.readline()
                        if not line:
                            log.seek(0)
                            raise AssertionError(log.read())
                        settings = json.loads(line)
                        assert Path(settings['root']).is_relative_to(private)
                        context = browser.new_context(viewport={'width': size, 'height': 1000})
                        page = context.new_page()
                        page.set_default_timeout(15000)
                        page.on('pageerror', lambda error: errors.append(str(error)))
                        results.append(exercise(page, settings, private, size))
                    except Exception:
                        if context:
                            page.screenshot(path=str(OUT / ('test-failure-' + str(size) + '.png')), full_page=True)
                        raise
                    finally:
                        if context:
                            context.close()
                        if fixture.poll() is None:
                            fixture.stdin.write('close\n')
                            fixture.stdin.flush()
                        stdout, _ = fixture.communicate(timeout=25)
                        log.seek(0)
                        assert fixture.returncode == 0, log.read()
                        assert any('"processesGone":true' in line for line in stdout.splitlines()), stdout
                        invocation = private / 'invocations.jsonl'
                        if invocation.exists():
                            for line in invocation.read_text().splitlines():
                                pid = json.loads(line)['pid']
                                until(lambda: not Path('/proc/' + str(pid)).exists() or Path('/proc/' + str(pid) + '/stat').read_text().split(') ')[1].startswith('Z'), 'Stub process survived fixture cleanup')
            assert not errors, errors
        finally:
            browser.close()
    report = dict(passed=True, results=results, javascriptErrors=errors, liveUserStateUsed=False,
                  providerNetworkUsed=False, provider='Explicit local Codex fixture; generation quality/authentication not tested', fixtureProcessesGone=True)
    (OUT / 'acceptance.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
