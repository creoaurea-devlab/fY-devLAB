"""Private UI regressions for terminal presentation ownership and explicit retry."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = Path(os.environ.get("TERMINAL_LIFECYCLE_EVIDENCE_DIR", "/dev/shm/devtest-terminal-lifecycle-evidence"))
PARSER = argparse.ArgumentParser()
PARSER.add_argument("--width", type=int, choices=[1440, 820])
ARGS = PARSER.parse_args()


def api(base, path, body=None):
    payload = None if body is None else json.dumps(body).encode()
    with urlopen(Request(base + path, data=payload, headers={} if body is None else {"Content-Type": "application/json"}), timeout=20) as response:
        return json.load(response)


def until(check, description, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        time.sleep(.05)
    raise AssertionError(description)


def exercise(page, settings, width):
    base, project = settings["url"], settings["projectId"]
    sessions = lambda: api(base, "/api/terminals?projectId=" + quote(project))
    running = lambda node: next((s for s in sessions() if s["nodeId"] == node and s["status"] == "running"), None)
    creates, inputs, resizes = [], [], []

    def requested(request):
        if request.method != "POST":
            return
        if request.url == base + "/api/terminals":
            creates.append(request.post_data_json)
        elif "/api/terminals/" in request.url and request.url.endswith("/input"):
            inputs.append(request.url)
        elif "/api/terminals/" in request.url and request.url.endswith("/resize"):
            resizes.append(request.url)

    page.on("request", requested)
    page.goto(base + "?projectId=" + quote(project), wait_until="domcontentloaded")
    expect(page.get_by_role("combobox", name="Active project", exact=True)).to_have_value(project)
    page.get_by_role("button", name="Build canvas", exact=True).click()
    doc = api(base, "/api/canvas/" + quote(project))
    if doc is None:
        doc = {"revision": 0, "graph": {"name": "Private terminal lifecycle", "nodes": [], "edges": []}}
    nodes = [{"id": "lifecycle-" + name, "type": "terminal", "position": {"x": 40 + index * 440, "y": 40},
              "data": {"label": "Lifecycle " + name, "cwd": ".", "shell": "bash", "collapsed": name == "collapsed"}}
             for index, name in enumerate(["a", "b", "collapsed"])]
    api(base, "/api/canvas", {"projectId": project, "expectedRevision": doc["revision"],
                              "graph": {**doc["graph"], "nodes": nodes, "edges": []}})
    canvas = lambda node: page.get_by_test_id("terminal-" + node)
    expect(canvas("lifecycle-a")).to_be_attached()
    expect(canvas("lifecycle-a")).to_have_attribute("data-input-owner", "false")
    expect(canvas("lifecycle-a")).to_have_attribute("data-resize-owner", "false")
    expect(canvas("lifecycle-collapsed")).to_have_count(0)
    page.wait_for_timeout(1300)
    assert not sessions() and not creates, "Build view launched an invisible Canvas terminal"

    page.get_by_test_id("workspace-view-terminals").click()
    a = until(lambda: running("lifecycle-a"), "Main terminal did not become ready")
    pane = lambda node: page.locator('.terminal-workspace-pane:visible[data-terminal-node-id="' + node + '"]')
    expect(pane("lifecycle-a").locator(".devlab-terminal")).to_have_attribute("data-terminal-connection", "Connected")
    page.wait_for_timeout(700)
    assert not running("lifecycle-b"), "Hidden unselected Canvas node launched in main Terminal view"
    expect(canvas("lifecycle-b")).to_have_attribute("data-input-owner", "false")
    expect(canvas("lifecycle-b")).to_have_attribute("data-resize-owner", "false")

    page.get_by_role("button", name="Workflow", exact=True).click()
    b = until(lambda: running("lifecycle-b"), "Visible Canvas node did not start")
    page.locator(".react-flow__controls-fitview").click()
    assert running("lifecycle-a")["id"] == a["id"]
    expect(canvas("lifecycle-a")).to_have_attribute("data-input-owner", "true")
    expect(canvas("lifecycle-collapsed")).to_have_count(0)
    assert not running("lifecycle-collapsed")
    collapsed = page.locator('.react-flow__node[data-id="lifecycle-collapsed"]')
    collapsed.get_by_role("button", name="Expand", exact=True).click()
    c = until(lambda: running("lifecycle-collapsed"), "Expanded visible terminal did not start")
    collapsed.get_by_role("button", name="Collapse", exact=True).click()
    expect(canvas("lifecycle-collapsed")).to_have_count(0)
    assert running("lifecycle-collapsed")["pid"] == c["pid"], "Collapse terminated an existing shell"
    expect(page.get_by_test_id("save-state")).to_have_text("Saved")

    # Preview focus also hides the editor surface, while retaining its mounted owners.
    page.get_by_role("button", name="Focus previews", exact=True).click()
    expect(canvas("lifecycle-a")).to_have_attribute("data-input-owner", "false")
    expect(canvas("lifecycle-a")).to_have_attribute("data-resize-owner", "false")
    doc = api(base, "/api/canvas/" + quote(project))
    extra = {"id": "lifecycle-focused", "type": "terminal", "position": {"x": 40, "y": 360},
             "data": {"label": "Lifecycle focused", "cwd": ".", "shell": "bash"}}
    api(base, "/api/canvas", {"projectId": project, "expectedRevision": doc["revision"],
                              "graph": {**doc["graph"], "nodes": doc["graph"]["nodes"] + [extra]}})
    expect(canvas(extra["id"])).to_be_attached()
    page.wait_for_timeout(1300)
    assert not running(extra["id"]), "Preview focus launched a hidden Canvas terminal"
    page.get_by_role("button", name="Exit preview focus", exact=True).click()
    until(lambda: running(extra["id"]), "Restored Canvas terminal did not become ready")

    page.get_by_test_id("workspace-view-terminals").click()
    page.locator('button.terminal-tab[data-terminal-node-id="lifecycle-a"]').click()
    # Multi-pane layout keeps one owner per terminal and no separate dock toolbar.
    page.locator('button.terminal-tab[data-terminal-node-id="lifecycle-b"]').click(modifiers=["Shift"])
    expect(pane("lifecycle-a")).to_be_visible()
    expect(pane("lifecycle-b")).to_be_visible()
    expect(page.get_by_role("separator", name="Resize Lifecycle a and Lifecycle b", exact=True)).to_be_visible()
    page.get_by_role("button", name="Stack vertically", exact=True).click()
    expect(page.get_by_test_id("terminal-sessions")).to_have_attribute("data-orientation", "vertical")
    page.get_by_role("button", name="Side by side", exact=True).click()
    page.locator('button.terminal-tab[data-terminal-node-id="lifecycle-a"]').click()
    assert running("lifecycle-a")["pid"] == a["pid"] and running("lifecycle-b")["pid"] == b["pid"]
    textarea = pane("lifecycle-a").locator(".xterm-helper-textarea")
    textarea.focus(); textarea.press_sequentially("exit 7", delay=1); textarea.press("Enter")
    until(lambda: next(s for s in sessions() if s["id"] == a["id"])["status"] == "exited", "Nonzero shell exit was not recorded")
    expect(pane("lifecycle-a").locator(".terminal-error")).to_contain_text("Shell exited (7)")
    attempts = sum(command["nodeId"] == "lifecycle-a" for command in creates)
    page.get_by_role("button", name="Build canvas", exact=True).click()
    expect(canvas("lifecycle-a")).to_have_attribute("data-input-owner", "false")
    before_input, before_resize = len(inputs), len(resizes)
    page.set_viewport_size({"width": width, "height": 880})
    page.wait_for_timeout(700)
    assert len(inputs) == before_input and len(resizes) == before_resize, "Hidden Canvas sent terminal input/resize"
    page.get_by_role("button", name="Workflow", exact=True).click()
    expect(canvas("lifecycle-a").locator(".terminal-error")).to_contain_text("Shell exited (7)")
    page.get_by_test_id("workspace-view-terminals").click()
    expect(pane("lifecycle-a").locator(".terminal-error")).to_contain_text("Shell exited (7)")
    page.wait_for_timeout(700)
    assert not running("lifecycle-a") and sum(command["nodeId"] == "lifecycle-a" for command in creates) == attempts, "Surface handoff bypassed Retry"

    page.reload(wait_until="domcontentloaded")
    page.get_by_test_id("workspace-view-terminals").click()
    expect(pane("lifecycle-a").locator(".terminal-error")).to_contain_text("Shell exited (7)")
    page.wait_for_timeout(700)
    assert not running("lifecycle-a") and sum(command["nodeId"] == "lifecycle-a" for command in creates) == attempts, "Reload bypassed Retry"
    assert running("lifecycle-b")["pid"] == b["pid"], "Unrelated running shell was replaced"

    # Retry from the other surface; the retained dock must adopt its successful result.
    page.get_by_role("button", name="Workflow", exact=True).click()
    page.locator(".react-flow__controls-fitview").click()
    canvas("lifecycle-a").get_by_role("button", name="Retry connection", exact=True).click()
    fresh = until(lambda: running("lifecycle-a"), "Explicit Canvas Retry did not open one new shell")
    page.get_by_test_id("workspace-view-terminals").click()
    expect(pane("lifecycle-a").locator(".devlab-terminal")).to_have_attribute("data-terminal-session-id", fresh["id"])
    expect(pane("lifecycle-a").locator(".devlab-terminal")).to_have_attribute("data-terminal-connection", "Connected")
    page.wait_for_timeout(300)
    assert sum(command["nodeId"] == "lifecycle-a" for command in creates) == attempts + 1, "One Retry launched more than one shell"

    frame = page.frame_locator('iframe[title^="Project UI"]').first
    frame.get_by_role("textbox", name="Preview input", exact=True).fill("lifecycle-preview-retained")
    frame.locator("body").evaluate("el => el.dataset.lifecycleOwner = 'same-preview'")
    pane("lifecycle-a").locator(".xterm").evaluate("el => el.dataset.lifecycleOwner = 'same-xterm'")
    textarea = pane("lifecycle-a").locator(".xterm-helper-textarea")
    textarea.focus(); textarea.press_sequentially("sleep 1; exit 0", delay=1); textarea.press("Enter")
    page.get_by_role("button", name="Focus previews", exact=True).click()
    expect(pane("lifecycle-a").locator(".devlab-terminal")).to_have_count(0)
    dock = page.locator('.terminal-workspace-pane[data-terminal-node-id="lifecycle-a"] .devlab-terminal')
    expect(dock).to_have_attribute("data-input-owner", "false")
    expect(dock).to_have_attribute("data-resize-owner", "false")
    expect(canvas("lifecycle-a")).to_have_attribute("data-input-owner", "false")
    until(lambda: next(s for s in sessions() if s["id"] == fresh["id"])["status"] == "exited", "Focused-preview shell did not exit")
    page.wait_for_timeout(700)
    assert not running("lifecycle-a"), "Hidden main Terminal presentation reopened during preview focus"
    page.get_by_role("button", name="Exit preview focus", exact=True).click()
    restored = until(lambda: running("lifecycle-a"), "Restored main terminal did not become ready")
    expect(pane("lifecycle-a").locator(".devlab-terminal")).to_have_attribute("data-terminal-connection", "Connected")
    expect(pane("lifecycle-a").locator(".xterm")).to_have_attribute("data-lifecycle-owner", "same-xterm")
    textarea = pane("lifecycle-a").locator(".xterm-helper-textarea")
    textarea.focus(); textarea.press_sequentially("exit 0", delay=1); textarea.press("Enter")
    reopened = until(lambda: (s if (s := running("lifecycle-a")) and s["id"] != restored["id"] else None), "Clean exit did not automatically reopen")
    expect(pane("lifecycle-a").locator(".devlab-terminal")).to_have_attribute("data-terminal-connection", "Connected")
    expect(pane("lifecycle-a").locator(".xterm")).to_have_attribute("data-lifecycle-owner", "same-xterm")
    page.get_by_role("button", name="Dock terminals", exact=True).click()
    expect(pane("lifecycle-a").locator(".xterm")).to_have_attribute("data-lifecycle-owner", "same-xterm")
    assert running("lifecycle-a")["pid"] == reopened["pid"]
    panel = page.get_by_test_id("terminal-sessions")
    expect(panel.locator(":scope > .terminal-workspace-toolbar")).to_have_count(0)
    header = pane("lifecycle-a").locator(".terminal-pane-toolbar")
    assert header.bounding_box()["height"] <= 28, "Compact terminal header exceeds 28px"
    expect(header.get_by_role("button", name="New terminal", exact=True)).to_be_visible()
    before_collapse = len(creates)
    header.get_by_role("button", name="Collapse terminal controls", exact=True).click()
    expect(header.get_by_role("button", name="Expand terminal controls", exact=True)).to_have_attribute("aria-expanded", "false")
    expect(header.get_by_role("button", name="New terminal", exact=True)).to_have_count(0)
    expect(pane("lifecycle-a").locator(".xterm")).to_have_attribute("data-lifecycle-owner", "same-xterm")
    assert running("lifecycle-a")["pid"] == reopened["pid"] and len(creates) == before_collapse
    header.get_by_role("button", name="Expand terminal controls", exact=True).click()
    expect(header.get_by_role("button", name="New terminal", exact=True)).to_be_visible()
    header.get_by_label("Actions for Lifecycle a", exact=True).click()
    expect(header.get_by_role("combobox", name="Ownership mode for Lifecycle a", exact=True)).to_be_visible()
    page.keyboard.press("Escape")
    expect(header.get_by_label("Actions for Lifecycle a", exact=True)).to_be_focused()
    page.screenshot(path=str(OUTPUT / ("compact-dock-" + str(width) + ".png")), full_page=True, animations="disabled")
    expect(frame.get_by_role("textbox", name="Preview input", exact=True)).to_have_value("lifecycle-preview-retained")
    expect(frame.locator("body")).to_have_attribute("data-lifecycle-owner", "same-preview")

    # Lose only this fixture's process owner. One unknown exit recovers automatically;
    # a repeated immediate loss stops at the existing explicit Retry action.
    def lose_owner(session):
        record = Path(settings["root"]).parent / "terminals" / (session["id"] + ".json")
        saved = json.loads(record.read_text())
        subprocess.run([str(ROOT / ".tools/tmux/bin/tmux"), "-S", saved["socket"], "kill-server"], check=True)

    lose_owner(reopened)
    recovered = until(lambda: (s if (s := running("lifecycle-a")) and s["id"] != reopened["id"] else None), "Unknown owner loss did not recover")
    expect(pane("lifecycle-a").locator(".devlab-terminal")).to_have_attribute("data-terminal-connection", "Connected")
    assert running("lifecycle-b")["pid"] == b["pid"]
    lose_owner(recovered)
    expect(pane("lifecycle-a").locator(".terminal-error")).to_contain_text("Shell exited (unknown)")
    page.wait_for_timeout(1200)
    assert not running("lifecycle-a"), "Repeated owner loss caused an unbounded restart loop"
    pane("lifecycle-a").get_by_role("button", name="Retry connection", exact=True).click()
    recovered = until(lambda: running("lifecycle-a"), "Manual recovery stayed stuck after the automatic retry budget")
    expect(pane("lifecycle-a").locator(".devlab-terminal")).to_have_attribute("data-terminal-connection", "Connected")

    # A request with no response must eventually release the input queue. Do not
    # replay ambiguous input after the user acknowledges it.
    input_url = base + "/api/terminals/" + recovered["id"] + "/input"
    held = []
    page.route(input_url, lambda route: held.append(route))
    textarea = pane("lifecycle-a").locator(".xterm-helper-textarea")
    textarea.focus(); textarea.press("x")
    expect(pane("lifecycle-a").locator(".terminal-error")).to_contain_text("Input delivery uncertain", timeout=20000)
    for route in held:
        route.abort()
    page.unroute(input_url)
    pane("lifecycle-a").get_by_role("button", name="Discard unsent input and continue", exact=True).click()
    textarea.focus(); textarea.press_sequentially("printf '\\nINPUT_%s\\n' RECOVERED", delay=1); textarea.press("Enter")
    until(lambda: any("INPUT_RECOVERED" in c["data"] for c in api(base, "/api/terminals/" + recovered["id"])["chunks"]), "Input queue remained stuck after timeout acknowledgement")
    assert running("lifecycle-a")["pid"] == recovered["pid"]
    page.screenshot(path=str(OUTPUT / ("lifecycle-" + str(width) + ".png")), full_page=True, animations="disabled")
    return {"width": width, "compactDockOneRow28px": True, "controlsCollapseRetainsOwnerAndPid": True, "multiPaneLayoutAndActionsRetained": True, "buildAndMainHiddenLaunchBlocked": True, "hiddenInputResizeBlocked": True,
            "previewFocusHiddenLaunchBlocked": True, "collapsedNodeDoesNotLaunchAndRetainsRunningPid": True,
            "mainPreviewFocusPausesReopenUntilRestore": True,
            "nonzeroExitWaitsAcrossOwnersAndReload": True, "explicitRetryCreatesOneSession": True,
            "otherOwnerAdoptsRetriedSession": True, "cleanExitReopens": True, "xtermPreviewAndPidRetained": True,
            "unknownExitRecoversOnce": True, "repeatedOwnerLossRequiresRetry": True, "stalledInputRecoversWithoutReplay": True}


def main():
    build = Path(os.environ["DEVLAB_BUILD_DIR"]).resolve()
    artifact = json.loads((build / "architecture.json").read_text())
    for path in ["plugins/ui-terminal/src/view.tsx", "plugins/ui-canvas/src/view.tsx", "plugins/ui-shell/src/view.tsx"]:
        assert artifact["sources"][path] == (ROOT / path).read_text(), "Candidate source drift: " + path
    OUTPUT.mkdir(parents=True, exist_ok=True)
    report = {"passed": False, "results": [], "javascriptErrors": [], "liveUserApiUsed": False, "cleanup": []}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True, chromium_sandbox=True)
        try:
            for width in ([ARGS.width] if ARGS.width else [1440, 820]):
                with tempfile.TemporaryDirectory(prefix="lc-", dir="/dev/shm") as private, tempfile.TemporaryFile(mode="w+") as log:
                    env = {**os.environ, "TMPDIR": private, "DEVLAB_BUILD_DIR": str(build)}
                    fixture = subprocess.Popen(["node", "scripts/terminal-fixture.ts"], cwd=ROOT, env=env,
                                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, text=True)
                    context = None
                    try:
                        line = fixture.stdout.readline()
                        if not line:
                            log.seek(0); raise AssertionError("Fixture did not boot: " + log.read())
                        settings = json.loads(line)
                        assert Path(settings["root"]).is_relative_to(private)
                        origin = urlparse(settings["url"])
                        assert origin.hostname == "127.0.0.1" and origin.port != 4310
                        context = browser.new_context(viewport={"width": width, "height": 900})
                        page = context.new_page(); page.set_default_timeout(15000)
                        page.on("pageerror", lambda error: report["javascriptErrors"].append(str(error)))
                        report["results"].append(exercise(page, settings, width))
                    except Exception:
                        if context:
                            page.screenshot(path=str(OUTPUT / ("failure-" + str(width) + ".png")), full_page=True)
                        raise
                    finally:
                        if context: context.close()
                        if fixture.poll() is None:
                            fixture.stdin.write("close\n"); fixture.stdin.flush()
                        try:
                            stdout, _ = fixture.communicate(timeout=25)
                        except subprocess.TimeoutExpired:
                            fixture.terminate(); fixture.communicate(timeout=10)
                            raise AssertionError("Private fixture shutdown timed out")
                        log.seek(0); assert fixture.returncode == 0, log.read()
                        cleanup = next((json.loads(line) for line in stdout.splitlines() if line.startswith('{"closed":')), None)
                        assert cleanup and cleanup["processesGone"], "Private fixture did not clean up its shells"
                        report["cleanup"].append(cleanup)
            assert not report["javascriptErrors"], report["javascriptErrors"]
            report["passed"] = True
        finally:
            browser.close()
            (OUTPUT / "lifecycle-browser.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
