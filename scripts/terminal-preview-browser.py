"""Disposable real-host acceptance for partial projects, terminal fit and preview setup."""
import importlib.util
import json
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import time
from urllib.request import urlopen

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = Path(os.environ.get('TERMINAL_PREVIEW_EVIDENCE', '/tmp/devlab-terminal-preview-repair/browser'))
SPEC = importlib.util.spec_from_file_location('existing_terminal_ui', ROOT / 'scripts/terminal-browser.py')
HELPERS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HELPERS)

FIXTURE = r"""
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {Kernel} from '@devlab/kernel';
import {profile,grants} from './src/profile.ts';
import {startFrontend} from './scripts/dev-ui.mjs';
const directory=await mkdtemp(join(tmpdir(),'devtest-terminal-preview-'));
const kernel=new Kernel(grants);let frontend;const projectIds=[];
const alive=async pid=>{try {const s=await readFile(`/proc/${pid}/stat`,'utf8');return s.slice(s.lastIndexOf(')')+2).split(' ')[0]!=='Z';}catch{return false;}};
try {
  const roots=[join(directory,'existing'),join(directory,'other')];
  for(const root of roots){
    await mkdir(join(root,'.wisdohm'),{recursive:true});
    await writeFile(join(root,'AGENTS.md'),'# Existing custom authority\nPreserve all existing project files.\n');
    await writeFile(join(root,'index.html'),'<!doctype html><title>Prepared preview</title><h1>Prepared preview</h1><label>Preview draft <input aria-label="Preview draft"></label>');
    const db=new DatabaseSync(join(root,'.wisdohm/memory.sqlite'));db.exec('CREATE TABLE project_notes(note TEXT)');db.close();
  }
  const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  await kernel.start(profile(kernel,process.cwd(),0,join(directory,'data'),port));
  const projects=kernel.service('projects');
  const first=await projects.open({path:roots[0],label:'Existing app'});
  const other=await projects.open({path:roots[1],label:'Other app'});
  projectIds.push(first.id,other.id);
  frontend=await startFrontend({backendUrl:kernel.service('http').url,webPort:port});
  console.log(JSON.stringify({url:`http://127.0.0.1:${port}`,projectId:first.id,otherProjectId:other.id,root:roots[0],otherRoot:roots[1]}));
  await new Promise(resolve=>{process.stdin.once('data',resolve);process.stdin.once('end',resolve);process.stdin.resume();});
} finally {
  const pids=kernel.phase==='ready'?projectIds.flatMap(id=>kernel.service('terminals').list(id)).filter(s=>s.status==='running').map(s=>s.pid):[];
  await frontend?.close();await kernel.close();
  for(let i=0;i<100 && (await Promise.all(pids.map(alive))).some(Boolean);i++)await new Promise(resolve=>setTimeout(resolve,20));
  assert(!(await Promise.all(pids.map(alive))).some(Boolean),'Fixture left a terminal process alive');
  await rm(directory,{recursive:true,force:true});
  console.log(JSON.stringify({closed:true,terminalPids:pids,processesGone:true}));
}
"""


def api(base, path):
    with urlopen(base + path, timeout=15) as response:
        return json.load(response)


def configuration(process):
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        if not selector.select(1):
            continue
        line = process.stdout.readline().decode('utf8')
        if not line:
            raise AssertionError('Fixture exited before readiness')
        if line.startswith('{"url":'):
            selector.close()
            return json.loads(line)
    raise AssertionError('Fixture readiness timed out')


def geometry(terminal):
    return terminal.evaluate("""element => {
      const box = node => {const r=node.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
      const screen=element.querySelector('.terminal-screen'), grid=element.querySelector('.xterm-screen');
      const actions=element.querySelector('.terminal-error-actions');
      const message=element.querySelector('.terminal-error-message');
      return {terminal:box(element),screen:box(screen),grid:box(grid),actions:actions&&box(actions),
        message:message&&{...box(message),scrollHeight:message.scrollHeight,clientHeight:message.clientHeight}};
    }""")


def check_fit(value):
    assert value['screen']['height'] > 10, value
    assert value['grid']['right'] <= value['screen']['right'] + 1, value
    assert value['grid']['bottom'] <= value['screen']['bottom'] + 1, value
    if value['actions']:
        assert value['actions']['bottom'] <= value['terminal']['bottom'] + 1, value
        assert value['message']['right'] <= value['terminal']['right'] + 1, value


