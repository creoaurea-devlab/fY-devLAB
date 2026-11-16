"""Private-browser acceptance for milestone/slice disclosure and real status dashes."""
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import select
import subprocess
import tempfile
import time
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen
import uuid

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('KANBAN_EVIDENCE_DIR', str(ROOT / 'docs/evidence/kanban-disclosures/browser')))


def api(base, path, body=None):
    try:
        with urlopen(Request(base + path, data=None if body is None else json.dumps(body).encode(),
                             headers={} if body is None else {'Content-Type': 'application/json'}), timeout=20) as response:
            return json.load(response)
    except HTTPError as error:
        raise AssertionError(f'{path}: HTTP {error.code}: {error.read().decode()}') from error


def snapshot(settings):
    return api(settings['url'], '/api/planning/workspace?projectId=' + quote(settings['projectId']))


def command(settings, operation):
    current = snapshot(settings)
    return api(settings['url'], '/api/planning/workspace/command', {
        'projectId': settings['projectId'], 'commandId': str(uuid.uuid4()),
        'expectedRevision': current['revision'], 'expectedDigest': current['digest'],
        'actor': 'private-disclosure-qa', 'operation': operation})


def seed(settings):
    tasks = [dict(id=f'QA-AT-{number:02}', slice='QA-SL-1', title=f'Atomic outcome {number:02}',
                  effect='feature', agent='general',
                  module='fixture-owner', mode='worker', depends_on=[], read=['owned.txt'],
                  write=['owned.txt'], verify=['node --version'], acceptance=['Private outcome is observable'])
             for number in range(84)]
    registry = dict(schema_version=1, goals=[dict(id='QA-G', title='Private disclosure goal')],
                    milestones=[dict(id='QA-MS-1', goal='QA-G', title='Disclosure milestone'),
                                dict(id='QA-MS-2', goal='QA-G', title='Empty milestone')],
                    slices=[dict(id='QA-SL-1', milestone='QA-MS-1', title='Status slice'),
                            dict(id='QA-SL-2', milestone='QA-MS-1', title='Empty slice')], tasks=tasks)
    command(settings, dict(kind='import', registry=registry))
    for number, status in [(1, 'running'), (2, 'review'), (3, 'complete')]:
        command(settings, dict(kind='status', taskId=f'QA-AT-{number:02}', status=status, note='Explicit synthetic reported state.'))
    return command(settings, dict(kind='move', taskId='QA-AT-02', sliceId='QA-SL-1', position=0))


def file_state(settings):
    values = {}
    for project in settings['projects']:
        root = Path(project['root'])
        for relative in ['.context/state/tasks.json', '.context/state/progress.json', '.wisdohm/memory.sqlite']:
            path = root / relative
            values[str(path)] = hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
    return values


def poll_once(page):
    with page.expect_response(lambda response: '/api/planning/workspace?' in response.url
                              and response.request.method == 'GET', timeout=6000):
        pass


def item_action(root, kind, title, action):
    summary = root.locator('summary[aria-label="Actions for ' + kind + ' ' + title + '"]')
    if summary.locator('xpath=parent::details').get_attribute('open') is None:
        summary.click()
    return root.get_by_role('button', name=action + ' ' + kind + ' ' + title, exact=True)


