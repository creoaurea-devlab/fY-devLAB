/** Runs only on a disposable candidate; never starts/reloads the live workspace. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { Kernel } from '@devlab/kernel';
import { profile, grants } from '../runtime/index.ts';

const candidate = fileURLToPath(new URL('../', import.meta.url));
const root = await mkdtemp(join(tmpdir(), 'devlab-runtime-browser-'));
const state = join(root, 'state');
const output = process.env.RUNTIME_BROWSER_EVIDENCE ?? join(tmpdir(), 'devlab-runtime-browser-evidence');
const kernel = new Kernel(grants);
let browser;
try {
  await mkdir(join(root, 'src')); await mkdir(state); await mkdir(output, { recursive: true });
  await writeFile(join(root, 'src/sample.ts'), 'export const RuntimeNeedle = 42;\n');
  const selection = { 'herdr-runtime': false, 'terminal-pty': false, 'rules-local': false, 'project-server': false, 'preview-inspector': false };
  await writeFile(join(state, 'runtime-plugins.json'), JSON.stringify({ selection, previous: null }));
  process.env.DEVLAB_BUILD_DIR = join(candidate, 'dist');
  await kernel.start(profile(kernel, root, 0, state, undefined, selection));
  const origin = kernel.service('http').url;
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/google/chrome/chrome', headless: true });
  for (const width of [1440, 820, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(origin);
      await page.getByRole('button', { name: 'Pop the Hood', exact: true }).click();
      await page.getByRole('tab', { name: 'PLUGINS', exact: true }).click();
      const panel = page.locator('.hood-runtime');
      const toggle = panel.getByRole('checkbox', { name: 'Enable workspace-search', exact: true });
      await toggle.waitFor(); assert.equal(await toggle.isChecked(), true);
      assert.equal(await panel.getByRole('checkbox', { name: 'Enable runtime-control', exact: true }).isDisabled(), true);
      await panel.getByRole('checkbox', { name: 'Enable project-local', exact: true }).click();
      await panel.getByRole('alert').filter({ hasText: 'requires projects' }).waitFor();
      assert.equal(await panel.getByRole('checkbox', { name: 'Enable project-local', exact: true }).isChecked(), true);
      await toggle.click(); await panel.getByText('Restart required', { exact: true }).waitFor();
      assert.equal(kernel.health().find(plugin => plugin.id === 'workspace-search')?.state, 'active');
      await panel.getByRole('button', { name: 'Rewind selection', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[aria-label="Enable workspace-search"]')?.checked);
      assert.equal(await panel.getByText('Restart required', { exact: true }).count(), 0);
      await panel.getByRole('textbox', { name: 'Search project source', exact: true }).fill('RuntimeNeedle');
      await panel.getByRole('button', { name: 'Search source', exact: true }).click();
      await panel.getByText('src/sample.ts:1', { exact: true }).waitFor();
      assert.equal(await panel.locator('pre').textContent(), 'export const RuntimeNeedle = 42;');
      await panel.locator('summary').filter({ hasText: 'Local diagnostics' }).click();
      await panel.getByText(/workspace-search · ok/).first().waitFor();
      const inventory = await kernel.service('runtimeControl').inspect();
      assert(!JSON.stringify(inventory.diagnostics).includes('RuntimeNeedle'));
      // A concurrent settings change must not be overwritten by this stale view.
      await kernel.service('runtimeControl').configure({ expectedRevision: inventory.revision, changes: { 'workspace-search': false } });
      await toggle.click();
      await panel.getByRole('alert').filter({ hasText: 'selection changed' }).waitFor();
      await panel.getByRole('button', { name: 'Refresh runtime', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[aria-label="Enable workspace-search"]')?.checked === false);
      await panel.getByRole('button', { name: 'Rewind selection', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[aria-label="Enable workspace-search"]')?.checked);
      assert.deepEqual(errors, []);
      assert(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'runtime panel overflows');
      await page.screenshot({ path: join(output, `runtime-${width}.png`) });
      await page.getByRole('tab', { name: 'App anatomy', exact: true }).click();
      await page.getByRole('tab', { name: 'PLUGINS', exact: true }).click();
      assert.equal(await panel.getByRole('textbox', { name: 'Search project source', exact: true }).inputValue(), 'RuntimeNeedle');
      await page.keyboard.press('Escape'); await page.getByTestId('hood-root').waitFor({ state: 'hidden' });
      console.log(`Runtime controls/search/refusal/rewind and retained view: passed at ${width}px`);
    } finally { await context.close(); }
  }
  console.log('Screenshots: ' + output);
} finally { await browser?.close(); await kernel.close(); await rm(root, { recursive: true, force: true }); }
