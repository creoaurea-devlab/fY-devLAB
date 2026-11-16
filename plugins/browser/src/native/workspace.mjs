import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { attachBrowser } from '../index.mjs';

const id = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const leaves = tree => tree?.paneId ? [tree.paneId] : tree ? [...leaves(tree.first), ...leaves(tree.second)] : [];
const replace = (tree, pane, next) => tree.paneId === pane ? next : tree.paneId ? tree :
  { ...tree, first: replace(tree.first, pane, next), second: replace(tree.second, pane, next) };
const remove = (tree, pane) => {
  if (tree.paneId) return tree.paneId === pane ? null : tree;
  const first = remove(tree.first, pane), second = remove(tree.second, pane);
  return first && second ? { ...tree, first, second } : first || second;
};

export function allowedUrl(value, allowLoopback = false) {
  try {
    const url = new URL(value);
    if (url.href === 'about:blank') return true;
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const privateHost = host === 'localhost' || host.endsWith('.localhost') || !host.includes('.') ||
      /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
      host.includes(':');
    return !privateHost || (allowLoopback && (host === 'localhost' || /^127\./.test(host) || host === '::1'));
  } catch { return false; }
}

/** Native resources outlive renderer layout changes. Only this owner sets their bounds. */
export async function createNativeWorkspace({ electron, window, puppeteer, root, approve, allowLoopback = false }) {
  const { WebContentsView, nativeImage } = electron;
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, 'browser.json'), panes = new Map();
  let tree = null, maximized = null, closed = false, saving = Promise.resolve();
  const snapshot = () => ({ version: 1, tree, maximized, panes: [...panes.values()].map(pane => ({
    paneId: pane.paneId, contextId: pane.contextId, url: pane.url, error: pane.error || null,
    canGoBack: pane.view?.webContents?.navigationHistory.canGoBack() || false,
    canGoForward: pane.view?.webContents?.navigationHistory.canGoForward() || false,
  })) });
  const save = () => {
    const data = JSON.stringify(snapshot());
    saving = saving.then(async () => { await writeFile(path + '.tmp', data, { mode: 0o600 }); await rename(path + '.tmp', path); });
    return saving;
  };
  const paneFor = paneId => {
    if (closed) throw new Error('Browser workspace closed');
    const pane = panes.get(paneId);
    if (!pane) throw new Error('Unknown pane');
    return pane;
  };
  async function create(saved) {
    const pane = { paneId: saved?.paneId || randomUUID(), contextId: saved?.contextId || randomUUID(),
      url: saved?.url || 'about:blank', control: null, attaching: null, fence: 0, error: null };
    const view = new WebContentsView({ webPreferences: {
      partition: `persist:automation-${pane.contextId}`, sandbox: true, contextIsolation: true,
      nodeIntegration: false, webSecurity: true, navigateOnDragDrop: false,
    } });
    pane.view = view;
    const contents = view.webContents;
    const block = (_event, url) => { if (!allowedUrl(url, allowLoopback)) _event.preventDefault(); };
    contents.on('will-navigate', block); contents.on('will-redirect', block);
    contents.setWindowOpenHandler(() => { pane.error = 'Popup blocked'; return { action: 'deny' }; });
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    contents.session.setPermissionCheckHandler(() => false);
    const download = (event, item) => { event.preventDefault(); item.cancel(); pane.error = 'Downloads are unavailable in this preview'; };
    contents.session.on('will-download', download);
    contents.session.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !allowedUrl(details.url, allowLoopback) && !details.url.startsWith('data:') });
    });
    contents.on('did-navigate', (_event, url) => { pane.url = url; void save().catch(() => { pane.error = 'Could not save browser state'; }); });
    contents.on('render-process-gone', () => { pane.control?.revoke(); pane.error = 'Page process ended; navigate to recover'; });
    pane.dispose = async () => {
      pane.fence++;
      await pane.attaching?.catch(() => {});
      await pane.control?.close(); pane.control = null;
      contents.session.removeListener('will-download', download);
      contents.session.webRequest.onBeforeRequest(null);
      if (!contents.isDestroyed()) {
        window.contentView.removeChildView(view);
        const done = new Promise(resolve => contents.once('destroyed', resolve));
        contents.close({ waitForBeforeUnload: false }); await done;
      }
    };
    panes.set(pane.paneId, pane); window.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    if (!allowedUrl(pane.url, allowLoopback)) pane.url = 'about:blank';
    try { await contents.loadURL(pane.url); } catch { pane.error = 'Page did not load'; }
    return pane;
  }
  try {
    const saved = JSON.parse(await readFile(path, 'utf8'));
    if (saved.version !== 1 || !Array.isArray(saved.panes) || saved.panes.length > 4 || !saved.panes.length ||
      saved.panes.some(pane => !id(pane.paneId) || !id(pane.contextId)) || new Set(saved.panes.map(pane => pane.contextId)).size !== saved.panes.length)
      throw new Error('Unsupported browser state; preserve it and choose a separate data root');
    const validateTree = (node, depth = 0) => {
      if (!node || depth > 4) throw new Error('Invalid saved layout');
      if (node.paneId) { if (!id(node.paneId)) throw new Error('Invalid saved pane'); return; }
      if (!id(node.splitId) || !['right', 'down'].includes(node.axis) || !Number.isFinite(node.ratio) || node.ratio < .15 || node.ratio > .85) throw new Error('Invalid saved split');
      validateTree(node.first, depth + 1); validateTree(node.second, depth + 1);
    };
    validateTree(saved.tree);
    if (JSON.stringify([...leaves(saved.tree)].sort()) !== JSON.stringify(saved.panes.map(pane => pane.paneId).sort())) throw new Error('Saved layout does not match panes');
    tree = saved.tree;
    for (const item of saved.panes) await create(item);
  } catch (error) {
    if (error.code !== 'ENOENT') { await Promise.allSettled([...panes.values()].map(pane => pane.dispose())); throw error; }
    const pane = await create(); tree = { paneId: pane.paneId }; await save();
  }
  return {
    snapshot,
    async split(paneId, axis) {
      paneFor(paneId);
      if (!['right', 'down'].includes(axis)) throw new Error('Invalid split axis');
      if (panes.size >= 4) throw new Error('Four-pane limit reached');
      const pane = await create();
      tree = replace(tree, paneId, { splitId: randomUUID(), axis, ratio: .5, first: { paneId }, second: { paneId: pane.paneId } });
      maximized = null; await save(); return snapshot();
    },
    async navigate(paneId, url) {
      const pane = paneFor(paneId);
      if (typeof url !== 'string' || url.length > 4096 || !allowedUrl(url, allowLoopback)) throw new Error('Use a public HTTP(S) URL; local resources are blocked');
      pane.error = null; pane.control?.revoke(); await pane.control?.close(); pane.control = null;
      try { await pane.view.webContents.loadURL(url); } catch { pane.error = 'Page did not load'; }
      pane.url = pane.view.webContents.getURL(); await save(); return snapshot();
    },
    async history(paneId, direction) {
      const pane = paneFor(paneId), contents = pane.view.webContents;
      pane.control?.revoke(); await pane.control?.close(); pane.control = null;
      if (direction === 'back' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
      else if (direction === 'forward' && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
      else if (direction === 'reload') contents.reload();
      else throw new Error('Navigation is unavailable');
      return snapshot();
    },
    async closePane(paneId) {
      if (panes.size === 1) throw new Error('Keep one pane open');
      const pane = paneFor(paneId); await pane.dispose(); panes.delete(paneId);
      tree = remove(tree, paneId); maximized = null; await save(); return snapshot();
    },
    async maximize(paneId) { paneFor(paneId); maximized = maximized === paneId ? null : paneId; await save(); return snapshot(); },
    async resize(splitId, ratio) {
      if (!Number.isFinite(ratio) || ratio < .15 || ratio > .85) throw new Error('Split ratio must be .15–.85');
      let found = false;
      const change = node => {
        if (node.paneId) return node;
        if (node.splitId === splitId) { found = true; return { ...node, ratio }; }
        return { ...node, first: change(node.first), second: change(node.second) };
      };
      const next = change(tree); if (!found) throw new Error('Unknown split');
      tree = next; await save(); return snapshot();
    },
    async move(paneId) {
      paneFor(paneId); const order = leaves(tree), other = order[(order.indexOf(paneId) + 1) % order.length];
      const swap = node => node.paneId ? { paneId: node.paneId === paneId ? other : node.paneId === other ? paneId : node.paneId } :
        { ...node, first: swap(node.first), second: swap(node.second) };
      tree = swap(tree); await save(); return snapshot();
    },
    layout(rectangles, hidden = false) {
      if (!Array.isArray(rectangles) || rectangles.length > 4) throw new Error('Invalid native layout');
      const [width, height] = window.getContentSize();
      for (const pane of panes.values()) {
        const rectangle = rectangles.find(item => item.paneId === pane.paneId);
        const valid = rectangle && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rectangle[key]) && rectangle[key] >= 0 && rectangle[key] <= 16384);
        if (!valid || hidden) { pane.view.setBounds({ x: 0, y: 0, width: 0, height: 0 }); continue; }
        const x = Math.min(width, Math.round(rectangle.x)), y = Math.min(height, Math.round(rectangle.y));
        pane.view.setBounds({ x, y, width: Math.min(Math.round(rectangle.width), width - x), height: Math.min(Math.round(rectangle.height), height - y) });
      }
    },
    focus(paneId) { paneFor(paneId).view.webContents.focus(); },
    async control(contextId) {
      const pane = [...panes.values()].find(item => item.contextId === contextId);
      if (!pane) throw new Error('Browser context unavailable');
      if (pane.control) return pane.control;
      if (!pane.attaching) {
        const fence = pane.fence;
        pane.attaching = (async () => {
          const control = await attachBrowser({ contents: pane.view.webContents, puppeteer, nativeImage,
            approve: request => approve({ ...request, paneId: pane.paneId }) });
          if (closed || fence !== pane.fence) { control.revoke(); await control.close(); throw new Error('Browser control revoked during attach'); }
          pane.control = control; return control;
        })().finally(() => { pane.attaching = null; });
      }
      return pane.attaching;
    },
    async release(contextId) {
      const pane = [...panes.values()].find(item => item.contextId === contextId);
      if (!pane) return;
      pane.fence++;
      pane.control?.revoke();
      const control = pane.control; pane.control = null;
      await control?.close(); await pane.attaching?.catch(() => {});
    },
    async close() {
      if (closed) return; closed = true;
      await saving; await Promise.all([...panes.values()].map(pane => pane.dispose())); panes.clear();
    },
  };
}
