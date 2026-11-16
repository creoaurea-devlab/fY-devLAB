/** Real browser integration, using the running isolated upstream host and disposable DevLab state. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { Kernel } from '@devlab/kernel';
import { grants, profile } from '../runtime/index.ts';
const upstream = process.env.DEVLAB_DEEPSEEK_ORIGIN ?? 'http://127.0.0.1:4340';
const root = fileURLToPath(new URL('../', import.meta.url));
const data = await mkdtemp(join(tmpdir(), 'devlab-deepseek-browser-'));
const output = process.env.DEEPSEEK_BROWSER_EVIDENCE ?? join(tmpdir(), 'deepseek-runtime-browser-evidence');
const kernel = new Kernel(grants);let browser;
try {
  await mkdir(output, { recursive: true });
  process.env.DEVLAB_DEEPSEEK_ORIGIN = upstream;
  await kernel.start(profile(kernel, root, 0, data, undefined, { 'herdr-runtime': false, 'terminal-pty': false, 'rules-local': false, 'project-server': false, 'preview-inspector': false }));
  const merged = await kernel.service('architecture').snapshot();
  assert.equal(merged.catalog.graph.items.filter(item => item.id.startsWith('deepseek:package:')).length, 403);
  assert(merged.plugins.some(plugin => plugin.id.startsWith('deepseek/') && plugin.state === 'active'));
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/google/chrome/chrome', headless: true });
  for (const width of [1440, 820, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(); page.setDefaultTimeout(15000);const errors=[];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(upstream);
      await page.getByRole('heading', { name: 'DeepSeek Harness Runtime', exact: true }).waitFor();
      await page.getByRole('searchbox', { name: 'Filter packages', exact: true }).fill('dsh-tools');
      await page.getByRole('button').filter({ hasText: /^dsh-tools/ }).click();
      await page.getByRole('button', { name: 'Disable plugin', exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('dd')].some(element => element.textContent === 'disabled'));
      await page.getByRole('button', { name: 'Rewind selection', exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('dd')].some(element => element.textContent === 'active'));
      await page.getByRole('textbox', { name: 'Native plugin configuration', exact: true }).fill('{');
      await page.getByRole('button', { name: 'Enable plugin', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'valid JSON' }).waitFor();
      await page.getByRole('textbox', { name: 'Native plugin configuration', exact: true }).fill('{}');
      await page.getByRole('button', { name: 'Test this package', exact: true }).click();
      await page.getByText(/active · off true · active true · cleanup true/).waitFor();
      assert(await page.locator('main').evaluate(element => element.scrollWidth <= element.clientWidth + 1));
      await page.screenshot({ path: join(output, `plugins-${width}.png`) });
      await page.goto(kernel.service('http').url);
      await page.locator('.flow-node-header').getByText('DeepSeek Harness Runtime', { exact: true }).first().waitFor();
      const open = page.getByRole('button', { name: 'Open runtime', exact: true }).first();
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Open runtime' && !button.disabled));
      const popup = page.waitForEvent('popup'); await open.click(); const native = await popup; await native.waitForLoadState();
      assert.equal(new URL(native.url()).origin, upstream); await native.close();
      assert.equal(await page.getByText('Hermes Agent', { exact: true }).count(), 0);
      await page.screenshot({ path: join(output, `canvas-${width}.png`) });
      await page.getByRole('button', { name: 'Pop the Hood', exact: true }).click();
      await page.getByRole('tab', { name: 'PLUGINS', exact: true }).click();
      await page.getByRole('button').filter({ hasText: /deepseek\/.*dsh-tools/ }).first().waitFor();
      assert.deepEqual(errors, []);
      console.log(`Runtime on/off/rewind/probe and canvas-to-registry integration passed: ${width}px`);
    } finally { await context.close(); }
  }
  console.log('Evidence: '+output);
} finally { await browser?.close(); await kernel.close(); await rm(data, { recursive: true, force: true }); }
