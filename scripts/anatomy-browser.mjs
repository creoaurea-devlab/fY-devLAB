/** Read-only UI smoke against the separately launched refactored host; no original workspace. */
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const origin = process.env.DEVLAB_TEST_ORIGIN ?? 'http://127.0.0.1:4322';
const output = process.env.DEVLAB_SCREENSHOTS ?? '/tmp/devlab-refactor-screenshots';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/google/chrome/chrome', headless: true });
const errors = [];
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  const name = page.getByTestId('flow-name-input');
  await name.fill('Refactor smoke draft');
  await name.press('Tab');
  await page.getByRole('button', { name: 'Pop the Hood', exact: true }).click();
  await page.getByRole('button', { name: 'Open Browser workspace', exact: true }).waitFor();
  assert.equal(await page.locator('[data-testid="app-anatomy"] .react-flow__node').count(), 7);
  await page.screenshot({ path: `${output}/layers-1440.png` });
  await page.getByRole('button', { name: 'Open Browser workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Open hood-view', exact: true }).waitFor();
  const search = page.getByRole('textbox', { name: 'Find an ownership block' });
  await search.fill('hood');
  await page.getByRole('button', { name: 'hood-view', exact: true }).click();
  assert((await page.getByRole('complementary', { name: 'Ownership details' }).innerText()).includes('Public surfaces:'));
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByText('Loading architecture…', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await search.inputValue(), 'hood');
  await search.fill('');
  await page.screenshot({ path: `${output}/owners-1440.png` });
  await page.getByRole('button', { name: 'Open hood-view', exact: true }).click();
  await page.getByRole('button', { name: 'anatomy.tsx', exact: true }).waitFor();
  await page.getByRole('tab', { name: 'PLUGINS', exact: true }).click();
  await page.getByRole('button', { name: /transport-http.*active/ }).waitFor();
  await page.getByRole('tab', { name: 'Source graph', exact: true }).click();
  await page.getByRole('button', { name: 'Navigation', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search architecture', exact: true }).waitFor();
  await page.getByRole('tab', { name: 'App anatomy', exact: true }).click();
  assert((await page.getByRole('navigation', { name: 'Architecture path' }).innerText()).includes('hood-view'));
  await page.getByRole('button', { name: 'All layers', exact: true }).click();
  for (const width of [820, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByTestId('app-anatomy').getByRole('button', { name: /fit view/i }).click();
    await page.screenshot({ path: `${output}/layers-${width}.png` });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `horizontal document overflow at ${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.keyboard.press('Escape');
  await page.getByTestId('hood-root').waitFor({ state: 'detached' });
  assert.equal(await name.inputValue(), 'Refactor smoke draft', 'opening/closing Hood must retain the canvas draft');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByTestId('menu-api-keys').click();
  await page.getByText('Ctrl / ⌘ S — Save graph', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByTestId('menu-api-keys').click();
  await page.getByText('Ctrl / ⌘ S — Save graph', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByTestId('settings-panel').waitFor({ state: 'detached' });
  // Failure/retry is a real request seam; the source stays read-only.
  const retryPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  retryPage.setDefaultTimeout(10000);
  retryPage.on('pageerror', error => errors.push(error.message));
  const architecture = url => url.pathname === '/api/architecture';
  await retryPage.route(architecture, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'SERVICE_UNAVAILABLE', message: 'Fixture unavailable' }) }));
  await retryPage.goto(origin);
  await retryPage.getByRole('button', { name: 'Pop the Hood', exact: true }).click();
  await retryPage.getByTestId('app-anatomy').getByRole('alert').waitFor();
  await retryPage.unroute(architecture);
  await retryPage.getByRole('button', { name: 'Refresh', exact: true }).click();
  await retryPage.getByRole('button', { name: 'Open Browser workspace', exact: true }).waitFor();
  await retryPage.close();
  assert.deepEqual(errors, [], 'browser exceptions');
  console.log('PASS: layer/owner/file drill-down, search/refresh retention, plugin/source tabs, failure/retry, 1440/820/390 layouts, canvas draft and settings retention; no page errors.');
} catch (error) {
  await page?.screenshot({ path: `${output}/failure.png` });
  console.error(await page?.locator('.anatomy-canvas').evaluateAll(elements => elements.map(el => ({
    nodes: el.querySelectorAll('.react-flow__node').length,
    nodeVisibility: [...el.querySelectorAll('.react-flow__node')].map(node => node.style.visibility),
    viewport: el.querySelector('.react-flow__viewport')?.getAttribute('style'),
    rect: el.getBoundingClientRect().toJSON(),
  }))));
  throw error;
} finally { await browser.close(); }
