"""Exercise the copied UI against a private fixture and a current-source reference.

FULL_UI_REFERENCE_DIST must point to an independently built Full frontend.
The reference proxy and every mutation use this script's disposable backend.
"""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
from threading import Thread
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

from playwright.sync_api import sync_playwright, expect


ROOT = Path(__file__).resolve().parent.parent
REFERENCE = Path(os.environ["FULL_UI_REFERENCE_DIST"]).resolve()
assert (REFERENCE / "index.html").is_file(), "FULL_UI_REFERENCE_DIST must contain index.html"
OUTPUT = Path(os.environ.get("UI_COPY_EVIDENCE_DIR", "/tmp/devlab-ui-copy"))
OUTPUT.mkdir(parents=True, exist_ok=True)
report = {"referenceAssets": str(REFERENCE), "comparisons": [], "acceptance": []}


def api(base, path, body=None):
    payload = None if body is None else json.dumps(body).encode()
    headers = {} if body is None else {"Content-Type": "application/json"}
    with urlopen(Request(base + path, data=payload, headers=headers), timeout=15) as response:
        return json.load(response)


def reference_proxy(backend):
    """Serve reference assets; all APIs use the same disposable fixture owner."""
    target = urlparse(backend)

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(REFERENCE), **kwargs)

        def log_message(self, *_args):
            pass

        def forward(self):
            body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            headers = {"Host": target.netloc, "Origin": backend}
            if self.headers.get("Content-Type"):
                headers["Content-Type"] = self.headers["Content-Type"]
            request = Request(backend + self.path, data=body if self.command == "POST" else None,
                              method=self.command, headers=headers)
            try:
                response = urlopen(request, timeout=20)
            except HTTPError as error:
                response = error
            with response:
                data = response.read()
                self.send_response(response.status)
                self.send_header("Content-Type", response.headers.get("Content-Type", "application/json"))
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        def do_GET(self):
            if self.path.startswith("/api/"):
                self.forward()
            else:
                super().do_GET()

        def do_POST(self):
            self.forward()

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, "http://127.0.0.1:" + str(server.server_port)


def open_project(page, base, project_id):
    page.goto(base + "?projectId=" + quote(project_id), wait_until="domcontentloaded")
    expect(page.get_by_test_id("flow-editor-root")).to_be_visible()
    select = page.get_by_role("combobox", name="Active project", exact=True)
    expect(select.locator("option[value='" + project_id + "']")).to_have_count(1)
    expect(select).to_be_enabled()
    select.select_option(project_id)
    expect(select).to_have_value(project_id)
    workflow = page.get_by_role("button", name="Workflow", exact=True)
    workflow.click()
    expect(workflow).to_have_attribute("aria-pressed", "true")
    expect(page.get_by_role("textbox", name="Flow name", exact=True)).to_be_enabled()
    page.frame_locator('iframe[title^="Project UI"]').first.get_by_role("textbox", name="Preview input").wait_for()


def geometry(page):
    return page.evaluate("""() => {
      const selectors = ['.devlab', '.toolbar', '.workspace-body', '.workspace-projects',
        '.project-explorer-collapsed', '.project-preview-split', '.project-flow-stage',
        '.node-palette', '.node-palette-collapsed', '.workspace-rail'];
      return Object.fromEntries(selectors.map(selector => {
        const e = document.querySelector(selector);
        if (!e) return [selector, null];
        const r = e.getBoundingClientRect(), s = getComputedStyle(e);
        return [selector, {rect: {x:r.x,y:r.y,width:r.width,height:r.height},
          styles: {fontFamily:s.fontFamily,fontSize:s.fontSize,color:s.color,
            backgroundColor:s.backgroundColor,borderRightColor:s.borderRightColor}}];
      }));
    }""")


