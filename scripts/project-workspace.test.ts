import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectWorkspace } from '../plugins/ui-projects/src/workspace.ts';
import { createCanvasWorkspace } from '../plugins/ui-canvas/src/workspace.ts';
import type { ApplicationClient, CanvasWorkspace } from '@devlab/ui-contracts';
import { RegistrySnapshotSchema, type Project, type ProjectService, type RegistrySnapshot } from '@devlab/contracts';

function fixture(remove: () => Promise<void> = async () => {}, registry?: RegistrySnapshot, initialProjectId?: string,
  initialView: { initialMode?: 'flow' | 'build'; initialOutput?: 'terminal' | 'servers' } = {}) {
  const projects: Project[] = [
    { id: 'default', label: 'Original', base: true, location: '/fixture' },
    { id: 'thread', label: 'Development', base: false, location: '/fixture/projects/thread', development: {
      sourceProjectId: 'default', pluginId: 'fixture', ownerId: 'fixture', sourcePath: 'plugins/fixture', createdAt: new Date().toISOString(),
    } },
  ];
  const events: string[] = [];
  const canvases = new Map<string, CanvasWorkspace>();
  const canvas = (id: string) => {
    if (!canvases.has(id)) canvases.set(id, { snapshot: () => ({ dirty: false, saving: false }), save: async () => {} } as CanvasWorkspace);
    return canvases.get(id)!;
  };
  const api = {
    create: async () => { throw new Error('Fixture does not create projects'); },
    createModule: async () => { throw new Error('Fixture does not create modules'); },
    list: async () => [...projects],
    inspect: async (id: string) => ({ project: projects.find(project => project.id === id)!, revision: 'a'.repeat(64), scannedAt: new Date().toISOString(),
      entries: ['a.ts', 'b.ts'].map(path => ({ path, kind: 'file' as const, editable: true, bytes: 5 })),
      graph: { items: [{ id: 'file:a.ts', parentId: null, kind: 'file', label: 'a.ts', path: 'a.ts', detail: '' }], edges: [] } }),
    read: async (_id: string, path: string) => ({ path, text: 'saved', sha256: 'b'.repeat(64) }),
    write: async (command: { path: string; text: string }) => ({ ...command, sha256: 'c'.repeat(64) }),
    deleteThread: async (id: string) => { events.push('delete:' + id); await remove(); projects.splice(projects.findIndex(project => project.id === id), 1); },
  } as ProjectService;
  const owner = createProjectWorkspace({ projects: api, registry: registry ? { snapshot: async () => registry } : undefined,
    servers: { stop: async (id: string) => { events.push('stop:' + id); } } } as unknown as ApplicationClient, canvas, { pollMs: 60000, initialProjectId, ...initialView });
  return { owner, events, canvas };
}

test('latest navigation cancels a delayed save, including reselecting the current project', async () => {
  const { owner, canvas } = fixture();
  let finish!: () => void;
  try {
    await owner.start();
    canvas('default').save = () => new Promise<void>(resolve => { finish = resolve; });
    const initial = owner.navigationRevision!();
    const old = owner.select('thread');
    assert.equal(await owner.select('default'), true);
    assert.equal(owner.snapshot().busy, true, 'old save still pending');
    finish();
    assert.equal(await old, false);
    assert.equal(owner.snapshot().projectId, 'default');
    assert.equal(owner.snapshot().busy, false);
    assert.equal(await owner.select('thread', initial), false, 'late startup/development callback refused');
    assert.equal(owner.snapshot().projectId, 'default');
  } finally { finish?.(); owner.dispose(); }
});

test('reload bookmark exists before rendering and applies only to its project', async () => {
  const { owner } = fixture(undefined, undefined, 'thread', { initialMode: 'flow', initialOutput: 'terminal' });
  try {
    assert.equal(owner.snapshot().projectId, 'thread');
    assert.equal(owner.snapshot().mode, 'flow');
    assert.equal(owner.snapshot().output, 'terminal');
    await owner.start();
    assert.equal(owner.snapshot().output, 'terminal');
    await owner.select('default');
    assert.equal(owner.snapshot().output, null);
    await owner.select('thread');
    assert.equal(owner.snapshot().output, 'terminal');
    owner.setMode('build');
    assert.equal(owner.snapshot().output, null, 'an explicit later surface choice wins');
  } finally { owner.dispose(); }
});

test('stale save failure cannot replace current error and current failure retains drafts', async () => {
  const { owner, canvas } = fixture(); let fail!: (e: Error) => void;
  try {
    await owner.start(); owner.newFile('draft.ts'); owner.changeText('keep me');
    canvas('default').save = () => new Promise<void>((_resolve, reject) => { fail = reject; });
    const old = owner.select('thread'); await owner.select('default');
    fail(new Error('Old save failed')); assert.equal(await old, false);
    assert.equal(owner.snapshot().error, '');
    canvas('default').save = async () => { throw new Error('Current save failed'); };
    await assert.rejects(owner.select('thread'), /Current save failed/);
    assert.equal(owner.snapshot().projectId, 'default');
    assert.equal(owner.snapshot().editor?.text, 'keep me');
    assert.equal(owner.snapshot().busy, false);
  } finally { owner.dispose(); }
});

