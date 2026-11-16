"""Actual WISDOHM setup UI acceptance on disposable projects and browser contexts."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import select
import subprocess
import tempfile
import time
import traceback
from urllib.parse import quote
from urllib.request import Request, urlopen

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = Path(os.environ.get("WISDOM_SETUP_EVIDENCE_DIR", str(Path(tempfile.gettempdir()) / "devlab-wisdom-setup-evidence")))
PARSER = argparse.ArgumentParser()
PARSER.add_argument("--width", type=int, choices=[1440, 820])
ARGS = PARSER.parse_args()


def api(base, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    headers = {} if body is None else {"Content-Type": "application/json"}
    with urlopen(Request(base + path, data=data, headers=headers), timeout=20) as response:
        return json.load(response)


def until(check, description, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        time.sleep(0.05)
    raise AssertionError(description)


def selected(page):
    return page.get_by_role("combobox", name="Active project", exact=True)


def actions(page):
    explorer = page.get_by_test_id("project-explorer")
    if not explorer.is_visible():
        page.get_by_role("button", name="Expand project explorer", exact=True).click()
    toggle = explorer.locator('[data-devlab-id="project.actions.toggle"]')
    if toggle.get_attribute("aria-expanded") != "true":
        toggle.focus()
        toggle.press("Enter")
    return explorer


def open_folder(page, path):
    explorer = actions(page)
    explorer.get_by_role("button", name="Open Folder", exact=True).click()
    form = explorer.get_by_role("form", name="Open existing folder", exact=True)
    field = form.get_by_role("textbox", name="Existing project folder", exact=True)
    expect(field).to_be_focused()
    field.fill(str(path))
    field.press("Enter")
    expect(form).not_to_be_visible(timeout=30000)
    expect(selected(page)).to_be_enabled()
    return selected(page).input_value()


def preparation(page, project):
    panel = page.locator('[data-testid="project-adoption"][data-devlab-project-id="' + project + '"]')
    expect(panel).to_be_visible()
    if panel.get_attribute("open") is None:
        panel.locator(":scope > summary").focus()
        panel.locator(":scope > summary").press("Enter")
    return panel


def geometry(page, panel):
    value = panel.evaluate("""element => {
      const box = element.getBoundingClientRect();
      const explorer = element.closest('.project-explorer-container');
      const outer = explorer.getBoundingClientRect();
      return {width: box.width, x: box.x, explorerWidth: outer.width,
        horizontalOverflow: element.scrollWidth > element.clientWidth,
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
        actions: [...element.querySelectorAll('.project-adoption-actions button')].filter(e => e.getClientRects().length).map(e => {
          const r = e.getBoundingClientRect(); return {text:e.textContent.trim(), x:r.x, y:r.y, width:r.width, height:r.height};
        })};
    }""")
    assert not value["horizontalOverflow"] and not value["pageOverflow"], value
    assert value["width"] <= value["explorerWidth"] + 1, value
    for button in value["actions"]:
        assert button["height"] <= 36 and button["width"] <= value["width"] + 1, value
    return value


def ready(base, project):
    value = api(base, "/api/projects/" + quote(project) + "/wisdom")
    assert value["setup"] == "ready" and value["status"] == "existing" and value["records"] > 0, value
    observed = api(base, "/api/rules?projectId=" + quote(project))
    assert observed["authority"]["status"] == "ready", observed["authority"]
    assert observed["harness"]["health"] == {"status": "healthy", "issues": []}, observed["harness"]["health"]
    assert observed["harness"]["routing"]["status"] == "valid", observed["harness"]["routing"]
    return {**{key: value[key] for key in ("status", "setup", "records")}, "health": "healthy", "healthNotes": 0}


def exercise(page, settings, width, case):
    base, original = settings["url"], settings["projectId"]
    private = Path(settings["root"]).parent
    assert private.name.startswith("devtest-terminal-browser-") and private.parent == Path(tempfile.gettempdir())
    checks = case["checks"]
    page.goto(base + "?projectId=" + quote(original), wait_until="domcontentloaded")
    expect(selected(page)).to_have_value(original)
    expect(selected(page)).to_be_enabled()
    page.get_by_role("button", name="Build canvas", exact=True).click()
    actions(page)
    # Current project intentionally follows selection; a named group pins retained work.
    groups = page.locator('[data-devlab-id="projects.preview-groups"]')
    groups.locator(":scope > summary").click()
    manage = groups.locator('[data-devlab-id="projects.preview-groups.manage"]')
    manage.locator(":scope > summary").click()
    group_name = manage.get_by_role("textbox", name="New preview group name", exact=True)
    group_name.fill("Retained setup fixture")
    group_name.press("Enter")
    expect(groups.get_by_role("button", name="Retained setup fixture 1", exact=True)).to_have_attribute("aria-pressed", "true")
    groups.locator(":scope > summary").click()
    page.get_by_role("button", name="Open owned.txt", exact=True).click()
    editor = page.get_by_role("textbox", name="File contents", exact=True)
    editor.fill("unsaved setup acceptance draft")
    iframe = page.locator('iframe[title^="Project UI"][data-devlab-project-id="' + original + '"]:visible').first
    expect(iframe).to_be_visible()
    iframe.evaluate("element => { window.__setupRetainedFrame = element; }")
    preview = page.frame_locator('iframe[title^="Project UI"][data-devlab-project-id="' + original + '"]:visible').first.get_by_role("textbox", name="Preview input", exact=True)
    preview.fill("retained setup preview")
    preview.evaluate("element => { window.__setupDocument = 'original-document'; }")
    terminal = api(base, "/api/terminals", {"projectId": original, "nodeId": "setup-retained-terminal", "cwd": ".", "shell": "bash", "cols": 80, "rows": 24})
    assert terminal["status"] == "running"

    # New Project goes through the actual form and the production create endpoint.
    explorer = actions(page)
    explorer.get_by_role("button", name="New project", exact=True).click()
    form = explorer.get_by_role("form", name="Create project", exact=True)
    name = form.get_by_role("textbox", name="Project name", exact=True)
    expect(name).to_be_focused()
    name.fill("Setup New " + str(width))
    slug = form.get_by_role("textbox", name="Project directory", exact=True).input_value()
    name.press("Enter")
    expect(form).not_to_be_visible(timeout=30000)
    expect(selected(page)).to_have_value(slug)
    expect(selected(page)).to_be_enabled()
    case["created"] = {"projectId": slug, **ready(base, slug)}
    panel = preparation(page, slug)
    expect(panel.locator(":scope > summary")).to_contain_text("Initialized")
    case["createdGeometry"] = geometry(page, panel)
    checks.append("New Project selects the created folder with initialized rules and populated project memory")

    # A real existing folder has application source and user rules that must survive.
    existing = private / ("setup-existing-" + str(width))
    (existing / "src").mkdir(parents=True)
    source = "export const fixture = 'preserved existing source';\n"
    rules = "# Existing instructions\nPreserve this project's application files.\n"
    (existing / "src/main.ts").write_text(source)
    (existing / "AGENTS.md").write_text(rules)
    (existing / "package.json").write_text(json.dumps({"name": "existing-setup-fixture", "scripts": {"test": "never-run-from-setup"}}))
    project = open_folder(page, existing)
    assert project not in [original, slug]
    case["opened"] = {"projectId": project, **ready(base, project)}
    assert (existing / "src/main.ts").read_text() == source
    assert (existing / "AGENTS.md").read_text().startswith(rules)
    panel = preparation(page, project)
    expect(panel.locator(":scope > summary")).to_contain_text("Initialized")
    checks.append("Open Folder initializes existing source and appends its loader while preserving user instructions")

    # A failed setup must not lose the already-opened project identity or imply success.
    retry = private / ("setup-retry-" + str(width))
    retry.mkdir()
    (retry / "source.txt").write_text("Retain retry fixture source.\n")
    outside = private / ("setup-untouched-" + str(width))
    outside.mkdir()
    marker = outside / "marker.txt"
    marker.write_text("Do not modify this symlink target.\n")
    (retry / ".wisdohm").symlink_to(outside, target_is_directory=True)
    failed = open_folder(page, retry)
    expect(selected(page)).to_have_value(failed)
    panel = preparation(page, failed)
    expect(panel.locator(":scope > summary")).to_contain_text("Needs attention")
    expect(panel.get_by_role("alert")).to_be_visible()
    assert marker.read_text() == "Do not modify this symlink target.\n" and len(list(outside.iterdir())) == 1
    assert len([p for p in api(base, "/api/projects") if p["id"] == failed]) == 1
    checks.append("Setup failure keeps the opened folder selected, exposes attention and never follows its unsafe symlink")
    (retry / ".wisdohm").unlink()
    # Review retries the selected folder without opening another project or losing the notice.
    panel.locator('[data-devlab-id="project.prepare"]').focus()
    panel.locator('[data-devlab-id="project.prepare"]').press("Enter")
    review = panel.get_by_label("Review project preparation", exact=True)
    expect(review).to_be_visible()
    expect(review).to_contain_text("project records")
    expect(review.get_by_role("button", name="Apply WISDOHM setup", exact=True)).to_be_enabled()
    assert not (retry / ".wisdohm").exists(), "Review must not install"
    case["reviewGeometry"] = geometry(page, panel)
    page.screenshot(path=str(OUTPUT / ("setup-review-" + str(width) + ".png")), full_page=True, animations="disabled")
    apply = review.get_by_role("button", name="Apply WISDOHM setup", exact=True)
    apply.focus()
    apply.press("Enter")
    expect(review).not_to_be_visible(timeout=30000)
    expect(panel.locator(":scope > summary")).to_contain_text("Initialized")
    expect(panel.get_by_role("alert")).to_have_count(0)
    case["retried"] = {"projectId": failed, **ready(base, failed)}
    assert (retry / "source.txt").read_text() == "Retain retry fixture source.\n"
    checks.append("Keyboard review/apply retries initialization in the same project and clears the failed-setup notice")
    panel.locator(":scope > summary").click()
    controls = page.locator('[data-testid="wisdohm-controls"][data-project-id="' + failed + '"]')
    refresh = controls.get_by_role("button", name="Refresh WISDOHM status", exact=True)
    expect(refresh).to_be_enabled()
    refresh.click()
    expect(controls.locator('dd[data-state="healthy"]')).to_be_visible()
    expect(controls.locator("summary")).to_have_count(0)
    page.screenshot(path=str(OUTPUT / ("setup-healthy-" + str(width) + ".png")), full_page=True, animations="disabled")
    checks.append("Actual WISDOHM control panel reports ready, healthy and populated with zero health notes")

    # Reopening is idempotent and selects the same project rather than duplicating it.
    database = retry / ".wisdohm/memory.sqlite"
    before = hashlib.sha256(database.read_bytes()).hexdigest()
    assert open_folder(page, retry) == failed
    assert hashlib.sha256(database.read_bytes()).hexdigest() == before
    assert len([p for p in api(base, "/api/projects") if p["id"] == failed]) == 1
    checks.append("Repeated Open Folder retains the same project and byte-identical populated memory")

    selected(page).select_option(original)
    expect(selected(page)).to_have_value(original)
    expect(editor).to_be_visible()
    expect(editor).to_have_value("unsaved setup acceptance draft")
    assert (Path(settings["root"]) / "owned.txt").read_text() == "owned original\n"
    expect(preview).to_have_value("retained setup preview")
    assert preview.evaluate("() => window.__setupDocument") == "original-document"
    assert iframe.evaluate("element => element === window.__setupRetainedFrame")
    sessions = api(base, "/api/terminals?projectId=" + quote(original))
    assert any(s["id"] == terminal["id"] and s["pid"] == terminal["pid"] and s["status"] == "running" for s in sessions)
    case["retainedTerminal"] = {"id": terminal["id"], "pid": terminal["pid"]}
    checks.append("Original unsaved editor draft, exact preview document/input and terminal ID/PID survive project setup transitions")
    toggle = actions(page).locator('[data-devlab-id="project.actions.toggle"]')
    toggle.focus()
    toggle.press("Escape")
    expect(toggle).to_have_attribute("aria-expanded", "false")
    expect(toggle).to_be_focused()
    checks.append("Project actions retain native keyboard access and Escape restores their compact state")
    page.screenshot(path=str(OUTPUT / ("setup-retained-" + str(width) + ".png")), full_page=True, animations="disabled")


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    report = {"passed": False, "results": [], "javascriptErrors": [], "cleanup": [], "build": os.environ.get("DEVLAB_BUILD_DIR", "source default dist")}
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="chrome", headless=True, chromium_sandbox=True)
            report["browser"] = browser.version
            try:
                for width in ([ARGS.width] if ARGS.width else [1440, 820]):
                    with tempfile.TemporaryFile(mode="w+") as log:
                        fixture = subprocess.Popen(["node", "scripts/terminal-fixture.ts"], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, text=True)
                        context = None
                        settings = None
                        try:
                            readable, _, _ = select.select([fixture.stdout], [], [], 30)
                            line = fixture.stdout.readline() if readable else ""
                            if not line:
                                log.seek(0)
                                raise RuntimeError("Setup fixture did not boot: " + log.read())
                            settings = json.loads(line)
                            context = browser.new_context(viewport={"width": width, "height": 1000})
                            page = context.new_page()
                            page.set_default_timeout(15000)
                            page.on("pageerror", lambda error: report["javascriptErrors"].append(str(error)))
                            case = {"width": width, "checks": []}
                            report["results"].append(case)
                            exercise(page, settings, width, case)
                        except Exception:
                            if context:
                                page.screenshot(path=str(OUTPUT / ("failure-" + str(width) + ".png")), full_page=True)
                            raise
                        finally:
                            if context:
                                context.close()
                            if fixture.poll() is None:
                                fixture.stdin.write("close\n")
                                fixture.stdin.flush()
                            try:
                                stdout, _ = fixture.communicate(timeout=30)
                            except subprocess.TimeoutExpired:
                                fixture.terminate()
                                fixture.communicate(timeout=10)
                                raise AssertionError("Setup fixture did not clean up")
                            log.seek(0)
                            assert fixture.returncode == 0, log.read()
                            closed = next((json.loads(line) for line in stdout.splitlines() if line.startswith('{"closed":')), None)
                            assert closed and closed["processesGone"], "Fixture cleanup receipt missing"
                            assert settings and not Path(settings["root"]).parent.exists(), "Fixture directory was not removed"
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