def compare_layout(candidate, reference, width):
    left, right = geometry(candidate), geometry(reference)
    # Standardized bars are the declared visual change. Keep exact Full colors,
    # font family and horizontal geometry; adjust only header/text height and
    # the resulting extra workspace space.
    expected = json.loads(json.dumps(right))
    header_delta = 36 - right['.toolbar']['rect']['height']
    for selector, item in expected.items():
        if item is None:
            continue
        rect = item['rect']
        if selector in ['.toolbar', '.workspace-rail']:
            rect['height'] = 36
            item['styles']['fontSize'] = '11px'
        elif rect['height'] > 0 and abs(rect['y'] - right['.workspace-body']['rect']['y']) <= 1:
            # Compact previews stack vertically; retain their original split ratio.
            share = rect['height'] / right['.workspace-body']['rect']['height']
            rect['y'] += header_delta
            rect['height'] -= header_delta * share
    differences = []
    for selector, wanted in expected.items():
        actual = left[selector]
        if wanted is None or actual is None:
            if wanted != actual:
                differences.append(selector + " presence")
            continue
        for field, value in wanted["rect"].items():
            if abs(actual["rect"][field] - value) > 1:
                differences.append(selector + "." + field)
        if actual["styles"] != wanted["styles"]:
            differences.append(selector + " computed style")
    result = {"viewport": [width, 900], "candidate": left, "reference": right,
              "expectedAppAlignedGeometry": expected,
              "intentionalChanges": ["36px bars with11px text; inherited app font family", "workspace gains removed header height"],
              "geometryToleranceCssPixels": 1, "differences": differences}
    candidate_path = OUTPUT / f"candidate-{width}.png"
    reference_path = OUTPUT / f"reference-{width}.png"
    candidate.screenshot(path=str(candidate_path), animations="disabled", caret="hide")
    reference.screenshot(path=str(reference_path), animations="disabled", caret="hide")
    # Pixel differences are recorded for review, not hidden behind a permissive threshold.
    # Capability availability and source-path text can legitimately differ.
    from PIL import Image, ImageChops
    delta = ImageChops.difference(Image.open(candidate_path).convert("RGB"),
                                 Image.open(reference_path).convert("RGB"))
    result["pixelsWithChannelDifferenceAbove12"] = sum(max(pixel) > 12 for pixel in delta.get_flattened_data())
    result["totalPixels"] = width * 900
    report["comparisons"].append(result)
    assert not differences, "Reference layout differs: " + ", ".join(differences)


def assert_retained_frames(frames, identities):
    assert identities == [frame.element_handle().content_frame().evaluate("window.__uiCopyFrame")
                          for frame in frames.all()], "Preview documents were replaced"


log = tempfile.TemporaryFile(mode="w+")
fixture = subprocess.Popen(["node", "scripts/browser-fixture.ts"], cwd=ROOT,
                           stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, text=True)
