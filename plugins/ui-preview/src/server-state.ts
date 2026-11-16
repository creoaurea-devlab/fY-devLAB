import type {
  ProjectWorkspace,
  PreviewSourceTarget,
} from '@devlab/ui-contracts';
import { ProjectRelativePathSchema } from '@devlab/contracts';
import type {
  PreviewPaneSpec,
  PreviewTarget,
  PreviewWorkspace,
} from './workspace.ts';
import type { ProjectServers, ProjectServerState } from '@devlab/contracts';
export interface PreviewServerSnapshot {
  state: ProjectServerState | null;
  working: '' | 'start' | 'stop';
  error: string;
}
export interface PreviewServerOwner {
  snapshot(projectId: string): PreviewServerSnapshot;
  subscribe(projectId: string, listener: () => void): () => void;
  refresh(projectId: string): Promise<void>;
  command(projectId: string, action: 'start' | 'stop'): Promise<void>;
  dispose(): void;
}
type Entry = {
  value: PreviewServerSnapshot;
  listeners: Set<() => void>;
  version: number;
  timer: ReturnType<typeof setTimeout> | null;
  poll: Promise<void> | null;
  pending: Map<'start' | 'stop', Promise<void>>;
};
/** Shared observations/pending intents only. Disposal never stops a project server. */
export function createPreviewServerOwner(
  api: ProjectServers | undefined,
  intervalMs = 1000,
): PreviewServerOwner {
  const entries = new Map<string, Entry>();
  let closed = false;
  const entry = (id: string) => {
    let item = entries.get(id);
    if (!item) {
      item = {
        value: Object.freeze({
          state: null,
          working: '',
          error: api ? '' : 'Project server capability is unavailable.',
        }),
        listeners: new Set(),
        version: 0,
        timer: null,
        poll: null,
        pending: new Map(),
      };
      entries.set(id, item);
    }
    return item;
  };
  function update(e: Entry, patch: Partial<PreviewServerSnapshot>) {
    e.value = Object.freeze({ ...e.value, ...patch });
    for (const listener of e.listeners) listener();
  }
  function schedule(id: string, e: Entry) {
    if (closed || !api || !e.listeners.size || e.timer || e.value.working)
      return;
    e.timer = setTimeout(() => {
      e.timer = null;
      void owner.refresh(id).catch(() => {});
    }, intervalMs);
  }
  const owner: PreviewServerOwner = {
    snapshot(id) {
      return entry(id).value;
    },
    subscribe(id, listener) {
      if (closed) throw new Error('Preview server observer is disposed.');
      const e = entry(id);
      e.listeners.add(listener);
      if (e.listeners.size === 1) void owner.refresh(id).catch(() => {});
      return () => {
        e.listeners.delete(listener);
        if (!e.listeners.size) {
          if (e.timer) clearTimeout(e.timer);
          e.timer = null;
        }
      };
    },
    refresh(id) {
      const e = entry(id);
      if (closed || !api || e.value.working) return Promise.resolve();
      if (e.poll) return e.poll;
      const version = e.version;
      const pending = Promise.resolve()
        .then(() => api.inspect(id))
        .then((value) => {
          if (value.projectId !== id)
            throw new Error('Server response belongs to a different project.');
          if (!closed && version === e.version)
            update(e, { state: value, error: '' });
        })
        .catch((error) => {
          if (!closed && version === e.version)
            update(e, {
              error: error instanceof Error ? error.message : String(error),
            });
          throw error;
        })
        .finally(() => {
          if (e.poll === pending) e.poll = null;
          schedule(id, e);
        });
      e.poll = pending;
      return pending;
    },
    command(id, action) {
      if (closed || !api)
        return Promise.reject(
          new Error('Project server capability is unavailable.'),
        );
      const e = entry(id),
        existing = e.pending.get(action);
      if (existing) return existing;
      if (e.value.working === 'stop' && action === 'start')
        return Promise.reject(
          new Error('Wait for this project to finish stopping.'),
        );
      const version = ++e.version;
      if (e.timer) clearTimeout(e.timer);
      e.timer = null;
      update(e, { working: action, error: '' });
      const pending = Promise.resolve()
        .then(() => api[action](id))
        .then((value) => {
          if (value.projectId !== id)
            throw new Error('Server response belongs to a different project.');
          if (!closed && version === e.version)
            update(e, { state: value, error: '' });
        })
        .catch((error) => {
          if (!closed && version === e.version)
            update(e, {
              error: error instanceof Error ? error.message : String(error),
            });
          throw error;
        })
        .finally(() => {
          if (e.pending.get(action) === pending) e.pending.delete(action);
          if (!closed && version === e.version) update(e, { working: '' });
          schedule(id, e);
        });
      e.pending.set(action, pending);
      return pending;
    },
    dispose() {
      closed = true;
      for (const e of entries.values()) {
        e.version++;
        if (e.timer) clearTimeout(e.timer);
        e.timer = null;
        e.listeners.clear();
      }
    },
  };
  return owner;
}
const hot = import.meta.hot;
const shared: WeakMap<ProjectServers, PreviewServerOwner> =
  hot?.data.previewServers ?? new WeakMap();
