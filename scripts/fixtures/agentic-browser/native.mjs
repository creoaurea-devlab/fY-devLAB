import { app, BrowserWindow, WebContentsView, nativeImage } from 'electron';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { attachBrowser } from '../../../plugins/browser/src/index.mjs';

app.setPath('userData', process.env.AUTOMATION_TEST_ROOT);
app.commandLine.appendSwitch('use-mock-keychain');
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html');
  if (process.env.AUTOMATION_BROWSER_SLICE?.startsWith('screenshot')) {
    if (request.url === '/overflow' || (process.env.AUTOMATION_BROWSER_SLICE === 'screenshot-refusal' && request.url === '/other')) { response.end(`<!doctype html><input type=password value=overflow-secret>${'<i>row</i>'.repeat(6000)}`); return; }
    response.end(`<!doctype html><style>body{margin:0;background:white}input,[data-sensitive]{display:block;position:absolute;box-sizing:border-box;border:0;background:rgb(255,0,0);color:rgb(255,0,0);width:120px;height:35px;left:20px}iframe{position:absolute;left:220px;top:100px;width:300px;height:300px;border:0;transform-origin:0 0;transform:translate(10px,20px) scale(.8)}${(request.url === '/perspective' || process.env.AUTOMATION_BROWSER_SLICE === 'screenshot-refusal') ? 'body{perspective:500px}iframe{transform:rotateY(25deg)}' : ''}</style>
      <input type=password style="top:20px" value=password-secret><input autocomplete=cc-number style="top:65px" value=4111111111111111>
      <input autocomplete=one-time-code style="top:110px" value=987654><div data-sensitive style="top:155px">private</div>
      <span style="position:absolute;left:20px;top:205px;background:rgb(0,128,0);width:100px;height:30px">Public</span>
      <p id=mutation-result style="position:absolute;top:250px">Mutations: 0</p><script>addEventListener('load',()=>{const observer=new MutationObserver(()=>{observer.disconnect();document.getElementById('mutation-result').textContent='Mutations: changed'});observer.observe(document.body,{attributes:true,childList:true,subtree:true})})</script>
      ${['/', '/perspective'].includes(request.url) ? `<iframe src="http://localhost:${server.address().port}/child"></iframe>` : ''}`);
    return;
  }
  response.end(`<!doctype html><style>button{margin:20px;padding:20px}</style>
    <button onclick="this.textContent='clicked '+(++window.count)">counter</button>
    <script>window.count=0; window.scriptSecret='script-secret';</script><input type=password value=hidden-secret>
    <input aria-label="Message" oninput="document.getElementById('typed-result').textContent='Typed: '+this.value">
    <p id=typed-result>Typed: empty</p><button onclick="document.querySelector('[aria-label=Message]').remove()">Remove input</button>
    <input aria-label="Secret token" value="not-returned"><input aria-label="Payment card" autocomplete=cc-number value=4111111111111111>
    <button>Buy now</button><button>Grant access</button>
    <h1>Readable page heading</h1><p>Useful article text with a <strong>nested phrase</strong>.</p>
    <input autocomplete=cc-number value=4111111111111111><input autocomplete=one-time-code value=987654>
    <p hidden>hidden-page-secret</p><style>.secret-style{content:'style-secret'}</style>
    <p>Card 4111 1111 1111 1111. Verification code: 987654</p>
    ${process.env.AUTOMATION_BROWSER_SLICE === 'content' ? `<p>${'bounded article '.repeat(2000)}</p>` : ''}
    ${process.env.AUTOMATION_BROWSER_SLICE === 'scroll' ? `<p id=scroll-result style="position:fixed;top:0;right:0">Scroll: 0</p><div style="height:2000px"></div><script>addEventListener('scroll',()=>document.getElementById('scroll-result').textContent='Scroll: '+Math.round(scrollY))</script>` : ''}
    ${request.url === '/' && process.env.AUTOMATION_BROWSER_SLICE !== 'scroll' ? `<iframe src="http://localhost:${server.address().port}/child"></iframe><iframe src="/same"></iframe>` : ''}`);
});
const controls = [], views = [];
const approvals = [];
let allowAction = true;
let window;
async function run() {
try {
  await app.whenReady();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const puppeteer = await import(pathToFileURL(process.env.AUTOMATION_PUPPETEER).href);
  console.log('versions', JSON.stringify({ ...process.versions, puppeteer: '25.4.0' }));
  window = new BrowserWindow({ width: 1200, height: 800, show: true });
  for (let i = 0; i < 2; i++) {
    const view = new WebContentsView({ webPreferences: { partition: `ab0-${i}`, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    views.push(view); window.contentView.addChildView(view);
    view.setBounds({ x: i * 600, y: 0, width: 600, height: 780 });
    await view.webContents.loadURL(`http://127.0.0.1:${server.address().port}/${i ? 'other' : ''}`);
    controls.push(await attachBrowser({ contents: view.webContents, puppeteer, nativeImage, approve: async request => { approvals.push(request); return allowAction; } }));
  }
  const [a, b] = controls;
  if (process.env.AUTOMATION_BROWSER_SLICE === 'content') {
    const observation = await a.observe();
    assert.equal(observation.content?.trust, 'untrusted-page-content');
    assert.match(observation.content.text, /Readable page heading/);
    assert.match(observation.content.text, /Useful article text with a nested phrase/);
    assert(observation.content.text.length <= 20000);
    assert.equal(observation.content.truncated, true);
    assert.equal(observation.partial, true);
    for (const secret of ['hidden-secret', 'script-secret', 'style-secret', 'hidden-page-secret', '4111111111111111', '4111 1111 1111 1111', '987654'])
      assert(!JSON.stringify(observation).includes(secret), `Observation leaked ${secret}`);
    console.log('BROWSER_CONTENT_PASS');
    await Promise.all(controls.map(control => control.close()));
    for (const view of views) view.webContents.close();
    window.destroy(); app.exit(0); return;
  }
  if (process.env.AUTOMATION_BROWSER_SLICE === 'type') {
    const mainId = a.topology().find(frame => frame.main).id;
    let observed = await a.observe();
    let input = observed.targets.find(target => target.name === 'Message' && target.frameId === a.topology().find(frame => frame.main).id);
    assert(input);
    allowAction = false;
    await assert.rejects(a.type(input.ref, 'denied', 'type-denied'), { code: 'APPROVAL_DENIED' });
    assert.match((await a.observe()).content.text, /Typed: empty/);
    observed = await a.observe(); input = observed.targets.find(target => target.name === 'Message' && target.frameId === mainId);
    allowAction = true;
    assert.equal((await a.type(input.ref, 'hello browser', 'type-approved')).inputDispatched, true);
    await assert.rejects(a.type(input.ref, 'hello browser', 'type-approved'), { code: 'DUPLICATE_COMMAND' });
    observed = await a.observe(); assert.match(observed.content.text, /Typed: hello browser/);
    const crossId = a.topology().find(frame => frame.url.includes('localhost')).id;
    const crossInput = observed.targets.find(target => target.name === 'Message' && target.frameId === crossId);
    assert.equal((await a.type(crossInput.ref, 'hello iframe', 'type-oopif')).inputDispatched, true);
    assert.match((await a.observe()).content.text, /Typed: hello iframe/);
    observed = await a.observe(); input = observed.targets.find(target => target.name === 'Message' && target.frameId === mainId);
    const remove = observed.targets.find(target => target.name === 'Remove input' && target.frameId === mainId);
    await a.click(remove.ref, 'remove-input');
    await assert.rejects(a.type(input.ref, 'detached', 'type-detached'), { code: 'STALE_REF' });
    const beforeManual = approvals.length;
    const buy = observed.targets.find(target => target.name === 'Buy now');
    const grant = observed.targets.find(target => target.name === 'Grant access');
    await assert.rejects(a.click(buy.ref, 'buy-manual'), { code: 'USER_STEP' });
    await assert.rejects(a.click(grant.ref, 'grant-manual'), { code: 'USER_STEP' });
    assert.equal(approvals.length, beforeManual);
    assert(!observed.targets.some(target => /Secret token|Payment card/.test(target.name)));
    await views[0].webContents.loadURL(`http://127.0.0.1:${server.address().port}/navigated`);
    await assert.rejects(a.type(crossInput.ref, 'stale', 'type-stale'), { code: 'STALE_REF' });
    a.revoke(); await assert.rejects(a.type('guessed', 'value', 'type-stopped'), { code: 'LEASE_REVOKED' });
    console.log('BROWSER_TYPE_PASS');
    await Promise.all(controls.map(control => control.close()));
    for (const view of views) view.webContents.close();
    window.destroy(); app.exit(0); return;
  }
  if (process.env.AUTOMATION_BROWSER_SLICE === 'scroll') {
    const before = approvals.length;
    await assert.rejects(a.scroll(0, 'zero'), { code: 'INVALID_SCROLL' });
    await assert.rejects(a.scroll(NaN, 'nan'), { code: 'INVALID_SCROLL' });
    await assert.rejects(a.scroll(5000, 'large'), { code: 'INVALID_SCROLL' });
    assert.equal((await a.scroll(420, 'scroll-once')).inputDispatched, true);
    await assert.rejects(a.scroll(420, 'scroll-once'), { code: 'DUPLICATE_COMMAND' });
    const deadline = Date.now() + 3000;
    let observation;
    do { observation = await a.observe(); } while (!/Scroll: 420/.test(observation.content.text) && Date.now() < deadline);
    assert.match(observation.content.text, /Scroll: 420/);
    assert.match((await b.observe()).content.text, /Scroll: 0/);
    assert.equal(approvals.length, before);
    a.revoke(); await assert.rejects(a.scroll(100, 'scroll-stopped'), { code: 'LEASE_REVOKED' });
    console.log('BROWSER_SCROLL_PASS');
    await Promise.all(controls.map(control => control.close()));
    for (const view of views) view.webContents.close();
    window.destroy(); app.exit(0); return;
  }
  if (process.env.AUTOMATION_BROWSER_SLICE === 'screenshot') {
    const encoded = await a.screenshot();
    const image = nativeImage.createFromBuffer(Buffer.from(encoded, 'base64'));
    assert(!image.isEmpty());
    const { width, height } = image.getSize(), pixels = image.toBitmap();
    const color = (x, y) => [...pixels.subarray((Math.floor(y) * width + Math.floor(x)) * 4, (Math.floor(y) * width + Math.floor(x)) * 4 + 4)];
    for (const [x, y] of [[30, 30], [30, 75], [30, 120], [30, 165], [254, 144], [254, 180], [254, 216], [254, 252]])
      assert.deepEqual(color(x * width / 600, y * height / 780), [0, 0, 0, 255], `Sensitive pixel visible at ${x},${y}`);
    const publicPixel = color(50 * width / 600, 220 * height / 780);
    assert(publicPixel[1] >= 100 && publicPixel[0] < 80 && publicPixel[2] < 80 && publicPixel[3] === 255, 'Public green pixels should remain visible through the native color profile');
    assert.match((await a.observe()).content.text, /Mutations: 0/);
    assert(!JSON.stringify(await a.observe()).includes('password-secret'));
    console.log('BROWSER_SCREENSHOT_PASS');
    await Promise.all(controls.map(control => control.close()));
    for (const view of views) view.webContents.close();
    window.destroy(); app.exit(0); return;
  }
  if (process.env.AUTOMATION_BROWSER_SLICE === 'screenshot-refusal') {
    await assert.rejects(a.screenshot(), { code: 'SCREENSHOT_UNSAFE' });
    await assert.rejects(b.screenshot(), { code: 'SCREENSHOT_UNSAFE' });
    assert.equal((await b.observe()).partial, true);
    await b.close();
    const withoutRedactor = await attachBrowser({ contents: views[1].webContents, puppeteer }); controls.push(withoutRedactor);
    await assert.rejects(withoutRedactor.screenshot(), { code: 'SCREENSHOT_UNSAFE' });
    console.log('BROWSER_SCREENSHOT-REFUSAL_PASS');
    await Promise.all(controls.map(control => control.close()));
    for (const view of views) view.webContents.close();
    window.destroy(); app.exit(0); return;
  }
  console.log('AB0_topology', JSON.stringify(a.topology()));
  assert.equal(a.topology().length, 3);
  const cross = a.topology().find(frame => frame.url.includes('localhost'));
  const main = a.topology().find(frame => frame.main);
  assert.notEqual(cross.session, main.session, 'Cross-site iframe must have a distinct CDP session');
  assert.equal(a.topology().find(frame => frame.url.endsWith('/same')).session, main.session);
  const observed = await a.observe();
  console.log('AB0_observed', JSON.stringify(observed));
  assert.equal(observed.partial, false);
  assert.equal(observed.targets.filter(target => target.name === 'counter').length, 3);
  assert(!JSON.stringify(observed).includes('hidden-secret'));
  const root = observed.targets.find(target => target.frameId === a.topology().find(frame => frame.main).id && target.name === 'counter');
  views[0].webContents.focus();
  assert.equal((await a.click(root.ref, 'click-1')).inputDispatched, true);
  assert.match(await views[0].webContents.executeJavaScript('document.body.innerText'), /clicked 1/);
  await assert.rejects(a.click(root.ref, 'click-1'), { code: 'DUPLICATE_COMMAND' });
  const oopif = observed.targets.find(target => target.frameId === cross.id && target.name === 'counter');
  assert.equal((await a.click(oopif.ref, 'iframe-click')).inputDispatched, true);
  const after = await a.observe();
  assert.equal(after.targets.filter(target => target.name === 'clicked 1').length, 2);
  assert(Buffer.from(await a.screenshot(), 'base64').subarray(1, 4).equals(Buffer.from('PNG')));
  const oldCrossRef = after.targets.find(target => target.frameId === cross.id).ref;
  await views[0].webContents.debugger.sendCommand('Page.navigate', { url: `http://localhost:${server.address().port}/next`, frameId: cross.id }, cross.session);
  const navigationDeadline = Date.now() + 5000;
  while (!a.topology().some(frame => frame.url.endsWith('/next')) && Date.now() < navigationDeadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert(a.topology().some(frame => frame.url.endsWith('/next')));
  await assert.rejects(a.click(oldCrossRef, 'stale-oopif'), { code: 'STALE_REF' });
  await views[0].webContents.loadURL(`http://127.0.0.1:${server.address().port}/navigated`);
  await assert.rejects(a.click(root.ref, 'stale'), { code: 'STALE_REF' });
  a.revoke();
  await assert.rejects(a.observe(), { code: 'LEASE_REVOKED' });
  const second = await b.observe();
  await b.click(second.targets[0].ref, 'independent');
  assert.match(await views[1].webContents.executeJavaScript('document.body.innerText'), /clicked 1/);
  await views[0].webContents.session.cookies.set({ url: `http://127.0.0.1:${server.address().port}`, name: 'private', value: 'A' });
  assert.equal((await views[1].webContents.session.cookies.get({ name: 'private' })).length, 0);
  views[1].webContents.debugger.detach();
  await assert.rejects(b.observe(), { code: 'LEASE_REVOKED' });
  await Promise.all(controls.map(control => control.close()));
  let approvalStarted;
  const waiting = new Promise(resolve => { approvalStarted = resolve; });
  const gated = await attachBrowser({ contents: views[0].webContents, puppeteer, approve: () => { approvalStarted(); return new Promise(() => {}); } });
  controls.push(gated);
  const pending = gated.click((await gated.observe()).targets[0].ref, 'approval-stop');
  await waiting; gated.revoke();
  await assert.rejects(pending, { code: 'LEASE_REVOKED' }); await gated.close();
  const ownedContents = views.map(view => view.webContents);
  for (const view of views) {
    assert.equal(view.webContents.debugger.listenerCount('message'), 0);
    assert.equal(view.webContents.debugger.listenerCount('detach'), 0);
    const destroyed = new Promise(resolve => view.webContents.once('destroyed', resolve));
    view.webContents.close();
    await destroyed;
  }
  window.destroy();
  assert(ownedContents.every(contents => contents.isDestroyed()));
  console.log('AB0_NATIVE_PASS');
  app.exit(0);
} catch (error) {
  console.error(error);
  await Promise.allSettled(controls.map(control => control.close()));
  for (const view of views) if (view.webContents && !view.webContents.isDestroyed()) view.webContents.close();
  window?.destroy(); app.exit(1);
} finally { server.close(); }
}
void run();
