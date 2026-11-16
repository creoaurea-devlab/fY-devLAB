import {
  RegistrySnapshotSchema,
  type RegistrySnapshot,
  type RegistryClient,
  type RegistryEvent,
  type ProjectTree,
} from '@devlab/contracts';
import type {
  ApplicationClient,
  CanvasWorkspace,
  ProjectEditorState,
  ProjectWorkspace,
  ProjectWorkspaceState,
} from '@devlab/ui-contracts';

/** Owns project identity/drafts; filesystem and canvas implementations are injected. */
export function createProjectWorkspace(
  client: ApplicationClient,
  getCanvas: (id: string) => CanvasWorkspace,
  options: { initialProjectId?: string; initialMode?: 'flow' | 'build'; initialOutput?: 'terminal' | 'servers' | 'herdr'; pollMs?: number; events?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> } = {},
): ProjectWorkspace {
  if (!client.projects) throw new Error('Projects adapter is unavailable');
  const api = client.projects;
  const listeners = new Set<() => void>(),
    sourceListeners = new Map<string, Set<(event: RegistryEvent) => void>>();
  const cache = new Map<
    string,
    {
      tree: ProjectTree | null;
      hood?: RegistrySnapshot;
      seq: number;
      mode: 'flow' | 'build';
      output: 'terminal' | 'servers' | 'herdr' | null;
      showFiles: boolean;
      editor: ProjectEditorState | null;
    }
  >();
  const sourceClients = new Map<string, RegistryClient>(),
    drafts = new Map<string, ProjectEditorState>();
  const entry = (id: string) => {
    let value = cache.get(id);
    if (!value) {
      value = {
        tree: null,
        seq: 0,
        mode: id === initialProjectId && options.initialMode ? options.initialMode : id === 'default' ? 'flow' : 'build',
        output: id === initialProjectId ? options.initialOutput ?? null : null,
        showFiles: false,
        editor: null,
      };
      cache.set(id, value);
    }
    return value;
  };
  const initialProjectId = options.initialProjectId ?? 'default';
  let state: ProjectWorkspaceState = {
    projects: [],
    projectId: initialProjectId,
    tree: null,
    workspace: getCanvas(initialProjectId),
    mode: entry(initialProjectId).mode,
    output: entry(initialProjectId).output,
    showFiles: false,
    busy: false,
    error: '',
    editor: null,
  };
  const hasUnsavedDrafts = (projectId?: string) => Boolean(
    (!projectId || projectId === state.projectId) && state.editor?.dirty ||
    [...drafts].some(([key, draft]) => (!projectId || key.startsWith(projectId + ':')) && draft.dirty) ||
    [...cache].some(([id, value]) => (!projectId || id === projectId) && value.editor?.dirty),
  );
  const events = options.events ?? (typeof window === 'undefined' ? undefined : window);
  const beforeUnload = (event: Event) => {
    if (hasUnsavedDrafts()) { event.preventDefault();
      if (typeof (event as BeforeUnloadEvent).returnValue === 'string') (event as BeforeUnloadEvent).returnValue = ''; }
  };
  events?.addEventListener('beforeunload', beforeUnload);
  let scanError = '';
  let deleting = false;
  let disposed = false,
    generation = 0,
    navigation = 0,
    pendingActions = 0,
    readGeneration = 0,
    refreshing: Promise<void> | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    unlisten: (() => void) | undefined;
  const publish = (patch: Partial<ProjectWorkspaceState>) => {
    if (disposed) return;
    if ('mode' in patch && !('output' in patch)) patch = { ...patch, output: null };
    state = { ...state, ...patch };
    Object.assign(entry(state.projectId), {
      tree: state.tree,
      mode: state.mode,
      output: state.output ?? null,
      showFiles: state.showFiles,
      editor: state.editor,
    });
    for (const listener of listeners) listener();
  };
  function notify(id: string) {
    const cached = entry(id);
    cached.seq++;
    for (const listener of sourceListeners.get(id) ?? [])
      listener({
        kind: 'snapshot',
        projectId: 'workspace',
        revision: cached.seq,
      });
  }
  async function hood(id: string, token: number) {
    if (!client.registry) return;
    try {
      const next = await client.registry.snapshot(
        id === 'default' ? 'workspace' : id,
      );
      if (disposed || token !== generation || id !== state.projectId) return;
      const cached = entry(id),
        previous = cached.hood;
      if (
        previous?.catalog.snapshotId !== next.catalog.snapshotId ||
        previous?.observation?.revision !== next.observation?.revision
      ) {
        cached.hood = next;
        notify(id);
      }
      if (
        next.observation?.mode === 'live' &&
        !unlisten &&
        client.registry.listen
      )
        unlisten = client.registry.listen(
          id === 'default' ? 'workspace' : id,
          (event) => {
            if (event.kind === 'projects') void refresh();
            else void hood(id, token);
          },
          () => {},
        );
    } catch {
      /* Compiler-free trees still provide a live structural graph. */
    }
  }
  async function refresh(): Promise<void> {
    if (disposed || deleting) return;
    if (refreshing) return refreshing;
    const id = state.projectId,
      token = generation;
    refreshing = (async () => {
      try {
        const [projects, tree] = await Promise.all([
          api.list(),
          api.inspect(id),
        ]);
        if (disposed || deleting || token !== generation || id !== state.projectId) return;
        const previous = entry(id).tree;
        const recovered = Boolean(scanError);
        const nextError = state.error === scanError ? '' : state.error;
        scanError = '';
        publish({ projects, tree, error: nextError });
        if (previous?.revision !== tree.revision || recovered) {
          notify(id);
          void hood(id, token);
          const editor = state.editor;
          if (editor && !editor.dirty && !editor.loading && !editor.readOnly) {
            if (!tree.entries.some((e) => e.path === editor.path))
              publish({ editor: null });
            else {
              try {
                const latest = await api.read(id, editor.path);
                if (
                  !disposed &&
                  token === generation &&
                  id === state.projectId &&
                  state.editor === editor &&
                  latest.sha256 !== editor.expectedHash
                )
                  publish({
                    editor: {
                      ...editor,
                      text: latest.text,
                      expectedHash: latest.sha256,
                    },
                  });
              } catch {
                /* An external rename/removal is reconciled on the next scan. */
              }
            }
          }
        }
      } catch (error) {
        if (!disposed && !deleting && token === generation) {
          const changed = scanError !== String(error);
          scanError = String(error);
          publish({ error: scanError });
          if (changed) notify(id);
        }
      }
    })().finally(() => {
      refreshing = undefined;
    });
    return refreshing;
  }
  function schedule() {
    if (disposed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void refresh().finally(schedule);
    }, options.pollMs ?? 1200);
  }
  async function select(id: string, expectedNavigation = navigation): Promise<boolean> {
    if (disposed || expectedNavigation !== navigation) return false;
    if (deleting) throw new Error('Thread deletion is in progress');
    const intent = ++navigation;
    readGeneration++;
    try { return await action(async () => {
      if (id === state.projectId) return true;
      const leaving = state.workspace;
      await leaving.save();
      if (disposed || intent !== navigation) return false;
      if (leaving.snapshot().dirty)
        throw new Error(leaving.snapshot().error || 'Save the current workflow before switching');
      const selectedGeneration = ++generation;
      unlisten?.(); unlisten = undefined;
      if (refreshing) await refreshing;
      if (disposed || intent !== navigation || selectedGeneration !== generation) return false;
      const cached = entry(id);
      publish({ projectId: id, tree: cached.tree, workspace: getCanvas(id),
        mode: cached.mode, output: cached.output, showFiles: cached.showFiles, editor: cached.editor, error: '' });
      await refresh();
      schedule();
      return !disposed && intent === navigation;
    }); } catch (error) {
      if (disposed || intent !== navigation) return false;
      throw error;
    }
  }
  const action = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (deleting) throw new Error('Thread deletion is in progress');
    const intent = navigation;
    pendingActions++;
    publish({ busy: true, error: '' });
    try { return await operation(); }
    catch (error) {
      if (intent === navigation) publish({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally { publish({ busy: --pendingActions > 0 }); }
  };
  function stash() {
    if (state.editor)
      drafts.set(state.projectId + ':' + state.editor.path, state.editor);
  }
  return {
    hasUnsavedDrafts,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => state,
    async start() {
      await refresh();
      schedule();
    },
    refresh,
    select,
    navigationRevision: () => navigation,
    setOutput: output => { ++navigation; publish({ output }); },
    async openFolder(path) {
      if (!api.open) throw new Error('Open Folder capability is unavailable');
      await action(async () => {
        const token = navigation;
        const opened = await api.open!({ path });
        if (disposed || token !== navigation) return;
        if (!await select(opened.id, token)) return;
        await refresh();
        if (!disposed && state.projectId === opened.id && opened.preparation?.status === 'attention')
          publish({ error: opened.preparation.message });
      });
    },
    async create(id, label) {
      await action(async () => {
        const token = navigation;
        const created = await api.create({ id, label });
        if (disposed || token !== navigation) return;
        if (!await select(created.id, token)) return;
        if (!disposed && state.projectId === created.id && created.preparation?.status === 'attention')
          publish({ error: created.preparation.message });
      });
    },
    async deleteThread(id) {
      if (!api.deleteThread) throw new Error('Delete thread capability is unavailable');
      if (state.busy || deleting) throw new Error('Wait for the current project action to finish');
      if (state.editor?.loading) throw new Error('Wait for the file to finish loading before deleting this thread');
      if (id !== state.projectId || !state.projects.find(project => project.id === id)?.development)
        throw new Error('Select a development thread before deleting it');
      const assertSaved = () => {
        if (hasUnsavedDrafts(id) || state.workspace.snapshot().dirty || state.workspace.snapshot().saving)
          throw new Error('Save or explicitly discard this thread’s unsaved work before deleting it');
      };
      assertSaved();
      await action(async () => {
        deleting = true;
        readGeneration++;
        try {
          if (refreshing) await refreshing;
          if (client.servers) await client.servers.stop(id);
          assertSaved();
          await api.deleteThread!(id);
          if (disposed) return;
          generation++;
          unlisten?.();
          unlisten = undefined;
          cache.delete(id);
          sourceClients.delete(id);
          sourceListeners.delete(id);
          for (const key of drafts.keys()) if (key.startsWith(id + ':')) drafts.delete(key);
          const projects = state.projects.filter(project => project.id !== id);
          const fallbackId = projects.find(project => project.id === 'default')?.id ??
            projects.find(project => !project.development && project.available !== false)?.id ?? 'default';
          const cached = entry(fallbackId);
          scanError = '';
          publish({ projects, projectId: fallbackId, tree: cached.tree, workspace: getCanvas(fallbackId),
            mode: cached.mode, output: cached.output, showFiles: cached.showFiles, editor: cached.editor, error: '' });
        } finally {
          deleting = false;
          schedule();
        }
        await refresh();
      });
    },
    setMode: mode => { ++navigation; publish({ mode }); },
    showFiles: (value) => publish({ showFiles: value }),
    async openFile(path, discardDraft = false) {
      if (deleting) return;
      stash();
      const id = state.projectId,
        token = ++readGeneration;
      if (discardDraft) drafts.delete(id + ':' + path);
      const cached = drafts.get(id + ':' + path);
      if (cached?.dirty) {
        publish({ editor: cached, mode: 'build' });
        return;
      }
      const file = state.tree?.entries.find((e) => e.path === path);
      if (!file || file.kind !== 'file') return;
      if (!file.editable) {
        publish({
          mode: 'build',
          editor: {
            path,
            text: `${path}\n${file.bytes} bytes · metadata only. This file is not editable here.`,
            expectedHash: null,
            dirty: false,
            loading: false,
            readOnly: true,
          },
        });
        return;
      }
      publish({
        mode: 'build',
        editor: {
          path,
          text: '',
          expectedHash: null,
          dirty: false,
          loading: true,
          readOnly: false,
        },
        error: '',
      });
      try {
        const value = await api.read(id, path);
        if (!disposed && token === readGeneration && id === state.projectId)
          publish({
            editor: {
              path,
              text: value.text,
              expectedHash: value.sha256,
              dirty: false,
              loading: false,
              readOnly: false,
            },
          });
      } catch (error) {
        if (token === readGeneration)
          publish({ error: String(error), editor: null });
      }
    },
    newFile(path) {
      if (deleting) return;
      if (!state.tree) throw new Error('Wait for project files to load before creating a file.');
      if (state.editor?.path === path || drafts.has(state.projectId + ':' + path) ||
          state.tree.entries.some(entry => entry.path === path))
        throw new Error('File or draft already exists; open it to continue editing.');
      stash();
      readGeneration++;
      publish({
        mode: 'build',
        editor: {
          path,
          text: '',
          expectedHash: null,
          dirty: true,
          loading: false,
          readOnly: false,
        },
        error: '',
      });
    },
    changeText(text) {
      if (deleting) return;
      if (state.editor && !state.editor.readOnly)
        publish({ editor: { ...state.editor, text, dirty: true } });
    },
    async saveFile() {
      await action(async () => {
        const editor = state.editor,
          id = state.projectId;
        if (!editor || editor.loading || editor.readOnly || !editor.dirty)
          return;
        const value = await api.write({
          projectId: id,
          path: editor.path,
          text: editor.text,
          expectedHash: editor.expectedHash,
        });
        const saved = {
          ...editor,
          text: value.text,
          expectedHash: value.sha256,
          dirty: false,
        };
        drafts.set(id + ':' + editor.path, saved);
        if (
          id === state.projectId &&
          state.editor?.path === editor.path &&
          state.editor.text === editor.text
        )
          publish({ editor: saved });
        await refresh();
      });
    },
    clearError() {
      publish({ error: '' });
    },
    closeEditor() {
      if (deleting) return;
      stash();
      readGeneration++;
      publish({ editor: null });
    },
    async createModule(path) {
      await action(async () => {
        await api.createModule(state.projectId, path);
        publish({ mode: 'build' });
        await refresh();
      });
    },
    sourceClient(id = state.projectId) {
      let adapter = sourceClients.get(id);
      if (adapter) return adapter;
      adapter = {
        async snapshot() {
          const cached = entry(id);
          if (!cached.tree) throw new Error('Project files are loading');
          const { tree, hood, seq } = cached,
            ids = new Set(tree.graph.items.map((i) => i.id));
          const symbols = (hood?.catalog.graph.items ?? []).filter(
            (i) => i.kind === 'symbol' && i.parentId && ids.has(i.parentId),
          );
          const external = (hood?.catalog.graph.items ?? []).filter(
            (i) => i.kind === 'external' || i.id === 'group:external',
          );
          for (const item of [...symbols, ...external]) ids.add(item.id);
          return RegistrySnapshotSchema.parse({
            catalog: {
              schemaVersion: 1,
              snapshotId: tree.revision,
              builtAt: tree.scannedAt,
              graph: {
                items: [...tree.graph.items, ...symbols, ...external.map(item => (
                  // Host ownership layers are outside this project projection;
                  // retained dependency roots must not point to omitted parents.
                  item.parentId && !ids.has(item.parentId) ? { ...item, parentId: null } : item
                ))],
                edges: [...new Map([...(hood?.catalog.graph.edges ?? []).filter(
                  (e) => ids.has(e.source) && ids.has(e.target),
                ), ...tree.graph.edges].map(edge => [edge.id, edge])).values()],
              },
              channels: hood?.catalog.channels ?? [],
            },
            plugins: hood?.plugins ?? [],
            wiring: hood?.wiring ?? { items: [], edges: [] },
            observation: {
              mode: 'live',
              projectId: 'workspace',
              revision: seq,
              status: state.projectId === id && scanError ? 'stale' : 'ready',
              ...(state.projectId === id && scanError
                ? { message: scanError }
                : {}),
            },
          });
        },
        source: async (path) => api.read(id, path),
        projects: async () => [
          { id: 'workspace', label: entry(id).tree?.project.label ?? id },
        ],
        listen(_project, receive) {
          let group = sourceListeners.get(id);
          if (!group) {
            group = new Set();
            sourceListeners.set(id, group);
          }
          group.add(receive);
          queueMicrotask(() => {
            if (group!.has(receive))
              receive({
                kind: 'snapshot',
                projectId: 'workspace',
                revision: entry(id).seq,
              });
          });
          return () => {
            group!.delete(receive);
          };
        },
      };
      sourceClients.set(id, adapter);
      return adapter;
    },
    dispose() {
      events?.removeEventListener('beforeunload', beforeUnload);
      disposed = true;
      generation++;
      readGeneration++;
      clearTimeout(timer);
      unlisten?.();
      listeners.clear();
      sourceListeners.clear();
    },
  };
}
