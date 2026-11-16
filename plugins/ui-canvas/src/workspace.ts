import {
  ApplicationError,
  CanvasGraphSchema,
  CanvasDocumentSchema,
  canonicalJson,
  type CanvasGraph,
} from '@devlab/contracts';
import type {
  CanvasClient,
  CanvasWorkspace,
  CanvasWorkspaceState,
} from '@devlab/ui-contracts';

export const agentData = () => ({
  runtimeProfile: 'default',
  provider: 'offline',
  model: 'echo',
  maxTurns: 25,
  maxBudgetUsd: 2,
  temperature: 0.7,
  maxTokens: 4096,
  thinkingLevel: 'off',
  systemPrompt: '',
  tools: [],
});
const defaultGraph = (): CanvasGraph => ({
  name: 'My Agent Flow',
  nodes: [
    {
      id: 'agent-1',
      type: 'piAgent',
      position: { x: 100, y: 100 },
      data: agentData(),
    },
  ],
  edges: [],
});
/** Persisted shape excludes renderer observations, selection and drag state. */
function persisted(graph: CanvasGraph): CanvasGraph {
  const copy = JSON.parse(JSON.stringify(graph)) as CanvasGraph;
  for (const node of copy.nodes) {
    delete node.selected;
    delete node.dragging;
    delete node.measured;
    delete node.resizing;
  }
  for (const edge of copy.edges) delete edge.selected;
  return CanvasGraphSchema.parse(copy);
}

function same(a: unknown, b: unknown): boolean {
  return (
    a === b ||
    (a !== undefined &&
      b !== undefined &&
      canonicalJson(a) === canonicalJson(b))
  );
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
function mergeValue(
  base: unknown,
  local: unknown,
  remote: unknown,
  field = '',
): unknown {
  if (same(local, remote) || same(base, remote)) return local;
  if (same(base, local)) return remote;
  // A drag is one operation, even when both coordinates changed.
  if (field !== 'position' && record(base) && record(local) && record(remote)) {
    const result: Record<string, unknown> = {};
    for (const key of new Set([
      ...Object.keys(base),
      ...Object.keys(local),
      ...Object.keys(remote),
    ])) {
      const value = mergeValue(base[key], local[key], remote[key], key);
      if (value !== undefined) result[key] = value;
    }
    return result;
  }
  throw new ApplicationError(
    'REVISION_CONFLICT',
    'Canvas conflict: overlapping edits are preserved locally. Review your draft before reloading the saved graph.',
  );
}
function mergeEntities<T extends { id: string }>(
  base: T[],
  local: T[],
  remote: T[],
): T[] {
  const previous = new Map(base.map((value) => [value.id, value]));
  const ours = new Map(local.map((value) => [value.id, value]));
  const theirs = new Map(remote.map((value) => [value.id, value]));
  const result: T[] = [];
  for (const id of new Set([...theirs.keys(), ...ours.keys()])) {
    const value = mergeValue(previous.get(id), ours.get(id), theirs.get(id));
    if (value !== undefined) result.push(value as T);
  }
  return result;
}
function mergeGraphs(
  base: CanvasGraph,
  local: CanvasGraph,
  remote: CanvasGraph,
): CanvasGraph {
  const metadata = (graph: CanvasGraph) =>
    Object.fromEntries(
      Object.entries(graph).filter(
        ([key]) => !['nodes', 'edges', 'viewport'].includes(key),
      ),
    );
  const viewport = same(base.viewport, local.viewport)
    ? remote.viewport
    : local.viewport;
  const result = {
    ...(mergeValue(metadata(base), metadata(local), metadata(remote)) as Record<
      string,
      unknown
    >),
    nodes: mergeEntities(base.nodes, local.nodes, remote.nodes),
    edges: mergeEntities(base.edges, local.edges, remote.edges),
    // Viewing the canvas is not an overlapping content edit.
    ...(viewport ? { viewport } : {}),
  };
  return CanvasGraphSchema.parse(result);
}
function retainObservations(
  graph: CanvasGraph,
  current: CanvasGraph,
): CanvasGraph {
  const originals = new Map(current.nodes.map((node) => [node.id, node]));
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const original = originals.get(node.id);
      const observations = Object.fromEntries(
        ['selected', 'dragging', 'measured', 'resizing']
          .filter((key) => original && key in original)
          .map((key) => [key, original![key]]),
      );
      return { ...node, ...observations };
    }),
  };
}

