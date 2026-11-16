import { PreviewGroups } from './preview-groups.tsx';
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Plus,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  FileCode2,
  Folder,
  Trash2,
  X,
} from 'lucide-react';
import type { UIPluginProps, ProjectWorkspace } from '@devlab/ui-contracts';
import './projects.css';
const Build = lazy(() =>
  import('./build.tsx').then((module) => ({ default: module.ProjectBuild })),
);
export function ProjectsView({
  client,
  projectWorkspace,
  projectOptions,
  previewWorkspace,
}: UIPluginProps) {
  if (!projectWorkspace) return null;
  return projectOptions?.view === 'canvas' ? (
    <Suspense
      fallback={<div className="projects-loading">Opening build canvas…</div>}
    >
      <Build owner={projectWorkspace} />
    </Suspense>
  ) : (
    <Explorer
      client={client}
      owner={projectWorkspace}
      previewWorkspace={previewWorkspace}
      developmentOnly={projectOptions?.developmentOnly}
      collapse={projectOptions?.collapse}
      renderControls={projectOptions?.renderControls}
    />
  );
}
const projectGroupsKey = 'devlab:project-groups:v1';
type ProjectCatalog = { groups: { id: string; name: string; collapsed: boolean }[]; assignment: Record<string, string>; order: string[] };
function readProjectCatalog(): ProjectCatalog {
  const fallback: ProjectCatalog = { groups: [
    { id: 'current', name: 'CURRENT', collapsed: false }, { id: 'pool', name: 'POOL', collapsed: false },
  ], assignment: {}, order: [] };
  try {
    const value = JSON.parse(localStorage.getItem(projectGroupsKey) ?? 'null');
    if (!value || !Array.isArray(value.groups) || value.groups.length < 2 || value.groups.length > 32 ||
      value.groups.some((g: any) => !g || typeof g.id !== 'string' || g.id.length > 80 || typeof g.name !== 'string' || !g.name.trim() || g.name.length > 40 || typeof g.collapsed !== 'boolean') ||
      new Set(value.groups.map((g: any) => g.id)).size !== value.groups.length ||
      !['current', 'pool'].every(id => value.groups.some((g: any) => g.id === id)) ||
      !value.assignment || typeof value.assignment !== 'object' || Array.isArray(value.assignment) ||
      Object.values(value.assignment).some(id => !value.groups.some((g: any) => g.id === id)) ||
      !Array.isArray(value.order) || value.order.some((id: unknown) => typeof id !== 'string')) return fallback;
    return value;
  } catch { return fallback; }
}
function Explorer({
  developmentOnly,
  client,
  owner,
  collapse,
  previewWorkspace,
  renderControls,
}: {
  developmentOnly?: boolean;
  client: UIPluginProps['client'];
  owner: ProjectWorkspace;
  collapse?: () => void;
  previewWorkspace?: UIPluginProps['previewWorkspace'];
  renderControls?: import('@devlab/ui-contracts').ProjectViewOptions['renderControls'];
}) {
  const state = useSyncExternalStore(owner.subscribe, owner.snapshot);
  const [catalog, setCatalog] = useState(readProjectCatalog);
  const [dropGroup, setDropGroup] = useState<string | null>(null);
  const [addingGroup, setAddingGroup] = useState(false), [groupName, setGroupName] = useState(''), [groupError, setGroupError] = useState('');
  function updateCatalog(next: ProjectCatalog) {
    setCatalog(next); setGroupError('');
    try { localStorage.setItem(projectGroupsKey, JSON.stringify(next)); }
    catch { setGroupError('Groups changed for this window; browser storage is unavailable.'); }
  }
  function moveProject(id: string, group: string, before?: string) {
    setDropGroup(null);
    if (!state.projects.some(project => project.id === id) || !catalog.groups.some(item => item.id === group) || id === before) return;
    const order = [...catalog.order, ...state.projects.map(project => project.id)]
      .filter((item, index, all) => item !== id && all.indexOf(item) === index);
    const index = before ? order.indexOf(before) : -1;
    order.splice(index < 0 ? order.length : index, 0, id);
    updateCatalog({ ...catalog, assignment: { ...catalog.assignment, [id]: group }, order });
  }
  const [actionsExpanded, setActionsExpanded] = useState(false);
  const actionsId = useId();
  const actionsToggle = useRef<HTMLButtonElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const deletePending = useRef(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const deleteTitleId = useId(), deleteDescriptionId = useId();
  useEffect(() => {
    if (deleteTarget && !deleteDialog.current?.open) deleteDialog.current?.showModal();
  }, [deleteTarget]);
  const dismissDelete = () => {
    if (deletePending.current) return;
    deleteDialog.current?.close();
    setDeleteTarget(null);
    (deleteTrigger.current ?? actionsToggle.current)?.focus();
  };
  const confirmDelete = async () => {
    if (!deleteTarget || deletePending.current) return;
    deletePending.current = true;
    setDeleting(true);
    setDeleteError('');
    try {
      await owner.deleteThread(deleteTarget.id);
      if (previewWorkspace && !previewWorkspace.snapshot().expandedPaneId) {
        for (const group of previewWorkspace.snapshot().groups) {
          if (group.kind === 'named' && group.panes.length && group.panes.every(pane => pane.projectId === deleteTarget.id))
            previewWorkspace.deleteGroup(group.id);
        }
      }
      deletePending.current = false;
      dismissDelete();
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      deletePending.current = false;
      setDeleting(false);
    }
  };
  const [opening, setOpening] = useState(false),
    [folderPath, setFolderPath] = useState('');
  const [creating, setCreating] = useState(false),
    [name, setName] = useState(''),
    [slug, setSlug] = useState(''),
    [error, setError] = useState('');
  const [expanded, setExpanded] = useState(
    new Set(['src', 'plugins', 'packages', 'apps']),
  );
  const children = useMemo(() => {
    const result = new Map<string, NonNullable<typeof state.tree>['entries']>();
    for (const entry of state.tree?.entries ?? []) {
      const parent = entry.path.split('/').slice(0, -1).join('/');
      const group = result.get(parent) ?? [];
      group.push(entry);
      result.set(parent, group);
    }
    return result;
  }, [state.tree]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await owner.create(slug, name);
      setCreating(false);
      setName('');
      setSlug('');
    } catch (e) {
      setError(String(e));
    }
  };
  function tree(path: string, depth = 0): React.ReactNode {
    return (children.get(path) ?? []).map((entry) =>
      entry.kind === 'directory' ? (
        <div key={entry.path}>
          <button
            className="project-tree-row"
            style={{ paddingLeft: 10 + depth * 12 }}
            aria-label={`${expanded.has(entry.path) ? 'Collapse' : 'Expand'} folder ${entry.path}`}
            aria-expanded={expanded.has(entry.path)}
            onClick={() =>
              setExpanded((current) => {
                const next = new Set(current);
                next.has(entry.path)
                  ? next.delete(entry.path)
                  : next.add(entry.path);
                return next;
              })
            }
          >
            {expanded.has(entry.path) ? (
              <ChevronDown size={11} />
            ) : (
              <ChevronRight size={11} />
            )}
            <Folder size={12} />
            <span>{entry.path.split('/').at(-1)}</span>
          </button>
          {expanded.has(entry.path) && tree(entry.path, depth + 1)}
        </div>
      ) : (
        <button
          key={entry.path}
          className={`project-tree-row${state.editor?.path === entry.path ? ' selected' : ''}`}
          style={{ paddingLeft: 24 + depth * 12 }}
          title={entry.path}
          aria-label={`Open ${entry.path}`}
          onClick={() => void owner.openFile(entry.path)}
        >
          <FileCode2 size={12} />
          <span>{entry.path.split('/').at(-1)}</span>
        </button>
      ),
    );
  }
  return (
    <aside
      className="project-explorer-container"
      aria-label="Project explorer"
      data-testid="project-explorer"
    >
      <div
        className={`project-explorer-header${actionsExpanded ? ' project-actions-expanded' : ''}`}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && actionsExpanded) {
            event.preventDefault();
            event.stopPropagation();
            setActionsExpanded(false);
            actionsToggle.current?.focus();
          }
        }}
      >
        <button
          ref={actionsToggle}
          type="button"
          className="project-actions-toggle"
          aria-label={actionsExpanded ? 'Minimize project actions' : 'Expand project actions'}
          aria-expanded={actionsExpanded}
          aria-controls={actionsId}
          data-devlab-id="project.actions.toggle"
          data-devlab-source="plugins/ui-projects/src/view.tsx"
          onClick={() => setActionsExpanded(!actionsExpanded)}
        >
        <span className="project-explorer-header-icon">◈</span>
        <span className="project-explorer-header-title">Projects</span>
        <span aria-hidden="true">{actionsExpanded ? '▴' : '•'}</span>
        </button>
        <div
          id={actionsId}
          className="project-header-actions"
          hidden={!actionsExpanded || developmentOnly}
          data-devlab-id="project.actions"
          data-devlab-source="plugins/ui-projects/src/view.tsx"
        >
        <button
          className="tree-action-btn"
          aria-label="New project"
          data-devlab-id="project.new"
          onClick={() => {
            setCreating(true);
            setOpening(false);
            setError('');
          }}
        >
          <Plus size={13} />
        </button>
        <button
          className="tree-action-btn"
          aria-label="Open Folder"
          data-devlab-id="project.open-folder"
          disabled={state.busy}
          onClick={() => {
            setOpening(true);
            setCreating(false);
            setError('');
          }}
        >
          <Folder size={13} />
        </button>

        </div>
        {collapse && <button type="button" className="project-explorer-close" aria-label="Collapse project explorer" data-devlab-id="workspace.projects.close" data-devlab-source="plugins/ui-projects/src/view.tsx" onClick={collapse}><ChevronLeft size={12}/></button>}
      </div>
      {creating && (
        <form
          className="project-create-form"
          aria-label="Create project"
          onSubmit={submit}
        >
          <div>
            <strong>New project</strong>
            <button
              type="button"
              aria-label="Cancel new project"
              onClick={() => setCreating(false)}
            >
              <X size={12} />
            </button>
          </div>
          <label>
            Name
            <input
              aria-label="Project name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSlug(
                  e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-|-$/g, '')
                    .slice(0, 64),
                );
              }}
              required
              autoFocus
            />
          </label>
          <label>
            Directory
            <input
              aria-label="Project directory"
              pattern="[a-z][a-z0-9-]{0,63}"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
            />
          </label>
          <small>projects/{slug || 'project-name'}/</small>
          {error && <p role="alert">{error}</p>}
          <button className="project-primary" disabled={state.busy || !slug}>
            Create project
          </button>
        </form>
      )}
      {opening && (
        <form
          className="project-create-form"
          aria-label="Open existing folder"
          onSubmit={async (event) => {
            event.preventDefault();
            setError('');
            try {
              await owner.openFolder(folderPath);
              setOpening(false);
              setFolderPath('');
            } catch (reason) {
              setError(
                reason instanceof Error ? reason.message : String(reason),
              );
            }
          }}
        >
          <div>
            <strong>Open Folder</strong>
            <button
              type="button"
              aria-label="Cancel open folder"
              data-devlab-id="project.open.cancel"
              onClick={() => setOpening(false)}
            >
              <X size={12} />
            </button>
          </div>
          <label>
            Absolute folder path
            <input
              aria-label="Existing project folder"
              data-devlab-id="project.open.path"
              value={folderPath}
              onChange={(event) => setFolderPath(event.target.value)}
              placeholder="/home/you/projects/app"
              required
              pattern="\/.*"
              autoFocus
            />
          </label>
          <small>
            Open an existing local project without moving its files.
          </small>
          {error && <p role="alert">{error}</p>}
          <button
            className="project-primary"
            data-devlab-id="project.open.submit"
            disabled={state.busy || !folderPath.startsWith('/')}
          >
            Open Folder
          </button>
        </form>
      )}
      <nav className="project-list" aria-label="Workspace projects">
        {catalog.groups.map(group => {
          const projects = state.projects.filter(project => !!project.development === !!developmentOnly &&
            (catalog.assignment[project.id] ?? (project.base ? 'current' : 'pool')) === group.id)
            .sort((a, b) => {
              const position = (id: string) => { const index = catalog.order.indexOf(id); return index < 0 ? Number.MAX_SAFE_INTEGER : index; };
              return position(a.id) - position(b.id);
            });
          return <section className={`project-catalog-group${dropGroup === group.id ? ' drop-active' : ''}`} key={group.id} aria-label={`Project group ${group.name}`}
            onDragOver={event => { if (event.dataTransfer.types.includes('application/x-devlab-project')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropGroup(group.id); } }}
            onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropGroup(null); }}
            onDrop={event => { event.preventDefault(); moveProject(event.dataTransfer.getData('application/x-devlab-project'), group.id); }}>
            <div className="project-group-heading">
              <button aria-expanded={!group.collapsed} onClick={() => updateCatalog({ ...catalog,
                groups: catalog.groups.map(item => item.id === group.id ? { ...item, collapsed: !item.collapsed } : item) })}>
                {group.collapsed ? <ChevronRight size={11}/> : <ChevronDown size={11}/>}
                <span>{group.name}</span><small>{projects.length}</small>
              </button>
            </div>
            {!group.collapsed && <div className="project-group-items">
          {projects.map(project => <div className="project-list-row" key={project.id} draggable={!state.busy}
            data-project-id={project.id} onDragEnd={() => setDropGroup(null)}
            onDragStart={event => { event.dataTransfer.setData('application/x-devlab-project', project.id); event.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={event => { if (event.dataTransfer.types.includes('application/x-devlab-project')) event.preventDefault(); }}
            onDrop={event => { event.preventDefault(); event.stopPropagation(); moveProject(event.dataTransfer.getData('application/x-devlab-project'), group.id, project.id); }}>
          <button
            aria-label={`Select project ${project.label}`}
            aria-pressed={state.projectId === project.id}
            onClick={() => void owner.select(project.id).then(selected => {
              if (selected === false || owner.snapshot().projectId !== project.id || !project.development || !previewWorkspace) return;
              const group = previewWorkspace.snapshot().groups.find(group => group.kind === 'named' && group.panes.length === 1 && group.panes[0]?.projectId === project.id);
              if (group) previewWorkspace.selectGroup(group.id);
            }).catch(() => {})}
            disabled={state.busy}
          >
            <Folder size={13} />
            <span>{project.label}</span>
            <small>{project.development ? 'DEV' : project.base ? 'BASE' : 'PROJECT'}</small>
          </button>
          <select className="project-group-move" aria-label={`Move ${project.label} to group`}
            title="Move to group" value={group.id} onChange={event => moveProject(project.id, event.target.value)}>
            {catalog.groups.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          {project.development && state.projectId === project.id && client.projects?.deleteThread && (
            <button
              ref={deleteTrigger}
              type="button"
              className="project-thread-delete"
              aria-label={`Delete thread ${project.label}`}
              title="Delete thread"
              disabled={state.busy}
              onClick={() => { setDeleteError(''); setDeleteTarget({ id: project.id, label: project.label }); }}
            ><Trash2 size={13} /></button>
          )}
          </div>)}
              {!projects.length && <span className="project-group-empty">Drop projects here</span>}
            </div>}
          </section>;
        })}
        {addingGroup ? <form className="project-group-create" onSubmit={event => {
          event.preventDefault(); const name = groupName.trim();
          if (!name || catalog.groups.some(group => group.name.toLowerCase() === name.toLowerCase())) { setGroupError('Use a unique group name.'); return; }
          if (catalog.groups.length >= 32) { setGroupError('Up to 32 groups are supported.'); return; }
          updateCatalog({ ...catalog, groups: [...catalog.groups, { id: crypto.randomUUID(), name, collapsed: false }] });
          setAddingGroup(false); setGroupName('');
        }}>
          <input autoFocus aria-label="Group name" maxLength={40} value={groupName} onChange={event => setGroupName(event.target.value)}
            onKeyDown={event => { if (event.key === 'Escape') { setAddingGroup(false); setGroupError(''); } }}/>
          <button type="submit" aria-label="Save project group">Add</button>
          <button type="button" aria-label="Cancel new group" onClick={() => { setAddingGroup(false); setGroupError(''); }}><X size={11}/></button>
        </form> : <button className="project-group-add" onClick={() => { setAddingGroup(true); setGroupError(''); }}><Plus size={11}/>Add group</button>}
        {groupError && <p role="alert" className="project-group-error">{groupError}</p>}
      </nav>
      <dialog
        ref={deleteDialog}
        className="project-delete-dialog"
        aria-labelledby={deleteTitleId}
        aria-describedby={deleteDescriptionId}
        onCancel={event => { event.preventDefault(); dismissDelete(); }}
      >
        <h2 id={deleteTitleId}>Delete thread “{deleteTarget?.label}”?</h2>
        <p id={deleteDescriptionId}>Its preview will stop and its working copy will move to private recovery storage. The original project stays available. Save or explicitly discard this thread’s unsaved work first.</p>
        {deleteError && <p role="alert">{deleteError}</p>}
        {deleting && <p role="status">Deleting thread…</p>}
        <div>
          <button type="button" autoFocus disabled={deleting} onClick={dismissDelete}>Cancel</button>
          <button type="button" disabled={deleting} onClick={() => void confirmDelete()}>Delete thread</button>
        </div>
      </dialog>
      {previewWorkspace && <PreviewGroups workspace={previewWorkspace}/>}
      <div className="project-files-heading">
        <strong>{state.tree?.project.label ?? 'Loading…'}</strong>
        <span>
          {state.tree?.entries.filter((e) => e.kind === 'file').length ?? 0}{' '}
          files
        </span>
      </div>
      <div className="project-file-tree">
        {renderControls?.(state.projectId)}
        <div role="tree" aria-label="Project files">
        {tree('')}
        {state.tree?.entries.length === 0 && (
          <p className="project-help">
            Empty project. Create a file on the build canvas.
          </p>
        )}
        </div>
      </div>
      <footer className="project-location" title={state.tree?.project.location}>
        {state.tree?.project.location ?? 'Loading project…'}
      </footer>
    </aside>
  );
}
