"""Actual planner UI/API acceptance on disposable projects and private Chrome contexts."""
import argparse
from copy import deepcopy
import json
import os
import re
from pathlib import Path
import select
import subprocess
import tempfile
import time
import traceback
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen
import uuid

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = Path(os.environ.get("PLANNING_EVIDENCE_DIR", str(Path(tempfile.gettempdir()) / "devtest-planning-evidence")))
PARSER = argparse.ArgumentParser()
PARSER.add_argument("--width", type=int, choices=[1440, 820])
ARGS = PARSER.parse_args()


def request(base, path, body=None):
    encoded = None if body is None else json.dumps(body).encode()
    headers = {} if body is None else {"Content-Type": "application/json"}
    try:
        with urlopen(Request(base + path, data=encoded, headers=headers), timeout=20) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, json.load(error)


def api(base, path, body=None):
    deadline = time.monotonic() + 5
    while True:
        status, value = request(base, path, body)
        if body is None and status == 409 and "busy" in value.get("message", "").lower() and time.monotonic() < deadline:
            # Reads can race a GUI commit's filesystem lock; never repeat mutations.
            time.sleep(0.03)
            continue
        assert status == 200, (path, status, value)
        return value


def until(check, description, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = check()
        if result:
            return result
        time.sleep(0.05)
    raise AssertionError(description)


class PlannerUI:
    def __init__(self, page, settings):
        self.page, self.settings = page, settings
        self.base, self.project = settings["url"], settings["projectId"]
        self.confirm = False
        self.dialogs = []
        page.on("dialog", self.on_dialog)

    def on_dialog(self, dialog):
        self.dialogs.append({"type": dialog.type, "message": dialog.message, "accepted": self.confirm})
        dialog.accept() if self.confirm else dialog.dismiss()

    def accepted(self, action):
        self.confirm = True
        try:
            return action()
        finally:
            self.confirm = False

    def reveal_milestone(self, milestone_id):
        milestone = next(item for item in self.snapshot()["registry"]["milestones"] if item["id"] == milestone_id)
        expand = self.page.get_by_role("button", name="Expand milestone " + milestone["title"], exact=True)
        if expand.count():
            expand.click()

    def reveal_task(self, task_id):
        registry = self.snapshot()["registry"]
        task = next(item for item in registry["tasks"] if item["id"] == task_id)
        parent = next(item for item in registry["slices"] if item["id"] == task["slice"])
        self.reveal_milestone(parent["milestone"])
        expand = self.page.get_by_role("button", name="Show atomic tasks in " + parent["title"], exact=True)
        if expand.count():
            expand.click()

    def item_action(self, kind, title, action):
        summary = self.page.locator('summary[aria-label="Actions for ' + kind + ' ' + title + '"]')
        menu = summary.locator('xpath=parent::details')
        if menu.get_attribute('open') is None:
            summary.click()
        return self.page.get_by_role("button", name=action + " " + kind + " " + title, exact=True)

    def control(self, semantic):
        if semantic.startswith('planner.new.'):
            menu = self.page.locator('.planner-create-menu')
            if menu.get_attribute('open') is None:
                menu.locator('summary').click()
        task = None
        if semantic.startswith('planner.task.'):
            task = next((item for item in self.snapshot()["registry"]["tasks"] if semantic.endswith('.' + item["id"])), None)
            if task:
                self.reveal_task(task["id"])
                if not semantic.startswith('planner.task.select.'):
                    self.page.locator('[data-devlab-id="planner.task.select.' + task["id"] + '"]').click()
        control = self.page.locator('[data-devlab-id="' + semantic + '"]')
        if task and not semantic.startswith(('planner.task.select.', 'planner.task.actions.')) and control.count():
            disclosure = control.locator('xpath=ancestor::details[1]')
            if disclosure.count() and disclosure.get_attribute('open') is None:
                disclosure.locator('summary').click()
        return control

    def snapshot(self, project=None):
        return api(self.base, "/api/planning/workspace?projectId=" + quote(project or self.project))

    def command(self, operation, before=None, actor="browser-qa"):
        value = before or self.snapshot()
        return request(self.base, "/api/planning/workspace/command", {
            "projectId": self.project, "commandId": str(uuid.uuid4()),
            "expectedRevision": value["revision"], "expectedDigest": value["digest"],
            "actor": actor, "operation": operation,
        })

    def lookup(self, collection, title):
        return next(item for item in self.snapshot()["registry"][collection] if item["title"] == title)

    def dialog(self, name):
        result = self.page.get_by_role("dialog", name=name, exact=True)
        expect(result).to_be_visible()
        return result

    def create(self, kind, title, parent=None, dependencies=""):
        self.control("planner.new." + kind).click()
        names = {"milestone": "New milestone", "slice": "New slice", "task": "New atomic task"}
        form = self.dialog(names[kind])
        form.get_by_label("Title", exact=True).fill(title)
        if kind == "slice":
            form.get_by_label("Milestone", exact=True).select_option(parent)
        if kind == "task":
            form.get_by_label("Slice", exact=True).select_option(parent)
            form.get_by_label("Ownership", exact=True).select_option("fixture-owner")
            form.get_by_label("Dependencies", exact=True).fill(dependencies)
            form.get_by_label("Read paths", exact=True).fill("owned.txt")
            form.get_by_label("Write paths", exact=True).fill("owned.txt")
            form.get_by_label("Verification commands", exact=True).fill("node --version")
            form.get_by_label("Acceptance criteria", exact=True).fill("Private fixture outcome is observable")
        label = {"milestone": "Save milestone", "slice": "Save slice", "task": "Save atomic task"}[kind]
        form.get_by_role("button", name=label, exact=True).click()
        expect(form).not_to_be_visible()
        collection = {"milestone": "milestones", "slice": "slices", "task": "tasks"}[kind]
        created = self.lookup(collection, title)
        if kind == "slice":
            self.reveal_milestone(created["milestone"])
        elif kind == "task":
            self.reveal_task(created["id"])
        return created

    def report(self, task, status):
        self.control("planner.task.report." + task["id"]).click()
        form = self.dialog("Report progress")
        form.get_by_label("Reported status", exact=True).select_option(status)
        form.get_by_label("Progress note", exact=True).fill("QA explicitly reports this workflow state; no test receipt is asserted.")
        form.get_by_role("button", name="Save progress", exact=True).click()
        expect(form).not_to_be_visible()
        until(lambda: self.snapshot()["progress"]["states"].get(task["id"], {}).get("status") == status,
              "Reported status did not persist")


def exercise(page, settings, width, evidence):
    ui = PlannerUI(page, settings)
    checks = evidence.setdefault("checks", [])
    page.goto(settings["url"] + "?projectId=" + quote(ui.project), wait_until="domcontentloaded")
    expect(page.get_by_role("combobox", name="Active project", exact=True)).to_have_value(ui.project)
    expect(page.get_by_test_id("flow-editor-root")).to_be_visible()
    page.get_by_role("button", name="Workflow", exact=True).click()
    page.locator('[data-devlab-id="workspace.drawer.planning"]').click()
    root = ui.control("workspace.planning")
    expect(root).to_be_visible()
    expect(ui.control("planner.new.milestone")).to_be_enabled()
    assert page.locator("#workspace-planning-drawer > section").count() == 1
    assert root.locator(":scope > header").count() == 1
    initial = root.bounding_box()
    assert initial and initial["height"] > 100
    initial_body = root.locator(".planner-body").bounding_box()
    assert initial_body and initial_body["height"] >= 280, {"drawer": initial, "body": initial_body}
    assert ui.snapshot()["writable"] is True
    assert ui.snapshot()["registry"]["tasks"] == []
    normal_layer = page.evaluate("""() => {
      const root = document.querySelector('[data-devlab-id="workspace.planning"]');
      const rect = root.getBoundingClientRect(), body = root.querySelector('.planner-body').getBoundingClientRect();
      const minimap = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === 'Minimap on');
      const probe = minimap?.getBoundingClientRect();
      const covered = probe?.width && probe.x + probe.width/2 >= rect.x && probe.x + probe.width/2 <= rect.right
        && probe.y + probe.height/2 >= rect.y && probe.y + probe.height/2 <= rect.bottom;
      const x = covered ? probe.x + probe.width/2 : body.x + body.width/2;
      const y = covered ? probe.y + probe.height/2 : body.y + body.height/2;
      const hit = document.elementFromPoint(x,y);
      return {plannerOwnsPoint: root.contains(hit), minimapPointTested: !!covered, hit: hit?.textContent?.slice(0,80)};
    }""")
    assert normal_layer["plannerOwnsPoint"], normal_layer
    checks.append("One mounted planner section/header; writable normal drawer intercepts underlying canvas controls")

    ui.control("planner.expand").click()
    expect(root).to_have_attribute("data-expanded", "true")
    page.wait_for_function("""() => {
      const root = document.querySelector('[data-devlab-id="workspace.planning"]');
      const rail = document.querySelector('.execution-tabs.workspace-rail');
      if (!root || !rail) return false;
      const a = root.getBoundingClientRect(), b = rail.getBoundingClientRect();
      return a.y >= 0 && a.bottom <= b.y + 1 && a.height > 400;
    }""")
    expanded = root.bounding_box()
    rail = page.locator(".execution-tabs.workspace-rail").bounding_box()
    assert expanded and rail and expanded["height"] > initial["height"] * 1.5
    assert expanded["x"] >= -1 and expanded["y"] >= 0 and expanded["x"] + expanded["width"] <= width + 1
    assert expanded["y"] + expanded["height"] <= rail["y"] + 1, {"expanded": expanded, "rail": rail}
    layered = page.evaluate("""() => {
      const root = document.querySelector('[data-devlab-id="workspace.planning"]');
      const body = root.querySelector('.planner-body');
      const rect = body.getBoundingClientRect();
      const minimap = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === 'Minimap on');
      const probe = minimap?.getBoundingClientRect();
      const x = probe?.width ? probe.x + probe.width/2 : rect.x + rect.width/2;
      const y = probe?.height ? probe.y + probe.height/2 : rect.y + rect.height/2;
      const button = root.querySelector('[data-devlab-id="planner.view.board"]');
      return {plannerOwnsPoint: root.contains(document.elementFromPoint(x,y)),
        minimapPointTested: !!probe?.width, contextZ: getComputedStyle(root.closest('.execution-panel')).zIndex,
        background: getComputedStyle(body).backgroundColor, buttonPadding: getComputedStyle(button).paddingLeft};
    }""")
    assert layered["plannerOwnsPoint"], layered
    assert float(layered["buttonPadding"].removesuffix("px")) >= 4, layered
    page.screenshot(path=str(OUTPUT / f"planner-expanded-{width}.png"), full_page=True, animations="disabled")

    first_milestone = ui.create("milestone", "Private delivery")
    first_slice = ui.create("slice", "First slice", first_milestone["id"])
    second_slice = ui.create("slice", "Second slice", first_milestone["id"])
    first_task = ui.create("task", "First atomic outcome", first_slice["id"])
    second_task = ui.create("task", "Dependent atomic outcome", first_slice["id"], first_task["id"])
    expect(page.locator('[data-planner-task-id="' + first_task["id"] + '"]')).to_be_visible()
    checks.append("GUI creates milestone, slices and scoped atomic definitions with exact canonical links")

    retry_ids = []

    def lost_commit_response(route):
        body = route.request.post_data_json
        if body.get("operation", {}).get("title") != "Ambiguous response milestone":
            route.continue_()
            return
        retry_ids.append(body["commandId"])
        if len(retry_ids) == 1:
            response = route.fetch()
            assert response.status == 200
            response.dispose()
            route.abort("failed")  # Commit succeeded; only its browser acknowledgment is lost.
        else:
            route.continue_()

    endpoint = ui.base + "/api/planning/workspace/command"
    page.route(endpoint, lost_commit_response)
    try:
        ui.control("planner.new.milestone").click()
        form = ui.dialog("New milestone")
        form.get_by_label("Title", exact=True).fill("Ambiguous response milestone")
        form.get_by_role("button", name="Save milestone", exact=True).click()
        expect(form.get_by_role("alert")).to_be_visible()
        assert len([item for item in ui.snapshot()["registry"]["milestones"] if item["title"] == "Ambiguous response milestone"]) == 1
        form.get_by_role("button", name="Save milestone", exact=True).click()
        expect(form).not_to_be_visible()
        assert len(retry_ids) == 2 and retry_ids[0] == retry_ids[1], retry_ids
        assert len([item for item in ui.snapshot()["registry"]["milestones"] if item["title"] == "Ambiguous response milestone"]) == 1
        checks.append("Lost acknowledgment plus explicit same-command retry commits one milestone without duplicate mutation")
    finally:
        page.unroute(endpoint, lost_commit_response)

    disposable_milestone = ui.create("milestone", "Disposable milestone")
    ui.item_action("milestone", "Disposable milestone", "Edit").click()
    form = ui.dialog("Edit milestone")
    form.get_by_label("Title", exact=True).fill("Renamed disposable milestone")
    form.get_by_role("button", name="Save milestone", exact=True).click()
    expect(form).not_to_be_visible()
    ui.accepted(lambda: ui.item_action("milestone", "Renamed disposable milestone", "Delete").click())
    until(lambda: all(item["id"] != disposable_milestone["id"] for item in ui.snapshot()["registry"]["milestones"]), "Empty milestone was not deleted")
    disposable_slice = ui.create("slice", "Disposable slice", first_milestone["id"])
    ui.item_action("slice", "Disposable slice", "Edit").click()
    form = ui.dialog("Edit slice")
    form.get_by_label("Title", exact=True).fill("Renamed disposable slice")
    form.get_by_role("button", name="Save slice", exact=True).click()
    expect(form).not_to_be_visible()
    ui.accepted(lambda: ui.item_action("slice", "Renamed disposable slice", "Delete").click())
    until(lambda: all(item["id"] != disposable_slice["id"] for item in ui.snapshot()["registry"]["slices"]), "Empty slice was not deleted")
    disposable_task = ui.create("task", "Disposable atomic outcome", first_slice["id"])
    ui.accepted(lambda: ui.control("planner.task.delete." + disposable_task["id"]).click())
    until(lambda: all(item["id"] != disposable_task["id"] for item in ui.snapshot()["registry"]["tasks"]), "Unreferenced task was not deleted")
    checks.append("GUI edits milestone/slice and confirms valid empty-parent/unreferenced-task deletions")

    ui.control("planner.task.up." + second_task["id"]).click()
    until(lambda: ui.snapshot()["progress"]["order"].get(first_slice["id"], [None])[0] == second_task["id"], "Keyboard-accessible reorder did not persist")
    ui.control("planner.task.down." + second_task["id"]).click()
    until(lambda: ui.snapshot()["progress"]["order"].get(first_slice["id"], [None])[0] == first_task["id"], "Reverse reorder did not persist")
    checks.append("Visible reorder controls persist exact task ordering without changing task identity")

    ui.control("planner.task.edit." + first_task["id"]).click()
    form = ui.dialog("Edit atomic task")
    form.get_by_label("Title", exact=True).fill("Renamed atomic outcome")
    form.get_by_role("button", name="Save atomic task", exact=True).click()
    expect(form).not_to_be_visible()
    first_task = ui.lookup("tasks", "Renamed atomic outcome")
    ui.control("planner.task.edit." + first_task["id"]).click()
    form = ui.dialog("Edit atomic task")
    form.get_by_label("Title", exact=True).fill("Unsaved title must survive Cancel")
    before_dialogs = len(ui.dialogs)
    form.press("Escape")
    expect(form).to_be_visible()
    expect(form.get_by_label("Title", exact=True)).to_have_value("Unsaved title must survive Cancel")
    assert len(ui.dialogs) == before_dialogs + 1 and ui.dialogs[-1]["accepted"] is False
    ui.accepted(lambda: form.get_by_role("button", name="Cancel", exact=True).click())
    expect(form).not_to_be_visible()
    assert ui.lookup("tasks", "Renamed atomic outcome")["id"] == first_task["id"]
    checks.append("Edit persists; dirty Escape/cancel refusal preserves input and explicit discard leaves source untouched")

    ui.control("planner.task.edit." + first_task["id"]).click()
    form = ui.dialog("Edit atomic task")
    form.get_by_label("Title", exact=True).fill("Unsaved stale proposal")
    latest_task = next(item for item in ui.snapshot()["registry"]["tasks"] if item["id"] == first_task["id"])
    external_update = {"kind": "task", "id": latest_task["id"], "sliceId": latest_task["slice"],
        "title": "Externally accepted title", "moduleId": latest_task["module"],
        "dependsOn": latest_task["depends_on"], "read": latest_task["read"], "write": latest_task["write"],
        "verify": latest_task["verify"], "acceptance": latest_task["acceptance"]}
    status, externally_changed = ui.command(external_update)
    assert status == 200, externally_changed
    expect(root.locator(".planner-footer")).to_contain_text(re.compile(r"\br" + str(externally_changed["revision"]) + r"\b"))
    form.get_by_role("button", name="Save atomic task", exact=True).click()
    expect(form).to_be_visible()
    expect(form.get_by_role("alert")).to_be_visible()
    expect(form.get_by_label("Title", exact=True)).to_have_value("Unsaved stale proposal")
    assert ui.lookup("tasks", "Externally accepted title")["id"] == first_task["id"], "Stale form overwrote external definition"
    ui.accepted(lambda: form.get_by_role("button", name="Cancel", exact=True).click())
    external_update["title"] = "Renamed atomic outcome"
    status, restored = ui.command(external_update)
    assert status == 200, restored
    expect(root).to_contain_text("Renamed atomic outcome")
    checks.append("Background refresh cannot freshen a dirty form's base revision and overwrite an external edit")

    before = ui.snapshot()
    status, value = ui.command({"kind": "status", "taskId": second_task["id"], "status": "complete", "note": "Must be blocked"})
    assert status >= 400, (status, value)
    assert ui.snapshot()["revision"] == before["revision"]
    status, value = ui.command({"kind": "delete", "entity": "task", "id": first_task["id"]})
    assert status >= 400, (status, value)
    assert ui.snapshot()["revision"] == before["revision"]
    ui.report(first_task, "running")
    ui.report(first_task, "review")
    ui.report(first_task, "complete")
    ui.report(second_task, "running")
    progress = ui.snapshot()["progress"]["states"][first_task["id"]]
    assert progress["provenance"] == "reported" and progress["reportedBy"]
    expect(root).to_contain_text("Reported")
    checks.append("Dependencies and referenced-task deletion enforced; status changes are explicitly reported, never verified evidence")

    snapshot = ui.snapshot()
    page.get_by_role("combobox", name="Move Dependent atomic outcome to slice", exact=True).select_option(second_slice["id"])
    until(lambda: ui.lookup("tasks", "Dependent atomic outcome")["slice"] == second_slice["id"], "GUI slice move did not persist")
    status, value = ui.command({"kind": "milestone", "title": "Stale must fail"}, before=snapshot)
    assert status == 409, (status, value)
    assert not any(item["title"] == "Stale must fail" for item in ui.snapshot()["registry"]["milestones"])
    status, value = ui.command({"kind": "delete", "entity": "slice", "id": first_slice["id"]})
    assert status >= 400, (status, value)
    checks.append("Task parent move persists and stale revision/digest plus nonempty-parent deletion are rejected")

    ui.control("planner.view.board").click()
    ui.reveal_task(first_task["id"])
    ui.reveal_task(second_task["id"])
    expect(root).to_contain_text("Renamed atomic outcome")
    expect(root).to_contain_text("Dependent atomic outcome")
    ui.control("planner.search").fill("Renamed atomic")
    expect(page.locator('[data-planner-task-id="' + second_task["id"] + '"]')).to_have_count(0)
    expect(ui.control("planner.search")).to_be_focused()
    ui.control("planner.search").fill("")
    expect(page.locator('[data-planner-task-id="' + second_task["id"] + '"]')).to_be_visible()
    ui.control("planner.view.execution").click()
    execution = root.get_by_role("table", name="Execution tasks", exact=True)
    expect(execution).to_be_visible()
    expect(execution.get_by_role("columnheader")).to_have_count(6)
    expect(execution).to_contain_text("Renamed atomic outcome")
    expect(execution).to_contain_text("Dependent atomic outcome")
    ui.control("planner.task.select." + first_task["id"]).click()
    expect(root.get_by_role("complementary", name="Task details", exact=True)).to_contain_text("Renamed atomic outcome")
    ui.control("planner.view.board").click()
    page.reload(wait_until="domcontentloaded")
    expect(page.get_by_role("combobox", name="Active project", exact=True)).to_have_value(ui.project)
    page.locator('[data-devlab-id="workspace.drawer.planning"]').click()
    expect(root).to_be_visible()
    ui.reveal_task(first_task["id"])
    expect(root).to_contain_text("Renamed atomic outcome")
    stored_registry = json.loads((Path(settings["root"]) / ".context/state/tasks.json").read_text())
    stored_progress = json.loads((Path(settings["root"]) / ".context/state/progress.json").read_text())
    assert stored_registry == ui.snapshot()["registry"]
    assert stored_progress["states"][first_task["id"]]["status"] == "complete"
    checks.append("Kanban/Execution share one canonical state and selected task inspector; page reload and actual tasks/progress JSON retain it")

    other = settings["projects"][1]
    page.get_by_role("combobox", name="Active project", exact=True).select_option(other["id"])
    expect(page.get_by_role("combobox", name="Active project", exact=True)).to_have_value(other["id"])
    expect(root).not_to_contain_text("Renamed atomic outcome")
    assert ui.snapshot(other["id"])["registry"]["tasks"] == []
    page.get_by_role("combobox", name="Active project", exact=True).select_option(ui.project)
    ui.reveal_task(first_task["id"])
    expect(root).to_contain_text("Renamed atomic outcome")
    checks.append("Real project selection fences planner data and retains separate project records")

    # The exact import/export controls are discovered from their accessible names.
    export = page.get_by_role("button", name="Export planning JSON", exact=True)
    with page.expect_download() as downloaded:
        export.click()
    export_path = OUTPUT / f"planner-export-{width}.json"
    downloaded.value.save_as(export_path)
    exported = json.loads(export_path.read_text())
    assert exported.get("registry", exported).get("tasks")
    ui.control("planner.import").click()
    form = ui.dialog("Import planning definitions")
    form.get_by_label("Project JSON", exact=True).fill(json.dumps(exported))
    before = ui.snapshot()
    form.get_by_role("button", name="Replace definitions", exact=True).click()
    expect(form).to_be_visible()
    assert ui.snapshot()["revision"] == before["revision"], "Import cancellation changed state"
    form.get_by_label("Project JSON", exact=True).fill('{"schema_version": 1, "tasks": []}')
    ui.accepted(lambda: form.get_by_role("button", name="Replace definitions", exact=True).click())
    expect(form).to_be_visible()
    assert ui.snapshot()["revision"] == before["revision"], "Invalid import changed state"
    ui.accepted(lambda: form.get_by_role("button", name="Cancel", exact=True).click())
    expect(form).not_to_be_visible()
    checks.append("JSON download is real; canceled and malformed replacement imports preserve canonical files")

    imported = deepcopy(ui.snapshot()["registry"])
    imported["milestones"].append({"id": "IMPORTED-QA", "goal": imported["goals"][0]["id"], "title": "Imported private milestone"})
    ui.control("planner.import").click()
    form = ui.dialog("Import planning definitions")
    form.get_by_label("Project JSON", exact=True).fill(json.dumps(imported))
    ui.accepted(lambda: form.get_by_role("button", name="Replace definitions", exact=True).click())
    expect(form).not_to_be_visible()
    until(lambda: any(item["id"] == "IMPORTED-QA" for item in ui.snapshot()["registry"]["milestones"]), "Confirmed valid import did not commit")
    assert ui.lookup("tasks", "Renamed atomic outcome")["id"] == first_task["id"]
    checks.append("Explicit confirmed import commits validated definitions while preserving imported task identities")

    if root.get_attribute("data-expanded") != "true":
        ui.control("planner.expand").click()
    page.wait_for_function("""() => {
      const root = document.querySelector('[data-devlab-id="workspace.planning"]');
      const rail = document.querySelector('.execution-tabs.workspace-rail');
      return root.getBoundingClientRect().bottom <= rail.getBoundingClientRect().top + 1;
    }""")
    page.screenshot(path=str(OUTPUT / f"planner-populated-expanded-{width}.png"), full_page=True, animations="disabled")
    ui.control("planner.expand").click()
    expect(root).to_have_attribute("data-expanded", "false")
    root.locator(".planner-body").evaluate("element => element.scrollTop = 0")
    card = page.locator('[data-planner-task-id="' + first_task["id"] + '"]')
    assert card.bounding_box()['height'] <= 135, card.bounding_box()
    expect(card).to_be_in_viewport(ratio=1)
    usable_body = root.locator(".planner-body").bounding_box()
    card_box = card.bounding_box()
    assert usable_body and card_box and usable_body["height"] >= 280
    assert card_box["y"] >= usable_body["y"] - 1 and card_box["y"] + card_box["height"] <= usable_body["y"] + usable_body["height"] + 1
    checks.append("Restored default drawer retains usable body space with a full atomic card visible")

    # A retained preview and exact private PTY prove Planning geometry does not restart other owners.
    retention = []
    evidence["previewRetention"] = retention
    page.on("framenavigated", lambda frame: retention.append({"event": "navigation", "url": frame.url, "time": time.monotonic()}))
    def preview_probe(step):
        retention.append({"event": step, "time": time.monotonic(), "frames": page.locator('iframe[title^="Project UI"]').evaluate_all("elements => elements.map(element => ({src: element.src, pane: element.dataset.paneId, project: element.dataset.devlabProjectId, generation: element.dataset.devlabGeneration, instance: element.dataset.devlabInstanceId, retainedElement: element === window.__plannerPreviewElement}))")})
    page.get_by_role("button", name="Close lower panel", exact=True).click()
    frame = page.frame_locator('iframe[title^="Project UI"]').first
    preview_probe("before seed")
    page.locator('iframe[title^="Project UI"]').first.evaluate("element => window.__plannerPreviewElement = element")
    frame.get_by_role("textbox", name="Preview input", exact=True).fill("planner-retained")
    frame.get_by_role("textbox", name="Preview input", exact=True).evaluate("() => window.__plannerPreviewIdentity = 'same-document'")
    preview_probe("seeded")
    page.locator('[data-devlab-id="workspace.output.terminal"]').click()
    terminals = until(lambda: [item for item in api(settings["url"], "/api/terminals?projectId=" + quote(ui.project)) if item["status"] == "running"], "Private retained terminal did not start")
    exact = {item["id"]: item["pid"] for item in terminals}
    preview_probe("terminal opened")
    page.locator('[data-devlab-id="workspace.drawer.planning"]').click()
    expect(root).to_be_visible()
    preview_probe("planning opened")
    ui.control("planner.expand").click()
    expect(root).to_have_attribute("data-expanded", "true")
    preview_probe("planning expanded")
    ui.control("planner.expand").click()
    expect(root).to_have_attribute("data-expanded", "false")
    preview_probe("planning restored")
    page.get_by_role("button", name="Close lower panel", exact=True).click()
    preview_probe("planning closed")
    expect(frame.get_by_role("textbox", name="Preview input", exact=True)).to_have_value("planner-retained")
    assert frame.get_by_role("textbox", name="Preview input", exact=True).evaluate("() => window.__plannerPreviewIdentity") == "same-document"
    after = api(settings["url"], "/api/terminals?projectId=" + quote(ui.project))
    assert all(any(item["id"] == identity and item["pid"] == pid and item["status"] == "running" for item in after) for identity, pid in exact.items())
    page.locator('[data-devlab-id="workspace.drawer.planning"]').click()
    page.screenshot(path=str(OUTPUT / f"planner-drawer-{width}.png"), full_page=True, animations="disabled")
    checks.append("Drawer/full-screen switching retains exact preview document/input and private PTY IDs/PIDs")
    return {"width": width, "checks": checks, "initialGeometry": initial, "initialBodyGeometry": initial_body,
            "restoredBodyGeometry": usable_body, "expandedGeometry": expanded, "expandedLayering": layered,
            "tasks": [first_task["id"], second_task["id"]], "terminalPids": exact,
            "revision": ui.snapshot()["revision"], "dialogs": ui.dialogs}


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    report = {"passed": False, "results": [], "javascriptErrors": [], "cleanup": [],
              "build": os.environ.get("DEVLAB_BUILD_DIR", "source default dist")}
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="chrome", headless=True, chromium_sandbox=True)
            report["browser"] = browser.version
            try:
                for width in ([ARGS.width] if ARGS.width else [1440, 820]):
                    with tempfile.TemporaryFile(mode="w+") as log:
                        fixture = subprocess.Popen(["node", "scripts/planning-fixture.ts"], cwd=ROOT,
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, text=True)
                        context = None
                        try:
                            ready, _, _ = select.select([fixture.stdout], [], [], 30)
                            line = fixture.stdout.readline() if ready else ""
                            if not line:
                                log.seek(0)
                                raise RuntimeError("Planner fixture did not boot: " + log.read())
                            settings = json.loads(line)
                            assert settings["root"].startswith(tempfile.gettempdir() + "/devtest-planning-browser-")
                            context = browser.new_context(viewport={"width": width, "height": 900}, accept_downloads=True)
                            page = context.new_page()
                            page.set_default_timeout(15000)
                            page.on("pageerror", lambda error: report["javascriptErrors"].append(str(error)))
                            case = {"width": width, "checks": []}
                            report["results"].append(case)
                            case.update(exercise(page, settings, width, case))
                        except Exception:
                            if context:
                                page.screenshot(path=str(OUTPUT / f"failure-{width}.png"), full_page=True)
                            raise
                        finally:
                            if context:
                                context.close()
                            if fixture.poll() is None:
                                fixture.stdin.write("close\n"); fixture.stdin.flush()
                            try:
                                stdout, _ = fixture.communicate(timeout=20)
                            except subprocess.TimeoutExpired:
                                fixture.terminate(); fixture.communicate(timeout=10)
                                raise AssertionError("Planner fixture did not clean up")
                            log.seek(0)
                            assert fixture.returncode == 0, log.read()
                            closed = next((json.loads(line) for line in stdout.splitlines() if line.startswith('{"closed":')), None)
                            assert closed and closed["processesGone"], "Cleanup receipt missing"
                            assert not Path(closed["removed"]).exists(), "Private fixture folder remains"
                            report["cleanup"].append(closed)
                assert not report["javascriptErrors"], report["javascriptErrors"]
                report["passed"] = True
            finally:
                browser.close()
    except Exception as error:
        report["error"] = str(error)
        report["traceback"] = traceback.format_exc()
        raise
    finally:
        (OUTPUT / "browser.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
