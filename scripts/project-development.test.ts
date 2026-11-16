import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink, realpath, readdir, lstat, rm, cp } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright-core';
import { Kernel } from '@devlab/kernel';
import { localProjects } from '@devlab/project-local';
import { forkProject } from '../plugins/project-local/src/fork.ts';
import { createServer, mergeConfig } from 'vite';
import viteConfig from '../vite.config.ts';
import { ensureAgentProjectFiles } from '../plugins/project-local/src/template.ts';

test('project agent context adds missing files and preserves existing instructions and symlink targets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'devlab-agent-context-'));
  const outside = await mkdtemp(join(tmpdir(), 'devlab-agent-outside-'));
  try {
    await writeFile(join(root, 'AGENTS.md'), '# Existing rules\n');
    await ensureAgentProjectFiles(root);
    assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), '# Existing rules\n');
    assert.match(await readFile(join(root, '.agents/DEVLAB.md'), 'utf8'), /DevLab project bootstrap/);
    await writeFile(join(root, '.agents/DEVLAB.md'), '# Customized introduction\n');
    await ensureAgentProjectFiles(root);
    assert.equal(await readFile(join(root, '.agents/DEVLAB.md'), 'utf8'), '# Customized introduction\n');
    await rm(join(root, '.agents'), { recursive: true });
    await symlink(outside, join(root, '.agents'));
    await assert.rejects(ensureAgentProjectFiles(root), /real directory/);
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('nested development Vite serves source while private paths and aliases remain forbidden', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'devlab-vite-private-'));
  const root = join(temporary, '.data/projects/thread');
  const privatePaths = ['.env', '.env.local', 'certificate.pem', 'certificate.crt',
    ...['_LAB', '_BACKUP', '.git', '.data', '.wisdohm', '.context', '.recovery', 'secrets']
      .flatMap(folder => [`${folder}/secret.txt`, `nested/${folder}/secret.txt`])];
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const files = { 'index.html': '<h1>nested preview</h1><script type="module" src="/src/main.js"></script>',
      'src/main.js': 'export const previewReady = true; document.querySelector("h1").textContent = "nested preview ready";', 'public/ordinary.txt': 'public asset',
      ...Object.fromEntries(privatePaths.map(path => [path, 'PRIVATE_FIXTURE_CONTENT'])) };
    for (const [path, contents] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), contents);
    }
    await symlink(join(root, 'src/main.js'), join(root, 'ordinary-alias.js'));
    await symlink(join(root, '.env'), join(root, 'env-alias.txt'));
    for (const folder of ['_LAB', '_BACKUP', '.git', '.data', '.wisdohm', '.context', '.recovery', 'secrets']) {
      await symlink(join(root, folder), join(root, `alias-${folder}`));
      await symlink(join(root, folder), join(root, 'public', `public-${folder}`));
    }
    const outside = join(temporary, '.data/host-secret.txt');
    await writeFile(outside, 'PRIVATE_FIXTURE_CONTENT');
    await symlink(outside, join(root, 'outside-alias.txt'));
    // Real forks physically copy Vite, so its internal /@fs/ client alias also lives under .data.
    const vitePackage = dirname(fileURLToPath(import.meta.resolve('vite/package.json')));
    await cp(vitePackage, join(root, 'node_modules/vite'), { recursive: true });
    await symlink(dirname(vitePackage), join(temporary, 'node_modules'));
    const nestedVite: typeof import('vite') = await import(pathToFileURL(join(root, 'node_modules/vite/dist/node/index.js')).href);
    server = await nestedVite.createServer(mergeConfig(viteConfig, { root, configFile: false, logLevel: 'silent',
      resolve: { alias: { '/private-alias': join(root, '.data') } },
      server: { host: '127.0.0.1', port: 0, hmr: false }, optimizeDeps: { noDiscovery: true } }));
    await server.listen();
    const address = server.httpServer!.address();
    assert(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    for (const path of ['/', '/index.html', '/src/main.js', '/ordinary-alias.js', '/ordinary.txt']) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 200, path);
      assert.match(await response.text(), /nested preview|previewReady|public asset/, path);
    }
    for (const path of ['/@vite/client', '/@vite/env'])
      assert.equal((await fetch(origin + path)).status, 200, path);
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    const failures: string[] = [];
    page.on('pageerror', error => failures.push(error.message));
    page.on('requestfailed', request => failures.push(request.url()));
    page.on('response', response => { if (response.status() >= 400) failures.push(response.url()); });
    // The backend-only observation bridge is outside this standalone Vite fixture.
    await page.route('**/api/preview/bridge.js', route => route.fulfill({ body: '', contentType: 'text/javascript' }));
    await page.goto(origin);
    await page.getByRole('heading', { name: 'nested preview ready', exact: true }).waitFor();
    assert.deepEqual(failures, []);
    const requests = privatePaths.flatMap(path => [`/${path}`, `/@fs/${join(root, path)}`, `/${path}?raw`]);
    for (const folder of ['_LAB', '_BACKUP', '.git', '.data', '.wisdohm', '.context', '.recovery', 'secrets'])
      requests.push(`/alias-${folder}/secret.txt`, `/public-${folder}/secret.txt`);
    requests.push('/env-alias.txt', '/outside-alias.txt', '/private-alias/secret.txt',
      '/%5fBACKUP/secret.txt', '/nested/%5fBACKUP/secret.txt', '/%2edata/secret.txt',
      `/@fs/${join(root, '%5fBACKUP/secret.txt')}`);
    for (const path of requests) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 403, path);
      assert(!((await response.text()).includes('PRIVATE_FIXTURE_CONTENT')), path);
    }
  } finally {
    await browser?.close();
    await server?.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

test('protected backup roots, nested backups and aliases cannot be inspected or edited; ordinary CAS still works', async () => {
  const root = await mkdtemp(join(tmpdir(), 'devlab-protection-'));
  const kernel = new Kernel(['workspace:local']);
  try {
    for (const path of ['_BACKUP', 'src/_BACKUP']) await mkdir(join(root, path), { recursive: true });
    for (const path of ['_BACKUP/secret.txt', 'src/_BACKUP/secret.txt', '.env', 'src/good.ts'])
      await writeFile(join(root, path), 'original');
    await symlink(join(root, '_BACKUP'), join(root, 'alias'));
    await kernel.start([localProjects({ root, projectsRoot: join(root, 'projects') })]);
    const service = kernel.service('projects');
    const tree = await service.inspect('default');
    assert(tree.entries.some(entry => entry.path === 'src/good.ts'));
    assert(tree.entries.every(entry => !entry.path.includes('_BACKUP') && !entry.path.includes('alias') && entry.path !== '.env'));
    for (const path of ['_BACKUP/secret.txt', 'src/_BACKUP/secret.txt', 'alias/secret.txt', '.env', 'src/../_BACKUP/secret.txt']) {
      await assert.rejects(service.read('default', path), { code: 'PATH_DENIED' });
      await assert.rejects(service.write({ projectId: 'default', path, text: 'changed', expectedHash: null }), { code: 'PATH_DENIED' });
    }
    for (const path of ['_BACKUP', 'alias', 'src/_BACKUP'])
      await assert.rejects(service.open!({ path: join(root, path) }), { code: 'PATH_DENIED' });
    const original = await service.read('default', 'src/good.ts');
    await service.write({ projectId: 'default', path: 'src/good.ts', text: 'edited', expectedHash: original.sha256 });
    await assert.rejects(service.write({ projectId: 'default', path: 'src/good.ts', text: 'stale', expectedHash: original.sha256 }), { code: 'CONFLICT' });
    assert.equal((await service.read('default', 'src/good.ts')).text, 'edited');
    assert.equal(await readFile(join(root, '_BACKUP/secret.txt'), 'utf8'), 'original');
  } finally {
    await kernel.close();
    await rm(root, { recursive: true, force: true });
  }
});

// A tiny installed graph exercises the real copier without copying this workspace's vendor tree.
async function fixture(root: string) {
  const files: Record<string, string> = {
    '.context/modules/registry.yaml': 'modules:\n  sample-owner:\n    paths:\n      - plugins/sample/package.json\n      - plugins/sample/src/index.ts\n',
    'package.json': JSON.stringify({ dependencies: { '@devlab/sample': 'file:plugins/sample' } }),
    'plugins/sample/package.json': JSON.stringify({ name: '@devlab/sample' }),
    'plugins/sample/src/index.ts': 'export const value = 1;\n',
    'node_modules/external/index.js': 'export const external = true;\n',
    'devlab.preview.json': JSON.stringify({ start: ['node', 'preview.js', '--backend', 'http://localhost:12345'], port: 12346, autoStart: true, views: [{ path: '/?projectId=default&view=code#editor' }] }),
    'vite.config.ts': 'export default {};\n',
    '.wisdohm/protocols/rules.md': '# Independent rules\n',
    '.wisdohm/memory.sqlite-wal': 'source WAL must not be copied',
    'nested/state.db': 'private database',
    '_BACKUP/secret.txt': 'backup',
    'plugins/sample/_BACKUP/secret.txt': 'nested backup',
    '_LAB/component.ts': 'reference-only source',
    'plugins/sample/_LAB/component.ts': 'nested reference-only source',
    '.env.local': 'private environment',
    '.data/state.json': 'live state',
  };
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  const database = new DatabaseSync(join(root, '.wisdohm/memory.sqlite'));
  try { database.exec('PRAGMA user_version=1'); } finally { database.close(); }
  await mkdir(join(root, 'node_modules/@devlab'), { recursive: true });
  await symlink('../../plugins/sample', join(root, 'node_modules/@devlab/sample'));
  await symlink('_BACKUP', join(root, 'backup-alias'));
}

test('fork physically isolates source and dependencies, retains rules without live databases and rewrites preview identity', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'devlab-fork-'));
  const sourceRoot = join(temporary, 'source');
  const projectsRoot = join(temporary, 'projects');
  try {
    await fixture(sourceRoot);
    const originalDatabase = await readFile(join(sourceRoot, '.wisdohm/memory.sqlite'));
    await mkdir(projectsRoot);
    const id = await forkProject({ sourceRoot, projectsRoot, command: { sourceProjectId: 'default', pluginId: 'sample', label: 'My development' } });
    const root = join(projectsRoot, id);
    const metadata = JSON.parse(await readFile(join(root, 'hood.project.json'), 'utf8'));
    assert.equal(metadata.label, 'My development');
    assert.equal(metadata.development.ownerId, 'sample-owner');
    assert.equal(metadata.development.sourcePath, 'plugins/sample');
    assert.equal(metadata.development.sourceProjectId, 'default');
    const source = 'plugins/sample/src/index.ts';
    await writeFile(join(root, source), 'fork edit');
    assert.equal(await readFile(join(sourceRoot, source), 'utf8'), 'export const value = 1;\n');
    assert.equal(await realpath(join(root, 'node_modules/@devlab/sample')), join(root, 'plugins/sample'));
    await writeFile(join(root, 'node_modules/external/index.js'), 'fork dependency edit');
    assert.equal(await readFile(join(sourceRoot, 'node_modules/external/index.js'), 'utf8'), 'export const external = true;\n');
    for (const path of ['_LAB', 'plugins/sample/_LAB', '_BACKUP', 'plugins/sample/_BACKUP', 'backup-alias', '.env.local', '.data', '.wisdohm/memory.sqlite', '.wisdohm/memory.sqlite-wal', 'nested/state.db'])
      await assert.rejects(lstat(join(root, path)), { code: 'ENOENT' });
    await writeFile(join(root, '.wisdohm/protocols/rules.md'), 'fork rules');
    assert.equal(await readFile(join(sourceRoot, '.wisdohm/protocols/rules.md'), 'utf8'), '# Independent rules\n');
    const independent = new DatabaseSync(join(root, '.wisdohm/memory.sqlite'));
    try { independent.exec('PRAGMA user_version=1'); } finally { independent.close(); }
    assert.deepEqual(await readFile(join(sourceRoot, '.wisdohm/memory.sqlite')), originalDatabase);
    const descriptor = JSON.parse(await readFile(join(root, 'devlab.preview.json'), 'utf8'));
    const view = new URL(descriptor.views[0].path, 'http://localhost');
    assert.equal(view.searchParams.get('projectId'), id);
    assert.equal(view.searchParams.get('view'), 'code');
    assert.equal(view.hash, '#editor');
    assert.equal(descriptor.autoStart, false);
    assert(descriptor.start.includes('devlab.fork.vite.mjs'));
    const config = await readFile(join(root, 'devlab.fork.vite.mjs'), 'utf8');
    assert(config.includes('"target":"http://127.0.0.1:12345"'));
    assert(config.includes('"origin":"http://127.0.0.1:12345"'));
    assert.deepEqual(await readdir(projectsRoot), [id]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('fork refuses corrupt operational SQLite before publishing a development copy', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'devlab-fork-corrupt-'));
  const sourceRoot = join(temporary, 'source'), projectsRoot = join(temporary, 'projects');
  try {
    await fixture(sourceRoot); await mkdir(projectsRoot);
    await writeFile(join(sourceRoot, '.wisdohm/memory.sqlite'), 'corrupt operational database');
    await assert.rejects(forkProject({ sourceRoot, projectsRoot, command: { sourceProjectId: 'default', pluginId: 'sample' } }), { code: 'PATH_DENIED' });
    assert.deepEqual(await readdir(projectsRoot), []);
    assert.equal(await readFile(join(sourceRoot, '.wisdohm/memory.sqlite'), 'utf8'), 'corrupt operational database');
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('unknown plugin and escaping dependency links fail without publishing or leaving staging copies', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'devlab-fork-failure-'));
  const sourceRoot = join(temporary, 'source');
  const projectsRoot = join(temporary, 'projects');
  try {
    await fixture(sourceRoot);
    await mkdir(projectsRoot);
    await assert.rejects(forkProject({ sourceRoot, projectsRoot, command: { sourceProjectId: 'default', pluginId: '../escape' } }), { code: 'PATH_DENIED' });
    assert.deepEqual(await readdir(projectsRoot), []);
    await symlink(sourceRoot, join(sourceRoot, 'node_modules/escape'));
    await assert.rejects(forkProject({ sourceRoot, projectsRoot, command: { sourceProjectId: 'default', pluginId: 'sample' } }), { code: 'PATH_DENIED' });
    assert.deepEqual(await readdir(projectsRoot), []);
    assert.equal(await readFile(join(sourceRoot, 'plugins/sample/src/index.ts'), 'utf8'), 'export const value = 1;\n');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
