"""Real private-project UI acceptance. Harness transport is synthetic; no Codex executes.

Build first with DEVLAB_BUILD_DIR=/tmp/process-ui-build npm run build, then run
DEVLAB_BUILD_DIR=/tmp/process-ui-build /usr/bin/python3 scripts/planning-process-browser.py.
Screenshots/results default to a fresh directory under /tmp, never previous evidence.
"""
import json
import os
from pathlib import Path
import re
import select
import subprocess
import tempfile
import time
import traceback
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen
import uuid

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('PROCESS_EVIDENCE_DIR', tempfile.mkdtemp(prefix='devlab-process-evidence-')))


def api(settings, path, body=None):
    request = Request(settings['url'] + path, data=None if body is None else json.dumps(body).encode(),
                      headers={} if body is None else {'Content-Type': 'application/json'})
    with urlopen(request, timeout=20) as response:
        return json.load(response)


def snapshot(settings):
    return api(settings, '/api/planning/workspace?projectId=' + quote(settings['projectId']))


def command(settings, operation):
    current = snapshot(settings)
    return api(settings, '/api/planning/workspace/command', dict(projectId=settings['projectId'],
        commandId=str(uuid.uuid4()), expectedRevision=current['revision'], expectedDigest=current['digest'],
        actor='private-process-regression', operation=operation))


def seed(settings):
    registry = dict(schema_version=1, goals=[dict(id='QA-G', title='Private Process goal')],
        milestones=[dict(id='QA-MS', goal='QA-G', title='Active milestone'),
                    dict(id='QA-ARCHIVE', goal='QA-G', title='Archived milestone')],
        slices=[dict(id='QA-SL', milestone='QA-MS', title='Process slice')],
        tasks=[dict(id='QA-AT-' + str(i), slice='QA-SL', title='Process task ' + str(i),
            effect='feature', agent='general', module='fixture-owner', mode='worker', depends_on=[],
            read=['owned.txt'], write=['owned.txt'], verify=['node --version'],
            acceptance=['Private fixture outcome is observable']) for i in range(3)])
    command(settings, dict(kind='import', registry=registry))
    command(settings, dict(kind='milestone-state', milestoneId='QA-MS', group='Active group'))
    command(settings, dict(kind='milestone-state', milestoneId='QA-ARCHIVE', group='Archived group', archived=True))
    for project in settings['projects']:
        root = Path(project['root'])
        (root / 'devlab.process.json').write_bytes((ROOT / 'devlab.process.json').read_bytes())


class HarnessFixture:
    """Exercises actual client/UI with safe deterministic transport responses only."""
    def __init__(self, settings):
        self.settings, self.runs, self.batches, self.writes = settings, [], [], []
        self.fail_next_start = False

    def run(self, task_id, **changes):
        return dict(dict(id=str(uuid.uuid4()), projectId=self.settings['projectId'], taskId=task_id,
                         status='running', output='', updatedAt='2026-11-02T11:00:00Z'), **changes)

    def batch(self, **changes):
        return dict(dict(id=str(uuid.uuid4()), projectId=self.settings['projectId'], kind='slice',
                         targetId='QA-SL', taskIds=[], pendingTaskIds=[], completedTaskIds=[],
                         skippedTaskIds=[], status='blocked', updatedAt='2026-11-02T11:00:00Z'), **changes)

    def route(self, route):
        request = route.request
        url = urlparse(request.url)
        path = url.path.removeprefix('/api/harness/')
        project = parse_qs(url.query).get('projectId', [''])[0]
        value = None
        if request.method == 'POST':
            body = request.post_data_json
            self.writes.append(dict(path=path, body=body))
            if path == 'start':
                if self.fail_next_start:
                    self.fail_next_start = False
                    route.fulfill(status=503, content_type='application/json', body=json.dumps(dict(code='SERVICE_UNAVAILABLE', message='Execution unavailable: sandbox host probe failed.')))
                    return
                value = self.run(body['taskId'], projectId=body['projectId'],
                             status='review',
                    output='Synthetic direct run output: private transport fixture only.')
                self.runs = [value]
            elif path == 'batches/start':
                value = self.batch(projectId=body['projectId'], kind=body['kind'], targetId=body['targetId'], status='review')
                self.batches = [value]
            elif path == 'batches/stop':
                value = next(item for item in self.batches if item['id'] == body['batchId'])
                assert value['projectId'] == body['projectId'], 'Stop targeted wrong queue owner'
                value['status'] = 'stopped'
            else:
                raise AssertionError('Unexpected Harness mutation: ' + path)
        elif path == 'account':
            value = dict(ready=True, label='Private synthetic Harness')
        elif path == 'activity':
            value = dict(runs=[item for item in self.runs if item['status'] == 'running'],
                         batches=[item for item in self.batches if item['status'] == 'blocked'])
        elif path == 'runs':
            value = [item for item in self.runs if item['projectId'] == project]
        elif path == 'batches':
            value = [item for item in self.batches if item['projectId'] == project]
        else:
            raise AssertionError('Unexpected Harness read: ' + path)
        route.fulfill(status=200, content_type='application/json', body=json.dumps(value))


