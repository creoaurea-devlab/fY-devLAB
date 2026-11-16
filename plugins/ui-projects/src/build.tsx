import { useRef, useState, useSyncExternalStore } from 'react';
import { useOnViewportChange, useReactFlow } from '@xyflow/react';
import { HoodView } from '@creoaurea/pop-the-hood/react';
import type { ProjectWorkspace, ProjectWorkspaceState } from '@devlab/ui-contracts';
import { ProjectEditor } from './editor.tsx';

/** Runs inside Hood's public toolbar slot and its React Flow provider. */
function InitialBuildFrame({ rootId, active }: { rootId?: string; active: boolean }) {
  const flow = useReactFlow(), framed = useRef(false);
  useOnViewportChange({ onEnd() {
    if (!active || framed.current) return;
    const root = rootId ? flow.getNode(rootId) : undefined;
    if (!root) return;
    framed.current = true;
    // Focus the project at readable scale once; subsequent pan/zoom belongs to the user.
    queueMicrotask(() => void flow.fitView({ nodes: [root], padding: 0.12, minZoom: 0.85, maxZoom: 1 }));
  } });
  return null;
}

export function ProjectBuild({ owner }: { owner: ProjectWorkspace }) {
  const state = useSyncExternalStore(owner.subscribe, owner.snapshot);
  const visited = useRef(new Map<string, ProjectWorkspaceState>());
  if (state.mode === 'build' || visited.current.has(state.projectId)) visited.current.set(state.projectId, state);
  for (const id of visited.current.keys()) if (!state.projects.some(project => project.id === id)) visited.current.delete(id);
  return <>{[...visited.current].map(([id, snapshot]) =>
    <BuildPanel key={id} owner={owner} state={snapshot} active={id === state.projectId && state.mode === 'build'} />)}</>;
}

function BuildPanel({ owner, state, active }: { owner: ProjectWorkspace; state: ProjectWorkspaceState; active: boolean }) {
  const [form, setForm] = useState<'file' | 'module' | null>(null),
    [path, setPath] = useState(''),
    [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!active || owner.snapshot().projectId !== state.projectId) return;
    setError('');
    try {
      if (form === 'module') await owner.createModule(path);
      else owner.newFile(path);
      setForm(null);
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <section
      className="project-build"
      data-project-id={state.projectId}
      hidden={!active}
      style={!active ? { display: 'none' } : undefined}
      data-testid="project-build-canvas"
      aria-label="Project build canvas"
    >
      {form && (
        <form
          className="project-path-form"
          aria-label={form === 'file' ? 'Create file' : 'Create module'}
          onSubmit={submit}
        >
          <label>
            {form === 'file' ? 'File path' : 'Module directory'}
            <input
              data-devlab-source="plugins/ui-projects/src/build.tsx"
              data-devlab-id="build.path"
              aria-label={form === 'file' ? 'File path' : 'Module directory'}
              value={path}
              onChange={(e) => setPath(e.target.value)}
              required
              autoFocus
            />
          </label>
          <button
            data-devlab-source="plugins/ui-projects/src/build.tsx"
            data-devlab-id="build.path.submit"
            className="project-primary"
            disabled={state.busy}
          >
            {form === 'file' ? 'Open new file' : 'Create module'}
          </button>
          <button
            data-devlab-source="plugins/ui-projects/src/build.tsx"
            data-devlab-id="build.path.cancel"
            type="button"
            onClick={() => setForm(null)}
          >
            Cancel
          </button>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
      <div className="project-build-body">
        <div className="project-build-graph">
          <HoodView
            key={state.projectId}
            client={owner.sourceClient(state.projectId)}
            presentation="embedded"
            title={`${state.tree?.project.label ?? 'Project'} · Build canvas`}
            toolbarActions={
              <div className="project-build-actions">
                <InitialBuildFrame active={active} rootId={state.tree?.graph.items.find(item => !item.parentId)?.id} />
                <button
                  data-devlab-source="plugins/ui-projects/src/build.tsx"
                  data-devlab-id="build.new-file"
                  onClick={() => {
                    setForm('file');
                    setPath('src/new-file.ts');
                  }}
                >
                  New file
                </button>
                <button
                  data-devlab-source="plugins/ui-projects/src/build.tsx"
                  data-devlab-id="build.new-module"
                  onClick={() => {
                    setForm('module');
                    setPath('src/modules/new-feature');
                  }}
                >
                  New module
                </button>
                <label>
                  <input
                    data-devlab-source="plugins/ui-projects/src/build.tsx"
                    data-devlab-id="build.files"
                    aria-label="Show file nodes"
                    type="checkbox"
                    checked={state.showFiles}
                    onChange={(e) => owner.showFiles(e.target.checked)}
                  />{' '}
                  File nodes
                </label>
              </div>
            }
            initialDepth={1}
            hideFiles={!state.showFiles}
            onSourceSelect={(path) => { if (active && owner.snapshot().projectId === state.projectId) void owner.openFile(path); }}
            theme="inherit"
          />
        </div>
        <ProjectEditor owner={owner} retainedState={state} />
      </div>
    </section>
  );
}