if (hot) hot.data.previewServers = shared;
const unavailable = createPreviewServerOwner(undefined);
/** Same api instance shares observers through compatible view refresh. */
export function previewServerOwner(
  api: ProjectServers | undefined,
): PreviewServerOwner {
  if (!api) return unavailable;
  let owner = shared.get(api);
  if (!owner) {
    owner = createPreviewServerOwner(api);
    shared.set(api, owner);
  }
  return owner;
}

export interface PreviewSourceFence extends PreviewTarget {
  instanceId?: string;
  generation?: number;
}
export function previewSourceFence(
  pane: PreviewPaneSpec,
  state: ProjectServerState | null,
): PreviewSourceFence {
  return {
    paneId: pane.paneId,
    projectId: pane.projectId,
    targetRevision: pane.targetRevision,
    instanceId: state?.instanceId,
    generation: state?.generation,
  };
}
/** Source navigation is explicit and must still target the active pane/server. */
export function acceptsPreviewSource(
  workspace: PreviewWorkspace,
  servers: PreviewServerOwner,
  target: PreviewSourceFence,
  path: string,
): boolean {
  const actual = servers.snapshot(target.projectId).state;
  return (
    path !== '.' &&
    ProjectRelativePathSchema.safeParse(path).success &&
    workspace.isCurrentTarget(target) &&
    actual?.projectId === target.projectId &&
    actual.status === 'ready' &&
    actual.instanceId === target.instanceId &&
    actual.generation === target.generation
  );
}

/** Recheck both owners after every asynchronous boundary before opening source. */
export async function openPreviewSource(
  workspace: PreviewWorkspace,
  editor: Pick<ProjectWorkspace, 'select' | 'snapshot' | 'openFile'>,
  servers: Pick<ProjectServers, 'inspect'>,
  target: PreviewSourceTarget,
): Promise<void> {
  if (
    !ProjectRelativePathSchema.safeParse(target.path).success ||
    target.path === '.'
  )
    throw new Error('Source path is not a project-relative file.');
  const captured = workspace.captureTarget(target.paneId);
  if (
    captured.projectId !== target.projectId ||
    captured.targetRevision !== target.targetRevision ||
    !workspace.isCurrentTarget(captured)
  )
    throw new Error('Preview source target is no longer current.');
  const current = () =>
    workspace.isCurrentTarget(captured) &&
    editor.snapshot().projectId === target.projectId;
  if (await editor.select(target.projectId) === false)
    throw new Error('Preview source navigation was superseded.');
  if (!current())
    throw new Error('Preview target changed before source navigation.');
  const server = await servers.inspect(target.projectId);
  if (
    !current() ||
    server.status !== 'ready' ||
    server.generation !== target.generation ||
    server.instanceId !== target.instanceId
  )
    throw new Error(
      'Preview project or server changed before source navigation.',
    );
  await editor.openFile(target.path);
}