settings = None
proxy = None
try:
    line = fixture.stdout.readline()
    if not line:
        log.seek(0)
        raise RuntimeError(log.read())
    settings = json.loads(line)
    proxy, reference_url = reference_proxy(settings["url"])
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True, chromium_sandbox=True)
        try:
            for width in [1440, 820]:
                contexts = [browser.new_context(viewport={"width": width, "height": 900}) for _ in range(2)]
                try:
                    pages = []
                    for context, base in zip(contexts, [settings["url"], reference_url]):
                        context.add_init_script("localStorage.clear();localStorage.setItem('devlab:theme','dark');localStorage.setItem('devlab:workflow-minimap','true')")
                        page = context.new_page()
                        page.set_default_timeout(15000)
                        open_project(page, base, settings["projects"][0]["id"])
                        pages.append(page)
                    compare_layout(*pages, width)
                finally:
                    for context in contexts:
                        context.close()
            report["acceptance"].append("Desktop/compact preserve Full geometry/styles with declared36px app bars and added workspace height")

            context = browser.new_context(viewport={"width": 1440, "height": 900})
            page = context.new_page()
            page.set_default_timeout(15000)
            errors, native_requests = [], []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: native_requests.append(request.url)
                    if "/api/browser" in request.url or ("/api/terminals" in request.url and request.method != "GET") else None)
            try:
                project_id = settings["projects"][0]["id"]
                open_project(page, settings["url"], project_id)
                for label in ["Layout nodes", "Align selected nodes", "Toggle Node Catalog",
                              "Toggle workflow minimap", "Pop the Hood", "Reload saved graph",
                              "Clear canvas", "Export flow", "Import flow", "Settings", "Light mode"]:
                    expect(page.get_by_role("button", name=label, exact=True)).to_be_visible()
                expect(page.locator(".workspace-rail")).to_have_css("height", "36px")
                expect(page.get_by_role("region", name="Workspace output")).to_be_hidden()
                page.get_by_role("button", name="Light mode", exact=True).click()
                expect(page.get_by_test_id("flow-editor-root")).not_to_have_class("devlab dark")
                page.get_by_role("button", name="Dark mode", exact=True).click()
                expect(page.get_by_test_id("flow-editor-root")).to_have_class("devlab dark")

                tree = page.get_by_role("tree", name="Project files")
                tree.evaluate("e => e.__retainedTree = true")
                page.get_by_role("button", name="Collapse project explorer", exact=True).click()
                page.get_by_role("button", name="Expand project explorer", exact=True).click()
                assert tree.evaluate("e => e.__retainedTree === true")
                palette = page.locator(".node-palette")
                palette.evaluate("e => e.__retainedPalette = true")
                page.get_by_role("button", name="Toggle Node Catalog", exact=True).click()
                expect(palette).to_be_hidden()
                page.get_by_role("button", name="Toggle Node Catalog", exact=True).click()
                assert palette.evaluate("e => e.__retainedPalette === true")
                report["acceptance"].append("Source toolbar, dark/light theme and retained Projects/Catalog")

                name = page.get_by_role("textbox", name="Flow name", exact=True)
                name.fill("UI copy acceptance flow")
                name.press("Enter")
                expect(page.get_by_test_id("save-state")).to_have_text("Saved")
                assert api(settings["url"], "/api/canvas/" + quote(project_id))["graph"]["name"] == "UI copy acceptance flow"
                palette.get_by_title("Add Hermes Agent", exact=True).click()
                page.get_by_role("button", name="Agents", exact=True).click()
                page.get_by_role("textbox", name="Agent message", exact=True).fill("UI copy offline acceptance")
                page.get_by_role("button", name="Run agent", exact=True).click()
                expect(page.get_by_test_id("run-result").first).to_contain_text("UI copy offline acceptance")
                page.get_by_role("button", name="Close lower panel", exact=True).click()
                report["acceptance"].append("Graph autosave and existing offline Echo execution through copied controls")

                # All writes below target this script's private fixture project, never live user files.
                file_path = "/api/projects/" + quote(project_id) + "/file"
                original = api(settings["url"], file_path + "?path=index.html")
                page.get_by_role("button", name="Open index.html", exact=True).click()
                contents = page.get_by_role("textbox", name="File contents", exact=True)
                expect(contents).to_have_value(original["text"])
                draft = original["text"] + "\n<!-- retained draft -->"
                contents.fill(draft)
                external = original["text"] + "\n<!-- concurrent disk update -->"
                api(settings["url"], file_path, {"path": "index.html", "text": external,
                                              "expectedHash": original["sha256"]})
                page.get_by_role("button", name="Save file", exact=True).click()
                expect(page.get_by_test_id("project-editor").get_by_role("alert")).to_be_visible()
                expect(contents).to_have_value(draft)
                assert api(settings["url"], file_path + "?path=index.html")["text"] == external
                page.once("dialog", lambda dialog: dialog.accept())
                page.get_by_role("button", name="Reload file", exact=True).click()
                expect(contents).to_have_value(external)
                saved = external + "\n<!-- hash checked UI save -->"
                contents.fill(saved)
                page.get_by_role("button", name="Save file", exact=True).click()
                expect(page.get_by_test_id("project-editor")).to_contain_text("Saved on disk")
                assert api(settings["url"], file_path + "?path=index.html")["text"] == saved
                page.get_by_role("button", name="Workflow", exact=True).click()
                report["acceptance"].append("Existing source editor rejects stale hash, retains draft and saves after reload")

                page.get_by_role("combobox", name="Number of UI previews").select_option("4")
                assignments = page.locator('select[aria-label^="Project for pane"]')
                expect(assignments).to_have_count(4)
                wanted = {project["id"] for project in settings["projects"]}
                for item in assignments.all():
                    if item.input_value() not in wanted:
                        assigned = {other.input_value() for other in assignments.all()}
                        missing = next(value for value in wanted if value not in assigned)
                        card = page.locator('.preview-pane-card[data-pane-id="' + item.get_attribute("data-pane-id") + '"]')
                        card.get_by_role("button", name="View", exact=True).click()
                        item.select_option(missing)
                        expect(card.get_by_role("button", name="View", exact=True)).to_have_attribute("aria-expanded", "false")
                frames = page.locator('iframe[title^="Project UI"]')
                expect(frames).to_have_count(4)
                for index in range(4):
                    page.frame_locator('iframe[title^="Project UI"]').nth(index).get_by_role("textbox", name="Preview input").fill("retained " + str(index))
                identities = [frame.element_handle().content_frame().evaluate("window.__uiCopyFrame = crypto.randomUUID()") for frame in frames.all()]
                boxes = [frame.bounding_box() for frame in frames.all()]
                assert abs(boxes[0]["y"] - boxes[1]["y"]) < 3 and boxes[1]["x"] > boxes[0]["x"]
                assert boxes[2]["y"] > boxes[0]["y"] and abs(boxes[2]["x"] - boxes[0]["x"]) < 3
                page.get_by_role("separator", name="Resize preview columns", exact=True).press("ArrowRight")
                page.get_by_role("separator", name="Resize preview rows", exact=True).press("ArrowDown")
                page.get_by_role("button", name="Collapse UI preview", exact=True).first.click()
                page.get_by_role("button", name="Restore UI preview", exact=True).click()
                assert_retained_frames(frames, identities)
                page.get_by_role("button", name="Focus previews", exact=True).click()
                expect(page.get_by_test_id("flow-editor-root")).to_have_attribute("data-preview-focus-mode", "maximized")
                expect(page.locator(".toolbar")).to_be_hidden()
                expect(page.locator(".workspace-rail")).to_be_visible()
                assert_retained_frames(frames, identities)
                page.get_by_role("button", name="Exit preview focus", exact=True).click()
                expect(page.get_by_role("button", name="Focus previews", exact=True)).to_be_focused()
                assert_retained_frames(frames, identities)
                page.get_by_role("button", name="Fullscreen preview workspace", exact=True).click()
                expect(page.locator('[data-preview-focus-mode="native"], .workspace-focus-error')).to_be_visible()
                if page.get_by_test_id("flow-editor-root").get_attribute("data-preview-focus-mode") == "native":
                    assert page.evaluate("() => document.fullscreenElement === document.querySelector('[data-testid=flow-editor-root]')")
                    assert_retained_frames(frames, identities)
                    page.get_by_role("button", name="Exit preview focus", exact=True).click()
                    report["acceptance"].append("Native whole-workspace fullscreen retains all preview documents")
                else:
                    expect(page.locator(".workspace-focus-error")).to_contain_text("Fullscreen unavailable")
                    report["acceptance"].append("Native fullscreen denial reports existing source fallback accurately")
                report["acceptance"].append("Four live previews retain documents and inputs through split/collapse/focus")

                page.get_by_role("button", name="Terminal", exact=True).click()
                expect(page.get_by_role("button", name="New terminal", exact=True)).to_be_visible()
                page.get_by_role("button", name="Planning", exact=True).click()
                expect(page.locator("#workspace-planning-drawer").get_by_role("region", name="Project planning", exact=True)).to_be_visible()
                page.get_by_role("button", name="Close lower panel", exact=True).click()
                page.get_by_role("button", name="Pop the Hood", exact=True).click()
                expect(page.get_by_test_id("hood-root")).to_be_visible()
                page.get_by_role("button", name="Back to canvas", exact=True).click()
                assert_retained_frames(frames, identities)
                page.reload(wait_until="domcontentloaded")
                active_project = page.get_by_role("combobox", name="Active project", exact=True)
                expect(active_project).to_have_value(project_id)
                expect(active_project).to_be_enabled()
                page.get_by_role("button", name="Workflow", exact=True).click()
                expect(page.get_by_role("textbox", name="Flow name", exact=True)).to_have_value("UI copy acceptance flow")
                expect(page.get_by_role("combobox", name="Number of UI previews")).to_have_value("4")
                expect(page.locator('iframe[title^="Project UI"]')).to_have_count(4)
                assert not errors, errors
                assert not native_requests, native_requests
                page.screenshot(path=str(OUTPUT / "accepted-four-previews.png"), animations="disabled")
                report["acceptance"].append("Available terminal and Planning controls, unavailable native tools, Hood modal, persisted layout and no JavaScript errors")
            except BaseException:
                page.screenshot(path=str(OUTPUT / "failure.png"), animations="disabled")
                raise
            finally:
                context.close()
        finally:
            browser.close()
finally:
    if proxy:
        proxy.shutdown()
        proxy.server_close()
    if fixture.poll() is None:
        fixture.stdin.close()
        try:
            fixture.wait(timeout=20)
        except subprocess.TimeoutExpired:
            fixture.terminate()
            fixture.wait(timeout=15)
    log.seek(0)
    if fixture.returncode:
        print(log.read())
    log.close()
    (OUTPUT / "verification.json").write_text(json.dumps(report, indent=2) + "\n")
    assert fixture.returncode == 0, "Fixture cleanup failed"

for url in [settings["url"], *(project["url"] for project in settings["projects"])]:
    address = urlparse(url)
    with socket.socket() as connection:
        connection.settimeout(1)
        assert connection.connect_ex((address.hostname, address.port)) != 0, "Owned fixture process survived shutdown"
report["acceptance"].append("Fixture backend and all four managed app servers released on shutdown")
report["passed"] = True
(OUTPUT / "verification.json").write_text(json.dumps(report, indent=2) + "\n")
for acceptance in report["acceptance"]:
    print("PASS: " + acceptance)
