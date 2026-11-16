import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Kernel } from '@devlab/kernel';
import { localProjects } from '@devlab/project-local';
import { httpTransport } from '@devlab/transport-http';
import { PreimpSnapshotSchema, RegistrySnapshotSchema, type ProjectCatalog } from '@devlab/contracts';
import type { CanvasWorkspace } from '@devlab/ui-contracts';
import { createProjectWorkspace } from '../plugins/ui-projects/src/workspace.ts';
import { preimpCommand } from '../plugins/project-local/src/preimp.ts';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'devlab-preimp-'));
  for (const [path, text] of Object.entries({
    '.agents/plans/authority.yaml': 'schema_version: 1\ndefinitions: files\n',
    '.agents/ownership/browser/example.yaml': 'schema_version: 1\nid: example\npurpose: Fixture source\ngroup: browser\npaths: [src/**]\npublic: [src/a.ts]\nuses: []\nguidance: []\n',
    'src/a.ts': 'export const value = 1;\n', 'src/b.ts': 'export const other = 1;\n',
  })) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text); }
  const kernel = new Kernel(['workspace:local', 'network:loopback']);
  await kernel.start([localProjects({ root, projectsRoot: join(root, 'projects') }),
    httpTransport({ port: 0, projects: true, diagnostics: () => ({ phase: kernel.phase, plugins: kernel.health() }) })]);
  t.after(async () => { await kernel.close(); await rm(root, { recursive: true, force: true }); });
  const api = kernel.service('projects') as ProjectCatalog;
  const call = async (command: Parameters<NonNullable<ProjectCatalog['preimp']>>[1]) => PreimpSnapshotSchema.parse(await api.preimp!('default', command));
  const create = (paths = ['src/a.ts']) => call({ action: 'create', id: 'feature', title: 'A feature', ownerId: 'example', paths });
  const edit = async (path: string, text: string) => api.write({ projectId: 'default', path, text, expectedHash: (await api.read('default', path)).sha256 });
  return { root, kernel, api, call, create, edit };
}

test('staging, owner/destination graph, reviewed merge and retained recovery originals', async t => {
  const { root, api, call, create, edit } = await fixture(t);
  const initial = await create();
  assert.equal(initial.selected!.status, 'staged');
  assert.equal(await readFile(join(root, 'src/a.ts'), 'utf8'), 'export const value = 1;\n');
  assert.equal(await readFile(join(root, '_preimp/feature/.base/src/a.ts'), 'utf8'), 'export const value = 1;\n');
  const tree = await api.inspect('default');
  assert(tree.graph.edges.some(e => e.source === 'dir:_preimp/feature' && e.target === 'owner:example'));
  assert(tree.graph.edges.some(e => e.source === 'file:_preimp/feature/files/src/a.ts' && e.target === 'file:src/a.ts'));
  assert(!tree.entries.find(e => e.path === '_preimp/feature/task.json')!.editable);
  const registry = RegistrySnapshotSchema.parse({ catalog: { schemaVersion: 1, snapshotId: tree.revision,
    builtAt: tree.scannedAt, graph: tree.graph, channels: [] }, plugins: [], wiring: { items: [], edges: [] } });
  const workspace = createProjectWorkspace({ projects: api, registry: { snapshot: async () => registry } } as unknown as Parameters<typeof createProjectWorkspace>[0],
    () => ({ snapshot: () => ({ dirty: false, saving: false }) } as CanvasWorkspace), { pollMs: 60000 });
  try {
    await workspace.start();
    const graph = (await workspace.sourceClient().snapshot()).catalog.graph;
    assert.equal(graph.edges.length, tree.graph.edges.length, 'live and built registry links must not duplicate edge IDs');
  } finally { workspace.dispose(); }
  await edit('_preimp/feature/files/src/a.ts', 'export const value = 2;\n');
  const review = (await call({ action: 'review', id: 'feature' })).selected!.review!;
  assert.deepEqual(review.conflicts, []);
  assert.equal(review.files[0]!.after, 'export const value = 2;\n');
  assert.equal(review.files[0]!.changed, true);
  const merged = await call({ action: 'promote', id: 'feature', revision: review.revision, evidence: 'Fixture assertion, not a production test claim' });
  assert.equal(merged.selected!.status, 'merged');
  assert.equal(merged.tasks[0]!.status, 'merged');
  assert.equal(await readFile(join(root, 'src/a.ts'), 'utf8'), 'export const value = 2;\n');
  await assert.rejects(edit('_preimp/feature/files/src/a.ts', 'later'), /locked/);
  await assert.rejects(call({ action: 'promote', id: 'feature', revision: review.revision, evidence: 'replay' }), /already merged/);
  assert.equal(JSON.parse(await readFile(join(root, '_preimp/feature/merge.json'), 'utf8')).status, 'merged');
  assert.match((await api.inspect('default')).graph.items.find(i => i.id === 'dir:_preimp/feature')!.detail!, /^merged/);
});

test('incomplete task creation preserves its files without breaking the valid catalog', async t => {
  const { root, call, create } = await fixture(t);
  await writeFile(join(root, 'src/unsupported.png'), 'text in an unsupported file');
  await assert.rejects(create(['src/a.ts', 'src/unsupported.png']), /creation incomplete; preserved/);
  assert.deepEqual((await call({ action: 'list' })).tasks, []);
  assert.equal((await create()).selected!.status, 'staged');
});