def drawer(page, root, name):
    page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    trigger = root.locator('[data-devlab-id="planner.drawer.' + name + '"]')
    trigger.focus()
    page.keyboard.press('Enter')
    expect(trigger).to_have_attribute('aria-expanded', 'true')
    content = root.locator('[id="' + trigger.get_attribute('aria-controls') + '"]')
    expect(content).to_be_visible()
    assert content.bounding_box()['y'] >= root.locator('.planner-header').bounding_box()['y']
    return trigger, content


def open_planning(page, settings):
    page.goto(settings['url'] + '?projectId=' + quote(settings['projectId']), wait_until='domcontentloaded')
    page.get_by_role('button', name='Build canvas', exact=True).click()
    page.locator('[data-devlab-id="workspace.drawer.planning"]').click()
    root = page.locator('[data-devlab-id="workspace.planning"]')
    expect(root).to_be_visible()
    root.locator('[data-devlab-id="planner.expand"]').click()
    return root


def exercise(page, settings, width):
    seed(settings)
    harness = HarnessFixture(settings)
    page.route('**/api/harness/**', harness.route)
    root = open_planning(page, settings)
    baseline = snapshot(settings)['digest']
    tabs = root.get_by_role('tablist', name='Planning views', exact=True)
    assert [text.strip().split()[-1] for text in tabs.get_by_role('tab').all_text_contents()] == ['Kanban', 'Execution', 'Process']
    for name in ['filters', 'queue']:
        trigger, content = drawer(page, root, name)
        if name == 'queue':
            expect(content).to_contain_text('No execution activity.')
        trigger.press('Escape')
        expect(content).to_be_hidden()
        expect(trigger).to_be_focused()
    assert root.locator('.planner-header').bounding_box()['height'] <= 76
    milestone = root.locator('[data-planner-milestone-id="QA-MS"]')
    expand = milestone.get_by_role('button', name='Expand milestone Active milestone', exact=True)
    expect(expand).to_have_attribute('aria-expanded', 'false')
    assert milestone.locator('button:visible').count() == 1
    expect(milestone.locator('.planner-milestone-workflow')).to_be_hidden()
    expect(milestone.locator('.planner-milestone-footer')).to_be_hidden()
    expand.focus(); page.keyboard.press('Space')
    expect(milestone.get_by_role('combobox', name='Stage for Active milestone', exact=True)).to_be_visible()
    milestone.get_by_role('button', name='Collapse milestone Active milestone', exact=True).press('Enter')
    assert milestone.locator('button:visible').count() == 1
    assert snapshot(settings)['digest'] == baseline, 'Presentation wrote planning progress'
    pool = root.locator('.planner-column[data-stage="pool"]')
    expect(pool.locator('[data-planner-milestone-id]')).to_have_count(1)
    expect(pool.get_by_role('heading', name='Active group', exact=True)).to_have_count(1)
    _, archive = drawer(page, root, 'archive')
    expect(archive.locator('[data-planner-milestone-id]')).to_have_count(1)
    expect(archive).to_contain_text('1 milestones')
    assert archive.evaluate('el => !el.closest(".planner-column")'), 'Archive belongs outside Pool'
    archived = archive.locator('[data-planner-milestone-id="QA-ARCHIVE"]')
    archived.get_by_role('button', name='Expand milestone Archived milestone', exact=True).click()
    archived.get_by_role('button', name='Restore milestone Archived milestone', exact=True).click()
    expect(archive.locator('[data-planner-milestone-id]')).to_have_count(0)
    expect(pool.locator('[data-planner-milestone-id]')).to_have_count(2)
    root.locator('[data-devlab-id="planner.drawer.archive"]').press('Escape')
    page.screenshot(path=str(OUT / f'compact-{width}.png'), full_page=True)

    # Safe other-project blocker: actual UI navigation/cancel payload, no provider process.
    other = settings['projects'][1]
    harness.batches = [harness.batch(id='private-blocked', projectId=other['id'],
        taskIds=['QA-AT-0', 'QA-AT-1'], pendingTaskIds=['QA-AT-1'], completedTaskIds=['QA-AT-0'],
        skippedTaskIds=[], status='blocked', updatedAt='2026-11-02T09:00:00Z')]
    _, queue = drawer(page, root, 'queue')
    expect(queue).to_contain_text('Paused · review or prerequisites required')
    expect(queue).to_contain_text(other['id'])
    expect(queue).to_contain_text('no worker is running')
    queue.get_by_role('button', name='Open owner / review', exact=True).click()
    expect(page.get_by_role('combobox', name='Active project', exact=True)).to_have_value(other['id'])
    queue.get_by_role('button', name='Cancel queue', exact=True).click()
    expect(queue.get_by_role('button', name='Cancel queue', exact=True)).to_have_count(0)
    assert harness.writes[-1] == dict(path='batches/stop', body=dict(projectId=other['id'], batchId='private-blocked'))
    page.get_by_role('combobox', name='Active project', exact=True).select_option(settings['projectId'])
    root.locator('[data-devlab-id="planner.drawer.queue"]').press('Escape')
    harness.batches = []

    # Run dispatches directly, once, without a second Start confirmation.
    tabs.get_by_role('tab', name='Kanban', exact=True).click()
    root.get_by_role('button', name='Expand milestone Active milestone', exact=True).click()
    root.get_by_role('button', name='Show atomic tasks in Process slice', exact=True).click()
    baseline = snapshot(settings)['digest']
    before = len(harness.writes)
    root.get_by_role('button', name='Run task Process task 0', exact=True).click()
    inspector = root.get_by_role('complementary', name='Task details', exact=True)
    expect(inspector.get_by_role('log', name='Codex output', exact=True)).to_contain_text('Synthetic direct run output')
    expect(inspector.get_by_role('group', name='Confirm Codex task', exact=True)).to_have_count(0)
    expect(inspector.get_by_role('button', name='Diagnose', exact=True)).to_have_count(0)
    assert len(harness.writes) == before + 1
    body = harness.writes[-1]['body']
    assert body['projectId'] == settings['projectId'] and body['taskId'] == 'QA-AT-0'
    assert set(body) == {'projectId', 'taskId', 'commandId', 'expectedDigest', 'humanReview'}
    assert body['humanReview'] is False
    assert snapshot(settings)['digest'] == baseline
    _, settings_queue = drawer(page, root, 'queue')
    settings_menu = settings_queue.get_by_text('Execution settings', exact=True)
    settings_menu.click()
    review = settings_queue.get_by_role('checkbox', name='Require human review', exact=True)
    expect(review).not_to_be_checked()
    review.check()
    expect(review).to_be_checked()
    settings_menu.click()
    harness.fail_next_start = True
    inspector.get_by_role('button', name='Run', exact=True).click()
    expect(inspector.get_by_role('alert')).to_contain_text('Execution unavailable: sandbox host probe failed.')
    assert harness.writes[-1]['body']['humanReview'] is True
    settings_menu.click()
    review.uncheck()
    settings_menu.click()
    inspector.locator('h3').press('Escape')
    before = len(harness.writes)
    root.get_by_role('button', name='Run slice Process slice', exact=True).click()
    expect(root.get_by_role('group', name='Confirm Codex queue', exact=True)).to_have_count(0)
    expect(root.locator('.planner-queue-progress[data-queue-status]')).to_contain_text('Ready for review')
    assert len(harness.writes) == before + 1
    assert harness.writes[-1]['path'] == 'batches/start'
    assert harness.writes[-1]['body']['kind'] == 'slice'
    assert harness.writes[-1]['body']['humanReview'] is False
    root.locator('[data-devlab-id="planner.drawer.queue"]').press('Escape')
    if os.environ.get('PROCESS_RUN_ONLY') == '1':
        before = len(harness.writes)
        root.get_by_role('button', name='Run milestone Active milestone', exact=True).click()
        expect(root.locator('.planner-queue-progress[data-queue-status]')).to_contain_text('Milestone queue')
        assert len(harness.writes) == before + 1
        assert harness.writes[-1]['body']['kind'] == 'milestone'
        settings_menu.click()
        review.check()
        root = open_planning(page, settings)
        _, restored_queue = drawer(page, root, 'queue')
        restored_queue.get_by_text('Execution settings', exact=True).click()
        expect(restored_queue.get_by_role('checkbox', name='Require human review', exact=True)).to_be_checked()
        page.screenshot(path=str(OUT / f'direct-run-{width}.png'), full_page=True)
        return dict(width=width, taskRunOnce=True, sliceRunOnce=True, milestoneRunOnce=True, sandboxErrorVisible=True, reviewTogglePersists=True, noStartConfirmation=True, noProviderExecuted=True)
    # Real graph disk edits; the existing ProjectService performs every UI save.
    tabs.get_by_role('tab', name='Process', exact=True).click()
    process = root.locator('.planner-process')
    expect(process).to_be_visible()
    expect(process).to_contain_text('Observations describe current activity, not completed steps.')
    expect(process).to_contain_text('3 tasks defined')
    expect(process).to_contain_text('1 awaiting human review')
    harness.runs.append(harness.run('QA-AT-1', id='private-running'))
    harness.batches = [harness.batch(id='private-pending',
        taskIds=['QA-AT-1', 'QA-AT-2'], pendingTaskIds=['QA-AT-2'], completedTaskIds=[], skippedTaskIds=[],
        status='blocked', updatedAt='2026-11-02T11:00:00Z')]
    expect(process).to_contain_text('1 task running')
    expect(process).to_contain_text('1 queued · paused')
    harness.runs[-1]['triageRole'] = 'diagnosis'
    expect(process).to_contain_text('1 triage running')
    expect(process).to_contain_text('No task running')
    harness.runs.pop(); harness.batches = []
    process.get_by_role('button', name='Harness view', exact=True).click()
    expect(process.locator('[data-devlab-id^="process.node."]')).to_have_count(12)
    process.locator('[data-devlab-id="process.node.plan"]').click()
    label = process.get_by_label('Node label', exact=True)
    label.fill('Persistent private label')
    process.get_by_label('X', exact=True).fill('235')
    process.get_by_label('Y', exact=True).fill('155')
    process.get_by_role('combobox', name='Edge source', exact=True).select_option('specify')
    process.get_by_role('combobox', name='Edge target', exact=True).select_option('reviewing')
    process.locator('[data-devlab-id="process.add-edge"]').click()
    save = process.locator('[data-devlab-id="process.save"]')
    expect(save).to_be_enabled(); save.click()
    expect(process).to_contain_text('Process saved.')
    expect(save).to_be_disabled()
    disk = Path(settings['root']) / 'devlab.process.json'
    saved = json.loads(disk.read_text())
    assert next(item for item in saved['nodes'] if item['id'] == 'plan')['position'] == dict(x=235, y=155)
    assert any(item['source'] == 'specify' and item['target'] == 'reviewing' for item in saved['edges'])
    page.reload(wait_until='domcontentloaded')
    canvas = page.get_by_role('button', name='Build canvas', exact=True)
    if canvas.is_visible(): canvas.click()
    root = page.locator('[data-devlab-id="workspace.planning"]')
    if root.is_visible(): page.get_by_role('button', name='Close lower panel', exact=True).click()
    explorer = page.get_by_test_id('project-explorer')
    if not explorer.is_visible(): page.get_by_role('button', name='Expand project explorer', exact=True).click()
    actions = explorer.locator('[data-devlab-id="project.actions.toggle"]')
    if actions.get_attribute('aria-expanded') != 'true': actions.click()
    groups = page.locator('[data-devlab-id="projects.preview-groups"]')
    groups.locator(':scope > summary').click()
    groups.locator('[data-devlab-id="projects.preview-groups.manage"] > summary').click()
    group_name = groups.get_by_role('textbox', name='New preview group name', exact=True)
    group_name.fill('Process retention'); group_name.press('Enter')
    groups.locator(':scope > summary').click()
    page.get_by_role('button', name='Open owned.txt', exact=True).click()
    editor = page.get_by_role('textbox', name='File contents', exact=True)
    owned_file = Path(settings['root']) / 'owned.txt'
    owned_before = owned_file.read_bytes()
    editor.fill('unsaved process acceptance draft')
    editor.evaluate('element => window.__processEditor = element')
    iframe = page.locator('iframe[title^="Project UI"][data-devlab-project-id="' + settings['projectId'] + '"]:visible').first
    expect(iframe).to_be_visible()
    iframe.evaluate('element => window.__processPreview = element')
    preview_input = page.frame_locator('iframe[title^="Project UI"][data-devlab-project-id="' + settings['projectId'] + '"]:visible').first.get_by_role('textbox', name='Preview input', exact=True)
    preview_input.fill('retained process preview')
    preview_input.evaluate('() => window.__processDocument = "original"')
    terminal = api(settings, '/api/terminals', dict(projectId=settings['projectId'], nodeId='process-retained-terminal', cwd='.', shell='bash', cols=80, rows=24))
    assert terminal['status'] == 'running'
    if not root.is_visible(): page.locator('[data-devlab-id="workspace.drawer.planning"]').click()
    root.get_by_role('tab', name='Process', exact=True).click()
    process = root.locator('.planner-process')
    process.get_by_role('button', name='Harness view', exact=True).click()
    process.locator('[data-devlab-id="process.node.plan"]').click()
    label = process.get_by_label('Node label', exact=True)
    expect(label).to_have_value('Persistent private label')
    # Conflicts retain the unsaved label and do not replace the external writer.
    label.fill('Preserved conflict draft')
    external = json.loads(disk.read_text()); external['nodes'][0]['label'] = 'External disk writer'
    disk.write_text(json.dumps(external))
    process.locator('[data-devlab-id="process.save"]').click()
    expect(process.get_by_role('alert')).to_contain_text(re.compile('409|changed|conflict', re.I))
    expect(label).to_have_value('Preserved conflict draft')
    assert json.loads(disk.read_text())['nodes'][0]['label'] == 'External disk writer'
    root.get_by_role('tab', name='Kanban', exact=True).click()
    root.get_by_role('tab', name='Process', exact=True).click()
    expect(label).to_have_value('Preserved conflict draft')
    page.locator('[data-devlab-id="workspace.drawer.planning"]').click()
    page.locator('[data-devlab-id="workspace.drawer.planning"]').click()
    expect(label).to_have_value('Preserved conflict draft')
    # Same-project panel changes preserve mounted workspace resource identities.
    assert editor.evaluate('element => element === window.__processEditor'), 'Same-project panel changes replaced editor textarea'
    expect(editor).to_have_value('unsaved process acceptance draft')
    assert iframe.evaluate('element => element === window.__processPreview'), 'Same-project panel changes replaced preview iframe'
    expect(preview_input).to_have_value('retained process preview')
    assert preview_input.evaluate('() => window.__processDocument') == 'original', 'Same-project panel changes navigated preview document'
    sessions = api(settings, '/api/terminals?projectId=' + quote(settings['projectId']))
    assert any(item['id'] == terminal['id'] and item['pid'] == terminal['pid'] and item['status'] == 'running' for item in sessions)
    # ui-projects restores cached drafts after a project with no editor unmounts the textarea.
    page.get_by_role('combobox', name='Active project', exact=True).select_option(other['id'])
    expect(editor).to_have_count(0)
    page.get_by_role('combobox', name='Active project', exact=True).select_option(settings['projectId'])
    root.get_by_role('tab', name='Process', exact=True).click()
    expect(label).to_have_value('Preserved conflict draft')
    expect(editor).to_have_value('unsaved process acceptance draft')
    # ui-preview syncProjects changes current targets/workspace identity on project navigation.
    # The configured owner/URL must return; a newly navigated external document is expected.
    expect(iframe).to_be_visible()
    actual_preview = urlparse(iframe.get_attribute('src'))
    configured_preview = urlparse(settings['previewUrl'])
    assert (actual_preview.scheme, actual_preview.netloc, actual_preview.path.rstrip('/')) == (configured_preview.scheme, configured_preview.netloc, configured_preview.path.rstrip('/')), 'Configured preview URL was not restored'
    expect(page.frame_locator('iframe[title^="Project UI"][data-devlab-project-id="' + settings['projectId'] + '"]:visible').first.get_by_role('textbox', name='Preview input', exact=True)).to_be_visible()
    sessions = api(settings, '/api/terminals?projectId=' + quote(settings['projectId']))
    assert any(item['id'] == terminal['id'] and item['pid'] == terminal['pid'] and item['status'] == 'running' for item in sessions)
    assert owned_file.read_bytes() == owned_before, 'Project/panel navigation wrote the unsaved draft'
    # Invalid hierarchy cannot overwrite the previous good document.
    process.get_by_role('combobox', name='Parent node', exact=True).select_option('reviewing')
    expect(process.get_by_role('alert').filter(has_text='same phase')).to_be_visible()
    expect(process.locator('[data-devlab-id="process.save"]')).to_be_disabled()
    assert json.loads(disk.read_text()) == external
    process.get_by_role('combobox', name='Parent node', exact=True).select_option('planning')
    page.once('dialog', lambda dialog: dialog.dismiss())
    process.locator('[data-devlab-id="process.reload"]').click()
    expect(label).to_have_value('Preserved conflict draft')
    page.once('dialog', lambda dialog: dialog.accept())
    process.locator('[data-devlab-id="process.reload"]').click()
    expect(label).to_have_value('Persistent private label')
    process.get_by_role('combobox', name='Edge source', exact=True).select_option('plan')
    process.get_by_role('combobox', name='Edge target', exact=True).select_option('plan')
    process.locator('[data-devlab-id="process.add-edge"]').click()
    expect(process.get_by_role('alert')).to_contain_text(re.compile('itself|cycle|acyclic|self', re.I))
    expect(process.locator('[data-devlab-id="process.save"]')).to_be_disabled()
    page.once('dialog', lambda dialog: dialog.accept())
    process.locator('[data-devlab-id="process.reload"]').click()
    expect(process.get_by_role('alert')).to_have_count(0)
    page.screenshot(path=str(OUT / f'process-{width}.png'), full_page=True)
    geometry = root.evaluate('(el) => ({width:el.clientWidth, scroll:el.scrollWidth, right:el.getBoundingClientRect().right, viewport:innerWidth})')
    assert geometry['scroll'] <= geometry['width'] + 1 and geometry['right'] <= geometry['viewport'] + 1, geometry
    readonly = page.context.new_page()
    readonly_writes = []
    readonly.on('request', lambda request: readonly_writes.append(request.url) if request.method == 'POST' else None)
    try:
        readonly.goto(settings['url'] + '?view=element&element=kanban&variant=A&projectId=' + quote(settings['projectId']), wait_until='domcontentloaded')
        preview = readonly.locator('.planner-unit[data-read-only="true"]')
        expect(preview).to_be_visible()
        # The isolated shell first mounts its default project, then selects the URL owner.
        # Wait for that owner before changing its per-project Process view.
        expect(preview.locator('.planner-project')).to_have_text(next(project['label'] for project in settings['projects'] if project['id'] == settings['projectId']))
        preview.get_by_role('tab', name='Process', exact=True).click()
        expect(preview.locator('.process-toolbar [role="status"]')).to_have_text('Process loaded.')
        preview.get_by_role('button', name='Harness view', exact=True).click()
        preview.locator('[data-devlab-id="process.node.plan"]').click()
        expect(preview.get_by_label('Node label', exact=True)).to_be_disabled()
        expect(preview.locator('[data-devlab-id="process.save"]')).to_have_count(0)
        assert not readonly_writes, readonly_writes
        readonly.screenshot(path=str(OUT / f'process-readonly-{width}.png'), full_page=True)
    finally:
        readonly.close()
    return dict(width=width, compactDrawers=True, collapsedMilestones=True, archiveRestore=True,
        globalQueueOwnerAndCancel=True, directRunTaskAndQueue=True, noProviderExecuted=True, graphDiskPersistence=True,
        staleHashRetainsDraft=True, invalidGraphPreventsSave=True, hiddenAndProjectDraftRetention=True, readOnlyProcess=True,
        actualMonitoringSignals=True, explicitReloadDecision=True, sameProjectEditorPreviewTerminalIdentity=True, projectSwitchDraftPreviewOwnerAndTerminal=True, geometry=geometry)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    report = dict(passed=False, results=[], cleanup=[], javascriptErrors=[])
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='chrome', headless=True)
        try:
            for width in [1440, 820]:
                with tempfile.TemporaryFile(mode='w+', dir='/dev/shm') as log:
                    fixture = subprocess.Popen(['node', 'scripts/planning-fixture.ts'], cwd=ROOT,
                        env=os.environ.copy(), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, text=True)
                    context = None
                    try:
                        ready, _, _ = select.select([fixture.stdout], [], [], 30)
                        line = fixture.stdout.readline() if ready else ''
                        if not line:
                            log.seek(0)
                            raise AssertionError('Private fixture did not become ready: ' + log.read())
                        settings = json.loads(line)
                        context = browser.new_context(viewport=dict(width=width, height=1000))
                        page = context.new_page(); page.set_default_timeout(15000)
                        page.on('pageerror', lambda error: report['javascriptErrors'].append(str(error)))
                        report['results'].append(exercise(page, settings, width))
                    except Exception as error:
                        report['error'] = str(error)
                        report['traceback'] = traceback.format_exc()
                        if context: page.screenshot(path=str(OUT / f'failure-{width}.png'), full_page=True)
                        raise
                    finally:
                        if context: context.close()
                        if fixture.poll() is None:
                            fixture.stdin.write('close\n'); fixture.stdin.flush()
                        stdout, _ = fixture.communicate(timeout=30)
                        log.seek(0); (OUT / f'fixture-{width}.log').write_text(log.read())
                        cleanup = next((json.loads(line) for line in stdout.splitlines() if line.startswith('{"closed":')), None)
                        report['cleanup'].append(cleanup)
                        assert fixture.returncode == 0 and cleanup and cleanup['processesGone'], cleanup
                        assert not Path(cleanup['removed']).exists(), 'Private fixture folder remains'
            assert not report['javascriptErrors'], report['javascriptErrors']
            report['passed'] = True
        finally:
            browser.close()
            (OUT / 'acceptance.json').write_text(json.dumps(report, indent=2) + '\n')
            print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
