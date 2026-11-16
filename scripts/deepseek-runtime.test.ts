import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogue } from '../runtime/deepseek/catalogue.ts';
import { DeepSeekRuntime, CORE_PACKAGES } from '../runtime/deepseek/adapter.ts';
import { routeDeepSeekRegistry, federateRegistry, deepSeekRegistryClient } from '../runtime/deepseek/registry-router.ts';
import { RegistrySnapshotSchema, type RegistryMap } from '@devlab/contracts';

const source = process.env.DEVLAB_DEEPSEEK_SOURCE;
const release = process.env.DEVLAB_DEEPSEEK_RELEASE;
if (!source || !release) throw new Error('Run the upstream integration lane with explicit DEVLAB_DEEPSEEK_SOURCE and DEVLAB_DEEPSEEK_RELEASE');
const packages = await catalogue(source, release);

test('all pinned workspace packages are accounted for with platform, license and installation facts', () => {
  assert.equal(packages.length, 403); assert.equal(new Set(packages.map(row => row.id)).size, 403);
  assert.equal(packages.filter(row => row.private).length, 6);
  assert(packages.every(row => /^[a-f0-9]{64}$/.test(row.sourceHash)));
  assert(packages.filter(row => row.platform && !row.private).every(row => row.installed));
  assert(packages.some(row => !row.platform)); assert(packages.every(row => row.license.length > 0));
});

test('unchanged native services activate, disable, rewind and restore persisted selection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-selection-test-'));
  let runtime = new DeepSeekRuntime({ packages, release: release!, directory });
  try {
    await runtime.start(); const before = await runtime.inventory();
    for (const id of CORE_PACKAGES) assert.equal(before.entries.find(entry => entry.module === id)?.state, 'active', id);
    const saved = await runtime.configure(before.revision, '@deepseek-ai/dsh-tools', false, {});
    assert.equal(saved.entries.find(entry => entry.module === '@deepseek-ai/dsh-tools')?.state, 'disabled');
    await assert.rejects(runtime.configure(before.revision, '@deepseek-ai/dsh-tools', true, {}), { code: 'CONFLICT' });
    const undone = await runtime.rewind(saved.revision);
    assert.equal(undone.entries.find(entry => entry.module === '@deepseek-ai/dsh-tools')?.state, 'active');
    const disabled = await runtime.configure(undone.revision, '@deepseek-ai/dsh-tools', false, {});
    assert(disabled.entries.some(entry => entry.state === 'pending'));
    await runtime.close(); runtime = new DeepSeekRuntime({ packages, release: release!, directory }); await runtime.start();
    assert.equal((await runtime.inventory()).entries.find(entry => entry.module === '@deepseek-ai/dsh-tools')?.state, 'disabled');
    const persisted = JSON.parse(await readFile(join(directory, 'selection.json'), 'utf8')); assert.equal(persisted.selection.find((row: any) => row.id === '@deepseek-ai/dsh-tools').enabled, false);
  } finally { await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});

test('unknown packages and executable config expressions are refused; real isolated probe proves on/off and cleanup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-probe-test-'));
  const runtime = new DeepSeekRuntime({ packages, release: release!, directory });
  try {
    await runtime.start(); const before = await runtime.inventory();
    await assert.rejects(runtime.configure(before.revision, 'node:fs', true, {}), { code: 'INVALID_INPUT' });
    await assert.rejects(runtime.configure(before.revision, '@deepseek-ai/dsh-tools', true, { __jsExpr: 'process.exit()' }), { code: 'INVALID_INPUT' });
    const measured = await runtime.probe('@deepseek-ai/dsh-tools');
    assert.equal(measured.outcome, 'active'); assert.equal(measured.off, true); assert.equal(measured.on, true); assert.equal(measured.cleanup, true);
    const unavailable = await runtime.probe(packages.find(row => !row.platform)!.id);
    assert.equal(unavailable.outcome, 'unavailable'); assert.equal(unavailable.on, false);
    assert.equal((await runtime.inventory()).revision, before.revision, 'probes must not change the live selection');
  } finally { await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});

test('registry router exposes every package; federation preserves host graph, namespaces and failure visibility', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-registry-test-'));
  const runtime = new DeepSeekRuntime({ packages, release: release!, directory });
  try {
    await runtime.start(); const foreign = routeDeepSeekRegistry(await runtime.inventory());
    assert.equal(foreign.catalog.graph.items.filter(item => item.id.startsWith('deepseek:package:')).length, 403);
    const base = RegistrySnapshotSchema.parse({ catalog: { schemaVersion: 1, snapshotId: 'a'.repeat(64), builtAt: new Date().toISOString(), graph: { items: [{ id: 'host', kind: 'group', parentId: null, label: 'Host', detail: 'Retained host graph' }], edges: [] }, channels: [] }, plugins: [], wiring: { items: [], edges: [] } });
    const unchanged = JSON.stringify(base);
    const main: RegistryMap = { snapshot: () => base, source: () => { throw Error('No source'); }, projects: async () => [{ id: 'workspace', label: 'Host' }] };
    const upstream = { snapshot: async () => foreign, source: async () => { throw Error('Read only'); }, projects: async () => [{ id: 'deepseek-runtime', label: 'DeepSeek Harness Runtime', previewUrl: 'http://127.0.0.1:4340' }] };
    const merged = federateRegistry(main, upstream);
    assert.equal((await merged.snapshot()).catalog.graph.items.length, foreign.catalog.graph.items.length + 1);
    assert.equal((await merged.snapshot('deepseek-runtime')).catalog.snapshotId, foreign.catalog.snapshotId);
    assert.equal((await merged.projects!()).length, 2); assert.equal(JSON.stringify(base), unchanged);
    const offline = federateRegistry(main, { ...upstream, snapshot: async () => { throw Error('Offline'); } });
    assert.equal((await offline.snapshot()).observation?.status, 'stale');
    assert.throws(() => deepSeekRegistryClient('https://example.com'), { code: 'INVALID_INPUT' });
    assert.throws(() => deepSeekRegistryClient('http://user:secret@127.0.0.1:4340'), { code: 'INVALID_INPUT' });
  } finally { await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});