/** One editing owner, independent of view mounts. Serial saves drain newer edits. */
export function createCanvasWorkspace(
  client: CanvasClient,
  projectId = 'default',
  options: { autosaveMs?: number; syncMs?: number; events?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> } = {},
): CanvasWorkspace {
  const listeners = new Set<() => void>();
  let state: CanvasWorkspaceState = {
    projectId,
    graph: defaultGraph(),
    revision: 0,
    selectedNodeId: null,
    dirty: false,
    loading: true,
    saving: false,
    error: '',
    canUndo: false,
    canRedo: false,
  };
  let past: CanvasGraph[] = [],
    future: CanvasGraph[] = [],
    saved = '';
  let savedGraph = persisted(state.graph);
  let disposed = false,
    loadGeneration = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | null = null;
  let syncTimer: ReturnType<typeof setTimeout> | undefined;
  const publish = (patch: Partial<CanvasWorkspaceState>) => {
    if (disposed) return;
    state = {
      ...state,
      ...patch,
      canUndo: past.length > 0,
      canRedo: future.length > 0,
    };
    for (const listener of listeners) listener();
  };
  const schedule = () => {
    clearTimeout(timer);
    if (!disposed && !state.loading && state.dirty && !state.error)
      timer = setTimeout(() => void save(), options.autosaveMs ?? 500);
  };
  function scheduleSync() {
    if (disposed || !listeners.size || syncTimer) return;
    syncTimer = setTimeout(
      async () => {
        syncTimer = undefined;
        try {
          if (!state.loading && !state.saving && !state.dirty && !state.error) {
            const generation = loadGeneration,
              revision = state.revision;
            const value = await client.load(projectId);
            if (
              !disposed &&
              listeners.size &&
              generation === loadGeneration &&
              revision === state.revision &&
              !state.loading &&
              !state.saving &&
              !state.dirty &&
              !state.error &&
              value
            ) {
              const doc = CanvasDocumentSchema.parse(value);
              if (doc.projectId === projectId && doc.revision > revision) {
                savedGraph = doc.graph;
                saved = canonicalJson(doc.graph);
                past = [];
                future = [];
                publish({
                  graph: retainObservations(doc.graph, state.graph),
                  revision: doc.revision,
                  selectedNodeId: doc.graph.nodes.some(
                    (node) => node.id === state.selectedNodeId,
                  )
                    ? state.selectedNodeId
                    : null,
                });
              }
            }
          }
        } catch {
          /* Keep the last good document; foreground saves report errors. */
        } finally {
          scheduleSync();
        }
      },
      Math.max(5, options.syncMs ?? 1500),
    );
  }
  function update(input: CanvasGraph) {
    if (disposed) return;
    if (state.loading)
      throw new Error('Wait for the saved graph to load before editing');
    const graph = CanvasGraphSchema.parse(JSON.parse(JSON.stringify(input)));
    if (canonicalJson(graph) === canonicalJson(state.graph)) return;
    const next = canonicalJson(persisted(graph));
    if (next !== canonicalJson(persisted(state.graph))) {
      past = [...past.slice(-49), state.graph];
      future = [];
    }
    publish({
      graph,
      dirty: next !== saved,
      selectedNodeId: graph.nodes.some((n) => n.id === state.selectedNodeId)
        ? state.selectedNodeId
        : null,
    });
    schedule();
  }
  function arrange(all = false) {
    const graph = state.graph, chosen = graph.nodes.filter(node => all || node.selected === true);
    if (state.loading || chosen.length < 2 || chosen.some(node => node.parentId)) return;
    const size = (node: typeof chosen[number]) => {
      const measured = record(node.measured) ? node.measured : {};
      const dimension = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
      return { width: dimension(measured.width, dimension(node.data.width, node.type === 'terminal' ? 380 : 300)),
        height: dimension(measured.height, dimension(node.data.height, 220)) };
    };
    const chosenIds = new Set(chosen.map(node => node.id));
    const occupied = graph.nodes.filter(node => !chosenIds.has(node.id)).map(node => ({ ...node.position, ...size(node) }));
    const positions = new Map<string, { x: number; y: number }>();
    const left = Math.min(...chosen.map(node => node.position.x));
    let x = left, y = Math.min(...chosen.map(node => node.position.y)), rowHeight = 0;
    chosen.forEach((node, index) => {
      if (index && index % 3 === 0) { x = left; y += rowHeight + 24; rowHeight = 0; }
      const box = { x, y, ...size(node) };
      // Unselected nodes stay fixed; place this rectangle after any occupied space.
      for (;;) {
        const collision = occupied.find(other => box.x < other.x + other.width + 24 && box.x + box.width + 24 > other.x &&
          box.y < other.y + other.height + 24 && box.y + box.height + 24 > other.y);
        if (!collision) break;
        box.x = collision.x + collision.width + 24;
      }
      positions.set(node.id, { x: box.x, y: box.y }); occupied.push(box);
      x = box.x + box.width + 24; rowHeight = Math.max(rowHeight, box.height);
    });
    update({ ...graph, nodes: graph.nodes.map(node => positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node) });
  }
  async function save(): Promise<void> {
    clearTimeout(timer);
    if (disposed || state.loading) return;
    if (inFlight) {
      await inFlight;
      if (state.dirty && !state.error && !disposed && !state.loading)
        await save();
      return;
    }
    if (!state.dirty) return;
    const graph = persisted(state.graph),
      expectedRevision = state.revision;
    publish({ saving: true, error: '' });
    inFlight = (async () => {
      try {
        let candidate = graph,
          revision = expectedRevision,
          ancestor = savedGraph;
        let doc;
        for (let attempt = 0; ; attempt++) {
          try {
            doc = CanvasDocumentSchema.parse(
              await client.save({
                projectId,
                expectedRevision: revision,
                graph: candidate,
              }),
            );
            break;
          } catch (error) {
            if (
              !(error instanceof ApplicationError) ||
              error.code !== 'REVISION_CONFLICT' ||
              attempt >= 2
            )
              throw error;
            const value = await client.load(projectId);
            if (!value) throw error;
            const latest = CanvasDocumentSchema.parse(value);
            if (latest.projectId !== projectId || latest.revision <= revision)
              throw error;
            candidate = mergeGraphs(ancestor, candidate, latest.graph);
            ancestor = latest.graph;
            revision = latest.revision;
          }
        }
        if (doc.projectId !== projectId || doc.revision !== revision + 1)
          throw new Error(
            'Save response does not match the active graph revision',
          );
        if (disposed) return;
        saved = canonicalJson(doc.graph);
        savedGraph = doc.graph;
        // Old snapshots must not undo another window's merged changes.
        if (revision !== expectedRevision) {
          past = [];
          future = [];
        }
        publish({ revision: doc.revision });
        const next = mergeGraphs(graph, persisted(state.graph), doc.graph);
        publish({
          graph: retainObservations(next, state.graph),
          revision: doc.revision,
          dirty: canonicalJson(next) !== saved,
          selectedNodeId: next.nodes.some(
            (node) => node.id === state.selectedNodeId,
          )
            ? state.selectedNodeId
            : null,
        });
      } catch (error) {
        publish({
          error: error instanceof Error ? error.message : String(error),
          dirty: true,
        });
      } finally {
        publish({ saving: false });
      }
    })();
    await inFlight;
    inFlight = null;
    if (state.dirty && !state.error && !disposed && !state.loading)
      await save();
  }
  async function reload(): Promise<void> {
    if (disposed) return;
    clearTimeout(timer);
    const generation = ++loadGeneration;
    publish({ loading: true, error: '' });
    if (inFlight) await inFlight;
    try {
      const value = await client.load(projectId);
      const doc = value === null ? null : CanvasDocumentSchema.parse(value);
      if (doc && doc.projectId !== projectId)
        throw new Error('Loaded graph belongs to another project');
      if (disposed || generation !== loadGeneration) return;
      past = [];
      future = [];
      saved = doc ? canonicalJson(doc.graph) : '';
      savedGraph = doc?.graph ?? defaultGraph();
      publish({
        graph: doc?.graph ?? defaultGraph(),
        revision: doc?.revision ?? 0,
        selectedNodeId: null,
        dirty: !doc,
        loading: false,
        error: '',
      });
      schedule();
    } catch (error) {
      if (generation === loadGeneration)
        publish({
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
    }
  }
  function history(undo: boolean) {
    if (disposed || state.loading) return;
    const from = undo ? past : future,
      next = from.pop();
    if (!next) return;
    if (undo) future.push(state.graph);
    else past.push(state.graph);
    publish({
      graph: next,
      dirty: canonicalJson(persisted(next)) !== saved,
      selectedNodeId: null,
    });
    schedule();
  }
  const events = options.events ?? (typeof window === 'undefined' ? undefined : window);
  const beforeUnload = (event: Event) => {
    if (state.dirty) { event.preventDefault();
      if (typeof (event as BeforeUnloadEvent).returnValue === 'string') (event as BeforeUnloadEvent).returnValue = ''; }
  };
  events?.addEventListener('beforeunload', beforeUnload);
  return {
    subscribe(listener) {
      listeners.add(listener);
      scheduleSync();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          clearTimeout(syncTimer);
          syncTimer = undefined;
        }
      };
    },
    snapshot: () => state,
    update,
    arrange,
    select(id) {
      if (id !== state.selectedNodeId)
        publish({
          selectedNodeId:
            id && state.graph.nodes.some((n) => n.id === id) ? id : null,
        });
    },
    undo: () => history(true),
    redo: () => history(false),
    save,
    reload,
    dispose() {
      events?.removeEventListener('beforeunload', beforeUnload);
      disposed = true;
      clearTimeout(timer);
      clearTimeout(syncTimer);
      listeners.clear();
    },
  };
}
