"""Real UI/PTY acceptance, using only disposable projects and private Chrome contexts."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
from urllib.parse import quote
from urllib.request import Request, urlopen

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = Path(os.environ.get("TERMINAL_EVIDENCE_DIR", str(ROOT / "docs/evidence/terminal-workspace")))
PARSER = argparse.ArgumentParser()
PARSER.add_argument("--case", choices=["all", "dock", "workspace", "controls", "pressure"], default="all")
PARSER.add_argument("--width", type=int, choices=[1440, 820])
ARGS = PARSER.parse_args()


def api(base, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    headers = {} if body is None else {"Content-Type": "application/json"}
    with urlopen(Request(base + path, data=data, headers=headers), timeout=20) as response:
        return json.load(response)


def until(check, description, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        time.sleep(0.05)
    raise AssertionError(description)


class TerminalUI:
    def __init__(self, page, settings):
        self.page = page
        self.settings = settings
        self.base = settings["url"]
        self.project = settings["projectId"]

    def sessions(self):
        values = api(self.base, "/api/terminals?projectId=" + quote(self.project))
        assert all(value["projectId"] == self.project and value["cwd"] == self.settings["root"] for value in values)
        return values

    def session(self, session_id):
        return next(value for value in self.sessions() if value["id"] == session_id)

    def tab(self, session_id):
        return self.page.locator("button.terminal-tab[data-terminal-session-id='" + session_id + "']")

    def pane(self, session_id):
        return self.page.locator(".terminal-workspace-pane:visible:has(.devlab-terminal[data-terminal-session-id='" + session_id + "'])")

    def visible(self):
        return self.page.locator(".terminal-workspace-pane:visible")

    def output(self, session_id):
        value = api(self.base, "/api/terminals/" + session_id + "?after=0")
        return "".join(chunk["data"] for chunk in value["chunks"])

    def command(self, session_id, command, expected):
        pane = self.pane(session_id)
        expect(pane).to_be_visible()
        textarea = pane.locator(".xterm-helper-textarea")
        textarea.focus()
        textarea.press_sequentially(command, delay=1)
        textarea.press("Enter")
        until(lambda: expected in self.output(session_id), "Shell did not produce " + expected)

    def create(self):
        previous = {item["id"] for item in self.sessions()}
        self.page.get_by_role("button", name="New terminal", exact=True).click()
        value = until(lambda: next((item for item in self.sessions() if item["id"] not in previous and item["status"] == "running"), None), "New terminal did not start")
        expect(self.pane(value["id"])).to_be_visible()
        expect(self.pane(value["id"]).locator(".devlab-terminal")).to_have_attribute("data-terminal-connection", "Connected")
        return value

    def open(self):
        self.page.goto(self.base + "?projectId=" + quote(self.project), wait_until="domcontentloaded")
        expect(self.page.get_by_test_id("flow-editor-root")).to_be_visible()
        select = self.page.get_by_role("combobox", name="Active project", exact=True)
        expect(select).to_have_value(self.project)
        expect(select).to_be_enabled()
        self.page.get_by_role("button", name="Workflow", exact=True).click()
        self.page.locator('[data-devlab-id="workspace.output.terminal"]').click()
        expect(self.page.get_by_test_id("terminal-sessions")).to_be_visible()

    def open_options(self, session_id):
        pane = self.pane(session_id)
        summary = pane.locator("summary[aria-label]")
        expect(summary).to_have_count(1)
        if summary.locator("..").get_attribute("open") is None:
            summary.click()
        return pane

    def close_options(self, session_id):
        pane = self.pane(session_id)
        summary = pane.locator("summary[aria-label]")
        if summary.locator("..").get_attribute("open") is not None:
            summary.click()

    def clean_exit(self, value):
        old_id = value["id"]
        self.tab(old_id).click()
        pane = self.pane(old_id)
        textarea = pane.locator(".xterm-helper-textarea")
        textarea.focus(); textarea.press_sequentially("exit 0", delay=1); textarea.press("Enter")
        until(lambda: self.session(old_id)["status"] == "exited", "Clean shell exit was not recorded")
        fresh = until(lambda: next((item for item in self.sessions() if item["nodeId"] == value["nodeId"] and item["id"] != old_id and item["status"] == "running"), None), "Visible terminal did not become ready after clean exit")
        expect(self.pane(fresh["id"]).locator(".devlab-terminal")).to_have_attribute("data-terminal-connection", "Connected")
        expect(self.page.locator("button.terminal-tab[data-terminal-node-id='" + value["nodeId"] + "']")).to_have_count(1)
        return fresh

    def restart_with_mode(self, value, mode):
        self.tab(value["id"]).click()
        pane = self.open_options(value["id"])
        pane.get_by_role("combobox", name=re.compile("^Ownership for ")).select_option("fixture-owner")
        pane.get_by_role("combobox", name=re.compile("^Ownership mode for ")).select_option(mode)
        self.close_options(value["id"])
        # Editing the next policy must not kill the current shell or running work.
        assert self.session(value["id"])["status"] == "running"
        fresh = self.clean_exit(value)
        assert fresh["ownership"]["mode"] == mode
        assert fresh["ownership"]["ownerId"] == "fixture-owner"
        expect(self.pane(fresh["id"])).to_have_attribute("data-ownership-mode", mode)
        return fresh


def alignment(page):
    """Shared native bar rhythm and real child geometry, not screenshot guesswork."""
    result = page.evaluate("""() => {
      const classes = ['.devlab > .toolbar', '.workspace-rail', '.terminal-workspace-toolbar', '.terminal-pane-toolbar'];
      const rows = classes.flatMap(selector => [...document.querySelectorAll(selector)].filter(el => el.getClientRects().length).map(el => {
        const box = el.getBoundingClientRect();
        const controls = [...el.querySelectorAll('button,summary,input,select')].filter(control => control.getClientRects().length && getComputedStyle(control).visibility !== 'hidden');
        return {selector, x:box.x,y:box.y,width:box.width,height:box.height,
          controls:controls.map(control => {const r=control.getBoundingClientRect();return {name:control.getAttribute('aria-label')||control.textContent?.trim(),x:r.x,y:r.y,width:r.width,height:r.height};})};
      }));
      return rows;
    }""")
    assert result, "No visible workspace bars"
    for row in result:
        assert abs(row["height"] - 36) <= 1, "Bar height differs from36px: " + str(row)
        for control in row["controls"]:
            assert control["y"] >= row["y"] - 1 and control["y"] + control["height"] <= row["y"] + row["height"] + 1, "Control does not align inside its bar: " + str(control)
    expect(page.locator(".terminal-actions")).to_have_count(0)
    expect(page.get_by_role("button", name=re.compile(r"^(Start shell|Stop shell|Stop terminal .*)$"))).to_have_count(0)
    gaps = page.locator(".terminal-workspace-pane:visible").evaluate_all("""panes => panes.map(pane => {
      const header = pane.querySelector('.terminal-pane-toolbar').getBoundingClientRect();
      const screen = pane.querySelector('.terminal-screen').getBoundingClientRect();
      return screen.y - header.bottom;
    })""")
    assert all(abs(gap) <= 2 for gap in gaps), "Extra status/control row remains below terminal title: " + str(gaps)
    return result


def preview_layout(ui, width):
    page = ui.page
    panel = page.get_by_test_id("terminal-sessions")
    strip = page.locator(".toolbar .terminal-workspace-tabs")
    expect(strip).to_have_count(1)
    expect(page.locator(".terminal-dock > .terminal-workspace-toolbar")).to_have_count(0)
    expect(page.locator(".project-preview-editor").get_by_test_id("terminal-sessions")).to_have_count(1)
    split = page.get_by_test_id("project-preview-split")
    resize = page.get_by_role("separator", name="Resize project preview", exact=True)
    expect(resize).to_be_visible()
    expect(resize).to_have_attribute("aria-valuenow", "60")
    vertical = width <= 850
    expect(resize).to_have_attribute("aria-orientation", "horizontal" if vertical else "vertical")
    frame = page.frame_locator('iframe[title^="Project UI"]').first
    field = frame.get_by_role("textbox", name="Preview input", exact=True)
    field.fill("preview-document-retained")
    frame.locator("body").evaluate("el => el.dataset.qaOwner = 'same-preview-document'")
    geometry = page.evaluate("""() => {
      const split = document.querySelector('.project-preview-split').getBoundingClientRect();
      const editor = document.querySelector('.project-preview-editor').getBoundingClientRect();
      const preview = document.querySelector('.preview-workspace-retained').getBoundingClientRect();
      return {split:{width:split.width,height:split.height},editor:{width:editor.width,height:editor.height},preview:{width:preview.width,height:preview.height}};
    }""")
    dimension = "height" if vertical else "width"
    assert abs(geometry["editor"][dimension] / geometry["split"][dimension] - .6) < .015, geometry
    resize.focus(); resize.press("ArrowDown" if vertical else "ArrowRight")
    expect(resize).to_have_attribute("aria-valuenow", "62")
    box, bounds = resize.bounding_box(), split.bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.mouse.move(bounds["x"] + (bounds["width"] * .65 if not vertical else bounds["width"] / 2), bounds["y"] + (bounds["height"] * .65 if vertical else bounds["height"] / 2), steps=6)
    page.mouse.up()
    until(lambda: 64 <= int(resize.get_attribute("aria-valuenow")) <= 66, "Preview drag did not resize existing split")
    page.locator('[data-devlab-id$="preview.collapse"]').first.click()
    restore = page.get_by_role("button", name="Restore UI preview", exact=True)
    expect(restore).to_be_visible(); restore.click()
    expect(field).to_have_value("preview-document-retained")
    expect(frame.locator("body")).to_have_attribute("data-qa-owner", "same-preview-document")
    expect(resize).to_have_attribute("aria-valuenow", "65")
    names = []
    for pane in ui.visible().all():
        title = pane.locator(".terminal-pane-name")
        original = title.inner_text(); names.append((pane, original))
        title.click(); field_name = pane.get_by_role("textbox", name="Terminal name", exact=True)
        field_name.fill(original + " retained workspace console with a long session name"); field_name.press("Enter")
    until(lambda: strip.evaluate("el => el.scrollWidth > el.clientWidth"), "Compact session strip did not allow horizontal scrolling")
    strip.evaluate("el => el.scrollLeft = el.scrollWidth")
    assert strip.evaluate("el => el.scrollLeft > 0")
    for pane, original in names:
        pane.locator(".terminal-pane-name").click()
        field_name = pane.get_by_role("textbox", name="Terminal name", exact=True)
        field_name.fill(original); field_name.press("Enter")
    strip.evaluate("el => el.scrollLeft = 0")
    page.get_by_role("button", name="Focus previews", exact=True).click()
    expect(page.get_by_test_id("flow-editor-root")).to_have_attribute("data-preview-focused", "true")
    expect(field).to_have_value("preview-document-retained")
    page.get_by_role("button", name="Exit preview focus", exact=True).click()
    expect(strip).to_be_visible()
    expect(frame.locator("body")).to_have_attribute("data-qa-owner", "same-preview-document")
    return {"toolbarTabs":True,"horizontalTabScroll":True,"previewFocusRetained":True,"initialTerminalShare":.6,"geometry":geometry,"pointerAndKeyboardResize":True,"retainedPreviewDocument":True,"restore":True,"orientation":"horizontal" if vertical else "vertical"}


def strict_failure_recovery(ui, value):
    """Break only a private fixture allowlist file, never the installed boundary."""
    page = ui.page
    ui.tab(value["id"]).click()
    pane = page.locator(".terminal-workspace-pane:visible[data-terminal-node-id='" + value["nodeId"] + "']")
    original = Path(ui.settings["root"]) / "owned.txt"
    temporary = original.with_name("owned.fixture-missing")
    attempts = []
    def attempted(request):
        if request.method == "POST" and request.url == ui.base + "/api/terminals":
            body = request.post_data_json
            if body.get("nodeId") == value["nodeId"]:
                attempts.append(body)
    page.on("request", attempted)
    # A nonzero shell exit is an error, not a reason to spin up replacements.
    textarea = pane.locator(".xterm-helper-textarea")
    textarea.focus(); textarea.press_sequentially("exit 7", delay=1); textarea.press("Enter")
    until(lambda: ui.session(value["id"])["status"] == "exited", "Nonzero shell exit was not recorded")
    expect(pane.locator(".terminal-error")).to_contain_text("Shell exited (7)")
    page.wait_for_timeout(1000)
    assert len(attempts) == 0, "Nonzero exit must wait for explicit Retry"
    pane.get_by_role("button", name="Retry connection", exact=True).click()
    recovered = until(lambda: next((item for item in ui.sessions() if item["nodeId"] == value["nodeId"] and item["id"] != value["id"] and item["status"] == "running"), None), "Retry after nonzero exit did not restore session")
    assert recovered["ownership"]["mode"] == "strict"
    expect(ui.pane(recovered["id"]).locator(".devlab-terminal")).to_have_attribute("data-terminal-connection", "Connected")
    value = recovered
    attempts.clear()
    original.rename(temporary)
    try:
        textarea = pane.locator(".xterm-helper-textarea")
        textarea.focus(); textarea.press_sequentially("exit 0", delay=1); textarea.press("Enter")
        until(lambda: ui.session(value["id"])["status"] == "exited", "Clean Strict exit was not recorded")
        expect(pane.locator(".terminal-error")).to_be_visible()
        retry = pane.get_by_role("button", name="Retry connection", exact=True)
        expect(retry).to_be_visible()
        page.wait_for_timeout(1000)
        assert len(attempts) == 1, "Failed Strict launch must not repeatedly respawn: " + str(len(attempts))
        assert not any(item["nodeId"] == value["nodeId"] and item["status"] == "running" for item in ui.sessions())
        assert all(item.get("ownership", {}).get("mode") == "strict" for item in attempts), "Strict failure cannot downgrade policy"
    finally:
        temporary.rename(original)
    retry.click()
    fresh = until(lambda: next((item for item in ui.sessions() if item["nodeId"] == value["nodeId"] and item["id"] != value["id"] and item["status"] == "running"), None), "Explicit retry did not restore Strict")
    expect(ui.pane(fresh["id"]).locator(".devlab-terminal")).to_have_attribute("data-terminal-connection", "Connected")
    assert fresh["ownership"]["mode"] == "strict"
    assert len(attempts) == 2
    page.remove_listener("request", attempted)
    return {"attempts": len(attempts), "nonzeroExitWaitedForRetry": True, "failedAttemptStayedStrict": True, "manualRetryRestoredStrict": True}


def fork_owner_races(ui, parent):
    """Pause fixture child launches so a surface change/reload precedes execution."""
    page = ui.page
    results = []
    for reload_pending in [False, True]:
        page.get_by_test_id("workspace-view-terminals").click()
        ui.tab(parent["id"]).click()
        before = {item["id"] for item in ui.sessions()}
        before_nodes = {item["nodeId"] for item in ui.sessions()}
        held, bodies = [], []
        holding = True

        def hold_first_launch(route):
            body = route.request.post_data_json
            if route.request.method == "POST" and body.get("nodeId") not in before_nodes:
                bodies.append(body)
                if holding:
                    held.append(route)
                else:
                    route.continue_()
            else:
                route.continue_()

        endpoint = ui.base + "/api/terminals"
        page.route(endpoint, hold_first_launch)
        def held_request_arrived():
            # Sync Playwright dispatches route callbacks while servicing its own
            # calls; urllib/time.sleep polling alone would starve this test hook.
            page.wait_for_timeout(25)
            return bool(held)
        try:
            ui.open_options(parent["id"]).get_by_role("button", name="Fork Owned console", exact=True).click()
            until(held_request_arrived, "First-generation fork did not reach its held launch request")
            child_node = bodies[0]["nodeId"]
            if reload_pending:
                expect(page.get_by_test_id("save-state")).to_have_text("Saved")
                graph = api(ui.base, "/api/canvas/" + quote(ui.project))["graph"]
                node = next(item for item in graph["nodes"] if item["id"] == child_node)
                assert node["data"]["parentNodeId"] == parent["nodeId"]
                assert node["data"]["parentSessionId"] == parent["id"], "Pending fork must persist its exact source session intent"
                for route in held:
                    route.abort("aborted")
                held.clear()
                page.unroute(endpoint, hold_first_launch)
                page.reload(wait_until="domcontentloaded")
                page.get_by_test_id("workspace-view-terminals").click()
            else:
                page.get_by_role("button", name="Workflow", exact=True).click()
                expect(page.get_by_role("button", name="Workflow", exact=True)).to_have_attribute("aria-pressed", "true")
                # Let the new presentation owner commit before releasing the old
                # owner's pending request; no backend process has started yet.
                page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
                holding = False
                for route in list(held):
                    route.continue_()
                held.clear()
                page.unroute(endpoint, hold_first_launch)
                page.get_by_test_id("workspace-view-terminals").click()
            child = until(lambda: next((item for item in ui.sessions() if item["nodeId"] == child_node and item["id"] not in before and item["status"] == "running"), None), "Pending fork did not recover after presentation change")
            assert child["projectId"] == parent["projectId"]
            assert child["parentSessionId"] == parent["id"]
            assert child["ownership"] == parent["ownership"]
            assert all(body.get("parentSessionId") == parent["id"] for body in bodies)
            assert len([item for item in ui.sessions() if item["nodeId"] == child_node and item["status"] == "running"]) == 1
            expect(ui.pane(child["id"]).locator(".devlab-terminal")).to_have_attribute("data-terminal-connection", "Connected")
            expect(page.locator("button.terminal-tab[data-terminal-node-id='" + child_node + "']")).to_have_count(1)
            expect(page.get_by_test_id("save-state")).to_have_text("Saved")
            graph = api(ui.base, "/api/canvas/" + quote(ui.project))["graph"]
            node = next(item for item in graph["nodes"] if item["id"] == child_node)
            assert "parentSessionId" not in node["data"], "Successful observation must consume pending fork intent"
            assert node["data"]["parentNodeId"] == parent["nodeId"]
            reopened = ui.clean_exit(child)
            assert reopened["ownership"] == parent["ownership"]
            assert "parentSessionId" not in reopened, "Clean reopening is not another first-generation fork"
            results.append({"reloadPending": reload_pending, "exactParentPreserved": True,
                            "createRequestsBeforeOwnerChange": len(bodies), "singleRunningChild": True,
                            "subsequentCleanReopenUsedOwnSettings": True})
        finally:
            page.unroute(endpoint, hold_first_launch)
            for route in held:
                try:
                    route.abort("aborted")
                except Exception:
                    pass
    page.get_by_role("button", name="Dock terminals", exact=True).click()
    return results


def pressure(ui, width):
    """Recorded browser-event-to-next-visible-frame proxies, not physical paint timing."""
    page = ui.page
    values = [item for item in ui.sessions() if item["status"] == "running"]
    while len(values) < 4:
        values.append(ui.create())
    visible = values[:4]
    measured = next(item for item in visible if item.get("ownership", {}).get("mode", "off") == "off")
    burst = next(item for item in visible if item["id"] != measured["id"])
    ui.tab(measured["id"]).click()
    for item in visible:
        if item["id"] != measured["id"]:
            ui.tab(item["id"]).click(modifiers=["Shift"])
    expect(ui.visible()).to_have_count(4)
    while len(values) < 8:
        item = api(ui.base, "/api/terminals", {"projectId": ui.project,
                   "nodeId": "pressure-" + str(len(values)), "cwd": ".", "shell": "bash", "cols": 80, "rows": 24})
        assert item["cwd"] == ui.settings["root"]
        values.append(item)
    cdp = page.context.new_cdp_session(page)

    def memory():
        cdp.send("Performance.enable")
        metrics = {item["name"]: item["value"] for item in cdp.send("Performance.getMetrics")["metrics"]}
        rss = None
        process = Path("/proc") / str(ui.settings["fixturePid"]) / "status"
        for line in process.read_text().splitlines():
            if line.startswith("VmRSS:"):
                rss = int(line.split()[1]) * 1024
        return {"browserJsHeapBytes": metrics.get("JSHeapUsedSize"), "backendRssBytes": rss}

    before = memory()
    def producer_children(item):
        """Read only descendants of this fixture's identified shell, not host processes."""
        try:
            children = Path("/proc") / str(item["pid"]) / "task" / str(item["pid"]) / "children"
            result = []
            for pid in children.read_text().split():
                try:
                    command_line = (Path("/proc") / pid / "cmdline").read_bytes().split(b"\0")
                    if command_line and b"python" in command_line[0] and b"-u" in command_line:
                        result.append(int(pid))
                except FileNotFoundError:
                    pass
            return result
        except FileNotFoundError:
            return []
    command = "python3 -u -c 'import sys,time; print(\"LOAD_\"+str(%d),flush=True);\nwhile True: sys.stdout.write(\"x\"*1024); sys.stdout.flush(); time.sleep(1/32)'\r"
    producer_ids = []
    try:
        for index, item in enumerate(values):
            api(ui.base, "/api/terminals/" + item["id"] + "/input", {"data": command % index})
            producer_ids.append(item["id"])
            # tmux may redraw a marker in several VT patches; raw byte substring
            # matching is not a sound readiness signal for an output producer.
            until(lambda item=item: producer_children(item), "Pressure producer did not start")
        time.sleep(1)
        for item in [measured, burst]:
            api(ui.base, "/api/terminals/" + item["id"] + "/input", {"data": "\x03"})
            producer_ids.remove(item["id"])
            until(lambda item=item: not producer_children(item), "Producer did not respond to interrupt")
        api(ui.base, "/api/terminals/" + burst["id"] + "/input",
            {"data": "python3 -c 'import sys; sys.stdout.write(\"b\"*10485760); sys.stdout.flush()'\r"})
        samples = []
        selector = ".terminal-workspace-pane:not([hidden]) > .devlab-terminal[data-terminal-session-id='" + measured["id"] + "']"
        for index in range(20):
            expected = "QA" + str(index) + "_OK"
            page.evaluate("""({selector, expected}) => {
              window.__terminalLatency = null;
              const host = document.querySelector(selector);
              if (!host || host.dataset.inputOwner !== 'true') throw new Error('Benchmark must target the visible input owner');
              const textarea = host.querySelector('.xterm-helper-textarea');
              textarea.addEventListener('keydown', function start(event) {
                if (event.key !== 'Enter') return;
                textarea.removeEventListener('keydown', start, true);
                const at = performance.now();
                const frame = () => {
                  if (host.querySelector('.xterm-rows')?.textContent.includes(expected))
                    window.__terminalLatency = performance.now() - at;
                  else if (performance.now() - at < 10000) requestAnimationFrame(frame);
                  else window.__terminalLatency = -1;
                };
                requestAnimationFrame(frame);
              }, true);
            }""", {"selector": selector, "expected": expected})
            ui.command(measured["id"], "printf '\\nQA" + str(index) + "_%s\\n' OK", expected)
            until(lambda: page.evaluate("() => window.__terminalLatency !== null"), "Terminal frame sample did not complete", timeout=12)
            sample = page.evaluate("() => window.__terminalLatency")
            assert sample >= 0, "Terminal text did not reach a visible frame"
            samples.append(sample)
        at_load = memory()
        # Actual keyboard separator input -> browser layout on the next animation frame.
        divider = page.locator(".terminal-pane-divider:visible").first
        divider_selector = '[data-devlab-id="' + divider.get_attribute("data-devlab-id") + '"]'
        divider_samples = []
        for index in range(20):
            page.evaluate("""selector => {
              window.__dividerLatency = null;
              const target = document.querySelector(selector);
              target.addEventListener('keydown', function sample() {
                const start = performance.now();
                target.removeEventListener('keydown', sample, true);
                requestAnimationFrame(() => {
                  target.parentElement.getBoundingClientRect();
                  window.__dividerLatency = performance.now() - start;
                });
              }, {capture:true});
            }""", divider_selector)
            divider.focus(); divider.press("ArrowRight" if index % 2 == 0 else "ArrowLeft")
            until(lambda: page.evaluate("() => window.__dividerLatency !== null"), "Divider frame sample did not complete")
            divider_samples.append(page.evaluate("() => window.__dividerLatency"))
        replay_sizes = {}
        for item in values:
            replay = api(ui.base, "/api/terminals/" + item["id"] + "?after=0")
            size = sum(len(chunk["data"].encode()) for chunk in replay["chunks"])
            assert size <= 1024 * 1024, "Replay grew beyond configured one MiB"
            replay_sizes[item["id"]] = {"bytes": size, "reset": replay["reset"]}
        # Stop only fixture producers, then observe recovery without closing sessions.
        for session_id in producer_ids:
            api(ui.base, "/api/terminals/" + session_id + "/input", {"data": "\x03"})
        producer_ids.clear()
        time.sleep(1)
        recovered = memory()
        quantile = lambda items, fraction: sorted(items)[max(0, int(len(items) * fraction + .9999) - 1)]
        result = {"width": width, "sessions": 8, "visible": 4,
                  "nominalProducerBytesPerSecondEach": 32768, "burstBytes": 10485760,
                  "latencySamplesMs": samples, "latencyP50Ms": quantile(samples, .5),
                  "latencyP95Ms": quantile(samples, .95), "latencyMaxMs": max(samples),
                  "dividerSamplesMs": divider_samples, "dividerP95Ms": quantile(divider_samples, .95),
                  "memoryBefore": before, "memoryUnderLoad": at_load, "memoryRecovered": recovered,
                  "boundedReplays": replay_sizes, "proxy": "browser keydown to terminal text observed on requestAnimationFrame; not physical input-to-photon"}
        # Preserve metrics even when a declared budget fails.
        (OUTPUT / ("pressure-" + str(width) + ".json")).write_text(json.dumps(result, indent=2) + "\n")
        assert result["latencyP95Ms"] <= 100, "Terminal frame p95 exceeded100ms: " + str(result["latencyP95Ms"])
        assert result["dividerP95Ms"] <= 50, "Divider layout p95 exceeded50ms: " + str(result["dividerP95Ms"])
        page.screenshot(path=str(OUTPUT / ("terminal-pressure-" + str(width) + ".png")), full_page=True, animations="disabled")
        return result
    finally:
        for session_id in producer_ids:
            try:
                api(ui.base, "/api/terminals/" + session_id + "/input", {"data": "\x03"})
            except Exception:
                pass
        cdp.detach()


