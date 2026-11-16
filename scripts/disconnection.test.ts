import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kernel } from '@devlab/kernel';
import { client } from '@devlab/client';
import { grants, profile } from '../src/profile.ts';

test('DevLab starts without planning or execution and retired endpoints are absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'devlab-disconnected-'));
  const kernel = new Kernel(grants);
  try {
    const definitions = profile(kernel, root, 0, join(root, '.data'));
    const removed = new Set(['planning', 'harness', 'runs', 'model', 'tools', 'policy', 'store', 'wisdom']);
    for (const plugin of definitions) {
      for (const key of [...plugin.manifest.provides, ...plugin.manifest.requires, ...(plugin.manifest.live ?? [])]) {
        assert.equal(removed.has(key), false, `${plugin.manifest.id} still wires ${key}`);
      }
    }
    await mkdir(join(root, 'dist'));
    await copyFile(new URL('../dist/architecture.json', import.meta.url), join(root, 'dist/architecture.json'));
    await kernel.start(definitions);
    const origin = kernel.service('http').url;
    const health = await fetch(`${origin}/api/health`);
    assert.equal(health.status, 200);
    for (const [method, path] of [
      ['GET', '/api/planning/workspace?projectId=default'],
      ['GET', '/api/harness/activity'], ['GET', '/api/runs'],
      ['POST', '/api/projects/default/wisdom/plan'], ['POST', '/api/harness/start'], ['POST', '/api/runs'], ['POST', '/api/model'],
    ]) {
      const response = await fetch(origin + path, { method, ...(method === 'POST' ? {
        headers: { 'content-type': 'application/json' }, body: '{}',
      } : {}) });
      assert.equal(response.status, 404, `${method} ${path}`);
      assert.equal((await response.json()).code, 'NOT_FOUND');
    }
    assert.equal((await fetch(`${origin}/api/projects`)).status, 200);
    const terminals = await fetch(`${origin}/api/terminals?projectId=default`);
    assert.equal(terminals.status, 200);
    assert.deepEqual(await terminals.json(), []);
    for (const key of ['planning', 'harness', 'list', 'start', 'cancel', 'resume', 'replaceModel', 'wisdom']) {
      assert.equal(key in client, false, `Browser client still exposes ${key}`);
    }
  } finally {
    await kernel.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('active UI catalog and dependencies omit extracted contributions', async () => {
  const catalog = await readFile(new URL('../src/contributions.ts', import.meta.url), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  for (const name of ['ui-whiteboard', 'ui-kanban', 'ui-spec', 'ui-runtime', 'ui-diagnostics', 'planning-local', 'run-controller', 'wisdom-tool']) {
    assert.equal(catalog.includes(`@devlab/${name}`), false);
    assert.equal(`@devlab/${name}` in manifest.dependencies, false);
  }
});
