import { loadPreferences } from './preferences.ts';
import type {
  PreviewPaneSpec,
  PreviewGroup,
  PreviewWorkspaceState,
  PreviewWorkspace,
} from '@devlab/ui-contracts';
export type {
  PreviewViewport,
  PreviewPaneSpec,
  PreviewGroup,
  PreviewTarget,
  PreviewSourceTarget,
  PreviewWorkspaceState,
  PreviewWorkspace,
} from '@devlab/ui-contracts';
export interface PreviewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
type StoredGroup = Omit<PreviewGroup, 'panes'> & {
  panes: Omit<PreviewPaneSpec, 'targetRevision'>[];
};
type Stored = {
  version: 1;
  groups: StoredGroup[];
  groupId: string;
  activePaneId: string;
};
const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const viewPattern = /^(?:[a-z][a-z0-9-]{0,63})?$/;
const viewports: readonly string[] = ['fit', 'desktop', 'mobile'];
function need(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function label(value: string) {
  need(
    typeof value === 'string' &&
      value.trim().length > 0 &&
      value.trim().length <= 80,
    'Use a group name from 1 to 80 characters.',
  );
  return value.trim();
}
function ratios(columns: number, rows: number) {
  need(
    [columns, rows].every((n) => Number.isFinite(n) && n >= 0.2 && n <= 0.8),
    'Split ratios must be between 20% and 80%.',
  );
}
function fields(value: object, keys: readonly string[]) {
  need(
    Object.keys(value).every((key) => keys.includes(key)),
    'Unknown preview preference field.',
  );
}
function validate(raw: unknown): Stored {
  need(raw && typeof raw === 'object', 'Invalid preview preferences.');
  const x = raw as Stored;
  fields(x, ['version', 'groups', 'groupId', 'activePaneId']);
  need(x.version === 1, 'Unknown preview preference version.');
  need(
    Array.isArray(x.groups) && x.groups.length >= 1 && x.groups.length <= 20,
    'Preview groups must contain 1–20 entries.',
  );
  const groups = new Set<string>(),
    panes = new Set<string>();
  let current = 0;
  for (const group of x.groups) {
    need(group && typeof group === 'object', 'Invalid preview group.');
    fields(group, ['id', 'name', 'kind', 'panes', 'columns', 'rows']);
    need(
      typeof group.id === 'string' &&
        idPattern.test(group.id) &&
        !groups.has(group.id),
      'Duplicate or invalid group ID.',
    );
    groups.add(group.id);
    label(group.name);
    need(
      group.kind === 'current' || group.kind === 'named',
      'Unknown preview group kind.',
    );
    if (group.kind === 'current') {
      current++;
      need(
        group.id === 'current' && group.panes.length === 1,
        'Current project group must have one pane.',
      );
    }
    need(
      Array.isArray(group.panes) &&
        group.panes.length >= 1 &&
        group.panes.length <= 4,
      'Use between one and four panes.',
    );
    ratios(group.columns, group.rows);
    const assignments = new Set<string>();
    for (const pane of group.panes) {
      need(pane && typeof pane === 'object', 'Invalid pane.');
      fields(pane, ['paneId', 'projectId', 'viewId', 'viewport']);
      need(
        typeof pane.paneId === 'string' &&
          idPattern.test(pane.paneId) &&
          !panes.has(pane.paneId),
        'Duplicate or invalid pane ID.',
      );
      panes.add(pane.paneId);
      need(
        typeof pane.projectId === 'string' && idPattern.test(pane.projectId),
        'Invalid project identity.',
      );
      need(
        typeof pane.viewId === 'string' && viewPattern.test(pane.viewId),
        'Invalid preview view.',
      );
      need(viewports.includes(pane.viewport), 'Unknown viewport.');
      const assignment = pane.projectId + '\0' + pane.viewId;
      need(
        !assignments.has(assignment),
        'Each project/view appears only once per group.',
      );
      assignments.add(assignment);
    }
  }
  need(current === 1, 'Exactly one Current project group is required.');
  const active = x.groups.find((group) => group.id === x.groupId);
  need(active, 'Unknown active preview group.');
  need(
    active.panes.some((pane) => pane.paneId === x.activePaneId),
    'Unknown active preview pane.',
  );
  return x;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
function defaultStorage(): PreviewStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
/** Owns presentation only. Project/editor/server/PTY lifetimes belong elsewhere. */
export function createPreviewWorkspace(
  options: {
    workspaceIdentity?: string;
    projectId?: string;
    paneId?: string;
    storage?: PreviewStorage | null;
    id?: () => string;
    events?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  } = {},
): PreviewWorkspace {
  const listeners = new Set<() => void>(),
    storage =
      options.storage === undefined ? defaultStorage() : options.storage;
  const newId = options.id ?? (() => crypto.randomUUID());
  let stopStorage = () => {};
  let closed = false,
    epoch = 0,
    key = '',
    pendingStorage: string | null | undefined;
  let state: PreviewWorkspaceState = freeze({
    revision: 0,
    groups: [],
    groupId: 'current',
    activePaneId: '',
    projects: [],
    editorProjectId: options.projectId ?? 'default',
    expandedPaneId: null,
    expandedMode: null,
    persistence: 'memory',
    persistenceMessage:
      'Layout is kept in memory until its workspace identity is known.',
    error: '',
  });
  function pane(projectId: string, viewId?: string): PreviewPaneSpec {
    const pref = loadPreferences(projectId);
    return {
      paneId: 'pane-' + newId(),
      projectId,
      viewId: viewId ?? pref.view,
      viewport: pref.viewport,
      targetRevision: ++epoch,
    };
  }
  const first = pane(state.editorProjectId);
  if (options.paneId) {
    need(idPattern.test(options.paneId), 'Invalid initial native pane ID.');
    first.paneId = options.paneId;
  }
  state = freeze({
    ...state,
    groups: [
      {
        id: 'current',
        name: 'Current project',
        kind: 'current',
        panes: [first],
        columns: 0.5,
        rows: 0.5,
      },
    ],
    activePaneId: first.paneId,
  });
  function emit(next: PreviewWorkspaceState) {
    state = freeze(next);
    for (const listener of listeners) listener();
  }
  function stored(value = state): Stored {
    return {
      version: 1,
      groupId: value.groupId,
      activePaneId: value.activePaneId,
      groups: value.groups.map((group) => ({
        ...group,
        panes: group.panes.map(({ paneId, projectId, viewId, viewport }) => ({
          paneId,
          projectId,
          viewId,
          viewport,
        })),
      })),
    };
  }
  function save(next: PreviewWorkspaceState): PreviewWorkspaceState {
    if (next.persistence === 'invalid') return next;
    if (!key) return { ...next, persistence: 'memory' };
    if (!storage)
      return {
        ...next,
        persistence: 'unavailable',
        persistenceMessage:
          'Storage is disabled. Layout changes remain in memory.',
      };
    try {
      storage.setItem(key, JSON.stringify(stored(next)));
      return { ...next, persistence: 'saved', persistenceMessage: '' };
    } catch {
      return {
        ...next,
        persistence: 'unavailable',
        persistenceMessage:
          'Layout could not be saved. Current controls remain usable in memory.',
      };
    }
  }
  function edit(action: (next: PreviewWorkspaceState) => void, persist = true) {
    need(!closed, 'Preview workspace is disposed.');
    need(
      !state.expandedPaneId,
      'Exit fullscreen or maximize before changing the split or group.',
    );
    const next = structuredClone(state);
    action(next);
    validate(stored(next));
    next.revision++;
    next.error = '';
    emit(persist ? save(next) : next);
  }
  function group(next = state): PreviewGroup {
    const value = next.groups.find((item) => item.id === next.groupId);
    need(value, 'Preview group no longer exists.');
    return value;
  }
  function editable(next: PreviewWorkspaceState): PreviewGroup {
    const active = group(next);
    if (active.kind === 'named') return active;
    const replacement: PreviewGroup = {
      ...active,
      id: 'group-' + newId(),
      name: 'Preview set',
      kind: 'named',
    };
    const currentPane = pane(next.editorProjectId),
      current: PreviewGroup = {
        id: 'current',
        name: 'Current project',
        kind: 'current',
        panes: [currentPane],
        columns: 0.5,
        rows: 0.5,
      };
    next.groups = [
      current,
      ...next.groups.filter((item) => item.id !== 'current'),
      replacement,
    ];
    next.groupId = replacement.id;
    return replacement;
  }
  function put(next: PreviewWorkspaceState, value: PreviewGroup) {
    next.groups = next.groups.map((item) =>
      item.id === value.id ? value : item,
    );
  }
  function known(projectId: string) {
    need(
      state.projects.some((p) => p.id === projectId && p.available !== false),
      'Choose an available opened project.',
    );
  }
  function assign(
    next: PreviewWorkspaceState,
    paneId: string,
    projectId: string,
    viewId: string,
  ) {
    const active = editable(next);
    need(
      active.panes.some((item) => item.paneId === paneId),
      'Preview pane no longer exists.',
    );
    put(next, {
      ...active,
      panes: active.panes.map((item) =>
        item.paneId === paneId
          ? { ...item, projectId, viewId, targetRevision: ++epoch }
          : item,
      ),
    });
  }
  function hydrate(raw: string | null) {
    try {
      if (raw === null) {
        emit({
          ...state,
          persistence: storage ? 'saved' : 'unavailable',
          persistenceMessage: storage
            ? ''
            : 'Storage is disabled. Layout changes remain in memory.',
        });
        return;
      }
      need(raw.length <= 131072, 'Preview preferences are too large.');
      const value = validate(JSON.parse(raw));
      const groups = value.groups.map((item) => ({
        ...item,
        panes: item.panes.map((p) => ({ ...p, targetRevision: ++epoch })),
      }));
      const current = groups.find((item) => item.kind === 'current')!;
      current.panes = [
        {
          ...current.panes[0]!,
          projectId: state.editorProjectId,
          targetRevision: ++epoch,
        },
      ];
      emit({
        ...state,
        groups,
        groupId: value.groupId,
        activePaneId: value.activePaneId,
        expandedPaneId: null,
        expandedMode: null,
        revision: state.revision + 1,
        persistence: 'saved',
        persistenceMessage: '',
        error: '',
      });
    } catch (error) {
      emit({
        ...state,
        persistence: 'invalid',
        persistenceMessage:
          'Stored layout is invalid or from an unknown version. Its original bytes are preserved; changes stay in memory.',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const api: PreviewWorkspace = {
    subscribe(listener) {
      need(!closed, 'Preview workspace is disposed.');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => state,
    syncProjects(projects, editorProjectId, identity) {
      need(!closed, 'Preview workspace is disposed.');
      need(idPattern.test(editorProjectId), 'Invalid editor project identity.');
      if (
        identity &&
        'devlab.preview-workspace.v1:' + encodeURIComponent(identity) !== key
      )
        need(
          !state.expandedPaneId,
          'Exit fullscreen before changing workspace identity.',
        );
      const current = state.groups.find((item) => item.kind === 'current')!;
      const changed = current.panes[0]!.projectId !== editorProjectId;
      emit({
        ...state,
        projects: structuredClone([...projects]),
        editorProjectId,
        groups: changed
          ? state.groups.map((item) =>
              item.kind === 'current'
                ? {
                    ...item,
                    panes: [
                      {
                        ...pane(editorProjectId),
                        paneId: item.panes[0]!.paneId,
                      },
                    ],
                  }
                : item,
            )
          : state.groups,
        revision: state.revision + 1,
      });
      if (identity) {
        const nextKey =
          'devlab.preview-workspace.v1:' + encodeURIComponent(identity);
        if (nextKey !== key) {
          need(
            !state.expandedPaneId,
            'Exit fullscreen before changing workspace identity.',
          );
          if (key) {
            const fresh = pane(editorProjectId);
            emit({
              ...state,
              groups: [
                {
                  id: 'current',
                  name: 'Current project',
                  kind: 'current',
                  panes: [fresh],
                  columns: 0.5,
                  rows: 0.5,
                },
              ],
              groupId: 'current',
              activePaneId: fresh.paneId,
              persistence: 'memory',
              persistenceMessage: '',
              error: '',
            });
            pendingStorage = undefined;
          }
          key = nextKey;
          let raw: string | null = null;
          try {
            raw = storage?.getItem(key) ?? null;
          } catch {
            emit({
              ...state,
              persistence: 'unavailable',
              persistenceMessage:
                'Storage is disabled. Layout changes remain in memory.',
            });
            return;
          }
          hydrate(raw);
        }
      }
    },
    createGroup(name, projectIds = [state.editorProjectId]) {
      const ids = [...projectIds];
      ids.forEach(known);
      const id = 'group-' + newId();
      edit((next) => {
        const panes = ids.map((projectId) => pane(projectId));
        next.groups = [
          ...next.groups,
          {
            id,
            name: label(name),
            kind: 'named',
            panes,
            columns: 0.5,
            rows: 0.5,
          },
        ];
        next.groupId = id;
        next.activePaneId = panes[0]?.paneId ?? '';
      });
      return id;
    },
    renameGroup(id, name) {
      edit((next) => {
        const value = next.groups.find((item) => item.id === id);
        need(
          value && value.kind === 'named',
          'Only named preview groups can be renamed.',
        );
        put(next, { ...value, name: label(name) });
      });
    },
    deleteGroup(id) {
      edit((next) => {
        const value = next.groups.find((item) => item.id === id);
        need(
          value && value.kind === 'named',
          'The Current project group cannot be deleted.',
        );
        next.groups = next.groups.filter((item) => item.id !== id);
        if (next.groupId === id) {
          next.groupId = 'current';
          next.activePaneId = group(next).panes[0]!.paneId;
        }
      });
    },
    selectGroup(id) {
      edit((next) => {
        const value = next.groups.find((item) => item.id === id);
        need(value, 'Preview group no longer exists.');
        next.groupId = id;
        put(next, {
          ...value,
          panes: value.panes.map((item) => ({
            ...item,
            targetRevision: ++epoch,
          })),
        });
        next.activePaneId = group(next).panes[0]!.paneId;
      });
    },
    setPaneCount(count) {
      need(
        Number.isInteger(count) && count >= 1 && count <= 4,
        'Choose one to four preview panes.',
      );
      edit((next) => {
        let active = group(next);
        if (active.panes.length === count) return;
        active = editable(next);
        let panes = [...active.panes];
        if (count < panes.length) panes = panes.slice(0, count);
        else {
          const choices = state.projects.filter(
            (p) =>
              p.available !== false &&
              !panes.some((item) => item.projectId === p.id),
          );
          need(
            choices.length >= count - panes.length,
            'Open enough distinct projects before adding more preview panes.',
          );
          panes.push(
            ...choices
              .slice(0, count - panes.length)
              .map((item) => pane(item.id)),
          );
        }
        put(next, { ...active, panes });
        if (!panes.some((p) => p.paneId === next.activePaneId))
          next.activePaneId = panes[0]!.paneId;
      });
    },
    addPane(projectId, viewId = '') {
      known(projectId);
      const value = pane(projectId, viewId);
      edit((next) => {
        const active = editable(next);
        put(next, { ...active, panes: [...active.panes, value] });
        next.activePaneId = value.paneId;
      });
      return value.paneId;
    },
    removePane(paneId) {
      edit((next) => {
        const active = editable(next);
        need(
          active.panes.some((p) => p.paneId === paneId),
          'Preview pane no longer exists.',
        );
        need(active.panes.length > 1, 'Keep at least one preview pane.');
        const panes = active.panes.filter((p) => p.paneId !== paneId);
        put(next, { ...active, panes });
        if (next.activePaneId === paneId) next.activePaneId = panes[0]!.paneId;
      });
    },
    assignPane(paneId, projectId, viewId = '') {
      known(projectId);
      edit((next) => assign(next, paneId, projectId, viewId));
    },
    updatePane(paneId, patch) {
      edit((next) => {
        const active = group(next);
        need(
          active.panes.some((p) => p.paneId === paneId),
          'Preview pane no longer exists.',
        );
        put(next, {
          ...active,
          panes: active.panes.map((p) =>
            p.paneId === paneId
              ? {
                  ...p,
                  ...patch,
                  targetRevision:
                    patch.viewId !== undefined && patch.viewId !== p.viewId
                      ? ++epoch
                      : p.targetRevision,
                }
              : p,
          ),
        });
      });
    },
    reorderPane(paneId, index) {
      edit((next) => {
        const active = editable(next),
          panes = [...active.panes],
          from = panes.findIndex((p) => p.paneId === paneId);
        need(
          from >= 0 &&
            Number.isInteger(index) &&
            index >= 0 &&
            index < panes.length,
          'Invalid pane position.',
        );
        const [moved] = panes.splice(from, 1);
        panes.splice(index, 0, moved!);
        put(next, { ...active, panes });
      });
    },
    setRatios(columns, rows) {
      ratios(columns, rows);
      edit((next) => put(next, { ...group(next), columns, rows }));
    },
    selectPane(paneId) {
      need(!closed, 'Preview workspace is disposed.');
      need(
        group().panes.some((p) => p.paneId === paneId),
        'Preview pane no longer exists.',
      );
      emit(save({ ...state, activePaneId: paneId }));
    },
    setExpanded(paneId, mode = 'native') {
      need(!closed, 'Preview workspace is disposed.');
      if (paneId) {
        need(
          group().panes.some((p) => p.paneId === paneId),
          'Preview pane no longer exists.',
        );
        emit({
          ...state,
          expandedPaneId: paneId,
          expandedMode: mode,
          error: '',
        });
      } else {
        emit({ ...state, expandedPaneId: null, expandedMode: null });
        if (pendingStorage !== undefined) {
          const raw = pendingStorage;
          pendingStorage = undefined;
          hydrate(raw);
        }
      }
    },
    captureTarget(paneId) {
      const p = group().panes.find((item) => item.paneId === paneId);
      need(p, 'Preview pane no longer exists.');
      return {
        paneId: p.paneId,
        projectId: p.projectId,
        targetRevision: p.targetRevision,
      };
    },
    isCurrentTarget(target) {
      return (
        !closed &&
        group().panes.some(
          (p) =>
            p.paneId === target.paneId &&
            p.projectId === target.projectId &&
            p.targetRevision === target.targetRevision,
        ) &&
        state.projects.some(
          (p) => p.id === target.projectId && p.available !== false,
        )
      );
    },
    acceptStorage(raw) {
      need(!closed, 'Preview workspace is disposed.');
      if (state.expandedPaneId) {
        pendingStorage = raw;
        emit({
          ...state,
          persistenceMessage:
            'Another layout arrived. Exit fullscreen to apply it.',
        });
      } else hydrate(raw);
    },
    dispose() {
      stopStorage();
      closed = true;
      listeners.clear();
    },
  };
  const events =
    options.events ?? (typeof window === 'undefined' ? undefined : window);
  if (storage && events) {
    const receive = (event: Event) => {
      const changed = event as StorageEvent;
      if (
        changed.key === key &&
        (!changed.storageArea || changed.storageArea === storage)
      )
        api.acceptStorage(changed.newValue);
    };
    events.addEventListener('storage', receive);
    stopStorage = () => events.removeEventListener('storage', receive);
  }
  if (options.workspaceIdentity)
    api.syncProjects([], state.editorProjectId, options.workspaceIdentity);
  return api;
}
