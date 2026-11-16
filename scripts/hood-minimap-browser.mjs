/** Build/Hood graph loading and minimap gestures, with disposable backend/browser state. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { Kernel } from '@devlab/kernel';
import { grants, profile } from '../src/profile.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const data = await mkdtemp(join(tmpdir(), 'devlab-hood-minimap-'));
const output = '/tmp/devlab-hood-minimap-evidence';
const kernel = new Kernel(grants);
let browser;
try {
  await mkdir(output, { recursive: true });
  await kernel.start(profile(kernel, root, 0, data));
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/google/chrome/chrome', headless: true });
  for (const [view, width] of ['build', 'hood'].flatMap(view => [1440, 820, 390].map(width => [view, width]))) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(kernel.service('http').url);
      if (view === 'build') await page.getByRole('button', { name: 'Build canvas', exact: true }).click();
      else {
        await page.getByRole('button', { name: 'Pop the Hood', exact: true }).click();
        await page.getByRole('tab', { name: 'Source graph', exact: true }).click();
      }
      const surface = view === 'build' ? page.getByTestId('project-build-canvas') : page.getByTestId('hood-root');
      await surface.getByRole('button', { name: 'Layout', exact: true }).click();
      const toggle = surface.getByRole('checkbox', { name: 'Show architecture minimap', exact: true });
      await toggle.check();
      const canvas = surface.getByRole('main', { name: 'Architecture graph', exact: true });
      const mini = canvas.getByTestId('rf__minimap');
      await mini.locator('.react-flow__minimap-node').first().waitFor();
      assert.equal(await surface.getByText('Architecture unavailable', { exact: true }).count(), 0);
      const geometry = await mini.evaluate(element => {
        const svg = element.querySelector('svg');
        const drawing = svg.getBoundingClientRect();
        return { width: element.clientWidth, height: element.clientHeight, drawingWidth: drawing.width, drawingHeight: drawing.height };
      });
      assert(geometry.drawingWidth <= geometry.width && geometry.drawingHeight <= geometry.height,
        `${view} minimap clips its drawing: ${JSON.stringify(geometry)}`);
      const viewport = canvas.locator('.react-flow__viewport');
      // Wait for the initial auto-fit animation, so it cannot fake a successful pan.
      assert(await viewport.evaluate(element => new Promise(resolve => {
        let previous = '', stable = 0, done = false;
        const deadline = setTimeout(() => { done = true; resolve(false); }, 2000);
        const frame = () => {
          if (done) return;
          const next = element.style.transform;
          stable = next === previous ? stable + 1 : 0; previous = next;
          if (stable >= 8) { done = true; clearTimeout(deadline); resolve(true); }
          else requestAnimationFrame(frame);
        }; requestAnimationFrame(frame);
      })), 'Hood viewport never settled');
      if (view === 'build') {
        const framing = await canvas.evaluate(element => {
          const scale = new DOMMatrix(getComputedStyle(element.querySelector('.react-flow__viewport')).transform).a;
          const titles = [...element.querySelectorAll('.hood-node-title')];
          return { cards: titles.length, scale, smallestTitle: Math.min(...titles.map(title => parseFloat(getComputedStyle(title).fontSize) * scale)) };
        });
        console.log(`BUILD framing ${width}: ${JSON.stringify(framing)}`);
        assert(framing.cards > 0 && framing.smallestTitle >= 10, `Unreadable initial Build framing: ${JSON.stringify(framing)}`);
        for (const name of ['Workflow', 'Build canvas', 'Terminals', 'Settings', 'Pop the Hood']) {
          const button = page.getByRole('button', { name, exact: true });
          const rect = await button.boundingBox();
          assert(rect && rect.x >= 0 && rect.x + rect.width <= width, `${name} clipped at ${width}px`);
        }
      }
      const bounds = await mini.boundingBox(); assert(bounds);
      const before = await viewport.getAttribute('style');
      await page.mouse.move(bounds.x + 40, bounds.y + 50);
      await page.mouse.down();
      await page.mouse.move(bounds.x + 90, bounds.y + 80, { steps: 8 });
      await page.mouse.up();
      assert.notEqual(await viewport.getAttribute('style'), before, 'minimap drag must pan the source graph');
      const zoom = await viewport.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).a);
      await page.mouse.wheel(0, -180);
      await page.waitForFunction(before => {
        const element = document.querySelector('.hood-canvas .react-flow__viewport');
        return element && new DOMMatrix(getComputedStyle(element).transform).a > before;
      }, zoom, { timeout: 1500 });
      await toggle.uncheck(); await mini.waitFor({ state: 'hidden' });
      await toggle.check(); await mini.waitFor();
      await page.screenshot({ path: join(output, `${view}-minimap-${width}.png`) });
      if (view === 'build') {
        await surface.getByRole('button', { name: 'Project', exact: true }).click();
        await surface.getByRole('button', { name: 'New file', exact: true }).click();
        await surface.getByRole('textbox', { name: 'File path', exact: true }).fill('src/unsaved-build-probe.ts');
        await surface.getByRole('button', { name: 'Open new file', exact: true }).click();
        await surface.getByRole('textbox', { name: 'File contents', exact: true }).fill('// retained draft');
        if (width === 1440) {
        await surface.getByRole('button', { name: 'Project', exact: true }).click();
        await surface.getByRole('button', { name: 'New file', exact: true }).click();
        await surface.getByRole('textbox', { name: 'File path', exact: true }).fill('src/unsaved-build-probe.ts');
        await surface.getByRole('button', { name: 'Open new file', exact: true }).click();
        assert.match(await surface.getByRole('alert').innerText(), /already exists/);
        assert.equal(await surface.getByRole('textbox', { name: 'File contents', exact: true }).inputValue(), '// retained draft');
        await surface.getByRole('button', { name: 'Cancel', exact: true }).click();
        }
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
        const settings = page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true });
        await settings.getByRole('button', { name: 'Close settings', exact: true }).focus();
        await page.keyboard.press('Escape'); await settings.waitFor({ state: 'hidden' });
        if (width === 1440) {
          await page.getByRole('button', { name: 'Expand project actions', exact: true }).click();
          await page.getByRole('button', { name: 'Open Folder', exact: true }).click();
          const folder = page.getByRole('textbox', { name: 'Existing project folder', exact: true });
          for (const [value, valid] of [['/tmp/example', true], ['relative/path', false]]) {
            await folder.fill(value); assert.equal(await folder.evaluate(input => input.checkValidity()), valid);
          }
          await page.getByRole('button', { name: 'Cancel open folder', exact: true }).click();
        }
        await page.getByRole('button', { name: 'Workflow', exact: true }).click();
        await page.getByRole('button', { name: 'Build canvas', exact: true }).click();
        assert.equal(await surface.getByRole('textbox', { name: 'File contents', exact: true }).inputValue(), '// retained draft');
      }
      if (view === 'build' && width === 1440) {
        const unconfigured = await context.newPage();
        await unconfigured.route('**/api/servers/default', route => route.fulfill({ json: {
          projectId: 'default', generation: 0, status: 'unconfigured', logs: [], error: 'Missing devlab.preview.json',
        } }));
        await unconfigured.goto(kernel.service('http').url);
        const preview = unconfigured.locator('.project-preview-pane').first();
        const start = preview.getByRole('button', { name: 'Start preview server', exact: true });
        assert(await start.isDisabled());
        assert.match(await start.getAttribute('title'), /devlab.preview.json/);
        assert.match(await preview.innerText(), /Create devlab.preview.json/);
        await unconfigured.close();
      }
      if (view === 'build' && width === 1440) console.log('PASS duplicate-path draft, absolute-folder validation, and unconfigured-preview guidance.');
      assert.deepEqual(errors, []);
      console.log(`PASS ${view} ${width}: graph loads, full minimap, drag pan, wheel zoom, hide/reopen${view === 'build' ? ', readable initial frame, primary navigation, shortcuts/Escape, draft survives Workflow/Build switch' : ''}; no page errors.`);
    } catch (error) {
      await page.screenshot({ path: join(output, `failure-${view}-${width}.png`) });
      throw error;
    } finally { await context.close(); }
  }
} finally {
  await browser?.close(); await kernel.close();
  await rm(data, { recursive: true, force: true });
}
