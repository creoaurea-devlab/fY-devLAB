import * as electron from 'electron';
import { Kernel } from '@devlab/kernel';
import { fork } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createNativeWorkspace } from '../../plugins/browser/src/native.mjs';
import { channel } from './channel.mjs';

const { app, BrowserWindow, ipcMain, dialog } = electron;
const root = resolve(process.env.AUTOMATION_DATA_ROOT || '');
if (!process.env.AUTOMATION_DATA_ROOT) throw new Error('Launch through launch.mjs with an owned data root');
app.setPath('userData', join(root, 'chromium'));
app.commandLine.appendSwitch('use-mock-keychain');
app.commandLine.appendSwitch('site-per-process');
const browserOnly = process.argv.includes('--browser-only');
const shellUrl = new URL('./index.html', import.meta.url).href;
let window, kernel, closing = false, worker, connection, browser, agentic;
const bindings = new Map();
let mutation = Promise.resolve();

async function boot() {
  await app.whenReady();
  if (!app.requestSingleInstanceLock()) throw new Error('This automation data root is already open');
  await mkdir(root, { recursive: true, mode: 0o700 });
  let installation;
  try { installation = JSON.parse(await readFile(join(root, 'installation.json'), 'utf8')).id; }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    installation = randomUUID(); await writeFile(join(root, 'installation.json'), JSON.stringify({ id: installation }), { flag: 'wx', mode: 0o600 });
  }
  if (!/^[a-f0-9-]{36}$/.test(installation)) throw new Error('Invalid installation identity');
  const puppeteer = await import(pathToFileURL(process.env.AUTOMATION_PUPPETEER).href);
  // The inspected runtime combination is explicit. Updating it requires rerunning AB0.
  if (process.versions.electron !== '44.9.3' || process.versions.chrome !== '152.0.7977.167') throw new Error('Unverified Electron/Chromium combination; rerun AB0 before updating the pin');
  const puppeteerPackage = JSON.parse(await readFile(new URL('../../package.json', pathToFileURL(process.env.AUTOMATION_PUPPETEER)), 'utf8'));
  if (puppeteerPackage.version !== '25.4.0') throw new Error('AB0 requires Puppeteer 25.4.0');
  window = new BrowserWindow({ title: 'Automation · Browser + Agentic', width: 1440, height: 900, minWidth: 390, minHeight: 500,
    webPreferences: { preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.once('closed', () => { if (!closing) void shutdown(); });
  window.webContents.on('will-navigate', event => event.preventDefault());
  kernel = new Kernel(['automation.browser', 'automation.agentic']);
  const browserPlugin = {
    manifest: { id: 'browser', version: '0.1.0', apiVersion: 1, provides: ['browsingV2'], requires: [], capabilities: ['automation.browser'], reload: 'restart' },
    async activate(scope) {
      browser = await createNativeWorkspace({ electron, window, puppeteer, root: join(root, 'browser'),
        allowLoopback: process.argv.includes('--allow-loopback'), approve: async request => {
          browser.layout([], true);
          const result = await dialog.showMessageBox(window, { type: 'question', buttons: ['Cancel', 'Allow once'], defaultId: 0, cancelId: 0, signal: request.signal,
            message: `Allow one click on “${request.name}”?`, detail: 'Inspect the page first. Sensitive input remains a manual step.' });
          window.webContents.send('automation-layout-needed');
          return result.response === 1;
        } });
      scope.onDispose(() => browser.close()); scope.provide('browsingV2', browser);
    },
  };
  const agenticPlugin = {
    manifest: { id: 'agentic', version: '0.1.0', apiVersion: 1, provides: ['agentic'], requires: ['browsingV2'], capabilities: ['automation.agentic'], reload: 'restart' },
    async activate(scope) {
      const native = scope.get('browsingV2'), token = randomBytes(32).toString('hex');
      worker = fork(fileURLToPath(new URL('./runtime.mjs', import.meta.url)), [], {
        execPath: process.env.AUTOMATION_NODE, stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG },
      });
      let readyResolve, readyReject;
      const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
      const timer = setTimeout(() => readyReject(new Error('Agentic startup timed out')), 15000);
      worker.on('error', readyReject); worker.once('exit', () => readyReject(new Error('Agentic runtime exited')));
      connection = channel({ peer: worker, token, handle: async (method, args) => {
        if (method === 'hostReady' && args.version === 1) { readyResolve(); return { ready: true }; }
        if (!native.snapshot().panes.some(pane => pane.contextId === args.contextId)) throw new Error('Unbound browser context');
        if (method === 'browser.observe') return (await native.control(args.contextId)).observe();
        if (method === 'browser.release') { await native.release(args.contextId); return { released: true }; }
        throw new Error('Unknown native operation');
      } });
      scope.onDispose(async () => {
        clearTimeout(timer);
        try { if (worker.connected) await connection.call('close'); }
        finally {
          connection.close();
          if (worker.exitCode === null && worker.signalCode === null) {
            const exited = new Promise(resolve => worker.once('exit', resolve));
            worker.kill(); const cutoff = setTimeout(() => worker.kill('SIGKILL'), 2000);
            await exited; clearTimeout(cutoff);
          }
        }
      });
      worker.send({ type: 'init', version: 1, token, config: { root: join(root, 'agentic'), moduleRoot: process.env.MEMORY_NODE_ROOT,
        python: process.env.AUTOMATION_PYTHON || 'python3', installation, owner: 'local-owner', project: 'standalone' } });
      await ready.finally(() => clearTimeout(timer));
      agentic = connection;
      scope.provide('agentic', connection);
    },
  };
  await kernel.start(browserOnly ? [browserPlugin] : [browserPlugin, agenticPlugin]);
  const ensureBindings = async () => {
    if (!agentic) return;
    for (const pane of browser.snapshot().panes) if (!bindings.has(pane.contextId)) {
      const session = await agentic.call('ensure', { contextId: pane.contextId });
      await agentic.call('memory', { sessionId: session.id, operation: 'recall', arguments: {} });
      bindings.set(pane.contextId, session.id);
    }
  };
  await ensureBindings();
  const state = async () => ({ ...browser.snapshot(), sessions: agentic ? await agentic.call('list') : [], browserOnly, health: kernel.health() });
  const paneSession = paneId => {
    const pane = browser.snapshot().panes.find(pane => pane.paneId === paneId);
    if (!pane) throw new Error('Unknown pane');
    const sessionId = bindings.get(pane.contextId);
    if (!agentic || !sessionId) throw new Error('Agentic plugin unavailable');
    return { ...pane, sessionId };
  };
  async function dispatch(method, args) {
    if (closing) throw new Error('App is closing');
    if (method === 'state') return state();
    if (method === 'layout') { browser.layout(args.rectangles); return true; }
    if (method === 'focus') { browser.focus(args.paneId); return true; }
    if (method === 'stop') {
      const pane = paneSession(args.paneId); await browser.release(pane.contextId);
      return agentic.call('stop', { sessionId: pane.sessionId });
    }
    if (method === 'start') return agentic.call('start', { sessionId: paneSession(args.paneId).sessionId, input: args.input });
    if (method === 'memory') return agentic.call('memory', { sessionId: paneSession(args.paneId).sessionId, operation: args.operation, arguments: args.arguments });
    if (method === 'split') { await browser.split(args.paneId, args.axis); await ensureBindings(); return state(); }
    if (method === 'navigate') { await browser.navigate(args.paneId, args.url); return state(); }
    if (method === 'history') { await browser.history(args.paneId, args.direction); return state(); }
    if (method === 'maximize') { await browser.maximize(args.paneId); return state(); }
    if (method === 'move') { await browser.move(args.paneId); return state(); }
    if (method === 'resize') { await browser.resize(args.paneId, args.ratio); return state(); }
    if (method === 'closePane') {
      if (agentic) { const pane = paneSession(args.paneId); await browser.release(pane.contextId); await agentic.call('stop', { sessionId: pane.sessionId }); }
      await browser.closePane(args.paneId); return state();
    }
    throw new Error('Unknown trusted-shell operation');
  }
  ipcMain.handle('automation-v1', async (event, message) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== shellUrl)
      throw new Error('Untrusted automation sender');
    if (!message || typeof message.method !== 'string' || !message.args || typeof message.args !== 'object' || Array.isArray(message.args) || Buffer.byteLength(JSON.stringify(message)) > 65536)
      throw new Error('Invalid automation message');
    if (['state', 'layout', 'focus', 'stop'].includes(message.method)) return dispatch(message.method, message.args);
    const result = mutation.then(() => dispatch(message.method, message.args));
    mutation = result.catch(() => {}); return result;
  });
  window.on('close', event => {
    if (!closing) { event.preventDefault(); void shutdown(); }
  });
  await window.loadURL(shellUrl);
  console.log(JSON.stringify({ event: 'automation-ready', dataRoot: root, browserOnly, versions: { electron: process.versions.electron, chromium: process.versions.chrome, puppeteer: puppeteerPackage.version }, plugins: kernel.health().map(item => item.id) }));
  if (process.argv.includes('--smoke')) {
    const { smoke } = await import('./smoke.mjs');
    await smoke({ browser, agentic, window, state, dispatch, root });
    console.log('AUTOMATION_STANDALONE_PASS'); await shutdown();
  }
}
async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  try { ipcMain.removeHandler('automation-v1'); await mutation; await kernel?.close(); }
  catch (error) { console.error('Automation cleanup failed:', error.message); code = 1; }
  window?.destroy(); app.exit(code);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void shutdown(); });
app.on('window-all-closed', () => {});
void boot().catch(error => { console.error('Automation startup failed:', error.message); void shutdown(1); });