test('source conflicts, changed ownership and stale review refuse all writes', async t => {
  const { root, call, create, edit } = await fixture(t);
  await create(['src/a.ts', 'src/b.ts']);
  await edit('_preimp/feature/files/src/a.ts', 'staged');
  const review = (await call({ action: 'review', id: 'feature' })).selected!.review!;
  await edit('_preimp/feature/PLAN.md', '# Updated plan');
  await assert.rejects(call({ action: 'promote', id: 'feature', revision: review.revision, evidence: 'check' }), /stale/);
  await edit('src/b.ts', 'external change');
  const conflict = (await call({ action: 'review', id: 'feature' })).selected!.review!;
  assert.match(conflict.conflicts.join(), /src\/b.ts/);
  await assert.rejects(call({ action: 'promote', id: 'feature', revision: conflict.revision, evidence: 'check' }), /source changed/);
  assert.equal(await readFile(join(root, 'src/a.ts'), 'utf8'), 'export const value = 1;\n');
  await assert.rejects(readFile(join(root, '_preimp/feature/merge.json')), { code: 'ENOENT' });
  const ownership = join(root, '.agents/ownership/browser/example.yaml');
  await writeFile(ownership, (await readFile(ownership, 'utf8')).replace('[src/**]', '[other/**]'));
  await assert.rejects(call({ action: 'review', id: 'feature' }), /canonical owner/);
});

test('no traversal, symlink, cross-owner, protected metadata or duplicate task writes', async t => {
  const { root, api, call, create, edit } = await fixture(t);
  for (const path of ['../outside.ts', '/src/a.ts', 'src/../a.ts', 'src/.env', '_preimp/x.ts', 'src/AGENTS.md', 'other/a.ts', 'src/a.ts\\x'])
    await assert.rejects(create([path]));
  await assert.rejects(call({ action: 'create', id: 'feature', ownerId: 'unknown', title: 'Unknown', paths: ['src/a.ts'] }), /canonical owner/);
  await create();
  await assert.rejects(create(), /already exists/);
  await assert.rejects(edit('_preimp/feature/task.json', '{}'), /read-only/);
  await assert.rejects(api.write({ projectId: 'default', path: '_preimp/feature/files/src/extra.ts', text: 'x', expectedHash: null }), /not registered/);
  await symlink(join(root, 'src/a.ts'), join(root, 'src/alias.ts'));
  await assert.rejects(call({ action: 'create', id: 'alias', title: 'Alias', ownerId: 'example', paths: ['src/alias.ts'] }));
  await symlink(join(root, '_preimp/feature'), join(root, '_preimp/link'));
  await assert.rejects(call({ action: 'list' }), /regular directories/);
});

test('new nested files and interrupted multi-file promotion can be reviewed and resumed', async t => {
  const { root, api, call, create, edit } = await fixture(t);
  await create(['src/a.ts', 'src/new/nested.ts']);
  await edit('_preimp/feature/files/src/a.ts', 'after-a');
  await edit('_preimp/feature/files/src/new/nested.ts', 'after-new');
  const review = (await call({ action: 'review', id: 'feature' })).selected!.review!;
  await assert.rejects(preimpCommand({ root, read: path => api.read('default', path), write: command => {
    if (command.path === 'src/new/nested.ts') throw new Error('simulated disk failure');
    return api.write({ projectId: 'default', ...command });
  } }, { action: 'promote', id: 'feature', revision: review.revision, evidence: 'fault injection' }), /disk failure/);
  assert.equal(await readFile(join(root, 'src/a.ts'), 'utf8'), 'after-a');
  const resumed = (await call({ action: 'review', id: 'feature' })).selected!;
  assert.equal(resumed.status, 'merging'); assert.deepEqual(resumed.review!.conflicts, []);
  await call({ action: 'promote', id: 'feature', revision: resumed.review!.revision, evidence: 'resume' });
  assert.equal(await readFile(join(root, 'src/new/nested.ts'), 'utf8'), 'after-new');
  assert.equal(await readFile(join(root, '_preimp/feature/.base/src/a.ts'), 'utf8'), 'export const value = 1;\n');
});

test('public transport validates task commands, project identity and origins', async t => {
  const { kernel, create } = await fixture(t), url = kernel.service('http').url;
  const post = (path: string, body: unknown, origin = url) => fetch(url + path, { method: 'POST',
    headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });
  const list = await post('/api/projects/default/preimp', { action: 'list' });
  assert.equal(list.status, 200); assert.equal(PreimpSnapshotSchema.parse(await list.json()).owners[0]!.id, 'example');
  assert.equal((await post('/api/projects/default/preimp', { action: 'list', execute: 'bad' })).status, 400);
  assert.equal((await post('/api/projects/default/preimp', { action: 'list' }, 'https://unrelated.invalid')).status, 403);
  assert.notEqual((await post('/api/projects/missing/preimp', { action: 'list' })).status, 200);
  const task = await create();
  const path = `/api/projects/default/preimp/feature/prototype?revision=${task.selected!.prototype.sha256}`;
  const prototype = await fetch(url + path);
  assert.equal(prototype.status, 200);
  assert.match(prototype.headers.get('content-security-policy')!, /sandbox allow-scripts; default-src 'none'/);
  assert.match(prototype.headers.get('content-security-policy')!, /connect-src 'none'/);
  assert.equal((await fetch(url + path + 'stale')).status, 409);
});
