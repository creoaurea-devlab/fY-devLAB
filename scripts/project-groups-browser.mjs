/** Catalog presentation only, using disposable projects, backend and browser storage. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { Kernel } from '@devlab/kernel';
import { grants, profile } from '../src/profile.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const data = await mkdtemp(join(tmpdir(), 'devlab-project-groups-'));
const output = process.env.PROJECT_GROUPS_EVIDENCE_DIR ?? '/tmp/devlab-project-groups-evidence';
const kernel = new Kernel(grants);
let browser, page;
try {
  await mkdir(output, { recursive: true });
  await kernel.start(profile(kernel, root, 0, data));
  const projects = [];
  for (const label of ['Alpha', 'Beta']) {
    const path = join(data, label); await mkdir(path);
    projects.push(await kernel.service('projects').open({ path, label }));
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/google/chrome/chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(kernel.service('http').url);
  const group = name => page.getByRole('region', { name: `Project group ${name}`, exact: true });
  const row = id => page.locator(`.project-list-row[data-project-id="${id}"]`);
  await group('POOL').getByRole('button', { name: 'Select project Alpha', exact: true }).waitFor();
  const selected = await page.getByRole('combobox', { name: 'Active project', exact: true }).inputValue();
  await page.getByRole('button', { name: 'Add group', exact: true }).click();
  await page.getByRole('textbox', { name: 'Group name', exact: true }).fill('RESEARCH');
  await page.getByRole('button', { name: 'Save project group', exact: true }).click();
  await row(projects[0].id).dragTo(group('RESEARCH').locator('.project-group-heading'));
  await group('RESEARCH').getByRole('button', { name: 'Select project Alpha', exact: true }).waitFor();
  await page.getByRole('combobox', { name: 'Move Beta to group', exact: true }).selectOption({ label: 'RESEARCH' });
  await row(projects[1].id).dragTo(row(projects[0].id));
  assert.deepEqual(await group('RESEARCH').locator('.project-list-row').evaluateAll(rows => rows.map(row => row.dataset.projectId)), [projects[1].id, projects[0].id]);
  assert.equal(await page.getByRole('combobox', { name: 'Active project', exact: true }).inputValue(), selected);
  await group('RESEARCH').getByRole('button', { name: 'RESEARCH', exact: false }).first().click();
  await page.reload();
  await group('RESEARCH').waitFor();
  assert.equal(await group('RESEARCH').locator('.project-group-heading button').getAttribute('aria-expanded'), 'false');
  await group('RESEARCH').locator('.project-group-heading button').click();
  await group('RESEARCH').getByRole('button', { name: 'Select project Alpha', exact: true }).waitFor();
  assert.deepEqual(await group('RESEARCH').locator('.project-list-row').evaluateAll(rows => rows.map(row => row.dataset.projectId)), [projects[1].id, projects[0].id]);
  await page.getByRole('button', { name: 'Add group', exact: true }).click();
  await page.getByRole('textbox', { name: 'Group name', exact: true }).fill('research');
  await page.getByRole('button', { name: 'Save project group', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'unique group name' }).waitFor();
  await page.getByRole('button', { name: 'Cancel new group', exact: true }).click();
  await page.locator('.project-list').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: join(output, 'project-groups-1440.png') });
  await page.setViewportSize({ width: 820, height: 950 });
  await page.screenshot({ path: join(output, 'project-groups-820.png') });
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.evaluate(() => { localStorage.setItem('devlab:project-groups:v1', '{broken'); });
  await page.reload();
  await group('POOL').getByRole('button', { name: 'Select project Alpha', exact: true }).waitFor();
  assert.equal(await group('RESEARCH').count(), 0);
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('Storage unavailable'); }; });
  await page.getByRole('combobox', { name: 'Move Alpha to group', exact: true }).selectOption({ label: 'CURRENT' });
  await group('CURRENT').getByRole('button', { name: 'Select project Alpha', exact: true }).waitFor();
  await page.getByRole('alert').filter({ hasText: 'browser storage is unavailable' }).waitFor();
  assert.deepEqual(errors, []);
  const result = { customGroup: true, dragMove: true, dragReorder: true, keyboardMove: true,
    navigationUnchanged: true, reloadPersistence: true, collapsedPersistence: true,
    duplicateRefused: true, malformedStorageFallback: true, unavailableStorageUsable: true, jsErrors: errors };
  await writeFile(join(output, 'browser.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }); throw error;
} finally {
  await browser?.close(); await kernel.close(); await rm(data, { recursive: true, force: true });
}
