import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';
import type { UIPluginProps } from '@devlab/ui-contracts';
import { ProjectRelativePathSchema } from '@devlab/contracts';
import {
  createPreviewWorkspace,
  type PreviewSourceTarget,
} from './workspace.ts';
import { previewServerOwner } from './server-state.ts';
import { PreviewLayout } from './layout.tsx';
import {
  loadPreferences,
  savePreferences,
  type PreviewPreferences,
} from './preferences.ts';
import './preview.css';
const emptyServer = Object.freeze({ state: null, working: '', error: '' });
/** The editor is mounted exactly once; only the UI preview area multiplies. */
export function PreviewView({
  client,
  previewOptions,
  previewWorkspace,
}: UIPluginProps) {
  const projectId = previewOptions?.projectId ?? 'default';
  const workspaceFocused = previewOptions?.workspaceFocused ?? false;
  const workspaceId = 'preview-workspace-' + useId();
  const fallback = useRef<ReturnType<typeof createPreviewWorkspace>>();
  if (!fallback.current)
    fallback.current = createPreviewWorkspace({ projectId, storage: null });
  const owner = previewWorkspace ?? fallback.current,
    servers = previewServerOwner(client.servers);
  const state = useSyncExternalStore(owner.subscribe, owner.snapshot);
  const [stored, setStored] = useState(() => ({
    projectId,
    preferences: loadPreferences(projectId),
  }));
  const preferences =
    stored.projectId === projectId
      ? stored.preferences
      : loadPreferences(projectId);
  const [dragging, setDragging] = useState(false),
    container = useRef<HTMLDivElement>(null),
    restore = useRef<HTMLButtonElement>(null);
  const [compact, setCompact] = useState(() => matchMedia('(max-width: 850px)').matches);
  useEffect(() => {
    const media = matchMedia('(max-width: 850px)');
    const change = () => setCompact(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!previewWorkspace)
      owner.syncProjects(
        [
          {
            id: projectId,
            label: projectId,
            base: true,
            location: '',
            available: true,
          },
        ],
        projectId,
      );
  }, [owner, projectId, previewWorkspace]);
  // The memory-only fallback owns no external listeners. Fast Refresh retains its ref;
  // React subscriptions detach on unmount and the owner can then be collected.
  const activeGroup = state.groups.find((group) => group.id === state.groupId)!,
    active =
      activeGroup.panes.find((pane) => pane.paneId === state.activePaneId) ??
      activeGroup.panes[0]!;
  const available = state.projects.some(
    (p) => p.id === active.projectId && p.available !== false,
  );
  const subscribe = useCallback(
    (listener: () => void) =>
      available ? servers.subscribe(active.projectId, listener) : () => {},
    [servers, active.projectId, available],
  );
  const snapshot = useCallback(
    () => (available ? servers.snapshot(active.projectId) : emptyServer),
    [servers, active.projectId, available],
  );
  const server = useSyncExternalStore(subscribe, snapshot);
  const update = (patch: Partial<PreviewPreferences>) => {
    const next = { ...preferences, ...patch };
    setStored({ projectId, preferences: next });
    savePreferences(projectId, next);
  };
  useEffect(() => {
    const initial = previewOptions?.initialEditorRatio;
    if (typeof initial !== 'number' || !Number.isFinite(initial)) return;
    try {
      if (localStorage.getItem('devlab.preview.' + projectId) !== null) return;
    } catch { /* A first-use layout remains usable without storage. */ }
    const next = { ...loadPreferences(projectId), ratio: Math.max(25, Math.min(75, initial)) };
    setStored({ projectId, preferences: next });
    savePreferences(projectId, next);
  }, [projectId, previewOptions?.initialEditorRatio]);
  const adjust = (position: number) => {
    const bounds = container.current?.getBoundingClientRect();
    if (bounds)
      update({
        ratio: Math.max(
          25,
          Math.min(75, ((position - (compact ? bounds.top : bounds.left)) / (compact ? bounds.height : bounds.width)) * 100),
        ),
      });
  };
  const source = (target: PreviewSourceTarget) => {
    if (!ProjectRelativePathSchema.safeParse(target.path).success)
      throw new Error('Source path is not project-relative.');
    if (previewOptions?.onSourceSelectTarget)
      return previewOptions.onSourceSelectTarget(target);
    if (target.projectId === projectId)
      return previewOptions?.onSourceSelect?.(target.path);
    throw new Error('Project-targeted source navigation is unavailable.');
  };
  if (!previewOptions) return null;
  return (
    <div
      ref={container}
      className={`project-preview-split${dragging ? ' is-dragging' : ''}${preferences.collapsed ? ' is-collapsed' : ''}`}
      data-preview-collapsed={preferences.collapsed && !workspaceFocused}
      data-workspace-focused={workspaceFocused}
      style={
        { '--preview-editor-ratio': `${preferences.ratio}%` } as CSSProperties
      }
      data-devlab-project-id={projectId}
      data-testid="project-preview-split"
    >
      <div className="project-preview-editor">{previewOptions.children}</div>
      <div
        hidden={preferences.collapsed && !workspaceFocused}
        role="separator"
        tabIndex={0}
        aria-label="Resize project preview"
        aria-orientation={compact ? 'horizontal' : 'vertical'}
        aria-valuemin={25}
        aria-valuemax={75}
        aria-valuenow={Math.round(preferences.ratio)}
        className="project-preview-separator"
        data-devlab-id="preview.splitter"
        data-devlab-source="plugins/ui-preview/src/view.tsx"
        onKeyDown={(event) => {
          const value =
            event.key === (compact ? 'ArrowUp' : 'ArrowLeft')
              ? preferences.ratio - 2
              : event.key === (compact ? 'ArrowDown' : 'ArrowRight')
                ? preferences.ratio + 2
                : event.key === 'Home'
                  ? 25
                  : event.key === 'End'
                    ? 75
                    : null;
          if (value !== null) {
            event.preventDefault();
            update({ ratio: Math.max(25, Math.min(75, value)) });
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          adjust(compact ? event.clientY : event.clientX);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            adjust(compact ? event.clientY : event.clientX);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          setDragging(false);
        }}
        onPointerCancel={() => setDragging(false)}
        onLostPointerCapture={() => setDragging(false)}
      />
      <aside
        className="project-preview-restore"
        hidden={!preferences.collapsed || workspaceFocused}
        aria-label="Collapsed project preview"
        data-state={
          server.error || server.state?.error ? 'error' : server.state?.status
        }
      >
        <button
          type="button"
          ref={restore}
          data-devlab-id="preview.restore"
          data-devlab-source="plugins/ui-preview/src/view.tsx"
          aria-label="Restore UI preview"
          aria-expanded={false}
          aria-controls={workspaceId}
          onClick={() => {
            update({ collapsed: false });
            requestAnimationFrame(() =>
              container.current
                ?.querySelector<HTMLButtonElement>(
                  '[data-devlab-id="preview.collapse"]',
                )
                ?.focus(),
            );
          }}
        >
          <span aria-hidden="true">‹</span>
          <span className="preview-rail-label">UI preview</span>
        </button>
        <span className="preview-rail-status" role="status">
          {server.error || server.state?.error
            ? 'Error'
            : (server.state?.status ?? 'Loading')}
        </span>
      </aside>
      <div
        id={workspaceId}
        className="preview-workspace-retained"
        hidden={preferences.collapsed && !workspaceFocused}
      >
        <PreviewLayout
        theme={previewOptions.theme}
          workspaceFocused={workspaceFocused}
          fullscreenHost={previewOptions.fullscreen}
          collapsed={preferences.collapsed && !workspaceFocused}
          client={client}
          workspace={owner}
          servers={servers}
          onSourceSelect={source}
          onCollapse={() => {
            update({ collapsed: true });
            requestAnimationFrame(() => restore.current?.focus());
          }}
        />
      </div>
    </div>
  );
}