def exercise(page, settings, width):
    data = seed(settings)
    expected_order = data['progress']['order']['QA-SL-1']
    expected_states = {task['id']: data['progress']['states'].get(task['id'], {}).get('status', 'pending')
                       for task in data['registry']['tasks']}
    before = file_state(settings)
    writes = []
    page.on('request', lambda request: writes.append(request.post_data_json)
            if request.method == 'POST' and '/api/planning/' in request.url else None)
    def dismiss(dialog):
        dialog.dismiss()
    page.on('dialog', dismiss)
    page.goto(settings['url'] + '?projectId=' + quote(settings['projectId']), wait_until='domcontentloaded')
    page.get_by_role('button', name='Build canvas', exact=True).click()
    owned = page.get_by_role('button', name='Open owned.txt', exact=True)
    expand_explorer = page.get_by_role('button', name='Expand project explorer', exact=True)
    expect(owned.or_(expand_explorer)).to_be_visible()
    if expand_explorer.is_visible():
        expand_explorer.click()
    owned.click()
    editor = page.get_by_role('textbox', name='File contents', exact=True, include_hidden=True)
    editor.fill('unsaved disclosure retention draft')
    editor.evaluate('el => window.__disclosureEditor = el')
    preview = page.frame_locator('iframe[title^="Project UI"]').first
    preview.get_by_role('textbox', name='Preview input', exact=True).fill('retained disclosure preview')
    preview_id = preview.locator('body').evaluate('() => window.__disclosurePreview = crypto.randomUUID()')
    page.get_by_test_id('workspace-view-terminals').click()
    deadline, terminal = time.monotonic() + 15, None
    while time.monotonic() < deadline:
        terminal = next((item for item in api(settings['url'], '/api/terminals?projectId=' + quote(settings['projectId']))
                         if item['nodeId'] == 'planner-retained-terminal' and item['status'] == 'running'), None)
        if terminal:
            break
        page.wait_for_timeout(50)
    assert terminal, 'Private retained terminal did not start'
    page.get_by_role('button', name='Build canvas', exact=True).click()
    page.locator('[data-devlab-id="workspace.drawer.planning"]').click()
    root = page.locator('[data-devlab-id="workspace.planning"]')
    expect(root).to_be_visible()
    root.locator('[data-devlab-id="planner.expand"]').click()
    expand = root.get_by_role('button', name='Expand milestone Disclosure milestone', exact=True)
    expect(expand).to_have_attribute('aria-expanded', 'false')
    expand.focus()
    page.keyboard.press('Enter')
    collapse = root.get_by_role('button', name='Collapse milestone Disclosure milestone', exact=True)
    expect(collapse).to_have_attribute('aria-expanded', 'true')
    item_action(root, 'slice', 'Status slice', 'Edit').click()
    page.get_by_role('dialog', name='Edit slice', exact=True).get_by_role('button', name='Cancel', exact=True).click()
    expect(root.get_by_role('button', name='Show atomic tasks in Status slice', exact=True)).to_have_attribute('aria-expanded', 'false')
    collapse.focus()
    page.keyboard.press('Space')
    expect(expand).to_have_attribute('aria-expanded', 'false')
    root.locator('[data-devlab-id="planner.view.board"]').click()
    expect(expand).to_have_attribute('aria-expanded', 'false')
    item_action(root, 'milestone', 'Disclosure milestone', 'Edit').click()
    page.get_by_role('dialog', name='Edit milestone', exact=True).get_by_role('button', name='Cancel', exact=True).click()
    expect(expand).to_have_attribute('aria-expanded', 'false')
    item_action(root, 'milestone', 'Empty milestone', 'Delete').click()
    expect(root.get_by_role('button', name='Expand milestone Empty milestone', exact=True)).to_have_attribute('aria-expanded', 'false')
    expand.focus()
    page.keyboard.press('Enter')
    expect(collapse).to_have_attribute('aria-expanded', 'true')
    assert collapse.get_attribute('aria-controls'), 'Milestone disclosure must identify its controlled region'
    slice_section = root.locator('[data-planner-slice-id="QA-SL-1"]')
    show = slice_section.get_by_role('button', name='Show atomic tasks in Status slice', exact=True)
    expect(show).to_have_attribute('aria-expanded', 'false')
    dashes = slice_section.locator('.planner-task-dash')
    expect(dashes).to_have_count(84)
    actual = dashes.evaluate_all('elements => elements.map(element => ({id:element.dataset.taskId,status:element.dataset.status,label:element.getAttribute("aria-label"),glow:getComputedStyle(element).boxShadow,animation:getComputedStyle(element).animationName,y:Math.round(element.getBoundingClientRect().y)}))')
    assert [item['id'] for item in actual] == expected_order, 'Dashes differ from canonical task order'
    for item in actual:
        assert item['status'] == expected_states[item['id']], item
        number = int(item['id'].rsplit('-', 1)[1])
        assert item['label'] and item['label'].startswith(f'Atomic outcome {number:02}: ') and item['label'].rsplit(': ', 1)[-1], item
        assert item['animation'] == 'none', item
    labels = {item['status']: item['label'].rsplit(': ', 1)[-1].lower() for item in actual}
    assert len(set(labels.values())) == 4, 'Accessible status labels must distinguish all reported states'
    summary_id = show.get_attribute('aria-describedby')
    assert summary_id, 'Slice disclosure must reference its textual status counts'
    summary = slice_section.locator('[id="' + summary_id + '"]')
    expect(summary).to_be_visible()
    for status, count in Counter(expected_states.values()).items():
        expect(summary).to_contain_text(f'{count} {labels[status]}')
    wrapped_rows = len({item['y'] for item in actual})
    assert wrapped_rows > 1, '84 actual task dashes did not wrap'
    assert slice_section.evaluate('el => el.scrollWidth <= el.clientWidth + 1'), 'Slice summary overflowed horizontally'
    show.focus()
    page.keyboard.press('Space')
    hide = slice_section.get_by_role('button', name='Hide atomic tasks in Status slice', exact=True)
    expect(hide).to_have_attribute('aria-expanded', 'true')
    cards = root.get_by_role('region', name='Atomic tasks in Status slice', exact=True)
    assert cards.locator('[data-planner-task-id]').evaluate_all('elements => elements.map(element => element.dataset.plannerTaskId)') == expected_order
    cards.locator('[data-devlab-id="planner.task.select.QA-AT-00"]').click()
    inspector = root.get_by_role('complementary', name='Task details', exact=True)
    inspector.locator('[data-devlab-id="planner.task.edit.QA-AT-00"]').click()
    page.get_by_role('dialog', name='Edit atomic task', exact=True).get_by_role('button', name='Cancel', exact=True).click()
    expect(hide).to_have_attribute('aria-expanded', 'true')
    task = cards.locator('[data-planner-task-id="QA-AT-00"]')
    actions = inspector.locator('.planner-task-more')
    if actions.get_attribute('open') is None:
        actions.locator('summary').click()
    inspector.get_by_role('button', name='Delete atomic task Atomic outcome 00', exact=True).click()
    expect(hide).to_have_attribute('aria-expanded', 'true')
    poll_once(page)
    expect(hide).to_have_attribute('aria-expanded', 'true')
    empty = root.locator('[data-planner-slice-id="QA-SL-2"]')
    expect(empty.locator('.planner-task-dash')).to_have_count(0)
    empty.get_by_role('button', name='Show atomic tasks in Empty slice', exact=True).click()
    expect(root.get_by_role('region', name='Atomic tasks in Empty slice', exact=True)).to_contain_text(re.compile(r'(No|0).*tasks', re.I))
    assert not writes, writes
    assert file_state(settings) == before, 'Disclosure/edit cancellation changed private plan or SQLite files'
    page.screenshot(path=str(OUT / f'disclosure-{width}.png'), full_page=True)

    # Both selected views use the same data, stay within the shell, and have real tabs.
    tabs = root.get_by_role('tablist', name='Planning views', exact=True)
    expect(tabs.get_by_role('tab')).to_have_count(2)
    execution_tab = tabs.get_by_role('tab', name='Execution', exact=True)
    execution_tab.click()
    execution = root.get_by_role('table', name='Execution tasks', exact=True)
    expect(execution).to_be_visible()
    expect(execution.get_by_role('columnheader')).to_have_count(6)
    expect(execution.locator('tbody > tr')).to_have_count(84)
    expect(execution).to_contain_text('Atomic outcome 00')
    expect(execution).to_contain_text('fixture-owner')
    execution.locator('[data-devlab-id="planner.task.select.QA-AT-00"]').click()
    expect(inspector).to_contain_text('Atomic outcome 00')
    for expanded in [True, False]:
        if root.get_attribute('data-expanded') != str(expanded).lower():
            root.locator('[data-devlab-id="planner.expand"]').click()
        geometry = root.evaluate("""element => {
          const body = element.querySelector('.planner-body');
          const box = element.getBoundingClientRect();
          const head = element.querySelector('.planner-header').getBoundingClientRect();
          return {width: box.width, x: box.x, right: box.right, viewport: innerWidth,
            scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
            headerHeight: head.height, bodyHeight: body.getBoundingClientRect().height};
        }""")
        assert geometry['x'] >= -1 and geometry['right'] <= geometry['viewport'] + 1, geometry
        assert geometry['scrollWidth'] <= geometry['clientWidth'] + 1, geometry
        assert geometry['bodyHeight'] >= 120, geometry
        page.screenshot(path=str(OUT / f'execution-{width}-{"expanded" if expanded else "panel"}.png'), full_page=True)
    root.locator('[data-devlab-id="planner.expand"]').click()
    execution_tab.focus()
    page.keyboard.press('ArrowLeft')
    expect(root.locator('[data-devlab-id="planner.view.board"]')).to_be_focused()
    expect(root.locator('[data-devlab-id="planner.view.board"]')).to_have_attribute('aria-selected', 'true')
    expect(hide).to_have_attribute('aria-expanded', 'true')
    assert not writes and file_state(settings) == before, 'View changes mutated planning files'

    # Escape closes one interaction layer and restores the correct surviving owner.
    inspector.locator('h3').press('Escape')
    expect(inspector).to_have_count(0)
    expect(root.locator('.planner-body')).to_be_focused()
    selector = cards.locator('[data-devlab-id="planner.task.select.QA-AT-00"]')
    selector.click()
    inspector.locator('h3').press('Escape')
    expect(inspector).to_have_count(0)
    expect(selector).to_be_focused()
    summary = root.locator('summary[aria-label="Actions for milestone Disclosure milestone"]')
    summary.click()
    expect(summary.locator('xpath=parent::details')).to_have_attribute('open', '')
    summary.press('Escape')
    expect(summary.locator('xpath=parent::details')).not_to_have_attribute('open', '')
    expect(summary).to_be_focused()
    expect(root).to_have_attribute('data-expanded', 'true')
    root.locator('[data-devlab-id="planner.expand"]').press('Escape')
    expect(root).to_have_attribute('data-expanded', 'false')
    expect(root.locator('[data-devlab-id="planner.expand"]')).to_be_focused()
    root.locator('[data-devlab-id="planner.expand"]').click()
    selector.click()
    expect(inspector).to_be_visible()
    # Intentional report proves a real task mutation does not collapse its owners.
    inspector.get_by_role('button', name='Report progress', exact=True).click()
    form = page.get_by_role('dialog', name='Report progress', exact=True)
    form.get_by_label('Reported status', exact=True).select_option('review')
    form.get_by_label('Progress note', exact=True).fill('Intentional private disclosure retention check.')
    form.get_by_role('button', name='Save progress', exact=True).click()
    expect(form).not_to_be_visible()
    expect(hide).to_have_attribute('aria-expanded', 'true')
    expect(collapse).to_have_attribute('aria-expanded', 'true')
    assert len(writes) == 1 and writes[0]['operation']['kind'] == 'status', writes
    after_report = file_state(settings)
    search = root.get_by_role('searchbox', name='Search atomic tasks', exact=True)
    collapse.click()
    search.fill('Atomic outcome 07')
    expect(collapse).to_have_attribute('aria-expanded', 'true')
    expect(hide).to_have_attribute('aria-expanded', 'true')
    expect(root.locator('[data-planner-task-id="QA-AT-07"]')).to_be_visible()
    hide.click()
    poll_once(page)
    expect(show).to_have_attribute('aria-expanded', 'false')
    search.fill('Atomic outcome 08')
    expect(hide).to_have_attribute('aria-expanded', 'true')
    expect(root.locator('[data-planner-task-id="QA-AT-08"]')).to_be_visible()
    search.fill('')
    root.get_by_role('button', name='Collapse milestone Disclosure milestone', exact=True).click()
    expect(editor).to_have_value('unsaved disclosure retention draft')
    assert editor.evaluate('el => el === window.__disclosureEditor'), 'Disclosure remounted the outer editor'
    expect(preview.get_by_role('textbox', name='Preview input', exact=True)).to_have_value('retained disclosure preview')
    assert preview.locator('body').evaluate('() => window.__disclosurePreview') == preview_id
    after = api(settings['url'], '/api/terminals?projectId=' + quote(settings['projectId']))
    assert any(item['id'] == terminal['id'] and item['pid'] == terminal['pid'] and item['status'] == 'running' for item in after)
    # A real project switch may intentionally discard the seeded private draft.
    # Retention has already been checked for disclosure and task reporting above.
    page.remove_listener('dialog', dismiss)
    page.on('dialog', lambda dialog: dialog.accept())
    other = settings['projects'][1]
    page.get_by_role('combobox', name='Active project', exact=True).select_option(other['id'])
    expect(root).to_contain_text('Start with a milestone')
    page.get_by_role('combobox', name='Active project', exact=True).select_option(settings['projectId'])
    expect(expand).to_have_attribute('aria-expanded', 'false')
    assert len(writes) == 1 and file_state(settings) == after_report, 'Presentation/filter/project changes wrote plan state'
    readonly = page.context.new_page()
    readonly.on('request', lambda request: writes.append(request.post_data_json)
                if request.method == 'POST' and '/api/planning/' in request.url else None)
    try:
        readonly.goto(settings['url'] + '?view=element&element=kanban&variant=A&projectId=' + quote(settings['projectId']), wait_until='domcontentloaded')
        preview_plan = readonly.locator('.planner-unit[data-read-only="true"]')
        expect(preview_plan).to_be_visible()
        preview_plan.get_by_role('button', name='Expand milestone Disclosure milestone', exact=True).click()
        preview_plan.get_by_role('button', name='Show atomic tasks in Status slice', exact=True).click()
        expect(preview_plan.locator('.planner-task-dash')).to_have_count(84)
        preview_plan.locator('[data-devlab-id="planner.task.select.QA-AT-00"]').click()
        expect(preview_plan.locator('[data-devlab-id="planner.task.edit.QA-AT-00"]')).to_be_disabled()
        assert len(writes) == 1 and file_state(settings) == after_report, 'Read-only disclosure wrote private state'
        readonly.screenshot(path=str(OUT / f'readonly-{width}.png'), full_page=True)
    finally:
        readonly.close()
    return dict(width=width, kanbanKeyboardDisclosure=True, executionTable=True, executionPanelAndExpandedFit=True, twoViewKeyboardTabs=True, layeredEscapeFocus=True, tasks=84, canonicalOrder=True,
                actualStatusDashes=True, textualStatusCounts=True, dashRows=wrapped_rows, nonAnimatedStatusMarkers=True, emptySlice=True,
                noDisclosurePlanningWrites=True, explicitReportWrites=1, editDeleteDoNotToggle=True,
                reportRetainsDisclosures=True, pollingRetainsDisclosure=True, filterIntentReveals=True,
                manualFilteredCollapseRetained=True, realProjectResets=True, readonlyPreview=True,
                editorPreviewRetained=True, sameTerminalPid=terminal['pid'])


