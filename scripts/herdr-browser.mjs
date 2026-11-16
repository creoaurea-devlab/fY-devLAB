/** Disposable UI verification; HERDR_REAL=1 uses the pinned contained server with no protocol mocks. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { Kernel } from '@devlab/kernel';
import { grants, profile } from '../runtime/index.ts';
const root = fileURLToPath(new URL('../', import.meta.url));
const real = process.env.HERDR_REAL === '1';
const data = await mkdtemp(join(tmpdir(), 'herdr-browser-')), output = '/tmp/devlab-herdr-browser' + (real ? '-real' : '');
const kernel = new Kernel(grants); let browser;
const result = [];
try {
  await mkdir(output, { recursive: true }); await kernel.start(profile(kernel, root, 0, join(data, 'host')));
  const projects = [];
  for (const name of ['A', 'B']) { const path = join(data, name); await mkdir(path); await writeFile(join(path, 'test.txt'), name); projects.push(await kernel.service('projects').open({ path, label: 'Herdr fixture ' + name })); }
  const url = kernel.service('http').url;
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/google/chrome/chrome', headless: true });
  for (const width of [1440, 820, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } }), page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    page.setDefaultTimeout(12000);
    const startUrl = url + '/?projectId=' + projects[0].id + '&output=herdr';
    await page.goto(startUrl);
    const surface = page.locator('.herdr-project:visible');
    await surface.locator('[role="status"]').filter({ hasText: /unavailable|stopped/ }).waitFor();
    const initialState = await surface.getAttribute('data-herdr-state');
    if (initialState === 'unavailable') assert(await surface.getByRole('button', { name: 'Start runtime' }).isDisabled());
    await page.screenshot({ path: join(output, `unavailable-${width}.png`) });
    const snapshots = new Map(projects.map(p => [p.id, { projectId: p.id, state: 'running', message: 'SIMULATED HERDR PROTOCOL; real disposable PTY renderer', version: '0.9.3', protocol: 22,
      policy: { mode: 'contained-project', network: 'offline', revision: 'ui-fixture', projectPath: '/workspace' }, workspaces: [{ id: 'w1', label: 'Fixture', focused: true }],
      panes: [{ id: 'w1:p1', workspaceId: 'w1', label: 'Fixture pane', focused: true, tabId: 'w1:t1', zoomed: false, agent: null, agentStatus: 'unknown' }], attachment: null }]));
    const calls = [];
    if (!real) await page.route('**/api/herdr**', async route => {
      const request = route.request(), parsed = new URL(request.url()), id = request.method() === 'GET' ? parsed.searchParams.get('projectId') : decodeURIComponent(parsed.pathname.split('/').pop());
      if (parsed.pathname.endsWith('/events')) { await route.continue(); return; }
      const value = snapshots.get(id); assert(value);
      if (request.method() === 'POST') {
        const command = request.postDataJSON(); calls.push({ id, command });
        if (command.type === 'attach') value.attachment = await kernel.service('terminals').attachManaged({ projectId: id, nodeId: `herdr:fixture-${width}-${id}`, executable: '/bin/sh', args: ['-c', 'printf "TUI FIXTURE READY\\r\\n"; exec cat'], env: { PATH: '/usr/bin:/bin' }, cwd: data, cols: 100, rows: 30 });
        if (command.type === 'detach') { await kernel.service('terminals').close(value.attachment.id); value.attachment = null; }
        if (command.type === 'zoom') value.panes[0].zoomed = command.mode === 'on';
        if (command.type === 'rename') value.panes[0].label = command.label;
      }
      await route.fulfill({ json: value });
    });
    if (real) {
      page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/herdr/')) calls.push({ command: request.postDataJSON() }); });
      await surface.getByRole('button', { name: 'Start runtime', exact: true }).click();
      await surface.getByText('Actions & policy', { exact: true }).click();
      await surface.getByRole('textbox', { name: 'Herdr name' }).fill('Browser check');
      await surface.getByRole('button', { name: 'New workspace', exact: true }).click();
      await surface.getByRole('combobox', { name: 'Herdr pane', exact: true }).locator('option[value^="w"]').first().waitFor({ state: 'attached' });
      await surface.getByText('Actions & policy', { exact: true }).click();
    }
    await page.reload(); await surface.getByRole('button', { name: 'Attach TUI' }).click();
    await surface.locator('.xterm-helper-textarea').waitFor({ state: 'attached' });
    await page.screenshot({path: join(output, `attached-${width}.png`)});
    await page.waitForFunction(() => document.querySelector('.herdr-project:not([hidden]) .terminal-connection')?.textContent?.includes('Connected') || document.querySelector('.herdr-project:not([hidden]) .xterm'));
    const session = (real ? await kernel.service('herdr').snapshot(projects[0].id) : snapshots.get(projects[0].id)).attachment; assert(session);
    if (real) {
      for (let attempt = 0; attempt < 100 && !kernel.service('terminals').read(session.id, 0).chunks.map(c => c.data).join('').includes('Browser check'); attempt++) await new Promise(done => setTimeout(done, 50));
      assert(kernel.service('terminals').read(session.id, 0).chunks.map(c => c.data).join('').includes('Browser check'), 'real TUI must render its workspace');
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      await page.screenshot({ path: join(output, `attached-${width}.png`) });
    }
    await page.evaluate(() => { window.herdrFixtureElement = document.querySelector('.herdr-project:not([hidden]) .xterm'); });
    await page.getByRole('button', { name: 'Workflow', exact: true }).click();
    assert.equal(await surface.count(), 0);
    await page.getByTestId('workspace-view-herdr').click();
    assert(await page.evaluate(() => window.herdrFixtureElement === document.querySelector('.herdr-project:not([hidden]) .xterm')));
    await page.getByRole('combobox', { name: 'Active project', exact: true }).selectOption(projects[1].id);
    await page.getByTestId('workspace-view-herdr').click();
    await surface.getByRole('button', { name: real ? 'Start runtime' : 'Attach TUI' }).waitFor();
    await page.getByRole('combobox', { name: 'Active project', exact: true }).selectOption(projects[0].id);
    await surface.getByRole('button', { name: 'Detach', exact: true }).waitFor();
    assert(await page.evaluate(() => window.herdrFixtureElement === document.querySelector('.herdr-project:not([hidden]) .xterm')));
    assert.equal(kernel.service('terminals').inspect(session.id).pid, session.pid);
    assert.equal(calls.filter(c => c.command.type === 'attach').length, 1);
    await surface.getByText('Actions & policy', { exact: true }).click();
    if (real) {
      await surface.getByRole('button', { name: 'Split right', exact: true }).click();
      await surface.getByRole('combobox', { name: 'Herdr pane', exact: true }).locator('option').nth(1).waitFor({ state: 'attached' });
    }
    await surface.getByRole('button', { name: 'Zoom pane', exact: true }).click();
    await surface.getByRole('button', { name: 'Unzoom', exact: true }).waitFor();
    await surface.getByRole('button', { name: 'Unzoom', exact: true }).click();
    await surface.getByRole('textbox', { name: 'Herdr name' }).fill('Renamed');
    await surface.getByRole('button', { name: 'Rename', exact: true }).click();
    assert.equal(calls.at(-1).command.type, 'rename');
    await surface.getByRole('button', { name: 'Rename', exact: true }).waitFor();
    await surface.getByRole('textbox', { name: 'Herdr pane input' }).fill('fixture input');
    await surface.getByRole('button', { name: 'Send text', exact: true }).click();
    assert.equal(calls.at(-1).command.type, 'input');
    await page.screenshot({ path: join(output, `controls-${width}.png`) });
    const bounds = await surface.locator('.herdr-options').boundingBox(); assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    const frame = await surface.boundingBox(); assert(bounds.y + bounds.height <= frame.y + frame.height, 'drawer must fit the editing pane');
    await surface.getByRole('textbox', { name: 'Herdr pane input' }).press('Escape');
    assert.equal(await surface.locator('.herdr-actions').getAttribute('open'), null);
    assert(await surface.locator('.herdr-actions summary').evaluate(node => node === document.activeElement));
    await page.screenshot({ path: join(output, `retained-${width}.png`) });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await surface.getByRole('button', { name: 'Detach', exact: true }).click();
    await surface.getByRole('button', { name: 'Attach TUI' }).waitFor();
    assert.equal(kernel.service('terminals').inspect(session.id).status, 'exited');
    assert.deepEqual(errors, []);
    result.push({ width, initialState, retainedDOM: true, retainedPID: true, duplicateAttachments: 0, paneCommand: true, drawerReachable: true, escapeFocus: true, overflow: false, pageErrors: errors.length, protocol: real ? 'real-contained' : 'simulated' });
    if (real) await kernel.service('herdr').command(projects[0].id, { type: 'stop' });
    await context.close();
  }
  await writeFile(join(output, 'verification.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser?.close(); await kernel.close(); await rm(data, { recursive: true, force: true }); }