test('output selection belongs to each project and opening a file returns to Build', async () => {
  const { owner } = fixture();
  try {
    await owner.start(); owner.setOutput!('terminal');
    await owner.select('thread'); owner.setMode('flow');
    assert.equal(owner.snapshot().output, null);
    await owner.select('default'); assert.equal(owner.snapshot().output, 'terminal');
    await owner.openFile('a.ts'); assert.equal(owner.snapshot().output, null);
    assert.equal(owner.snapshot().mode, 'build');
  } finally { owner.dispose(); }
});

test('arrangement preserves connections, viewport, obstacles and one-step undo', async () => {
  const workspace = createCanvasWorkspace({ load: async () => null, save: async () => { throw new Error('No persistence in this probe'); } }, 'layout', { autosaveMs: 60000 });
  try {
    await workspace.reload();
    const graph = { name: 'Mixed sizes', viewport: { x: 10, y: 20, zoom: .5 }, nodes: [
      { id: 'a', type: 'terminal', selected: true, position: { x: 0, y: 0 }, data: { width: 500, height: 280 } },
      { id: 'b', type: 'terminal', selected: true, position: { x: 900, y: 0 }, data: { width: 700, height: 350 } },
      { id: 'fixed', type: 'terminal', position: { x: 524, y: 0 }, data: { width: 300, height: 220 } },
    ], edges: [{ id: 'edge', source: 'a', target: 'b' }] };
    workspace.update(graph); const baseline = workspace.snapshot().graph; workspace.arrange!();
    const arranged = workspace.snapshot().graph;
    assert.equal(arranged.nodes[0]!.position.x, 0);
    assert(arranged.nodes[1]!.position.x >= 848);
    assert.deepEqual(arranged.nodes[2], baseline.nodes[2]);
    assert.deepEqual(arranged.edges, graph.edges); assert.deepEqual(arranged.viewport, graph.viewport);
    workspace.arrange!(); assert.deepEqual(workspace.snapshot().graph, arranged);
    workspace.undo(); assert.deepEqual(workspace.snapshot().graph, baseline);
  } finally { workspace.dispose(); }
});

test('thread deletion rejects hidden cached drafts and preserves unrelated project drafts', async () => {
  const { owner, events, canvas } = fixture();
  try {
    await owner.start();
    await owner.openFile('a.ts'); owner.changeText('original draft'); owner.closeEditor();
    await owner.select('thread');
    await owner.openFile('a.ts'); owner.changeText('thread draft');
    await owner.openFile('b.ts'); owner.closeEditor();
    assert.equal(owner.hasUnsavedDrafts?.('thread'), true);
    await assert.rejects(owner.deleteThread('thread'), /unsaved/);
    assert.deepEqual(events, []);
    await owner.openFile('a.ts'); assert.equal(owner.snapshot().editor?.text, 'thread draft');
    await owner.saveFile();
    assert.equal(owner.hasUnsavedDrafts?.('thread'), false);
    await owner.deleteThread('thread');
    assert.deepEqual(events, ['stop:thread', 'delete:thread']);
    assert.equal(owner.snapshot().projectId, 'default');
    assert.equal(owner.snapshot().workspace, canvas('default'));
    assert.deepEqual(owner.snapshot().projects.map(project => project.id), ['default']);
    assert.equal(owner.hasUnsavedDrafts?.('default'), true);
    await owner.openFile('a.ts'); assert.equal(owner.snapshot().editor?.text, 'original draft');
  } finally { owner.dispose(); }
});

test('build graph keeps dependency roots valid when host ownership layers are outside the project', async () => {
  const registry = RegistrySnapshotSchema.parse({
    catalog: { schemaVersion: 1, snapshotId: 'd'.repeat(64), builtAt: new Date().toISOString(), channels: [], graph: {
      items: [
        { id: 'layer:installed', parentId: null, kind: 'group', label: 'Installed', detail: '' },
        { id: 'group:external', parentId: 'layer:installed', kind: 'group', label: 'Dependencies', detail: '' },
        { id: 'external:react', parentId: 'group:external', kind: 'external', label: 'react', detail: '' },
        { id: 'file:a.ts', parentId: null, kind: 'file', label: 'a.ts', path: 'a.ts', detail: '' },
        { id: 'symbol:a', parentId: 'file:a.ts', kind: 'symbol', label: 'a', detail: '' },
      ],
      edges: [{ id: 'imports-react', source: 'file:a.ts', target: 'external:react', kind: 'import', label: 'react', evidence: [] }],
    } }, plugins: [], wiring: { items: [], edges: [] },
  });
  const original = JSON.stringify(registry);
  const { owner } = fixture(undefined, registry);
  try {
    await owner.start();
    const graph = (await owner.sourceClient().snapshot()).catalog.graph;
    assert.equal(graph.items.find(item => item.id === 'group:external')?.parentId, null);
    assert.equal(graph.items.find(item => item.id === 'external:react')?.parentId, 'group:external');
    assert.equal(graph.items.find(item => item.id === 'symbol:a')?.parentId, 'file:a.ts');
    assert(!graph.items.some(item => item.id === 'layer:installed'), 'host layers do not become project files');
    assert.deepEqual(graph.edges, registry.catalog.graph.edges);
    assert.equal(JSON.stringify(registry), original, 'project projection must not change the host snapshot');
  } finally { owner.dispose(); }
});

