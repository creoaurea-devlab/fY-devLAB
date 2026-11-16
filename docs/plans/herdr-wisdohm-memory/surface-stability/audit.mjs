/** Audit probe, not product code. All writes/processes use disposable project data. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as reservation } from 'node:net';
import { chromium } from 'playwright-core';
import { createServer as createVite } from 'vite';
import { Kernel } from '@devlab/kernel';
import { profile, grants } from '../../../../src/profile.ts';
import { createProjectWorkspace } from '../../../../plugins/ui-projects/src/workspace.ts';
import { createCanvasWorkspace } from '../../../../plugins/ui-canvas/src/workspace.ts';

const output = process.env.SURFACE_AUDIT_OUTPUT ?? dirname(fileURLToPath(import.meta.url));
await mkdir(output, { recursive: true });
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const sourcePaths = ['src/profile.ts', 'src/main.ts', 'src/workspace.ts', 'src/shell.tsx',
  'plugins/ui-projects/src/workspace.ts', 'plugins/ui-projects/src/build.tsx', 'plugins/ui-projects/src/editor.tsx',
  'plugins/ui-shell/src/view.tsx', 'plugins/ui-shell/src/terminals.tsx', 'plugins/ui-shell/src/devlab.css',
  'plugins/ui-canvas/src/view.tsx', 'plugins/ui-canvas/src/workspace.ts', 'plugins/ui-terminal/src/view.tsx',
  'plugins/terminal-pty/src/index.ts', 'packages/ui-contracts/src/index.ts', 'package.json', 'package-lock.json'];
const fingerprints = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async p =>
  [p, createHash('sha256').update(await readFile(join(root, p))).digest('hex')])));
const result = { auditedAt: new Date().toISOString(), source: await fingerprints(),
  scope: 'Disposable owner and browser probes; no live user API, terminal or browser touched', findings: {} };
const waitFor = async (f, description) => {
  for (let i = 0; i < 200; i++) { const value = await f(); if (value) return value; await new Promise(r => setTimeout(r, 50)); }
  throw new Error(description);
};

// Actual project/canvas owners, with only the persistence port delayed.
const canvases = new Map();
let releaseSave, saveEntered;
const entered = new Promise(resolve => { saveEntered = resolve; });
const disk = { load: async () => null, save: async command => {
  saveEntered(); await new Promise(resolve => { releaseSave = resolve; });
  return { schemaVersion: 1, projectId: command.projectId, revision: command.expectedRevision + 1, graph: command.graph };
} };
const getCanvas = id => {
  if (!canvases.has(id)) canvases.set(id, createCanvasWorkspace(disk, id, { autosaveMs: 60000 }));
  return canvases.get(id);
};
const projects = ['default', 'other'].map(id => ({ id, label: id, base: id === 'default', location: '/fixture/' + id }));
const owner = createProjectWorkspace({ projects: {
  list: async () => projects,
  inspect: async id => ({ project: projects.find(p => p.id === id), revision: 'a'.repeat(64), entries: [], graph: { items: [], edges: [] } }),
} }, getCanvas, { pollMs: 60000 });
try {
  await owner.start(); await getCanvas('default').reload();
  getCanvas('default').update({ name: 'Unsaved fixture', nodes: [], edges: [] });
  const pending = owner.select('other'); await entered;
  await owner.select('default'); // Latest intent is to stay in the current project.
  const busyWhileEarlierPending = owner.snapshot().busy;
  releaseSave(); await pending;
  result.findings.navigation = { expectedLatestIntent: 'default', observed: owner.snapshot().projectId,
    busyWhileEarlierPending, reproduced: owner.snapshot().projectId !== 'default',
    fidelity: 'Real public owners with a delayed save; does not establish the cause of the live report.' };
} finally { releaseSave?.(); owner.dispose(); for (const canvas of canvases.values()) canvas.dispose(); }

const temporary = await mkdtemp(join(tmpdir(), 'devlab-surface-audit-'));
const kernel = new Kernel(grants);
let browser, vite, pids = [];
const fixtureProjectIds = [];
try {
  const hold = reservation(); await new Promise(r => hold.listen(0, '127.0.0.1', r));
  const webPort = hold.address().port; await new Promise(r => hold.close(r));
  await kernel.start(profile(kernel, root, 0, join(temporary, 'data'), webPort));
  const backend = kernel.service('http').url;
  const api = async (path, body) => {
    const response = await fetch(backend + path, body === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert(response.ok, `${path}: ${response.status}`); return response.json();
  };
  const fixture = [];
  for (const label of ['Audit A', 'Audit B']) {
    const directory = join(temporary, label.replace(' ', '-'));
    await mkdir(join(directory, 'src'), { recursive: true });
    await writeFile(join(directory, 'src/example.ts'), 'export const fixture = true;\n');
    fixture.push(await kernel.service('projects').open({ path: directory, label }));
  }
  const [a, b] = fixture;
  fixtureProjectIds.push(a.id, b.id);
  await api('/api/canvas', { projectId: a.id, expectedRevision: 0, graph: { name: 'Surface audit',
    nodes: [0, 1].map(i => ({ id: `audit-terminal-${i}`, type: 'terminal', position: { x: 40 + i * 580, y: 40 },
      data: { label: `Audit terminal ${i}`, cwd: '.', shell: 'bash', width: 500, height: 280 } })), edges: [],
    viewport: { x: 15, y: 20, zoom: 0.55 } } });
  vite = await createVite({ root, cacheDir: join(temporary, 'vite-cache'), logLevel: 'error',
    define: { 'import.meta.env.DEVLAB_BACKEND_ORIGIN': JSON.stringify(backend) },
    server: { host: '127.0.0.1', port: webPort, strictPort: true, proxy: { '/api': { target: backend, changeOrigin: true } } } });
  await vite.listen();
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/google/chrome/chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${webPort}/?projectId=${a.id}`);
  const selected = page.getByRole('combobox', { name: 'Active project', exact: true });
  await waitFor(async () => await selected.inputValue() === a.id, 'Project A not selected');
  await page.getByRole('button', { name: 'Build canvas', exact: true }).click();
  const build = page.getByTestId('project-build-canvas').filter({ has: page.locator('.hood-root') }).locator('visible=true');
  const graph = build.locator('.react-flow__viewport');
  await graph.locator('.react-flow__node').first().waitFor();
  const settle = async element => element.evaluate(el => new Promise(resolve => {
    let last, stable = 0; const deadline = performance.now() + 3000;
    const step = () => { const next = el.style.transform; stable = next === last ? stable + 1 : 0; last = next;
      if (stable > 15 || performance.now() > deadline) resolve(next); else requestAnimationFrame(step); }; step();
  }));
  await settle(graph);
  await build.getByRole('button', { name: 'Layout', exact: true }).click();
  await build.getByRole('button', { name: 'zoom in', exact: true }).click(); await settle(graph);
  await build.getByRole('button', { name: 'zoom in', exact: true }).click();
  const beforeBuild = await settle(graph);
  await graph.evaluate(el => { el.dataset.auditRetained = 'original'; });
  await page.getByRole('button', { name: 'Workflow', exact: true }).click();
  const removedOnWorkflow = await page.getByTestId('project-build-canvas').count() === 0;
  await page.getByRole('button', { name: 'Build canvas', exact: true }).click();
  await graph.locator('.react-flow__node').first().waitFor();
  const afterBuild = await settle(graph);
  if (process.env.SURFACE_AUDIT_VERIFY) {
    await selected.selectOption(b.id);
    await waitFor(async () => await selected.inputValue() === b.id && await selected.isEnabled(), 'Build B not ready');
    await selected.selectOption(a.id);
    await waitFor(async () => await selected.inputValue() === a.id && await selected.isEnabled(), 'Build A not restored');
    assert.equal(await settle(graph), beforeBuild, 'Cross-project Build viewport lost');
    assert.equal(await graph.getAttribute('data-audit-retained'), 'original');
    await page.getByRole('button', { name: 'Open src/example.ts', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'File contents', exact: true });
    await editor.fill('Unsaved fixture draft to retain');
    await editor.evaluate(el => el.setSelectionRange(4, 12));
    await page.getByRole('button', { name: 'Workflow', exact: true }).click();
    await page.getByRole('button', { name: 'Build canvas', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Build canvas', exact: true }).evaluate(el => el === document.activeElement), true, 'Surface click lost keyboard focus');
    assert.equal(await editor.inputValue(), 'Unsaved fixture draft to retain');
    assert.deepEqual(await editor.evaluate(el => [el.selectionStart, el.selectionEnd]), [4, 12]);
  }
  result.findings.build = { removedOnWorkflow, beforeBuild, afterBuild,
    retainedDom: await graph.getAttribute('data-audit-retained') === 'original', viewportReset: beforeBuild !== afterBuild };

  await page.getByRole('button', { name: 'Workflow', exact: true }).click();
  const terminals = () => kernel.service('terminals').list(a.id).filter(s => s.status === 'running');
  await waitFor(() => terminals().length === 2, 'Fixture terminals not running');
  const sessionsBefore = terminals().map(s => ({ id: s.id, pid: s.pid }));
  const flowNodes = page.locator('.project-flow-stage .react-flow__node-terminal');
  const frames = flowNodes.locator('.flow-node-header');
  await frames.nth(0).click(); await frames.nth(1).click({ modifiers: ['Shift'] });
  await waitFor(async () => await page.locator('.project-flow-stage .react-flow__node.selected').count() === 2, 'Nodes not selected');
  result.findings.terminalControls = { resizeHandles: await flowNodes.locator('.react-flow__resize-control').count(),
    fontZoomButtons: await flowNodes.getByRole('button', { name: /(?:font|text).*(?:zoom|size)|(?:zoom|size).*(?:font|text)/i }).count() };
  await page.getByTestId('btn-align-selected').click();
  const rectangles = await flowNodes.evaluateAll(nodes => nodes.map(el => {
    const r = el.getBoundingClientRect(); return { id: el.dataset.id, x: r.x, y: r.y, width: r.width, height: r.height }; }));
  const [r0, r1] = rectangles;
  result.findings.align = { rectangles, overlaps: r0.x < r1.x + r1.width && r0.x + r0.width > r1.x && r0.y < r1.y + r1.height && r0.y + r0.height > r1.y };
  await page.screenshot({ path: join(output, 'align-overlap-before.png') });
  await page.getByRole('button', { name: 'Terminals', exact: true }).click();
  await waitFor(async () => await page.getByTestId('workspace-view-terminals').getAttribute('aria-pressed') === 'true', 'Terminal main not active');
  await selected.selectOption(b.id);
  await waitFor(async () => await selected.inputValue() === b.id && await selected.isEnabled(), 'Project B not ready');
  await page.getByRole('button', { name: 'Workflow', exact: true }).click();
  await selected.selectOption(a.id);
  await waitFor(async () => await selected.inputValue() === a.id && await selected.isEnabled(), 'Return to A not ready');
  result.findings.surface = { expected: 'Terminals', terminalViewRestored: await page.getByTestId('workspace-view-terminals').getAttribute('aria-pressed') === 'true',
    actualCanvasMode: await page.getByTestId('flow-editor-root').getAttribute('data-canvas-mode'),
    sameSessions: JSON.stringify(sessionsBefore) === JSON.stringify(terminals().map(s => ({ id: s.id, pid: s.pid }))) };
  // These are observation probes: a finding remains open, not a passing repair test.
  result.pageErrors = errors;
  pids = terminals().map(s => s.pid);
  result.privateFixtureTerminalCount = pids.length;
} finally {
  pids = fixtureProjectIds.flatMap(id => kernel.service('terminals').list(id).filter(s => s.status === 'running').map(s => s.pid));
  await browser?.close(); await vite?.close(); await kernel.close();
  const running = async pid => { try { const stat = await readFile(`/proc/${pid}/stat`, 'utf8'); return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] !== 'Z'; } catch { return false; } };
  await waitFor(async () => !(await Promise.all(pids.map(running))).some(Boolean), 'Fixture process survived cleanup');
  await rm(temporary, { recursive: true, force: true });
  result.cleanup = { fixtureRemoved: true, terminalProcessesGone: true };
  result.sourceUnchanged = JSON.stringify(result.source) === JSON.stringify(await fingerprints());
  await writeFile(join(output, 'audit.json'), JSON.stringify(result, null, 2) + '\n');
}
if (process.env.SURFACE_AUDIT_VERIFY) {
  assert.equal(result.findings.navigation.reproduced, false);
  assert.equal(result.findings.navigation.busyWhileEarlierPending, true);
  assert.equal(result.findings.build.removedOnWorkflow, false);
  assert.equal(result.findings.build.retainedDom, true);
  assert.equal(result.findings.build.viewportReset, false);
  assert.equal(result.findings.align.overlaps, false);
  assert.equal(result.findings.surface.terminalViewRestored, true);
  assert.equal(result.findings.surface.sameSessions, true);
  assert.deepEqual(result.pageErrors, []);
}
console.log(JSON.stringify({ findings: result.findings, pageErrors: result.pageErrors, cleanup: result.cleanup, sourceUnchanged: result.sourceUnchanged }, null, 2));
