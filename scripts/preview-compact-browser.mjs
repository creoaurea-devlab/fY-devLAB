/** Real preview controls with disposable backend, project folders, shells and browser state. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp,mkdir,writeFile,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';
const root=fileURLToPath(new URL('../',import.meta.url)), require=createRequire(join(root,'package.json'));
const {Kernel}=await import(pathToFileURL(require.resolve('@devlab/kernel')));
const {chromium}=require('playwright-core');
const {profile,grants}=await import(pathToFileURL(join(root,'src/profile.ts')));
const data=await mkdtemp(join(tmpdir(),'devlab-compact-preview-')), output=process.env.PREVIEW_COMPACT_EVIDENCE_DIR ?? '/tmp/devlab-preview-compact-evidence';
const kernel=new Kernel(grants); let browser,page,terminal;
async function until(check, message) {
 for (let i=0; i<240; i++) { if (await check()) return; await delay(25); }
 throw new Error(message);
}
try {
 await mkdir(output,{recursive:true}); const folder=join(data,'app'); await mkdir(folder);
 const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 await writeFile(join(folder,'index.html'),'<h1>Compact preview</h1><label>Draft<input aria-label="Draft"></label>');
 await writeFile(join(folder,'server.mjs'),"import{createServer}from'node:http';import{readFile}from'node:fs/promises';createServer(async(q,r)=>{r.setHeader('content-type','text/html');r.end(await readFile(new URL('./index.html',import.meta.url)))}).listen(Number(process.argv[2]),'127.0.0.1');");
 await writeFile(join(folder,'devlab.preview.json'),JSON.stringify({schemaVersion:1,adapter:'static',start:[process.execPath,'server.mjs','{port}'],port,autoStart:false,inspection:'manual'}));
 await kernel.start(profile(kernel,root,0,join(data,'host')));const project=await kernel.service('projects').open({path:folder,label:'Compact fixture'});
 terminal=await kernel.service('terminals').create({projectId:project.id,nodeId:'retained-shell',cwd:'.',shell:'bash',cols:80,rows:24});
 browser=await chromium.launch({executablePath:'/opt/google/chrome/chrome',headless:true});
 page=await browser.newPage({viewport:{width:1440,height:950}});page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(kernel.service('http').url+'/?projectId='+project.id);await page.getByRole('button',{name:'Focus previews',exact:true}).click();
 const pane=page.locator('.project-preview-pane[data-project-id="'+project.id+'"]').first();const primary=name=>pane.getByRole('button',{name:name+' preview server',exact:true});
 await primary('Start').waitFor();await primary('Start').click();await pane.frameLocator('iframe.project-preview-frame').getByRole('heading',{name:'Compact preview'}).waitFor();await primary('Stop').waitFor();
 const measurements=[];
 for(const width of [1440,820,390]) {
  await page.setViewportSize({width,height:950});await pane.frameLocator('iframe.project-preview-frame').getByLabel('Draft').fill('retained-'+width);
  assert.equal(await pane.frameLocator('iframe.project-preview-frame').getByLabel('Draft').inputValue(),'retained-'+width,'Fill did not complete after viewport change');
  await pane.locator('iframe.project-preview-frame').evaluate(el=>window.retainedFrame=el);
  const result={width,toolbar:await pane.locator('.project-preview-toolbar').evaluate(el=>el.getBoundingClientRect().height),drawers:{}};
  assert.equal(result.toolbar,28);
  assert.equal(await page.locator('.preview-workspace-toolbar').evaluate(el=>el.getBoundingClientRect().height),24);
  const buttonsFit = await pane.locator('.project-preview-toolbar').evaluate(bar => {
   const bounds=bar.getBoundingClientRect();
   return [...bar.querySelectorAll('button')].filter(button=>button.getClientRects().length).every(button => {
    const rect=button.getBoundingClientRect();
    return rect.top>=bounds.top && rect.bottom<=bounds.bottom;
   });
  });
  assert(buttonsFit, 'Toolbar action is vertically clipped');
  for(const name of ['Server options','View','Inspect','Tools']) {
   const trigger=pane.getByRole('button',{name,exact:true});await trigger.click();
   const drawer=pane.locator('.preview-drawer:visible');await drawer.waitFor();result.drawers[name]=await drawer.evaluate(el=>el.getBoundingClientRect().height);
   if(['Server options','View','Tools'].includes(name))assert(result.drawers[name]<=34,JSON.stringify(result));
   assert.equal(await pane.locator('.preview-drawer-heading').count(),0);
   assert(await pane.locator('iframe.project-preview-frame').evaluate(el=>el===window.retainedFrame));
   assert.equal(await pane.frameLocator('iframe.project-preview-frame').getByLabel('Draft').inputValue(),'retained-'+width);
   if(name==='Server options')await page.screenshot({path:join(output,'server-'+width+'.png')});
   await page.keyboard.press('Escape');assert.equal(await trigger.getAttribute('aria-expanded'),'false');assert(await trigger.evaluate(el=>el===document.activeElement));
   await page.evaluate(()=>new Promise(requestAnimationFrame));
  }
  assert.equal(kernel.service('terminals').list(project.id).find(s=>s.id===terminal.id).pid,terminal.pid);measurements.push(result);
 }

 // A delayed drawer focus return must not steal a new preview input focus.
 await pane.getByRole('button',{name:'View',exact:true}).click();
 await page.evaluate(()=>{
  window.previewNativeRAF=window.requestAnimationFrame;
  window.previewDeferredFrames=[];
  window.requestAnimationFrame=callback=>{window.previewDeferredFrames.push(callback);return -1;};
 });
 await page.keyboard.press('Escape');
 await pane.frameLocator('iframe.project-preview-frame').getByLabel('Draft').fill('focus-race-retained');
 await page.evaluate(()=>{
  window.requestAnimationFrame=window.previewNativeRAF;
  for(const callback of window.previewDeferredFrames)callback(performance.now());
  delete window.previewNativeRAF;delete window.previewDeferredFrames;
 });
 assert(await pane.locator('iframe.project-preview-frame').evaluate(frame=>document.activeElement===frame),'Delayed drawer close stole preview input focus');
 // Pane fullscreen is hosted by the workspace so its original dock remains inside it.
 await page.setViewportSize({width:1440,height:950});
 await page.getByRole('button',{name:'Exit preview focus',exact:true}).click();
 const retainedValue=await pane.frameLocator('iframe.project-preview-frame').getByLabel('Draft').inputValue();
 await pane.getByRole('button',{name:'Fullscreen preview '+project.id,exact:true}).click();
 await page.waitForFunction(()=>document.fullscreenElement===document.querySelector('[data-testid="flow-editor-root"]'));
 await pane.getByRole('button',{name:'Exit enlarged preview',exact:true}).waitFor();
 const rail=page.getByTestId('workspace-rail');
 assert(await rail.evaluate(element=>document.fullscreenElement.contains(element)));
 await page.locator('[data-devlab-id="workspace.output.terminal"]').click();
 const outputPanel=page.getByRole('region',{name:'Workspace output',exact:true});
 await outputPanel.waitFor();
 const beforeUI=new Set(kernel.service('terminals').list(project.id).map(session=>session.id));
 await page.getByRole('button',{name:'New terminal',exact:true}).click();
 await until(()=>kernel.service('terminals').list(project.id).some(session=>!beforeUI.has(session.id)&&session.status==='running'),'Fullscreen terminal did not start');
 const dockSessions=kernel.service('terminals').list(project.id).map(session=>[session.id,session.pid]);
 await outputPanel.locator('.devlab-terminal[data-resize-owner="true"] .xterm-helper-textarea').first().focus();
 await page.keyboard.type('printf fullscreen-ok > fullscreen-proof.txt'); await page.keyboard.press('Enter');
 await until(()=>readFile(join(folder,'fullscreen-proof.txt'),'utf8').then(text=>text==='fullscreen-ok').catch(()=>false),'Fullscreen terminal input did not reach its shell');
 const panelBounds=await outputPanel.boundingBox(), railBounds=await rail.boundingBox();
 assert(panelBounds && railBounds);
 assert.equal(railBounds.height,28);
 assert(panelBounds.y+panelBounds.height<=railBounds.y+1,'Dock overlaps bottom rail');
 await page.screenshot({path:join(output,'fullscreen-terminal.png')});
 await page.locator('[data-devlab-id="workspace.output.servers"]').click();
 await outputPanel.waitFor();
 assert.equal(await page.locator('[data-devlab-id="workspace.output.servers"]').getAttribute('aria-pressed'),'true');
 await page.screenshot({path:join(output,'fullscreen-servers.png')});
 assert.deepEqual(kernel.service('terminals').list(project.id).map(session=>[session.id,session.pid]),dockSessions);
 assert(await pane.locator('iframe.project-preview-frame').evaluate(el=>el===window.retainedFrame));
 assert.equal(await pane.frameLocator('iframe.project-preview-frame').getByLabel('Draft').inputValue(),retainedValue);
 await page.setViewportSize({width:390,height:950});
 const terminalButton=page.locator('[data-devlab-id="workspace.output.terminal"]');
 await terminalButton.scrollIntoViewIfNeeded(); await terminalButton.click();
 await outputPanel.waitFor();
 const narrowRail=await rail.boundingBox(), narrowButton=await terminalButton.boundingBox();
 assert(narrowRail && narrowButton && narrowButton.y+narrowButton.height<=950 && narrowButton.x>=0 && narrowButton.x+narrowButton.width<=390);
 await page.screenshot({path:join(output,'fullscreen-terminal-390.png')});
 const serverButton=page.locator('[data-devlab-id="workspace.output.servers"]');
 await serverButton.scrollIntoViewIfNeeded(); await serverButton.click();
 await page.screenshot({path:join(output,'fullscreen-servers-390.png')});
 await page.setViewportSize({width:1440,height:950});
 await page.getByRole('button',{name:'Hide output',exact:true}).click();
 await pane.getByRole('button',{name:'Exit enlarged preview',exact:true}).click();
 await page.waitForFunction(()=>!document.fullscreenElement);
 assert(await pane.locator('iframe.project-preview-frame').evaluate(el=>el===window.retainedFrame));
 const fullscreenDock=true;
 await primary('Stop').click();await primary('Start').waitFor();assert.equal((await kernel.service('servers').inspect(project.id)).status,'stopped');
 await pane.getByRole('button',{name:'Inspect',exact:true}).click();const empty=pane.locator('.preview-drawer:visible');assert((await empty.boundingBox()).height>=32);await empty.getByRole('button',{name:'Close preview drawer',exact:true}).click();

 // Hold a real successful Start response; Stop must win over that late reply.
 let held;
 const startURL=kernel.service('http').url+'/api/servers/'+project.id+'/start';
 await page.route(startURL, async route => { held={route,response:await route.fetch()}; });
 await primary('Start').click();
 await until(()=>Boolean(held), 'Start did not reach the server');
 await primary('Stop').click();
 await until(async()=>(await kernel.service('servers').inspect(project.id)).status==='stopped','Stop did not finish');
 await held.route.fulfill({response:held.response});
 await page.unroute(startURL);
 await primary('Start').waitFor();
 assert.equal((await kernel.service('servers').inspect(project.id)).status,'stopped');
 // Actual unconfigured and no-UI projects retain their Start refusal/guidance.
 for (const kind of ['unconfigured','none']) {
  const path=join(data,kind); await mkdir(path);
  if(kind==='none') await writeFile(join(path,'devlab.preview.json'),JSON.stringify({schemaVersion:1,adapter:'none'}));
  const other=await kernel.service('projects').open({path,label:kind});
  const refusal=await browser.newPage({viewport:{width:1440,height:950}});
  try {
   await refusal.goto(kernel.service('http').url+'/?projectId='+other.id);
   const control=refusal.locator('.project-preview-pane').first().getByRole('button',{name:'Start preview server',exact:true});
   await until(async()=> (await control.getAttribute('title'))?.includes(kind==='none'?'no browser UI':'devlab.preview.json'),'Expected Start guidance missing');
   assert(await control.isDisabled());
  } finally { await refusal.close(); }
 }

 // A never-settled host request must become retryable and focus fallback must cancel it.
 const hung=await browser.newPage({viewport:{width:820,height:950}});
 hung.setDefaultTimeout(12000);
 await hung.addInitScript(()=>{HTMLElement.prototype.requestFullscreen=()=>new Promise(()=>{});});
 try {
  await hung.goto(kernel.service('http').url+'/?projectId='+project.id);
  const trigger=hung.getByRole('button',{name:'Fullscreen preview '+project.id,exact:true});
  await trigger.click();
  await until(()=>trigger.isDisabled(),'Pending control was not disabled');
  await until(async()=>!await trigger.isDisabled(),'Fullscreen request did not release its lock');
  await hung.locator('.workspace-focus-error').filter({hasText:'Fullscreen unavailable'}).waitFor();
  assert.equal(await hung.getByText('A fullscreen request is still pending.',{exact:true}).count(),0);
  assert.equal(await hung.locator('.preview-workspace-toolbar').evaluate(el=>el.getBoundingClientRect().height),24);
  await trigger.click();
  await hung.getByRole('button',{name:'Focus previews',exact:true}).click();
  await hung.locator('[data-preview-focus-mode="maximized"]').waitFor();
  await hung.getByTestId('workspace-rail').waitFor();
  await hung.screenshot({path:join(output,'pending-recovered.png')});
 } finally {await hung.close();}
 assert.deepEqual(errors,[]);
 const result={measurements,directStartStop:true,frameAndDraftRetained:true,escapeAndFocus:true,
  terminalPidRetained:true,stoppedInspectClose:true,lateStartResponseFenced:true,
  fullscreenDock,fullscreenIframeRetained:true,drawerFocusIntentRetained:true,fullscreenTerminalAndServers:true,fullscreenTerminalInput:true,pendingRequestRecovered:true,
  unconfiguredAndNoUIRefused:true,toolbarActionsFit:true,jsErrors:errors};
 await writeFile(join(output,'browser.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
} catch(error) {await page?.screenshot({path:join(output,'failure.png')});throw error;}
finally {await browser?.close();await kernel.close();if(terminal){try{await readFile('/proc/'+terminal.pid+'/stat');throw new Error('Fixture shell remained alive')}catch(e){if(e.code!=='ENOENT')throw e;}}await rm(data,{recursive:true,force:true});}
