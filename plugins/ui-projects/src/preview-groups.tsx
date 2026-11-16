import { useEffect, useState, useSyncExternalStore } from 'react';
import type { PreviewWorkspace } from '@devlab/ui-contracts';
/** Groups change preview presentation only; they never select/open an editor project. */
export function PreviewGroups({ workspace }: { workspace: PreviewWorkspace }) {
  const state = useSyncExternalStore(workspace.subscribe, workspace.snapshot),
    active = state.groups.find((item) => item.id === state.groupId)!;
  const [name, setName] = useState(''),
    [rename, setRename] = useState(active.name),
    [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState('');
  const unavailable = !!state.expandedPaneId;
  useEffect(() => {
    setRename(active.name);
  }, [active.id, active.name]);
  const run = (action: () => void) => {
    try {
      action();
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const targets = active.panes
    .map(
      (pane) =>
        state.projects.find((project) => project.id === pane.projectId)
          ?.label ?? pane.projectId,
    )
    .join(', ');
  return (
    <details
      className="project-preview-groups"
      data-devlab-source="plugins/ui-projects/src/preview-groups.tsx"
      data-devlab-id="projects.preview-groups"
    >
      <summary>
        Preview groups <span>{state.groups.length}</span>
      </summary>
      <ul aria-label="Saved preview groups">
        {state.groups.map((group) => (
          <li key={group.id}>
            <button
              type="button"
              data-devlab-source="plugins/ui-projects/src/preview-groups.tsx"
              data-devlab-id="projects.preview-group.select"
              data-group-id={group.id}
              aria-pressed={group.id === state.groupId}
              disabled={unavailable}
              onClick={() => run(() => workspace.selectGroup(group.id))}
              title={group.name}
            >
              {group.name}
              <small>{group.panes.length}</small>
            </button>
          </li>
        ))}
      </ul>
      <details className="project-group-management" data-devlab-id="projects.preview-groups.manage" data-devlab-source="plugins/ui-projects/src/preview-groups.tsx"><summary>Manage groups</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          run(() => {
            workspace.createGroup(
              name,
              selected.length ? selected : [state.editorProjectId],
            );
            setName('');
            setSelected([]);
          });
        }}
      >
        <label>
          New group name
          <input
            aria-label="New preview group name"
            data-devlab-source="plugins/ui-projects/src/preview-groups.tsx"
            data-devlab-id="projects.preview-group.name"
            maxLength={80}
            value={name}
            disabled={unavailable}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <fieldset disabled={unavailable}>
          <legend>Projects · choose up to four</legend>
          <div className="preview-group-choices">
            {state.projects
              .filter((project) => project.available !== false)
              .map((project) => (
                <label key={project.id}>
                  <input
                    type="checkbox"
                    data-devlab-source="plugins/ui-projects/src/preview-groups.tsx"
                    data-devlab-id="projects.preview-group.member"
                    data-project-id={project.id}
                    checked={selected.includes(project.id)}
                    disabled={
                      selected.length === 4 && !selected.includes(project.id)
                    }
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setSelected((old) =>
                        checked
                          ? [...old, project.id]
                          : old.filter((id) => id !== project.id),
                      );
                    }}
                  />
                  {project.label}
                </label>
              ))}
          </div>
        </fieldset>
        <button
          type="submit"
          data-devlab-source="plugins/ui-projects/src/preview-groups.tsx"
          data-devlab-id="projects.preview-group.create"
          disabled={unavailable || !name.trim()}
        >
          Create preview group
        </button>
      </form>
      {active.kind === 'named' && (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              run(() => workspace.renameGroup(active.id, rename));
            }}
          >
            <label>
              Rename group
              <input
                aria-label="Rename preview group"
                data-devlab-source="plugins/ui-projects/src/preview-groups.tsx"
                data-devlab-id="projects.preview-group.rename-input"
                maxLength={80}
                value={rename}
                disabled={unavailable}
                onChange={(event) => setRename(event.currentTarget.value)}
              />
            </label>
            <button
              type="submit"
              data-devlab-source="plugins/ui-projects/src/preview-groups.tsx"
              data-devlab-id="projects.preview-group.rename"
              disabled={unavailable || !rename.trim()}
            >
              Rename
            </button>
          </form>
          <p>
            Layout targets: {targets}. Removing the group keeps project files
            and servers.
          </p>
          <button
            type="button"
            data-devlab-source="plugins/ui-projects/src/preview-groups.tsx"
            data-devlab-id="projects.preview-group.delete"
            disabled={unavailable}
            aria-label={`Delete preview group ${active.name}`}
            onClick={() => run(() => workspace.deleteGroup(active.id))}
          >
            Delete group
          </button>
        </>
      )}
      </details>
      {unavailable && (
        <p role="status">Exit fullscreen to change preview groups.</p>
      )}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
