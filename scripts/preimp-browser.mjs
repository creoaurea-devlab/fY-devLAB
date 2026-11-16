/** Real app/HTTP/iframe flow. All writes, previews and browser state belong to disposable fixtures. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as netServer } from 'node:net';
import { chromium } from 'playwright-core';
import { createServer, mergeConfig } from 'vite';
import viteConfig from '../vite.config.ts';
import { Kernel } from '@devlab/kernel';
import { grants, profile } from '../src/profile.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const data = await mkdtemp(join(tmpdir(), 'devlab-preimp-browser-'));
const output = process.env.PREIMP_EVIDENCE_DIR ?? '/tmp/devlab-preimp-browser-evidence';
const kernel = new Kernel(grants);
let browser, vite;
const results = [];
try {
  await mkdir(output, { recursive: true });
  await kernel.start(profile(kernel, root, 0, join(data, 'host')));
  const folder = join(data, 'app');
  const socket = netServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const files = {
    '.agents/plans/authority.yaml': 'schema_version: 1\ndefinitions: files\n',
    '.agents/ownership/browser/example.yaml': 'schema_version: 1\nid: example\npurpose: Prototype fixture\ngroup: browser\npaths: [src/**]\npublic: [src/a.ts]\nuses: []\nguidance: []\n',
    'src/a.ts': 'export const value = 1;\n',
    'index.html': '<h1>Retained project preview</h1><label>Preview draft<input aria-label="Preview draft"></label>',
    'server.mjs': `import {createServer} from 'node:http';import{readFile}from'node:fs/promises';createServer(async(q,r)=>{r.setHeader('content-type','text/html');r.end(await readFile(new URL('./index.html',import.meta.url)));}).listen(Number(process.argv[2]),'127.0.0.1');`,
    'devlab.preview.json': JSON.stringify({ schemaVersion: 1, adapter: 'static', start: [process.execPath, 'server.mjs', '{port}'], port, autoStart: false, inspection: 'manual' }),
  };
  for (const [path, text] of Object.entries(files)) { await mkdir(dirname(join(folder, path)), { recursive: true }); await writeFile(join(folder, path), text); }
  const project = await kernel.service('projects').open({ path: folder, label: 'Prototype fixture' });
  assert.equal((await kernel.service('servers').start(project.id)).status, 'ready');
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/google/chrome/chrome', headless: true });
  for (const width of [1440, 820, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    try {
      await page.goto(kernel.service('http').url + '/?projectId=' + project.id);
      await page.getByRole('button', { name: 'Focus previews', exact: true }).click();
      const pane = page.locator(`.project-preview-pane[data-project-id="${project.id}"]`).first();
      const normal = pane.frameLocator('.project-preview-frame');
      await normal.getByLabel('Preview draft').fill('retained-' + width);
      await pane.locator('.project-preview-frame').evaluate(el => { window.preimpRetainedFrame = el; });
      await pane.getByRole('button', { name: 'Prototype', exact: true }).click();
      const panel = pane.getByRole('region', { name: `Feature prototypes · ${project.id}` });
      await panel.getByRole('button', { name: 'New task', exact: true }).click();
      await panel.getByLabel('Task ID', { exact: true }).fill('feature-' + width);
      await panel.getByLabel('Title', { exact: true }).fill('Compact node catalog ' + width);
      await panel.getByLabel('Task owner').selectOption('example');
      await panel.getByLabel('Destination files, one per line').fill('src/a.ts');
      await panel.getByRole('button', { name: 'Create staged task', exact: true }).click();
      await panel.getByText('Plan & staged source', { exact: true }).click();
      await panel.getByLabel('Staged file').selectOption(`_preimp/feature-${width}/prototype.html`);
      const html = `<!doctype html><style>body{margin:0;padding:18px;background:#18191d;color:#ececf2;font:13px system-ui}header{display:flex;gap:12px;align-items:center}h1{font-size:16px}button{background:#282b32;color:inherit;border:1px solid #666;border-radius:4px;padding:8px;cursor:pointer}aside{display:grid;gap:6px;max-width:170px;border-right:3px solid #e8c64a;padding-right:8px}p{color:#a9adb8}</style><header><h1>Node catalog</h1><button id="collapse" onclick="document.querySelector('aside').hidden=!document.querySelector('aside').hidden">Collapse</button></header><aside><button onclick="document.querySelector('#state').textContent='Terminal selected · terminal-view'">⌨ Terminal</button><button onclick="document.querySelector('#state').textContent='Agent selected · canvas-ui'">π Agent</button></aside><p id="state">Prototype · simulated selection</p>`;
      await panel.getByLabel('Staged source text').fill(html);
      await panel.getByRole('button', { name: 'Save', exact: true }).click();
      await panel.getByText('Plan & staged source', { exact: true }).click();
      const prototype = panel.frameLocator('.preview-preimp-frame');
      await prototype.getByRole('button', { name: '⌨ Terminal', exact: true }).click();
      await prototype.getByText('Terminal selected · terminal-view', { exact: true }).waitFor();
      const frame = await panel.locator('.preview-preimp-frame').elementHandle();
      const browserFrame = await frame.contentFrame();
      const isolation = await browserFrame.evaluate(async origin => {
        let parentDenied = false, storageDenied = false, networkDenied = false;
        try { void parent.document.body; } catch { parentDenied = true; }
        try { localStorage.setItem('preimp', 'bad'); } catch { storageDenied = true; }
        try { await fetch(origin + '/api/projects'); } catch { networkDenied = true; }
        return { parentDenied, storageDenied, networkDenied };
      }, kernel.service('http').url);
      assert.deepEqual(isolation, { parentDenied: true, storageDenied: true, networkDenied: true });
      await pane.screenshot({ path: join(output, `prototype-${width}.png`) });
      await pane.getByRole('button', { name: 'Prototype', exact: true }).click();
      assert.equal(await normal.getByLabel('Preview draft').inputValue(), 'retained-' + width);
      assert(await pane.locator('.project-preview-frame').evaluate(el => el === window.preimpRetainedFrame));
      await pane.getByRole('button', { name: 'Prototype', exact: true }).click();
      await prototype.getByText('Terminal selected · terminal-view', { exact: true }).waitFor();
      await panel.getByText('Plan & staged source', { exact: true }).click();
      await panel.getByLabel('Staged file').selectOption(`_preimp/feature-${width}/files/src/a.ts`);
      const before = await readFile(join(folder, 'src/a.ts'), 'utf8');
      const after = `export const value = ${width};\n`;
      await panel.getByLabel('Staged source text').fill(after);
      assert(await panel.getByRole('button', { name: 'Review merge', exact: true }).isDisabled());
      await panel.getByRole('button', { name: 'Save', exact: true }).click();
      await panel.getByText('Plan & staged source', { exact: true }).click();
      assert.equal(await readFile(join(folder, 'src/a.ts'), 'utf8'), before);
      await panel.getByRole('button', { name: 'Review merge', exact: true }).click();
      await panel.getByLabel('Merge evidence').fill('Disposable browser fixture: source remains unchanged until review, sandbox and iframe retention verified.');
      await panel.getByRole('checkbox').check();
      if (width === 1440) await pane.screenshot({ path: join(output, 'merge-review.png') });
      await panel.getByRole('button', { name: 'Merge reviewed files', exact: true }).click();
      await panel.getByText('merged · example', { exact: true }).waitFor();
      assert.equal(await readFile(join(folder, 'src/a.ts'), 'utf8'), after);
      assert.equal(await panel.getByRole('alert').count(), 0);
      const geometry = await panel.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
      assert(geometry.scroll <= geometry.width + 1, JSON.stringify({ width, geometry }));
      assert.deepEqual(errors, []);
      results.push({ width, isolation, retainedNormalFrame: true, retainedPrototypeState: true, reviewedMerge: true, geometry });
    } catch (error) { await page.screenshot({ path: join(output, `failure-${width}.png`) }); throw error; }
    finally { await context.close(); }
  }
  vite = await createServer(mergeConfig(viteConfig, { root: folder, configFile: false, logLevel: 'silent', server: { host: '127.0.0.1', port: 0, hmr: false }, optimizeDeps: { noDiscovery: true } }));
  await vite.listen();
  const viteURL = `http://127.0.0.1:${vite.httpServer.address().port}`;
  for (const path of ['/_preimp/feature-1440/prototype.html', '/_preimp/feature-1440/files/src/a.ts', '/%5fpreimp/feature-1440/task.json'])
    assert.equal((await fetch(viteURL + path)).status, 403, path);
  await writeFile(join(output, 'browser.json'), JSON.stringify({ results, viteStagingBlocked: true }, null, 2) + '\n');
  console.log(JSON.stringify({ results, viteStagingBlocked: true, output }));
} finally {
  await vite?.close(); await browser?.close(); await kernel.close();
  await rm(data, { recursive: true, force: true });
}
