import { profile, grants } from '../runtime/index.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Kernel } from '@devlab/kernel';
import { localProjects } from '@devlab/project-local';
import { httpTransport } from '@devlab/transport-http';
import { type PluginDefinition, type RuntimeInventory, type ProjectCatalog } from '@devlab/contracts';
import { runtimeControl, readRuntimeSelection } from '../runtime/plugins/control.ts';
import { workspaceSearch } from '../runtime/plugins/workspace-search.ts';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'runtime-plugins-test-'));
  await mkdir(join(root, 'src')); await mkdir(join(root, '_LAB'));
  await writeFile(join(root, 'src/example.ts'), 'const needle = 1;\nconst other = needle + 1;\n');
  await writeFile(join(root, '_LAB/hidden.ts'), 'needle');
  const file = join(root, 'state/runtime.json'), kernel = new Kernel(['storage:local', 'workspace:local', 'network:loopback']);
  let definitions: PluginDefinition[] = [];
  const defaults = { 'project-local': true, 'runtime-control': true, 'workspace-search': true, 'transport-http': true };
  definitions = [localProjects({ root, projectsRoot: join(root, 'projects') }),
    runtimeControl({ file, defaults, catalog: flags => definitions.map(item => item.manifest.id === 'transport-http'
      ? httpTransport({ port: 0, projects: true, runtime: true, search: flags?.['workspace-search'] !== false, diagnostics: () => ({ phase: kernel.phase, plugins: kernel.health() }) }).manifest
      : item.manifest), running: () => definitions.map(item => item.manifest), health: () => kernel.health() }),
    workspaceSearch(), httpTransport({ port: 0, projects: true, runtime: true, search: true, diagnostics: () => ({ phase: kernel.phase, plugins: kernel.health() }) })];
  await kernel.start(definitions);
  return { root, file, kernel, control: kernel.service('runtimeControl'), search: kernel.service('workspaceSearch'),
    origin: kernel.service('http').url, async close() { await kernel.close(); await rm(root, { recursive: true, force: true }); } };
}

test('saved selection differs from live health, rejects stale writers and rewinds without touching running services', async () => {
  const f = await fixture();
  try {
    const before = await f.control.inspect();
    assert(before.plugins.every(plugin => plugin.state === 'active' && plugin.enabled));
    const saved = await f.control.configure({ expectedRevision: before.revision, changes: { 'workspace-search': false } });
    assert.equal(saved.restartRequired, true); assert.equal(saved.canRewind, true);
    assert.equal(saved.plugins.find(plugin => plugin.id === 'workspace-search')?.running, true);
    assert.equal((await f.search.search({ projectId: 'default', query: 'needle' })).matches.length, 2);
    await assert.rejects(f.control.configure({ expectedRevision: before.revision, changes: {} }), { code: 'CONFLICT' });
    assert.equal((await readRuntimeSelection(f.file))['workspace-search'], false);
    const undone = await f.control.rewind({ expectedRevision: saved.revision });
    assert.equal(undone.restartRequired, false); assert.equal(undone.canRewind, false);
    await assert.rejects(f.control.rewind({ expectedRevision: undone.revision }), { code: 'CONFLICT' });
    assert.equal(f.kernel.health().length, 4);
  } finally { await f.close(); }
});

test('unknown plugins, self-disable, dependencies and external settings locks are refused without a settings change', async () => {
  const f = await fixture();
  try {
    const before = await f.control.inspect();
    for (const changes of ([{ unknown: false }, { 'runtime-control': false }, { 'project-local': false }] as Record<string, boolean>[]))
      await assert.rejects(f.control.configure({ expectedRevision: before.revision, changes }));
    assert.equal((await f.control.inspect()).revision, before.revision);
    await mkdir(join(f.root, 'state'), { recursive: true }); await writeFile(f.file + '.lock', 'another writer');
    await assert.rejects(f.control.configure({ expectedRevision: before.revision, changes: {} }), { code: 'CONFLICT' });
    assert.equal(await readFile(f.file + '.lock', 'utf8'), 'another writer');
  } finally { await f.close(); }
});

test('two simultaneous configuration saves have one winner and diagnostics retain only bounded metadata', async () => {
  const f = await fixture();
  try {
    const before = await f.control.inspect();
    const saves = await Promise.allSettled([true, false].map(enabled => f.control.configure({ expectedRevision: before.revision, changes: { 'workspace-search': enabled } })));
    assert.equal(saves.filter(result => result.status === 'fulfilled').length, 1);
    for (let i = 0; i < 110; i++) f.control.record({ at: new Date().toISOString(), operation: 'workspace-search', outcome: 'ok', durationMs: i, matches: 1 });
    const snapshot = await f.control.inspect(); assert.equal(snapshot.diagnostics.length, 100);
    assert.deepEqual(Object.keys(snapshot.diagnostics[0]!).sort(), ['at', 'durationMs', 'matches', 'operation', 'outcome']);
    assert(!JSON.stringify(snapshot.diagnostics).includes('needle'));
  } finally { await f.close(); }
});

test('read-only search is literal, bounded, excludes LAB, rejects unknown projects and supports cancellation/disposal', async () => {
  const f = await fixture();
  try {
    const before = await readFile(join(f.root, 'src/example.ts'), 'utf8');
    const result = await f.search.search({ projectId: 'default', query: 'NEEDLE', maxResults: 1 });
    assert.equal(result.matches.length, 1); assert.equal(result.truncated, true);
    assert.equal(result.matches[0]?.path, 'src/example.ts');
    assert.equal((await f.search.search({ projectId: 'default', query: '.*' })).matches.length, 0);
    await assert.rejects(f.search.search({ projectId: 'missing', query: 'needle' }));
    const abort = new AbortController(); abort.abort();
    await assert.rejects(f.search.search({ projectId: 'default', query: 'needle' }, abort.signal), { code: 'CANCELLED' });
    assert.equal(await readFile(join(f.root, 'src/example.ts'), 'utf8'), before);
    await f.kernel.close();
    await assert.rejects(f.search.search({ projectId: 'default', query: 'needle' }), { code: 'NOT_READY' });
    await assert.rejects(f.control.inspect(), { code: 'NOT_READY' });
  } finally { await f.close(); }
});