test('rejected backend deletion retains selected thread, editor, and canvas identity', async () => {
  const { owner, events, canvas } = fixture(async () => { throw new Error('Active terminal'); });
  try {
    await owner.start(); await owner.select('thread'); await owner.openFile('a.ts');
    const editor = owner.snapshot().editor;
    await assert.rejects(owner.deleteThread('thread'), /Active terminal/);
    assert.equal(owner.snapshot().projectId, 'thread');
    assert.equal(owner.snapshot().editor, editor);
    assert.equal(owner.snapshot().workspace, canvas('thread'));
    assert.equal(owner.snapshot().busy, false);
    assert.deepEqual(events, ['stop:thread', 'delete:thread']);
    owner.changeText('retained after failure'); assert.equal(owner.snapshot().editor?.text, 'retained after failure');
  } finally { owner.dispose(); }
});

test('pending deletion rejects duplicates and project selection races', async () => {
  let release!: () => void;
  const { owner, events } = fixture(() => new Promise<void>(resolve => { release = resolve; }));
  try {
    await owner.start(); await owner.select('thread');
    const deleting = owner.deleteThread('thread');
    await assert.rejects(owner.deleteThread('thread'), /current project action/);
    await assert.rejects(owner.select('default'), /in progress/);
    await Promise.resolve();
    assert.deepEqual(events, ['stop:thread', 'delete:thread']);
    owner.newFile('racing.ts'); assert.equal(owner.snapshot().editor, null);
    release(); await deleting;
    assert.equal(owner.snapshot().projectId, 'default');
  } finally { owner.dispose(); }
});

test('original projects cannot be deleted through the thread command', async () => {
  const { owner, events } = fixture();
  try {
    await owner.start(); await assert.rejects(owner.deleteThread('default'), /development thread/);
    assert.deepEqual(events, []);
  } finally { owner.dispose(); }
});

test('duplicate new-file requests cannot replace active, cached or cross-project drafts', async () => {
  const { owner } = fixture();
  try {
    await owner.start();
    await owner.openFile('a.ts'); owner.changeText('active draft');
    const active = owner.snapshot().editor;
    assert.throws(() => owner.newFile('a.ts'), /already exists/);
    assert.equal(owner.snapshot().editor, active);
    owner.closeEditor();
    assert.throws(() => owner.newFile('a.ts'), /already exists/);
    await owner.openFile('a.ts'); assert.equal(owner.snapshot().editor?.text, 'active draft');
    owner.newFile('new.ts'); owner.changeText('new unsaved draft'); owner.closeEditor();
    assert.throws(() => owner.newFile('new.ts'), /already exists/);
    await owner.openFile('new.ts'); assert.equal(owner.snapshot().editor?.text, 'new unsaved draft');
    await owner.select('thread'); owner.newFile('new.ts'); owner.changeText('thread draft');
    await owner.select('default'); await owner.openFile('new.ts');
    assert.equal(owner.snapshot().editor?.text, 'new unsaved draft');
  } finally { owner.dispose(); }
});


test('initial project identity exists before loading and retains early surface selection', async () => {
  const { owner } = fixture(undefined, undefined, 'thread');
  try {
    assert.equal(owner.snapshot().projectId, 'thread');
    owner.setOutput!('terminal');
    await owner.start();
    assert.equal(owner.snapshot().projectId, 'thread');
    assert.equal(owner.snapshot().output, 'terminal');
  } finally { owner.dispose(); }
});


test('explicit surface selection supersedes delayed project navigation', async () => {
  const { owner, canvas } = fixture(); let finish!: () => void;
  try {
    await owner.start();
    canvas('default').save = () => new Promise<void>(resolve => { finish = resolve; });
    const pending = owner.select('thread');
    owner.setOutput!('terminal');
    finish(); assert.equal(await pending, false);
    assert.equal(owner.snapshot().projectId, 'default');
    assert.equal(owner.snapshot().output, 'terminal');
  } finally { finish?.(); owner.dispose(); }
});
