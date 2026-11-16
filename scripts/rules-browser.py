"""RulesBoard acceptance: real private service plus explicit response-state fixtures.

No live application or user project is opened. Commands are copied, never run.
"""
import argparse
import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
from urllib.parse import quote, parse_qs, urlparse
from urllib.request import Request, urlopen

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = Path(os.environ.get("RULES_EVIDENCE_DIR", str(ROOT / "docs/evidence/rules-board/browser")))
PARSER = argparse.ArgumentParser()
PARSER.add_argument("--width", type=int, choices=[1440, 820])
ARGS = PARSER.parse_args()


def api(base, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    with urlopen(Request(base + path, data=data, headers={} if body is None else {"Content-Type": "application/json"}), timeout=20) as response:
        return json.load(response)


def until(check, description, timeout=15):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        value = check()
        if value:
            return value
        time.sleep(.05)
    raise AssertionError(description)


def state_fixture(snapshot, project):
    """Contract-valid synthetic evidence exercises independent UI status axes."""
    value = copy.deepcopy(snapshot)
    value["projectId"] = project
    value["sources"] = [
        {"id": "fixture-" + state, "path": "private/" + state + ".md", "label": "Fixture " + state,
         "category": "engineering" if state == "current" else "reference", "status": state,
         "text": "1. ORACLE_" + state.upper() + " requires deliberate review.", "truncated": state == "unverified",
         "numberedRules": [{"number": 1, "text": "ORACLE_" + state.upper() + " requires deliberate review.", "line": 1}],
         "review": "required" if state == "current" else "reference"}
        for state in ["current", "stale", "missing", "invalid", "unverified"]]
    value["checks"] = [
        {"id": "check-" + result + "-" + freshness, "sessionId": "fixture-session", "command": "fixture-check-" + result + "-" + freshness,
         "result": result, "freshness": freshness, "reason": "Explicit fixture evidence; no per-rule coverage.",
         "evidence": [{"path": "private/receipt.txt", "status": "stale" if freshness == "stale" else "missing"}]}
        for result, freshness in [("passed", "current"), ("failed", "stale"), ("unknown", "unverified"), ("passed", "historical")]]
    value["commands"] = [{"label": "Fixture verification", "command": "printf RULES_COMMAND_MUST_NOT_RUN > rules-executed.txt"}]
    value["warnings"] = ["Explicit UI response fixture; source validity and receipts are independent."]
    return value


def exercise(page, context, settings, width):
    base, project, root = settings["url"], settings["projectId"], Path(settings["root"])
    # Only the disposable project is populated; this also exercises the real service.
    (root / ".context/protocols").mkdir(parents=True, exist_ok=True)
    (root / ".context/config").mkdir(parents=True, exist_ok=True)
    (root / "AGENTS.md").write_text("Read .context/BOOT.md and the private fixture rules.\n")
    (root / ".context/BOOT.md").write_text("# Wisdom fixture 2.4.0\nPrivate browser acceptance authority.\n")
    (root / ".context/protocols/rules.md").write_text("# Private engineering rules\n1. REAL_SERVICE_RULE: preserve private fixture data.\n2. Require actual verification evidence.\n")
    (root / ".context/config/project.yaml").write_text("schema_version: 1\nproject:\n  name: Private RulesBoard fixture\n  root: .\nrules:\n  sources:\n    - AGENTS.md\n    - .context/protocols/rules.md\n")
    rules_path = "/api/rules?projectId=" + quote(project)
    real = api(base, rules_path)
    assert real["projectId"] == project
    assert any("REAL_SERVICE_RULE" in source["text"] for source in real["sources"]), real
    assert not real["checks"], "Private fixture must not invent check receipts"

    page.goto(base + "?projectId=" + quote(project), wait_until="domcontentloaded")
    expect(page.get_by_role("combobox", name="Active project", exact=True)).to_have_value(project)
    page.get_by_role("button", name="Build canvas", exact=True).click()
    doc = api(base, "/api/canvas/" + quote(project)) or {"revision": 0, "graph": {"name": "Rules retention", "nodes": [], "edges": []}}
    node = {"id": "rules-retained", "type": "terminal", "position": {"x": 40, "y": 40}, "data": {"label": "Rules retained", "cwd": ".", "shell": "bash"}}
    api(base, "/api/canvas", {"projectId": project, "expectedRevision": doc["revision"], "graph": {**doc["graph"], "nodes": [node], "edges": []}})
    expect(page.get_by_test_id("save-state")).to_have_text("Saved")
    if not page.get_by_role("button", name="Open owned.txt", exact=True).is_visible():
        page.get_by_role("button", name="Expand project explorer", exact=True).click()
    page.get_by_role("button", name="Open owned.txt", exact=True).click()
    close_drawer = page.get_by_role("button", name="Collapse project explorer", exact=True)
    if width < 1100:
        close_drawer.click()
    editor = page.get_by_role("textbox", name="File contents", exact=True, include_hidden=True)
    editor.fill("unsaved RulesBoard fixture draft")
    editor.evaluate("el => el.dataset.rulesOwner = 'same-editor'")
    frame = page.frame_locator('iframe[title^="Project UI"]').first
    frame.get_by_role("textbox", name="Preview input", exact=True).fill("retained-rules-preview")
    frame.locator("body").evaluate("el => el.dataset.rulesOwner = 'same-preview'")
    page.get_by_test_id("workspace-view-terminals").click()
    sessions = lambda: api(base, "/api/terminals?projectId=" + quote(project))
    session = until(lambda: next((item for item in sessions() if item["nodeId"] == node["id"] and item["status"] == "running"), None), "Private terminal was not ready")
    terminal = page.locator('.terminal-workspace-pane[data-terminal-node-id="rules-retained"] .devlab-terminal')
    expect(terminal).to_have_attribute("data-terminal-connection", "Connected")
    terminal.locator(".xterm").evaluate("el => el.dataset.rulesOwner = 'same-xterm'")
    button = page.get_by_role("button", name="Rules Board", exact=True)
    board = page.get_by_role("dialog", name="Rules Board", exact=True)
    mutations = []
    unexpected_mutations = lambda: [item for item in mutations if not (item["method"] == "POST" and item["url"] == base + "/api/terminals/" + session["id"] + "/resize")]
    def requested(request):
        if request.method != "GET" and request.url.startswith(base + "/api/"):
            mutations.append({"method": request.method, "url": request.url})
    page.on("request", requested)
    button.click()
    expect(board).to_be_visible()
    expect(board).to_have_attribute("data-project-id", project)
    search = board.get_by_role("searchbox", name="Search rules and evidence", exact=True)
    search.fill("REAL_SERVICE_RULE")
    expect(board.locator(".rules-entry:visible")).to_have_count(1)
    board.locator(".rules-entry:visible > summary").click()
    expect(board.get_by_text("No reviewed pin configured", exact=True)).to_be_visible()
    board.get_by_role("tab", name="Automatic checks", exact=True).click()
    expect(board.get_by_text("No automatic check evidence is recorded.", exact=True)).to_be_visible()
    board.get_by_role("button", name="Refresh rules snapshot", exact=True).click()
    expect(board.get_by_role("button", name="Refresh rules snapshot", exact=True)).to_be_enabled()
    # Native modal focus containment, including wrapping past its final control.
    board.get_by_role("button", name="Close Rules Board", exact=True).focus()
    chrome_focus_transitions = 0
    for _ in range(35):
        page.keyboard.press("Tab")
        focus = board.evaluate("el => ({inside:el.contains(document.activeElement), documentFocus:document.hasFocus(), active:document.activeElement.outerHTML.slice(0,300)})")
        # A native modal may enter browser chrome; it must never focus the app behind it.
        assert focus["inside"] or not focus["documentFocus"], "Tab reached background app: " + json.dumps(focus)
        chrome_focus_transitions += not focus["inside"]
    assert page.evaluate("() => {const outside=document.querySelector('.project-switcher');outside.focus();return document.activeElement!==outside;}"), "Native dialog did not make background controls inert"
    board.get_by_role("button", name="Close Rules Board", exact=True).focus()
    page.keyboard.press("Escape")
    expect(board).to_have_count(0)
    expect(button).to_be_focused()
    expect(terminal.locator(".xterm")).to_have_attribute("data-rules-owner", "same-xterm")
    expect(terminal).to_have_attribute("data-resize-owner", "true")
    expect(terminal).to_have_attribute("data-input-owner", "true")
    expect(editor).to_have_attribute("data-rules-owner", "same-editor")
    expect(editor).to_have_value("unsaved RulesBoard fixture draft")
    expect(frame.locator("body")).to_have_attribute("data-rules-owner", "same-preview")
    expect(frame.get_by_role("textbox", name="Preview input", exact=True)).to_have_value("retained-rules-preview")
    assert next(item for item in sessions() if item["id"] == session["id"])["pid"] == session["pid"]
    assert (root / "owned.txt").read_text() == "owned original\n", "Inspection saved the editor draft"
    assert not unexpected_mutations(), mutations

    # Explicit response-state fixtures complement the real-service assertions above.
    sample = state_fixture(real, project)
    def respond(route):
        route.fulfill(status=200, json=sample)
    page.route("**/api/rules?*", respond)
    button.click()
    expect(board.locator(".rules-entry:visible")).to_have_count(5)
    board.get_by_role("combobox", name="Source validity", exact=True).select_option("missing")
    expect(board.locator(".rules-entry:visible")).to_have_count(1)
    expect(board.locator(".rules-entry:visible")).to_contain_text("Source missing")
    board.get_by_role("combobox", name="Source validity", exact=True).select_option("all")
    board.get_by_role("combobox", name="Review guidance", exact=True).select_option("required")
    expect(board.locator(".rules-entry:visible")).to_have_count(1)
    expect(board.locator(".rules-entry:visible")).to_contain_text("ORACLE_CURRENT")
    board.get_by_role("combobox", name="Review guidance", exact=True).select_option("all")
    board.get_by_role("combobox", name="Rule category", exact=True).select_option("reference")
    expect(board.locator(".rules-entry:visible")).to_have_count(4)
    board.get_by_role("combobox", name="Rule category", exact=True).select_option("all")
    search.fill("ORACLE_STALE")
    expect(board.locator(".rules-entry:visible")).to_have_count(1)
    search.fill("")
    board.get_by_role("tab", name="Automatic checks", exact=True).focus()
    page.keyboard.press("Enter")
    board.get_by_role("combobox", name="Check result", exact=True).select_option("failed")
    board.get_by_role("combobox", name="Check freshness", exact=True).select_option("stale")
    expect(board.locator(".rules-entry:visible")).to_have_count(1)
    expect(board.locator(".rules-entry:visible")).to_contain_text("Result failed")
    expect(board.locator(".rules-entry:visible")).to_contain_text("Freshness stale")
    board.locator(".rules-entry:visible > summary").click()
    expect(board.get_by_text("No recording time available", exact=True)).to_be_visible()
    board.get_by_role("combobox", name="Check result", exact=True).select_option("passed")
    board.get_by_role("combobox", name="Check freshness", exact=True).select_option("historical")
    expect(board.locator(".rules-entry:visible")).to_have_count(1)
    expect(board.locator(".rules-entry:visible")).to_contain_text("Freshness historical")
    board.get_by_role("tab", name="Automatic checks", exact=True).focus()
    page.keyboard.press("ArrowLeft")
    expect(board.get_by_role("tab", name="Rules and guidance", exact=True)).to_have_attribute("aria-selected", "true")
    board.get_by_role("button", name="Copy Fixture verification command", exact=True).click()
    expect(board.get_by_text("Command copied. It has not been executed.", exact=True)).to_be_visible()
    assert page.evaluate("navigator.clipboard.readText()") == sample["commands"][0]["command"]
    assert not (root / "rules-executed.txt").exists() and not unexpected_mutations(), mutations
    background_resizes = len(mutations)
    geometry = board.evaluate("""el => {
      const r=el.getBoundingClientRect(), header=el.querySelector('.rules-toolbar'), h=header.getBoundingClientRect();
      const app=document.querySelector('.devlab>.toolbar'), a=app.getBoundingClientRect();
      const color=state=>getComputedStyle(el.querySelector('.rules-badge[data-state="'+state+'"]')).color;
      return {x:r.x,y:r.y,width:r.width,height:r.height,bar:h.height,appBar:a.height,font:getComputedStyle(header).fontFamily,headingFont:getComputedStyle(header.querySelector('h1')).fontFamily,appFont:getComputedStyle(app).fontFamily,currentColor:color('current'),staleColor:color('stale'),missingColor:color('missing'),overflow:el.scrollWidth>el.clientWidth};
    }""")
    assert geometry["x"] >= 0 and geometry["y"] >= 0 and geometry["x"] + geometry["width"] <= width + 1, geometry
    assert geometry["bar"] == geometry["appBar"] == 36 and geometry["font"] == geometry["appFont"] and not geometry["overflow"], geometry
    assert geometry["headingFont"] == geometry["appFont"] and geometry["currentColor"] != geometry["staleColor"] and geometry["currentColor"] != geometry["missingColor"], geometry
    board.locator(".rules-scroll").evaluate("el => el.scrollTop = 0")
    page.screenshot(path=str(OUTPUT / ("rules-" + str(width) + ".png")), full_page=True, animations="disabled")

    page.unroute("**/api/rules?*", respond)
    def fail(route):
        route.fulfill(status=503, json={"error": "Private fixture refresh failure"})
    page.route("**/api/rules?*", fail)
    board.get_by_role("button", name="Refresh rules snapshot", exact=True).click()
    expect(board.get_by_role("alert")).to_contain_text("last successful snapshot")
    expect(board.locator(".rules-entry:visible")).to_have_count(5)
    board.get_by_role("button", name="Close Rules Board", exact=True).click()
    button.click()
    expect(board.get_by_role("alert")).to_be_visible()
    expect(board.locator(".rules-entry")).to_have_count(0)
    board.get_by_role("button", name="Close Rules Board", exact=True).click()
    page.unroute("**/api/rules?*", fail)

    held = []
    current_scope_requests = []
    def hold(route):
        # The sidebar also observes the selected scope; request counts are not a modal contract.
        if parse_qs(urlparse(route.request.url).query).get("projectId") == ["default"]:
            current_scope_requests.append(route)
            route.fulfill(status=200, json=state_fixture(real, "default"))
        else:
            held.append(route)
    page.route("**/api/rules?*", hold)
    button.click()
    expect(board.get_by_text("Loading rules snapshot…", exact=True)).to_be_visible()
    until(lambda: len(held) == 1, "Rules request was not held")
    board.get_by_role("button", name="Close Rules Board", exact=True).click()
    page.get_by_role("combobox", name="Active project", exact=True).select_option("default")
    expect(page.get_by_role("combobox", name="Active project", exact=True)).to_have_value("default")
    button.click()
    until(lambda: bool(current_scope_requests), "New-scope observation was not requested")
    expect(board).to_have_attribute("data-project-id", "default")
    expect(board.get_by_role("searchbox", name="Search rules and evidence", exact=True)).to_be_visible()
    held[0].fulfill(status=200, json=sample)
    page.wait_for_timeout(100)
    expect(board).to_have_attribute("data-project-id", "default")
    expect(board.get_by_role("alert")).to_have_count(0)
    board.get_by_role("button", name="Close Rules Board", exact=True).click()
    page.unroute("**/api/rules?*", hold)
    page.remove_listener("request", requested)
    page.goto(base + "?view=kernel&projectId=" + quote(project), wait_until="domcontentloaded")
    fallback = page.get_by_role("button", name="Open Rules Board", exact=True)
    expect(fallback).to_be_visible()
    expect(board).to_have_count(0)
    fallback.click()
    expect(board).to_be_visible()
    page.keyboard.press("Escape")
    expect(board).to_have_count(0)
    expect(fallback).to_be_focused()
    return {"width": width, "realServiceRead": True, "responseStateFixturesExplicit": True,
            "searchAndIndependentFilters": True, "sourceDetails": True, "resultAndFreshnessSeparate": True,
            "copyWithoutExecution": True, "nativeFocusAndEscape": True, "browserChromeFocusTransitions": chrome_focus_transitions,
            "retainedOwnerResizeObservations": background_resizes, "workspaceIdentityDraftAndPidRetained": True,
            "loadingAndFailuresHonest": True, "latePreviousScopeIgnored": True, "kernelFallbackExplicitAndClosable": True, "geometry": geometry}


def main():
    build = Path(os.environ["DEVLAB_BUILD_DIR"]).resolve()
    artifact = json.loads((build / "architecture.json").read_text())
    for path in ["plugins/ui-rules/src/index.ts", "plugins/ui-rules/src/view.tsx", "plugins/ui-rules/src/rules.css", "plugins/ui-shell/src/view.tsx"]:
        assert artifact["sources"][path] == (ROOT / path).read_text(), "Candidate source drift: " + path
    OUTPUT.mkdir(parents=True, exist_ok=True)
    report = {"passed": False, "results": [], "javascriptErrors": [], "liveUserApiUsed": False, "cleanup": []}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True, chromium_sandbox=True)
        try:
            for width in ([ARGS.width] if ARGS.width else [1440, 820]):
                with tempfile.TemporaryDirectory(prefix="rb-", dir="/dev/shm") as private, tempfile.TemporaryFile(mode="w+", dir="/dev/shm") as log:
                    fixture = subprocess.Popen(["node", "scripts/terminal-fixture.ts"], cwd=ROOT,
                        env={**os.environ, "TMPDIR": private, "DEVLAB_BUILD_DIR": str(build)}, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, text=True)
                    context = None
                    try:
                        line = fixture.stdout.readline()
                        if not line:
                            log.seek(0); raise AssertionError("Fixture did not boot: " + log.read())
                        settings = json.loads(line)
                        assert Path(settings["root"]).is_relative_to(private)
                        origin = urlparse(settings["url"])
                        assert origin.hostname == "127.0.0.1" and origin.port not in [4310, 4311]
                        context = browser.new_context(viewport={"width": width, "height": 900})
                        context.grant_permissions(["clipboard-read", "clipboard-write"], origin=settings["url"])
                        page = context.new_page(); page.set_default_timeout(15000)
                        page.on("pageerror", lambda error: report["javascriptErrors"].append(str(error)))
                        report["results"].append(exercise(page, context, settings, width))
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
                            stdout, _ = fixture.communicate(timeout=25)
                        except subprocess.TimeoutExpired:
                            fixture.terminate(); fixture.communicate(timeout=10)
                            raise AssertionError("Private fixture shutdown timed out")
                        log.seek(0); assert fixture.returncode == 0, log.read()
                        cleanup = next((json.loads(line) for line in stdout.splitlines() if line.startswith('{"closed":')), None)
                        assert cleanup and cleanup["processesGone"], "Private fixture did not clean up shells"
                        report["cleanup"].append(cleanup)
            assert not report["javascriptErrors"], report["javascriptErrors"]
            report["passed"] = True
        finally:
            browser.close()
            (OUTPUT / "rules-browser.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