def exercise(page, config, width):
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    ui = HELPERS.TerminalUI(page, config)
    original_rules = (Path(config['root']) / 'AGENTS.md').read_bytes()
    original_db = (Path(config['root']) / '.wisdohm/memory.sqlite').read_bytes()
    ui.open()
    first = ui.create()
    ui.command(first['id'], "printf '\\nFIT_RECOVERY_OK\\n'", 'FIT_RECOVERY_OK')

    # Exercise the same recoverable launch failure as the report, with an extreme path.
    message = 'Ownership definitions are unavailable: missing definition source: ' + '/very-long-project-folder' * 100
    intercepted = []
    def fail_once(route):
        if route.request.method == 'POST' and not intercepted:
            intercepted.append(route.request.post_data_json)
            route.fulfill(status=503, content_type='application/json', body=json.dumps({'code':'SERVICE_UNAVAILABLE','message':message}))
        else:
            route.continue_()
    endpoint = config['url'] + '/api/terminals'
    page.route(endpoint, fail_once)
    page.get_by_role('button', name='New terminal', exact=True).click()
    failed = page.locator('.devlab-terminal[data-resize-owner="true"]:visible').filter(has=page.locator('.terminal-error')).first
    expect(failed.locator('.terminal-error-message')).to_have_text(message)
    boxes = []
    for scale, height in [(1,180),(.65,140),(1.25,200)]:
        failed.evaluate('(el,p)=>{el.style.width="300px";el.style.height=p.height+"px";el.style.flex="none";el.style.transform="scale("+p.scale+")";el.style.transformOrigin="top left";}', {'scale':scale,'height':height})
        page.wait_for_timeout(250)
        value = geometry(failed)
        check_fit(value)
        assert value['message']['scrollHeight'] > value['message']['clientHeight'], value
        expect(failed.get_by_role('button', name='Retry connection', exact=True)).to_be_visible()
        boxes.append(value)
    failed.evaluate('el=>{el.style.transform="";}')
    # Remove the mock before urllib polling: sync Playwright cannot dispatch a
    # continued route while the driver is busy outside its own event loop.
    page.unroute(endpoint, fail_once)
    failed.get_by_role('button', name='Retry connection', exact=True).click()
    retry_node = intercepted[0]['nodeId']
    HELPERS.until(lambda: any(s['nodeId']==retry_node and s['status']=='running' for s in ui.sessions()), 'Explicit retry did not start the failed node’s shell')
    assert len([s for s in ui.sessions() if s['nodeId']==retry_node and s['status']=='running'])==1
    assert ui.session(first['id'])['pid'] == first['pid']

    # Setup is offered where the preview is missing, and preserves foreign authority.
    pane = page.locator('.project-preview-pane[data-project-id="' + config['projectId'] + '"]').first
    setup = pane.locator('[data-testid="project-adoption"]')
    expect(setup.get_by_role('button', name='Prepare preview', exact=True)).to_be_visible()
    setup.get_by_role('button', name='Prepare preview', exact=True).click()
    expect(setup.get_by_role('button', name='Apply and start preview', exact=True)).to_be_enabled()
    setup.get_by_role('button', name='Apply and start preview', exact=True).click()
    frame = pane.locator('iframe.project-preview-frame')
    expect(frame).to_be_visible(timeout=30000)
    expect(frame.content_frame.get_by_role('heading', name='Prepared preview')).to_be_visible(timeout=30000)
    frame.content_frame.get_by_role('textbox', name='Preview draft').fill('retained preview form')
    frame_node = frame.element_handle()
    existing_ids = {s['id'] for s in ui.sessions()}
    page.get_by_role('button', name='New terminal', exact=True).click()
    HELPERS.until(lambda: any(s['id'] not in existing_ids and s['status']=='running' for s in ui.sessions()), 'Independent terminal did not start')
    assert frame_node.evaluate('node=>node.isConnected')
    expect(frame.content_frame.get_by_role('textbox', name='Preview draft')).to_have_value('retained preview form')
    assert ui.session(first['id'])['pid'] == first['pid']
    assert (Path(config['root'])/'AGENTS.md').read_bytes() == original_rules
    assert (Path(config['root'])/'.wisdohm/memory.sqlite').read_bytes() == original_db
    assert not (Path(config['root'])/'.agents').exists()

    # A late discovery response cannot apply or start the newly selected project.
    select = page.get_by_role('combobox', name='Active project', exact=True)
    select.select_option(config['otherProjectId'])
    other_pane = page.locator('.project-preview-pane[data-project-id="' + config['otherProjectId'] + '"]').first
    held = []
    def hold_plan(route):
        held.append((route, route.fetch()))
    plan_url = config['url']+'/api/projects/'+config['otherProjectId']+'/wisdom/plan'
    page.route(plan_url, hold_plan)
    other_pane.get_by_role('button', name='Prepare preview', exact=True).click()
    for _ in range(100):
        if held:break
        page.wait_for_timeout(25)
    assert held, 'Preview discovery did not reach its selected-project request'
    select.select_option(config['projectId'])
    for route,response in held:route.fulfill(response=response)
    page.unroute(plan_url, hold_plan)
    page.wait_for_timeout(200)
    assert not (Path(config['otherRoot'])/'devlab.preview.json').exists()
    assert api(config['url'],'/api/servers/'+config['otherProjectId'])['status']=='unconfigured'
    assert ui.session(first['id'])['pid']==first['pid']
    assert not errors, errors
    page.screenshot(path=str(OUTPUT/f'recovered-{width}.png'))
    return {'width':width,'geometry':boxes,'sessionsRetained':True,'previewSetupAndStart':True,'foreignAuthorityUnchanged':True,'lateDiscoveryFenced':True,'javascriptErrors':errors}


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    # A real entry file keeps Node's worker children free of --input-type flags.
    host = OUTPUT/'fixture-host.mjs'
    code = FIXTURE.replace("import {Kernel} from '@devlab/kernel';", "import {createRequire} from 'node:module';\nconst {Kernel}=await import(createRequire("+json.dumps((ROOT/'package.json').as_uri())+").resolve('@devlab/kernel'));")
    code = code.replace("'./src/profile.ts'", json.dumps((ROOT/'src/profile.ts').as_uri()))
    code = code.replace("'./scripts/dev-ui.mjs'", json.dumps((ROOT/'scripts/dev-ui.mjs').as_uri()))
    host.write_text(code)
    report = {'passed':False,'widths':[],'cleanup':[]}
    chrome = os.environ.get('CHROME_BIN') or shutil.which('google-chrome') or shutil.which('chromium')
    assert chrome, 'A local Chromium executable is required'
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=chrome, headless=True, args=['--no-sandbox','--disable-gpu'])
        try:
            for width in [1440,820]:
                context = None
                with (OUTPUT/f'fixture-{width}.log').open('w+') as log:
                    process = subprocess.Popen(['node',str(host)],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=log,bufsize=0)
                    try:
                        config = configuration(process)
                        context = browser.new_context(viewport={'width':width,'height':1050})
                        page = context.new_page()
                        try:
                            report['widths'].append(exercise(page, config, width))
                        except Exception:
                            page.screenshot(path=str(OUTPUT/f'failure-{width}.png'))
                            sessions = api(config['url'],'/api/terminals?projectId='+config['projectId'])
                            (OUTPUT/f'failure-{width}.json').write_text(json.dumps({'sessions':sessions,'visibleTerminals':page.locator('.devlab-terminal:visible').evaluate_all('(els)=>els.map(el=>({id:el.dataset.terminalSessionId,status:el.dataset.terminalConnection,error:el.querySelector(".terminal-error")?.textContent}))')},indent=2))
                            raise
                    finally:
                        if context:context.close()
                        if process.poll() is None:
                            process.stdin.write(b'close\n');process.stdin.flush()
                        try:
                            stdout,_ = process.communicate(timeout=35)
                        except subprocess.TimeoutExpired:
                            process.terminate();process.communicate(timeout=10)
                            raise AssertionError('Fixture cleanup timed out')
                        log.seek(0)
                        assert process.returncode==0,log.read()
                        closed = next((json.loads(line) for line in stdout.decode('utf8').splitlines() if line.startswith('{"closed":')),None)
                        assert closed and closed['processesGone'],'Fixture cleanup receipt missing'
                        report['cleanup'].append(closed)
            report['passed']=True
        finally:
            browser.close()
            (OUTPUT/'browser.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'passed':report['passed'],'widths':[v['width'] for v in report['widths']],'cleanup':report['cleanup']}))


if __name__=='__main__':
    main()