test('HTTP mutation validation, origin refusal, settings rewind and project search use public services', async () => {
  const f = await fixture();
  const post = (path: string, body: unknown, origin?: string) => fetch(f.origin + path, { method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
  try {
    const inventory = await (await fetch(f.origin + '/api/runtime')).json() as RuntimeInventory;
    assert.equal((await post('/api/runtime/selection', { expectedRevision: inventory.revision, changes: { 'workspace-search': false } }, 'http://evil.invalid')).status, 403);
    const response = await post('/api/runtime/selection', { expectedRevision: inventory.revision, changes: { 'workspace-search': false } });
    assert.equal(response.status, 200);
    const saved = await response.json() as RuntimeInventory;
    assert.equal((await post('/api/runtime/rewind', { expectedRevision: saved.revision })).status, 200);
    const matches = await post('/api/runtime/search', { projectId: 'default', query: 'needle' });
    assert.equal(matches.status, 200); assert.equal((await matches.json()).matches.length, 2);
    assert.equal((await post('/api/runtime/search', { projectId: 'default', query: '' })).status, 400);
    assert.equal((await post('/api/runtime/selection', { expectedRevision: saved.revision, changes: {} })).status, 409);
  } finally { await f.close(); }
});

test('settings startup refuses symlinked parents/finals and malformed state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-settings-refusal-'));
  try {
    await mkdir(join(root, 'ordinary')); await writeFile(join(root, 'ordinary/settings.json'), '{"selection":{},"previous":null}');
    await symlink(join(root, 'ordinary'), join(root, 'alias'));
    await assert.rejects(readRuntimeSelection(join(root, 'alias/settings.json')), { code: 'PATH_DENIED' });
    await symlink(join(root, 'ordinary/settings.json'), join(root, 'linked.json'));
    await assert.rejects(readRuntimeSelection(join(root, 'linked.json')));
    await writeFile(join(root, 'bad.json'), '{"selection":{"unknown":"false"},"previous":null}');
    await assert.rejects(readRuntimeSelection(join(root, 'bad.json')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('search limits concurrency and shutdown aborts work while awaiting the existing project owner', async () => {
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const kernel = new Kernel(['workspace:local']);
  const records: string[] = []; let count = 0;
  const provider: PluginDefinition = { manifest: { id: 'fixture', version: '1', apiVersion: 1,
    provides: ['projects', 'runtimeControl'], requires: [], capabilities: [], reload: 'restart' }, activate(scope) {
    scope.provide('projects', { inspect: async () => { if (++count === 4) entered(); await waiting; return { entries: [] }; } } as unknown as ProjectCatalog);
    scope.provide('runtimeControl', { record: (event: import('@devlab/contracts').RuntimeDiagnostic) => records.push(event.outcome) } as unknown as import('@devlab/contracts').RuntimeControl);
  } };
  try {
    await kernel.start([provider, workspaceSearch()]);
    const api = kernel.service('workspaceSearch');
    const results = Array.from({ length: 4 }, () => api.search({ projectId: 'default', query: 'x' }));
    const refused = Promise.all(results.map(result => assert.rejects(result, { code: 'CANCELLED' }))); await started;
    await assert.rejects(api.search({ projectId: 'default', query: 'x' }), { code: 'NOT_READY' });
    let closed = false; const closing = kernel.close().then(() => { closed = true; });
    await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(closed, false);
    release(); await refused; await closing; assert.deepEqual(records, Array(4).fill('cancelled'));
  } finally { release(); await kernel.close(); }
});


test('saved switches take effect on the next kernel startup while live selection stays intact until shutdown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-restart-test-'));
  const data = join(root, 'state'), file = join(data, 'runtime-plugins.json');
  const initial = { 'herdr-runtime': false, 'terminal-pty': false, 'rules-local': false, 'project-server': false,
    'preview-inspector': false, 'canvas-store': false, 'registry-map': false };
  let kernel = new Kernel(grants);
  try {
    await mkdir(data); await writeFile(file, JSON.stringify({ selection: initial, previous: null }));
    await kernel.start(profile(kernel, root, 0, data, undefined, await readRuntimeSelection(file)));
    const before = await kernel.service('runtimeControl').inspect();
    assert.equal(before.restartRequired, false);
    await kernel.service('runtimeControl').configure({ expectedRevision: before.revision, changes: { 'workspace-search': false } });
    assert(kernel.health().some(plugin => plugin.id === 'workspace-search'));
    await kernel.close(); kernel = new Kernel(grants);
    await kernel.start(profile(kernel, root, 0, data, undefined, await readRuntimeSelection(file)));
    assert(!kernel.health().some(plugin => plugin.id === 'workspace-search'));
    const after = await kernel.service('runtimeControl').inspect();
    assert.equal(after.restartRequired, false);
    assert.equal(after.plugins.find(plugin => plugin.id === 'workspace-search')?.state, 'disabled');
    const response = await fetch(kernel.service('http').url + '/api/runtime/search', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'default', query: 'x' }) });
    assert.equal(response.status, 503);
  } finally { await kernel.close(); await rm(root, { recursive: true, force: true }); }
});
