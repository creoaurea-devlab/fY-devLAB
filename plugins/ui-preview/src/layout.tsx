import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import type { ApplicationClient, PreviewViewOptions } from '@devlab/ui-contracts';
import type {
  PreviewSourceTarget,
  PreviewWorkspace,
  PreviewPaneSpec,
} from './workspace.ts';
import type { PreviewServerOwner } from './server-state.ts';
import {
  createPreviewFullscreen,
  type PreviewFullscreen,
  type PreviewFullscreenState,
} from './fullscreen.ts';
import { PreviewPane } from './pane.tsx';
const initialFullscreen: PreviewFullscreenState = Object.freeze({
  paneId: null,
  mode: null,
  error: '',
});
export function PreviewLayout({
  workspace,
  servers,
  client,
  theme,
  onSourceSelect,
  onCollapse,
  collapsed = false,
  workspaceFocused = false,
  fullscreenHost,
}: {
  workspace: PreviewWorkspace;
  servers: PreviewServerOwner;
  client: ApplicationClient;
  theme?: 'light' | 'dark';
  onSourceSelect?: (target: PreviewSourceTarget) => void | Promise<void>;
  onCollapse(): void;
  collapsed?: boolean;
  workspaceFocused?: boolean;
  fullscreenHost?: PreviewViewOptions['fullscreen'];
}) {
  const state = useSyncExternalStore(workspace.subscribe, workspace.snapshot),
    group = state.groups.find((item) => item.id === state.groupId)!;
  // Current-project navigation changes the assignment, not the lifetime of an
  // opened project's preview. Named groups already own stable pane assignments.
  const currentPanes = useRef(new Map<string, PreviewPaneSpec>());
  const currentGroup = state.groups.find((item) => item.kind === 'current')!;
  for (const pane of currentGroup.panes) currentPanes.current.set(pane.projectId, pane);
  for (const projectId of currentPanes.current.keys()) {
    if (!currentGroup.panes.some((pane) => pane.projectId === projectId) &&
        !state.projects.some((project) => project.id === projectId && project.available !== false))
      currentPanes.current.delete(projectId);
  }
  const retainedPanes = [
    ...[...currentPanes.current.values()].map((pane) => ({ pane, groupId: currentGroup.id })),
    ...state.groups.filter((item) => item.kind !== 'current')
      .flatMap((item) => item.panes.map((pane) => ({ pane, groupId: item.id }))),
  ];
  const cards = useRef(new Map<string, HTMLDivElement>()),
    grid = useRef<HTMLDivElement>(null);
  const [controller, setController] = useState<PreviewFullscreen | null>(null),
    [fullscreen, setFullscreen] = useState(initialFullscreen),
    [error, setError] = useState(''),
    [drag, setDrag] = useState<'columns' | 'rows' | null>(null);
  useEffect(() => {
    const value = createPreviewFullscreen({
      document,
      getElement: (id) => cards.current.get(id) ?? null,
      onChange: (next) => {
        setFullscreen(next);
        if (next.paneId && next.mode)
          workspace.setExpanded(next.paneId, next.mode);
        else if (workspace.snapshot().expandedPaneId)
          workspace.setExpanded(null);
      },
    });
    setFullscreen(value.snapshot());
    setController(value);
    return () => {
      value.dispose();
    };
  }, [workspace]);
  useEffect(() => {
    if (!state.expandedPaneId) return;
    const target = group.panes.find(
      (pane) => pane.paneId === state.expandedPaneId,
    );
    if (
      !target ||
      !state.projects.some(
        (p) => p.id === target.projectId && p.available !== false,
      )
    )
      void controller?.exit();
  }, [state.expandedPaneId, state.projects, group.panes, controller]);
  const wasFocused = useRef(workspaceFocused);
  useEffect(() => {
    if (wasFocused.current && !workspaceFocused && controller?.snapshot().mode === 'maximized') void controller.exit();
    wasFocused.current = workspaceFocused;
  }, [workspaceFocused, controller]);
  const run = (action: () => void) => {
    try {
      action();
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const projectOptions = state.projects.filter(
    (project) => project.available !== false,
  );
  const settings = (pane: PreviewPaneSpec) => (
      <label>
        Project{' '}
        <select
          aria-label={`Project for pane ${pane.paneId}`}
          data-devlab-id="preview.pane.project"
          data-pane-id={pane.paneId}
          disabled={!!state.expandedPaneId}
          value={pane.projectId}
          onChange={(event) =>
            run(() =>
              workspace.assignPane(pane.paneId, event.currentTarget.value),
            )
          }
        >
          {!projectOptions.some((project) => project.id === pane.projectId) && (
            <option value={pane.projectId}>
              Unavailable · {pane.projectId}
            </option>
          )}
          {projectOptions.map((project) => (
            <option key={project.id} value={project.id}>
              {project.label}
            </option>
          ))}
        </select>
      </label>
  );
  const paneActions = (pane: PreviewPaneSpec) => (
      <button
        type="button"
        aria-label="Remove pane"
        title="Remove pane"
        data-devlab-id="preview.pane.remove"
        data-pane-id={pane.paneId}
        disabled={group.panes.length === 1 || !!state.expandedPaneId}
        onClick={() => run(() => workspace.removePane(pane.paneId))}
      >
        <span aria-hidden="true">−</span>
      </button>
  );
  const enlarge = (pane: PreviewPaneSpec) => {
    const expanded = fullscreen.paneId === pane.paneId;
    return (
      <>
        <button
          type="button"
          aria-label={
            expanded
              ? 'Exit enlarged preview'
              : `Fullscreen preview ${pane.projectId}`
          }
          data-devlab-id={
            expanded ? 'preview.fullscreen.exit' : 'preview.fullscreen.enter'
          }
          data-pane-id={pane.paneId}
          disabled={!controller || !!fullscreenHost?.pending}
          onClick={(event) => {
            const trigger = event.currentTarget;
            if (expanded) {
              void controller?.exit();
              if (fullscreenHost?.native) void fullscreenHost.exit();
            } else if (workspaceFocused) controller?.maximize(pane.paneId, trigger);
            else if (fullscreenHost) {
              void fullscreenHost.enter(trigger).then(entered => {
                if (!entered) return;
                const current = workspace.snapshot();
                if (current.groupId === group.id && current.groups.find(item => item.id === current.groupId)?.panes.some(
                  item => item.paneId === pane.paneId && item.projectId === pane.projectId && item.targetRevision === pane.targetRevision))
                  controller?.maximize(pane.paneId, trigger);
                else void fullscreenHost.exit();
              });
            } else void controller?.enter(pane.paneId, trigger);
          }}
        >
          {expanded ? 'Exit' : '⛶'}
        </button>
        {fullscreen.error && !expanded && (
          <button
            type="button"
            data-devlab-id="preview.maximize"
            data-pane-id={pane.paneId}
            onClick={() => {
              controller?.maximize(pane.paneId, {
                get isConnected() {
                  return !!cards.current.get(pane.paneId)?.isConnected;
                },
                focus() {
                  requestAnimationFrame(() =>
                    cards.current
                      .get(pane.paneId)
                      ?.querySelector<HTMLButtonElement>(
                        '[data-devlab-id="preview.maximize"],[data-devlab-id="preview.fullscreen.enter"]',
                      )
                      ?.focus(),
                  );
                },
              });
              requestAnimationFrame(() =>
                cards.current
                  .get(pane.paneId)
                  ?.querySelector<HTMLButtonElement>(
                    '[data-devlab-id="preview.fullscreen.exit"]',
                  )
                  ?.focus(),
              );
            }}
          >
            Maximize in app
          </button>
        )}
      </>
    );
  };
  const adjust = (
    event: PointerEvent<HTMLDivElement>,
    axis: 'columns' | 'rows',
  ) => {
    const bounds = grid.current?.getBoundingClientRect();
    if (!bounds) return;
    const value = Math.max(
      0.2,
      Math.min(
        0.8,
        axis === 'columns'
          ? (event.clientX - bounds.left) / bounds.width
          : (event.clientY - bounds.top) / bounds.height,
      ),
    );
    run(() =>
      workspace.setRatios(
        axis === 'columns' ? value : group.columns,
        axis === 'rows' ? value : group.rows,
      ),
    );
  };
  const splitter = (axis: 'columns' | 'rows') => (
    <div
      role="separator"
      tabIndex={0}
      className={`preview-grid-separator preview-grid-separator--${axis}`}
      data-devlab-id={`preview.grid.${axis}`}
      aria-label={
        axis === 'columns' ? 'Resize preview columns' : 'Resize preview rows'
      }
      aria-orientation={axis === 'columns' ? 'vertical' : 'horizontal'}
      aria-valuemin={20}
      aria-valuemax={80}
      aria-valuenow={Math.round(group[axis] * 100)}
      style={
        axis === 'columns'
          ? { left: `${group.columns * 100}%` }
          : { top: `${group.rows * 100}%` }
      }
      onKeyDown={(event) => {
        const old = group[axis],
          delta =
            event.key === 'ArrowLeft' || event.key === 'ArrowUp'
              ? -0.02
              : event.key === 'ArrowRight' || event.key === 'ArrowDown'
                ? 0.02
                : null;
        const value =
          event.key === 'Home'
            ? 0.2
            : event.key === 'End'
              ? 0.8
              : delta === null
                ? null
                : Math.max(0.2, Math.min(0.8, old + delta));
        if (value !== null) {
          event.preventDefault();
          run(() =>
            workspace.setRatios(
              axis === 'columns' ? value : group.columns,
              axis === 'rows' ? value : group.rows,
            ),
          );
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDrag(axis);
        adjust(event, axis);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          adjust(event, axis);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        setDrag(null);
      }}
      onPointerCancel={() => setDrag(null)}
      onLostPointerCapture={() => setDrag(null)}
    />
  );
  return (
    <div
      className="preview-workspace-area"
      data-devlab-id="preview.workspace"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && fullscreen.mode === 'maximized') {
          event.preventDefault();
          event.stopPropagation();
          void controller?.exit();
        }
      }}
    >
      <header
        className="preview-workspace-toolbar"
        aria-label="Preview workspace controls"
      >
        <label>
          Group{' '}
          <select
            aria-label="Preview group"
            data-devlab-id="preview.group"
            value={state.groupId}
            disabled={!!state.expandedPaneId}
            onChange={(event) =>
              run(() => workspace.selectGroup(event.currentTarget.value))
            }
          >
            {state.groups.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Panes{' '}
          <select
            aria-label="Number of UI previews"
            data-devlab-id="preview.pane-count"
            disabled={!!state.expandedPaneId}
            value={group.panes.length}
            onChange={(event) =>
              run(() =>
                workspace.setPaneCount(Number(event.currentTarget.value)),
              )
            }
          >
            {[1, 2, 3, 4].map((count) => (
              <option
                key={count}
                value={count}
                disabled={
                  count > Math.max(group.panes.length, projectOptions.length)
                }
              >
                {count}
              </option>
            ))}
          </select>
        </label>
        <small role="status" aria-label={state.persistence === 'saved' ? 'Layout saved' : undefined} title={state.persistenceMessage || (state.persistence === 'saved' ? 'Layout saved' : 'Layout kept in memory')}>
          {state.persistence === 'saved'
            ? 'Saved'
            : state.persistence === 'invalid'
              ? 'Layout storage invalid'
              : state.persistence === 'unavailable'
                ? 'In memory · storage unavailable'
                : 'In memory'}
        </small>
        {(error || fullscreen.error || state.error) && <small className="preview-workspace-error" role="alert"
          title={error || fullscreen.error || state.error}>{error || fullscreen.error || state.error}</small>}
      </header>
      <div
        ref={grid}
        className={`preview-workspace-grid${drag ? ' is-resizing' : ''}`}
        data-pane-count={group.panes.length}
        data-expanded={state.expandedPaneId ?? ''}
        data-testid="preview-workspace-grid"
        style={
          {
            '--preview-columns': `${group.columns}fr ${1 - group.columns}fr`,
            '--preview-rows': `${group.rows}fr ${1 - group.rows}fr`,
            '--preview-pane-count': group.panes.length,
          } as CSSProperties
        }
      >
        {retainedPanes.map(({ pane, groupId }) => {
          const visible = groupId === group.id && group.panes.some(
            (active) => active.paneId === pane.paneId && active.projectId === pane.projectId,
          );
          const available = state.projects.some(
            (project) =>
              project.id === pane.projectId && project.available !== false,
          );
          return (
            <div
              key={`${pane.paneId}:${pane.projectId}`}
              ref={(element) => {
                if (visible && element) cards.current.set(pane.paneId, element);
                else if (visible) cards.current.delete(pane.paneId);
              }}
              className="preview-pane-card"
              hidden={!visible}
              style={!visible ? { display: 'none' } : undefined}
              data-pane-id={pane.paneId}
              data-project-id={pane.projectId}
              data-expanded={state.expandedPaneId === pane.paneId}
              data-expanded-mode={state.expandedMode ?? ''}
              onFocusCapture={() => {
                if (workspace.snapshot().activePaneId !== pane.paneId)
                  workspace.selectPane(pane.paneId);
              }}
            >
              {available ? (
                <PreviewPane
                  client={client}
                  theme={theme}
                  collapsed={collapsed || !visible}
                  pane={pane}
                  workspace={workspace}
                  servers={servers}
                  onSourceSelect={onSourceSelect}
                  legacyIds={
                    visible && group.kind === 'current' && group.panes.length === 1
                  }
                  onCollapse={() => {
                    if (fullscreen.mode)
                      void controller?.exit().then(onCollapse);
                    else onCollapse();
                  }}
                  toolbarActions={enlarge(pane)}
                  configurationActions={settings(pane)}
                  paneActions={paneActions(pane)}
                />
              ) : (
                <section
                  className="project-preview-pane"
                  aria-label={`Unavailable preview ${pane.projectId}`}
                >
                  <header className="project-preview-toolbar">
                    <strong>{pane.projectId}</strong>
                    {enlarge(pane)}
                  </header>
                  <div
                    className="project-preview-empty"
                    role="status"
                    data-devlab-id="preview.unavailable"
                  >
                    This project is unavailable. Its saved pane assignment is
                    retained.
                  </div>
                  <div className="preview-drawer-content">{settings(pane)}{paneActions(pane)}</div>
                </section>
              )}
            </div>
          );
        })}
        {group.panes.length >= 2 &&
          !state.expandedPaneId &&
          splitter('columns')}
        {group.panes.length >= 3 && !state.expandedPaneId && splitter('rows')}
      </div>
    </div>
  );
}