def exercise(page, settings, width):
    ui = TerminalUI(page, settings)
    checks = []
    ui.open()
    a, b = ui.create(), ui.create()
    ui.tab(a["id"]).click()
    expect(ui.visible()).to_have_count(1)
    ui.command(a["id"], "printf '\\nBROWSER_%s\\n' FIRST", "BROWSER_FIRST")
    ui.command(a["id"], "QA_VALUE=retained; printf '\\nSTATE_%s\\n' SET", "STATE_SET")
    ui.tab(b["id"]).click(modifiers=["Shift"])
    expect(ui.visible()).to_have_count(2)
    panel = page.get_by_test_id("terminal-sessions")
    expect(panel).to_have_attribute("data-orientation", "horizontal")
    panes = [ui.pane(item["id"]).bounding_box() for item in [a, b]]
    assert abs(panes[0]["y"] - panes[1]["y"]) < 2
    assert panes[0]["x"] + panes[0]["width"] <= panes[1]["x"] + 1
    divider = page.locator('.terminal-pane-divider:visible').first
    expect(divider).to_have_attribute("aria-orientation", "vertical")
    before = int(divider.get_attribute("aria-valuenow"))
    divider.focus(); divider.press("ArrowRight")
    expect(divider).not_to_have_attribute("aria-valuenow", str(before))
    box = divider.bounding_box()
    before = int(divider.get_attribute("aria-valuenow"))
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + min(40, box["height"] / 2))
    page.mouse.down(); page.mouse.move(box["x"] + 30, box["y"] + min(40, box["height"] / 2), steps=5); page.mouse.up()
    expect(divider).not_to_have_attribute("aria-valuenow", str(before))
    height = page.get_by_role("separator", name="Resize terminal panel", exact=True)
    before = height.get_attribute("aria-valuenow")
    height.focus(); height.press("ArrowUp")
    expect(height).not_to_have_attribute("aria-valuenow", before)
    ui.tab(b["id"]).click()
    expect(ui.visible()).to_have_count(1)
    ui.tab(a["id"]).focus(); ui.tab(a["id"]).press("Shift+Enter")
    expect(ui.visible()).to_have_count(2)
    dock_bars = alignment(page)
    checks.append("Real interactive shells; normal/Shift header selection; horizontal dock; pointer/keyboard pane and keyboard panel dividers")
    if ARGS.case == "pressure":
        return {"width": width, "checks": checks, "pressure": pressure(ui, width), "sessions": ui.sessions()}
    if ARGS.case == "dock":
        return {"width": width, "checks": checks, "previewLayout": locals().get("layout_receipt"), "sessions": ui.sessions()}

    # Expand/reorder the same mounted terminal panel without replacing xterm instances.
    token = "retained-" + str(width)
    ui.pane(a["id"]).locator(".xterm").evaluate("(element, token) => element.dataset.qaIdentity = token", token)
    page.get_by_test_id("workspace-view-terminals").click()
    expect(page.get_by_test_id("workspace-view-terminals")).to_have_attribute("aria-pressed", "true")
    layout_receipt = preview_layout(ui, width)
    assert panel.bounding_box()["height"] >= page.viewport_size["height"] * .4, "Terminals must share the retained preview stage"
    main_bars = alignment(page)
    page.get_by_role("button", name="Stack vertically", exact=True).click()
    expect(panel).to_have_attribute("data-orientation", "vertical")
    expect(ui.pane(a["id"]).locator(".xterm")).to_have_attribute("data-qa-identity", token)
    aa, bb = ui.pane(a["id"]).bounding_box(), ui.pane(b["id"]).bounding_box()
    assert aa["y"] + aa["height"] <= bb["y"] + 1
    first_id = page.locator("button.terminal-tab").first.get_attribute("data-terminal-node-id")
    ui.open_options(b["id"]).get_by_role("button", name="Move Terminal 2 earlier", exact=True).click()
    ui.close_options(b["id"])
    assert page.locator("button.terminal-tab").first.get_attribute("data-terminal-node-id") != first_id
    page.get_by_role("button", name="Side by side", exact=True).click()
    page.screenshot(path=str(OUTPUT / ("terminal-main-" + str(width) + ".png")), full_page=True, animations="disabled")
    page.get_by_role("button", name="Dock terminals", exact=True).click()
    expect(panel).to_have_attribute("data-orientation", "horizontal")
    expect(ui.pane(a["id"]).locator(".xterm")).to_have_attribute("data-qa-identity", token)
    page.get_by_role("button", name="Build canvas", exact=True).click()
    assert ui.session(a["id"])["pid"] == a["pid"]
    page.get_by_test_id("workspace-view-terminals").click()
    expect(ui.pane(a["id"]).locator(".xterm")).to_have_attribute("data-qa-identity", token)
    page.get_by_role("button", name="Workflow", exact=True).click()
    page.locator('[data-devlab-id="workspace.output.terminal"]').click()
    expect(ui.pane(a["id"]).locator(".xterm")).to_have_attribute("data-qa-identity", token)
    page.locator('[data-devlab-id="workspace.output.terminal"]').click()
    page.get_by_role("button", name="Agents", exact=True).click()
    expect(panel).not_to_be_visible()
    page.locator('[data-devlab-id="workspace.output.terminal"]').click()
    expect(ui.pane(a["id"]).locator(".xterm")).to_have_attribute("data-qa-identity", token)
    assert ui.session(a["id"])["pid"] == a["pid"]
    checks.append("Main Terminals view, orientation, reorder and Workflow/Build/dock transitions preserve mounted xterm and exact session/PID; all bars share36px geometry and no Start/Stop row")
    if ARGS.case == "workspace":
        before_reload = {value["id"]: value["pid"] for value in ui.sessions() if value["status"] == "running"}
        page.reload(wait_until="domcontentloaded")
        page.get_by_test_id("workspace-view-terminals").click()
        expect(page.get_by_role("separator", name="Resize project preview", exact=True)).to_have_attribute("aria-valuenow", "65")
        assert all(ui.session(key)["pid"] == pid for key, pid in before_reload.items())
        layout_receipt["savedRatioReload"] = True
        return {"width": width, "checks": checks, "previewLayout": locals().get("layout_receipt"), "sessions": ui.sessions()}

    ui.tab(a["id"]).click()
    pane = ui.pane(a["id"])
    pane.get_by_role("button", name="Rename Terminal 1", exact=True).click()
    name = pane.get_by_role("textbox", name="Terminal name", exact=True)
    name.fill("Owned console"); name.press("Enter")
    expect(ui.tab(a["id"])).to_contain_text("Owned console")
    a = ui.restart_with_mode(a, "guided")
    ui.open_options(a["id"])
    expect(ui.pane(a["id"]).locator("p").filter(has_text=re.compile("Guided.*advisory"))).to_be_visible()
    ui.close_options(a["id"])
    before = {item["id"] for item in ui.sessions()}
    ui.open_options(a["id"]).get_by_role("button", name="Fork Owned console", exact=True).click()
    fork = until(lambda: next((item for item in ui.sessions() if item["id"] not in before and item["status"] == "running"), None), "Fork did not start")
    assert fork["parentSessionId"] == a["id"]
    assert fork["ownership"] == a["ownership"]
    assert fork["pid"] != a["pid"]
    ui.command(fork["id"], "printf '\\nFORK_%s\\n' READY", "FORK_READY")
    checks.append("Rename persists in graph; Guided is advisory; fork starts fresh PID and inherits canonical ownership/mode")
    a = ui.restart_with_mode(a, "strict")
    ui.command(a["id"], "printf strict-updated > owned.txt; printf '\\nOWNED_%s\\n' WRITTEN", "OWNED_WRITTEN")
    ui.command(a["id"], "if printf forbidden > sibling.txt; then printf '\\nSIBLING_%s\\n' ESCAPED; else printf '\\nSIBLING_%s\\n' DENIED; fi", "SIBLING_DENIED")
    assert (Path(settings["root"]) / "owned.txt").read_text() == "strict-updated"
    assert (Path(settings["root"]) / "sibling.txt").read_text() == "sibling original\n"
    ui.command(a["id"], "QA_VALUE=still_here; printf '\\nSTRICT_%s\\n' RETAINED", "STRICT_RETAINED")
    race_results = fork_owner_races(ui, a)
    old_pid = a["pid"]
    expect(page.get_by_test_id("save-state")).to_have_text("Saved")
    page.reload(wait_until="domcontentloaded")
    expect(page.get_by_role("combobox", name="Active project", exact=True)).to_have_value(settings["projectId"])
    page.get_by_role("button", name="Workflow", exact=True).click()
    page.locator('[data-devlab-id="workspace.output.terminal"]').click()
    expect(ui.tab(a["id"])).to_contain_text("Owned console")
    ui.tab(a["id"]).click()
    expect(ui.pane(a["id"])).to_be_visible()
    assert ui.session(a["id"])["pid"] == old_pid
    ui.command(a["id"], "printf '\\nRESTORED_%s\\n' \"$QA_VALUE\"", "RESTORED_still_here")
    checks.append("Strict performs owned-file write and rejects sibling write; reload preserves shell variable, PID and renamed graph node")

    # Existing project preview remains interactive across workspace controls and Hood.
    page.get_by_role("button", name="Close lower panel", exact=True).click()
    frame = page.frame_locator('iframe[title^="Project UI"]').first
    frame.get_by_role("textbox", name="Preview input", exact=True).fill("retained preview")
    frame.get_by_role("textbox", name="Preview input", exact=True).evaluate("element => window.__terminalPreviewIdentity = 'same-document'")
    page.get_by_role("button", name=re.compile(r"^Pop(?: the)? Hood$")).click()
    expect(page.get_by_test_id("hood-root")).to_be_visible()
    architecture = api(settings["url"], "/api/architecture")
    assert any(item["id"] == "terminal-pty" for item in architecture["plugins"])
    page.get_by_role("button", name="Back to canvas", exact=True).click()
    expect(frame.get_by_role("textbox", name="Preview input", exact=True)).to_have_value("retained preview")
    assert frame.get_by_role("textbox", name="Preview input", exact=True).evaluate("() => window.__terminalPreviewIdentity") == "same-document"
    page.locator('[data-devlab-id="workspace.output.terminal"]').click()
    checks.append("Updated Pop the Hood shows active terminal capability; existing preview document/input survives switching")
    page.screenshot(path=str(OUTPUT / ("terminal-" + str(width) + ".png")), full_page=True, animations="disabled")
    result = {"width": width, "checks": checks, "previewLayout": layout_receipt, "sessions": ui.sessions(), "strictFile": "owned.txt", "siblingPreserved": True, "dockBars": dock_bars, "mainBars": main_bars, "forkOwnerRaces": race_results}
    (OUTPUT / ("correctness-" + str(width) + ".json")).write_text(json.dumps(result, indent=2) + "\n")
    if ARGS.case == "all":
        result["pressure"] = pressure(ui, width)
    result["strictFailureRecovery"] = strict_failure_recovery(ui, a)
    result["sessions"] = ui.sessions()
    return result


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    report = {"case": ARGS.case, "results": [], "javascriptErrors": [], "passed": False,
              "environment": {"kernel": os.uname().release, "machine": os.uname().machine,
                              "node": subprocess.check_output(["node", "--version"], text=True).strip()}}
    report["environment"]["cpu"] = next((line.split(":", 1)[1].strip() for line in Path("/proc/cpuinfo").read_text().splitlines() if line.startswith("model name")), "unknown")
    report["environment"]["memoryTotal"] = next((line.split(":", 1)[1].strip() for line in Path("/proc/meminfo").read_text().splitlines() if line.startswith("MemTotal:")), "unknown")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True, chromium_sandbox=True)
        report["environment"]["browser"] = browser.version
        try:
            for width in ([ARGS.width] if ARGS.width else [1440, 820]):
                with tempfile.TemporaryFile(mode="w+") as log:
                    fixture = subprocess.Popen(["node", "scripts/terminal-fixture.ts"], cwd=ROOT,
                                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, text=True)
                    context = None
                    try:
                        line = fixture.stdout.readline()
                        if not line:
                            log.seek(0)
                            raise RuntimeError("Fixture did not boot: " + log.read())
                        settings = json.loads(line)
                        settings["fixturePid"] = fixture.pid
                        assert settings["root"].startswith(tempfile.gettempdir() + "/devtest-terminal-browser-")
                        context = browser.new_context(viewport={"width": width, "height": 900})
                        page = context.new_page()
                        page.set_default_timeout(15000)
                        network = context.new_cdp_session(page)
                        network.send("Network.enable")
                        open_streams = set()
                        def stream_started(event):
                            if event.get("type") == "EventSource" and "/api/terminal" in event["request"]["url"]:
                                open_streams.add(event["requestId"])
                                report["maxConcurrentTerminalStreams"] = max(report.get("maxConcurrentTerminalStreams", 0), len(open_streams))
                        def stream_finished(event):
                            open_streams.discard(event["requestId"])
                        network.on("Network.requestWillBeSent", stream_started)
                        network.on("Network.loadingFinished", stream_finished)
                        network.on("Network.loadingFailed", stream_finished)
                        page.on("pageerror", lambda error: report["javascriptErrors"].append(str(error)))
                        page.on("request", lambda request: report.setdefault("closeRequests", []).append({"url": request.url, "at": time.monotonic()}) if "/api/terminals/" in request.url and request.url.endswith("/close") else None)
                        page.on("response", lambda response: report.setdefault("closeResponses", []).append({"url": response.url, "status": response.status, "at": time.monotonic()}) if "/api/terminals/" in response.url and response.url.endswith("/close") else None)
                        report["results"].append(exercise(page, settings, width))
                    except Exception:
                        if context:
                            page.screenshot(path=str(OUTPUT / ("failure-" + str(width) + ".png")), full_page=True)
                        raise
                    finally:
                        if context:
                            context.close()
                        if fixture.poll() is None:
                            fixture.stdin.write("close\n"); fixture.stdin.flush()
                        try:
                            stdout, _ = fixture.communicate(timeout=20)
                        except subprocess.TimeoutExpired:
                            fixture.terminate()
                            stdout, _ = fixture.communicate(timeout=10)
                            raise AssertionError("Fixture shutdown timed out")
                        log.seek(0)
                        assert fixture.returncode == 0, log.read()
                        closed = next((json.loads(line) for line in stdout.splitlines() if line.startswith('{"closed":')), None)
                        assert closed and closed["processesGone"], "Fixture process cleanup receipt missing"
                        report.setdefault("cleanup", []).append(closed)
            assert not report["javascriptErrors"], report["javascriptErrors"]
            report["passed"] = True
        finally:
            browser.close()
            (OUTPUT / "browser.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
