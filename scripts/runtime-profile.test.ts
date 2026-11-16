import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, copyFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Kernel } from '@devlab/kernel';
import { grants, profile } from '../runtime/index.ts';
import { profile as compatibilityProfile } from '../src/profile.ts';

test('default candidate runtime preserves the retained plugins plus inspection/search and rejects malformed selection', () => {
  assert.equal(compatibilityProfile, profile);
  const kernel = new Kernel(grants);
  const definitions = profile(kernel, process.cwd(), 0);
  assert.deepEqual(definitions.map(plugin => plugin.manifest.id), [
    'canvas-store', 'project-local', 'terminal-pty', 'runtime-control', 'workspace-search', 'rules-local', 'herdr-runtime',
    'project-server', 'preview-inspector', 'registry-map', 'transport-http',
  ]);
  assert.deepEqual(kernel.health(), [], 'composition must not activate resources');
  assert.throws(() => profile(kernel, process.cwd(), 0, undefined, undefined, { typo: false }), { code: 'INVALID_PLUGIN_SELECTION' });
  assert.throws(() => profile(kernel, process.cwd(), 0, undefined, undefined,
    { 'terminal-pty': 'false' } as unknown as Record<string, boolean>), { code: 'INVALID_PLUGIN_SELECTION' });
});

test('Cordis refuses missing runtime dependencies before any activation', async () => {
  const kernel = new Kernel(grants);
  try {
    await assert.rejects(kernel.start(profile(kernel, process.cwd(), 0, undefined, undefined,
      { 'project-local': false })), { code: 'MISSING_DEPENDENCY' });
    assert.deepEqual(kernel.health(), []);
  } finally { await kernel.close(); }
});

test('runtime registry forwards selected manifests and health; disabled services stay unavailable and LAB discovery stays absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'devlab-runtime-'));
  const kernel = new Kernel(grants);
  try {
    await mkdir(join(root, 'dist'));
    await copyFile(new URL('../dist/architecture.json', import.meta.url), join(root, 'dist/architecture.json'));
    for (const folder of ['_LAB/reference', 'src/_LAB', 'src']) await mkdir(join(root, folder), { recursive: true });
    for (const path of ['_LAB/reference/component.ts', 'src/_LAB/component.ts', 'src/ordinary.ts'])
      await writeFile(join(root, path), 'export const value = 1;');
    const selected = profile(kernel, root, 0, join(root, 'disposable-state'), undefined, {
      'canvas-store': false, 'herdr-runtime': false, 'terminal-pty': false, 'rules-local': false,
      'project-server': false, 'preview-inspector': false,
    });
    await kernel.start(selected);
    const registry = kernel.service('architecture');
    const snapshot = await registry.snapshot();
    assert.deepEqual(snapshot.plugins.map(plugin => plugin.id), selected.map(plugin => plugin.manifest.id));
    assert(snapshot.plugins.every(plugin => plugin.state === 'active' && plugin.generation === 1));
    assert(snapshot.catalog.graph.items.some(item => item.path === 'runtime/registry-router.ts'));
    assert(snapshot.catalog.graph.items.every(item => !item.path?.split('/').includes('_LAB')));
    const artifact = JSON.parse(await readFile(join(root, 'dist/architecture.json'), 'utf8'));
    assert(Object.keys(artifact.sources).every(path => !path.split('/').includes('_LAB')));
    const tree = await kernel.service('projects').inspect('default');
    assert(tree.entries.some(entry => entry.path === 'src/ordinary.ts'));
    assert(tree.entries.every(entry => !entry.path.split('/').includes('_LAB')));
    assert(tree.graph.items.every(item => !item.path?.split('/').includes('_LAB')));
    const origin = kernel.service('http').url;
    assert.equal((await fetch(origin + '/api/architecture')).status, 200);
    assert.equal((await fetch(origin + '/api/projects')).status, 200);
    for (const path of ['/api/terminals?projectId=default', '/api/rules?projectId=default'])
      assert.equal((await fetch(origin + path)).status, 503, path);
    await kernel.close();
    assert.throws(() => registry.snapshot(), { code: 'NOT_READY' });
  } finally {
    await kernel.close();
    await rm(root, { recursive: true, force: true });
  }
});