def exercise_workflow(page, settings, width):
    root = page.locator('[data-devlab-id="workspace.planning"]')
    board = root.locator('.planner-board')
    labels = ['POOL', 'PLANNED', 'QUEUE', 'IN PROGRESS', 'Q/A / EVA', 'DONE']
    assert board.locator('.planner-column-heading h3').all_text_contents() == labels
    expect(board.locator('.planner-column[data-stage="pool"] .planner-board-milestone')).to_have_count(2)
    milestone = root.locator('[data-planner-milestone-id="QA-MS-1"]')
    stage = milestone.get_by_role('combobox', name='Stage for Disclosure milestone', exact=True)
    expect(stage.locator('option[value="complete"]')).to_be_disabled()
    initial = snapshot(settings)

    # Every section uses a native keyboard button and keeps its controlled owner mounted.
    def disclosure(label):
        button = root.get_by_role('button', name='Collapse ' + label, exact=True)
        expect(button).to_have_text('<')
        target = root.locator('[id="' + button.get_attribute('aria-controls') + '"]')
        target.evaluate('el => el.__workflowIdentity = true')
        button.focus(); page.keyboard.press('Enter')
        expect(target).to_be_hidden()
        expect(target).to_have_count(1)
        button = root.get_by_role('button', name='Expand ' + label, exact=True)
        button.focus(); page.keyboard.press('Space')
        expect(target).to_be_visible()
        assert target.evaluate('el => el.__workflowIdentity === true')

    for label in ['planning content', 'planning filters', 'Ungrouped pool group', 'Archive'] + [x + ' column' for x in labels]:
        disclosure(label)
    assert snapshot(settings)['digest'] == initial['digest'], 'Section disclosure wrote progress'

    milestone.get_by_role('button', name='Set Pool group for Disclosure milestone', exact=True).click()
    form = page.get_by_role('dialog', name='Set Pool group', exact=True)
    field = form.get_by_label('Pool group', exact=True)
    field.fill('Workflow group')
    poll_once(page)
    expect(field).to_have_value('Workflow group')
    # One intercepted rejection exercises the real UI error/draft path without changing the fixture.
    page.route('**/api/planning/workspace/command', lambda route: route.fulfill(status=409, content_type='application/json', body=json.dumps({'error': 'Private rejected workflow save'})), times=1)
    form.get_by_role('button', name='Save group', exact=True).click()
    expect(form.get_by_role('alert')).to_contain_text('409')
    expect(field).to_have_value('Workflow group')
    assert snapshot(settings)['digest'] == initial['digest']
    page.screenshot(path=str(OUT / f'workflow-error-{width}.png'), full_page=True)
    form.get_by_role('button', name='Save group', exact=True).click()
    expect(form).not_to_be_visible()
    expect(root.get_by_role('region', name='Workflow group pool group', exact=True)).to_be_visible()
    disclosure('Workflow group pool group')
    for value in ['planned', 'queue', 'running', 'review', 'pool']:
        stage.select_option(value)
        expect(board.locator(f'.planner-column[data-stage="{value}"] [data-planner-milestone-id="QA-MS-1"]')).to_be_visible()
        assert snapshot(settings)['progress']['milestones']['QA-MS-1']['stage'] == value
    milestone.get_by_role('button', name='Archive milestone Disclosure milestone', exact=True).click()
    expect(root.locator('.planner-archive [data-planner-milestone-id="QA-MS-1"]')).to_be_visible()
    expect(stage).to_be_disabled()
    disclosure('Workflow group archive group')
    milestone.get_by_role('button', name='Restore milestone Disclosure milestone', exact=True).click()
    expect(board.locator('.planner-column[data-stage="pool"] > .planner-column-content > .planner-pool-group [data-planner-milestone-id="QA-MS-1"]')).to_be_visible()
    restored = snapshot(settings)
    assert restored['registry'] == initial['registry']
    assert restored['progress']['states'] == initial['progress']['states']
    assert restored['progress']['milestones']['QA-MS-1'] == {'stage': 'pool', 'group': 'Workflow group', 'archived': False}
    milestone.get_by_role('button', name='Expand milestone Disclosure milestone', exact=True).click()
    root.get_by_role('button', name='Show atomic tasks in Status slice', exact=True).click()
    root.locator('[data-devlab-id="planner.task.select.QA-AT-00"]').click()
    disclosure('task detail content')
    # Drawer visibility and polling retain the selected task and nested disclosures.
    page.locator('[data-devlab-id="workspace.drawer.planning"]').click()
    expect(root).to_be_hidden()
    page.locator('[data-devlab-id="workspace.drawer.planning"]').click()
    expect(root).to_be_visible()
    poll_once(page)
    expect(root.get_by_role('button', name='Collapse milestone Disclosure milestone', exact=True)).to_have_attribute('aria-expanded', 'true')
    expect(root.get_by_role('button', name='Hide atomic tasks in Status slice', exact=True)).to_have_attribute('aria-expanded', 'true')
    expect(root.get_by_role('complementary', name='Task details', exact=True)).to_contain_text('Atomic outcome 00')
    milestone.get_by_role('button', name='Run milestone Disclosure milestone', exact=True).click()
    disclosure('execution queue')
    root.get_by_role('button', name='Close queue confirmation', exact=True).click()
    # Keep the overview screenshot at the column headings rather than the last selected task.
    root.get_by_role('button', name='Collapse milestone Disclosure milestone', exact=True).click()
    board.evaluate('el => el.parentElement.scrollTop = 0')
    page.screenshot(path=str(OUT / f'six-stage-{width}.png'), full_page=True)
    geometry = board.evaluate('el => ({width: el.clientWidth, scroll: el.scrollWidth})')
    assert geometry['scroll'] <= geometry['width'] + 1, geometry
    return dict(sixColumns=True, stageRoundTrip=True, groupArchiveRestore=True,
                allVisibleSectionKeyboardDisclosures=True, rejectedSaveRetainsDraft=True,
                hiddenReopenRetainsSelection=True, doneDisabledUntilComplete=True)


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
                        context = browser.new_context(viewport={'width': width, 'height': 1000})
                        page = context.new_page(); page.set_default_timeout(15000)
                        page.on('pageerror', lambda error: report['javascriptErrors'].append(str(error)))
                        result = exercise(page, settings, width)
                        result.update(exercise_workflow(page, settings, width))
                        report['results'].append(result)
                    except Exception as error:
                        report['error'] = str(error)
                        if context:
                            page.screenshot(path=str(OUT / f'failure-{width}.png'), full_page=True)
                        raise
                    finally:
                        if context:
                            context.close()
                        if fixture.poll() is None:
                            fixture.stdin.write('close\n'); fixture.stdin.flush()
                        stdout, _ = fixture.communicate(timeout=30)
                        log.seek(0); (OUT / f'fixture-{width}.log').write_text(log.read())
                        cleanup = next((json.loads(line) for line in stdout.splitlines() if line.startswith('{"closed":')), None)
                        report['cleanup'].append(cleanup)
                        assert fixture.returncode == 0 and cleanup and cleanup['closed'] and cleanup['processesGone'], cleanup
                        assert not Path(cleanup['removed']).exists(), 'Private fixture folder remains'
            assert not report['javascriptErrors'], report['javascriptErrors']
            report['passed'] = True
        finally:
            browser.close()
            (OUT / 'acceptance.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
