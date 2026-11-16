/** Restart only disposable owners; never signal the user's backend or terminals. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readlink, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { Kernel } from '@devlab/kernel';
import { terminalPty } from '@devlab/terminal-pty';
import { grants, profile } from '../src/profile.ts';

const source = fileURLToPath(new URL('../', import.meta.url));
const data = await mkdtemp(join(tmpdir(), 'devlab-restart-browser-'));
const root = join(data, 'project'), output = process.env.RESTART_EVIDENCE_DIR ?? '/tmp/devlab-terminal-restart-evidence';
let kernel, browser, page, projectId, port = 0, jobPid;
const identity = async pid => {
  try { const text = await readFile(`/proc/${pid}/stat`, 'utf8'); const fields = text.slice(text.lastIndexOf(')') + 2).split(' '); return fields[0] === 'Z' ? null : fields[19]; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};
async function until(check, message) {
  for (let i = 0; i < 400; i++) { if (await check()) return; await delay(25); }
  throw new Error(message);
}
async function boot() {
  kernel = new Kernel(grants);
  const definitions = profile(kernel, source, port, join(data, 'host')).map(plugin => plugin.manifest.id === 'terminal-pty'
    ? terminalPty({ stateDirectory: join(data, 'host/terminals'), tmuxPath: join(source, '.tools/tmux/bin/tmux'), preserveOnDispose: true }) : plugin);
  await kernel.start(definitions);
  port = Number(new URL(kernel.service('http').url).port);
}
try {
  await mkdir(join(root, 'work'), { recursive: true }); await mkdir(output, { recursive: true });
  await boot();
  projectId = (await kernel.service('projects').open({ path: root, label: 'Restart fixture' })).id;
  const nodes = ['a', 'b'].map((id, index) => ({ id: 'restart-' + id, type: 'terminal',
    position: { x: 30 + index * 530, y: 30 }, data: { label: 'Restart ' + id.toUpperCase(), cwd: '.', shell: 'bash', width: 500, height: 280, ownership: { mode: 'off' } } }));
  await kernel.service('canvas').save({ projectId, expectedRevision: 0, graph: { name: 'Restart fixture', nodes, edges: [] } });
  const terminals = kernel.service('terminals');
  const sessions = [];
  for (const node of nodes) sessions.push(await terminals.create({ projectId, nodeId: node.id, cwd: '.', shell: 'bash', cols: 80, rows: 24 }));
  const [a, b] = sessions;
  const originalIdentities = await Promise.all(sessions.map(s => identity(s.pid)));
  terminals.write(a.id, "export RESTART_VALUE=retained; cd work; (while :; do printf x >> heartbeat; sleep 0.1; done) & printf '%s' $! > job.pid; printf '\\nBEFORE_%s\\n' RESTART\r");
  terminals.write(b.id, "export SECOND_VALUE=second; printf '\\nSECOND_%s\\n' READY\r");
  await until(() => readFile(join(root, 'work/job.pid'), 'utf8').then(Boolean).catch(() => false), 'Background job did not start');
  jobPid = Number(await readFile(join(root, 'work/job.pid'), 'utf8'));
  const jobIdentity = await identity(jobPid);
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/google/chrome/chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  page = await context.newPage(); page.setDefaultTimeout(15000);
  await page.goto(kernel.service('http').url);
  await page.getByRole('combobox', { name: 'Active project', exact: true }).selectOption(projectId);
  await page.getByRole('button', { name: 'Terminals', exact: true }).click();
  const tab = id => page.locator(`button[role="tab"][data-terminal-node-id="${id}"]`);
  await tab(a.nodeId).click(); await tab(b.nodeId).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Stack vertically', exact: true }).click();
  await page.getByRole('separator', { name: 'Resize Restart A and Restart B', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  const pane = id => page.locator(`.terminal-workspace-pane[data-terminal-node-id="${id}"]`);
  await pane(a.nodeId).locator('.xterm-helper-textarea').waitFor({ state: 'attached' });
  await until(async () => new URL(page.url()).searchParams.get('output') === 'terminal', 'Terminal surface was not bookmarked');
  assert.equal(new URL(page.url()).searchParams.get('projectId'), projectId);
  await pane(a.nodeId).locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('printf typed-once >> partial.txt');
  const selection = await page.locator('button[role="tab"][aria-selected="true"][data-terminal-node-id]').evaluateAll(items => items.map(el => el.dataset.terminalNodeId));
  assert.deepEqual(selection, ['restart-a', 'restart-b']);
  const preferences = await page.evaluate(() => localStorage.getItem('devlab:terminal-workspace:v1'));
  await page.screenshot({ path: join(output, 'before-restart.png') });
  await kernel.close();
  const heartbeat = (await readFile(join(root, 'work/heartbeat'), 'utf8')).length;
  assert.deepEqual(await Promise.all(sessions.map(s => identity(s.pid))), originalIdentities);
  await until(async () => (await readFile(join(root, 'work/heartbeat'), 'utf8')).length > heartbeat, 'Background job stopped while the backend was offline');
  assert.equal(await identity(jobPid), jobIdentity);
  await boot();
  const restored = kernel.service('terminals').list(projectId);
  assert.deepEqual(restored.map(s => [s.id, s.pid, s.ownership]), sessions.map(s => [s.id, s.pid, s.ownership]));
  assert.equal(await readlink(`/proc/${a.pid}/cwd`), join(root, 'work'));
  const replay = kernel.service('terminals').read(a.id, 0).chunks.map(c => c.data).join('');
  assert(replay.includes('BEFORE_RESTART'), 'Retained output disappeared');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.devlab[data-terminal-mainview="true"]') || document.querySelector('[data-terminal-mainview="true"]'));
  assert.equal(await page.getByRole('combobox', { name: 'Active project', exact: true }).inputValue(), projectId);
  await until(async () => await tab(a.nodeId).getAttribute('aria-selected') === 'true' && await tab(b.nodeId).getAttribute('aria-selected') === 'true', 'Terminal pane selection was not restored');
  const restoredPreferences = JSON.parse(await page.evaluate(() => localStorage.getItem('devlab:terminal-workspace:v1')))[projectId];
  // Reload normalizes omitted defaults; preserve every explicitly chosen value.
  for (const [key, value] of Object.entries(JSON.parse(preferences)[projectId])) assert.deepEqual(restoredPreferences[key], value, key);
  await pane(a.nodeId).locator('.xterm-helper-textarea').focus(); await page.keyboard.press('Enter');
  await until(() => readFile(join(root, 'work/partial.txt'), 'utf8').then(text => text === 'typed-once').catch(() => false), 'Partially typed command was lost or duplicated');
  kernel.service('terminals').write(a.id, "printf '%s' \"$RESTART_VALUE\" > restored-value.txt\r");
  kernel.service('terminals').write(b.id, "printf '%s' \"$SECOND_VALUE\" > second-value.txt\r");
  await until(() => readFile(join(root, 'work/restored-value.txt'), 'utf8').then(text => text === 'retained').catch(() => false), 'First shell environment lost');
  await until(() => readFile(join(root, 'second-value.txt'), 'utf8').then(text => text === 'second').catch(() => false), 'Second shell environment lost');
  assert.equal(await identity(jobPid), jobIdentity);
  assert.deepEqual(await Promise.all(sessions.map(s => identity(s.pid))), originalIdentities);
  assert.equal(kernel.service('terminals').list(projectId).length, 2, 'Reload created duplicate shells');
  await page.screenshot({ path: join(output, 'after-restart.png') });
  const result = { sessions: 2, sameProcessIdentities: true, backgroundJobSurvivedOffline: true,
    shellVariablesAndCwd: true, partialCommandExecutedOnce: true, retainedOutput: true,
    selectedProjectAndTerminalView: true, selectedPanesAndPreferences: true, duplicates: 0 };
  await writeFile(join(output, 'browser.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {}); throw error;
} finally {
  await browser?.close();
  if (kernel?.phase !== 'ready' && projectId) await boot();
  if (kernel?.phase === 'ready' && projectId) for (const session of kernel.service('terminals').list(projectId)) await kernel.service('terminals').close(session.id);
  await kernel?.close();
  if (jobPid) assert.equal(await identity(jobPid), null, 'Fixture left its background job alive');
  await rm(data, { recursive: true, force: true });
}
