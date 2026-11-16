import { DevToolsControls } from './devtools.tsx';
import { ElementInspector } from './inspector.tsx';
import { ElementSourceTools } from './elements.tsx';
import { PrototypePanel } from './prototype.tsx';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { previewRefreshMode } from '@devlab/contracts';
import { previewSourceFence, acceptsPreviewSource } from './server-state.ts';
import type { ApplicationClient } from '@devlab/ui-contracts';
import type {
  PreviewPaneSpec,
  PreviewWorkspace,
  PreviewSourceTarget,
} from './workspace.ts';
import type { PreviewServerOwner } from './server-state.ts';
import {
  loadPreferences,
  savePreferences,
  previewURL,
  type PreviewPreferences,
} from './preferences.ts';
import './preview.css';

export function PreviewPane({
  client,
  pane,
  workspace,
  servers,
  onSourceSelect,
  onCollapse,
  toolbarActions,
  configurationActions,
  paneActions,
  legacyIds = false,
  collapsed = false,
  theme,
}: {
  client: ApplicationClient;
  pane: PreviewPaneSpec;
  workspace: PreviewWorkspace;
  servers: PreviewServerOwner;
  onSourceSelect?: (target: PreviewSourceTarget) => void | Promise<void>;
  onCollapse?(): void;
  toolbarActions?: ReactNode;
  configurationActions?: ReactNode;
  paneActions?: ReactNode;
  legacyIds?: boolean;
  collapsed?: boolean;
  theme?: 'light' | 'dark';
}) {
  const projectId = pane.projectId;
  const semantic = (id: string) => (legacyIds ? id : pane.paneId + '.' + id);
  type Drawer = 'server' | 'view' | 'inspect' | 'tools' | 'prototype';
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const controlsId = pane.paneId + useId();
  const drawerTriggers = useRef<
    Partial<Record<Drawer, HTMLButtonElement | null>>
  >({});

  const frameDescription = 'Native browser frame · hardware acceleration depends on your browser. Full DevTools uses native browser controls.';
  const names: Record<Drawer, string> = {
    server: 'Server options',
    view: 'View',
    inspect: 'Inspect',
    tools: 'Tools',
    prototype: 'Prototype',
  };
  function closeDrawer() {
    if (drawer) {
      const trigger = drawerTriggers.current[drawer];
      const previousFocus = document.activeElement;
      setDrawer(null);
      requestAnimationFrame(() => {
        if (document.activeElement === previousFocus || document.activeElement === document.body) trigger?.focus();
      });
    }
  }
  useEffect(() => {
    setDrawer(null);
  }, [projectId]);
  const api = client.servers;
  const subscribe = useCallback(
    (listener: () => void) => servers.subscribe(projectId, listener),
    [servers, projectId],
  );
  const snapshot = useCallback(
    () => servers.snapshot(projectId),
    [servers, projectId],
  );
  const shared = useSyncExternalStore(subscribe, snapshot);
  const current = shared.state,
    working = shared.working;
  const needsSetup = current?.status === 'unconfigured' && !current.descriptor;
  const serverRunning = working === 'start' || ['ready', 'starting', 'installing'].includes(current?.status ?? '');
  const serverAction = serverRunning ? 'stop' : 'start';
  const serverDisabled = !api || !current || working === 'stop' ||
    (!serverRunning && (needsSetup || current.descriptor?.adapter === 'none'));
  const serverTitle = !api ? 'Project server capability is unavailable.' : !current ? 'Checking preview server…' :
    needsSetup ? 'Add a devlab.preview.json configuration before starting.' :
    current.descriptor?.adapter === 'none' ? 'This project has no browser UI.' :
    serverAction === 'stop' ? 'Stop preview server' : 'Start preview server';
  const serverError = current?.error;
  const [localError, setLocalError] = useState('');
  const preferences = {
    ...loadPreferences(projectId),
    view: pane.viewId,
    viewport: pane.viewport,
    collapsed,
  };
  const [reload, setReload] = useState(0),
    [loadedURL, setLoadedURL] = useState(''),
    [frameLoad, setFrameLoad] = useState(0);
  const [refreshState, setRefreshState] = useState({
    target: '',
    value: 'unknown',
  });
  const frame = useRef<HTMLIFrameElement>(null);
  const update = (patch: Partial<PreviewPreferences>) => {
    try {
      workspace.updatePane(pane.paneId, {
        ...(patch.view !== undefined ? { viewId: patch.view } : {}),
        ...(patch.viewport ? { viewport: patch.viewport } : {}),
      });
      if (legacyIds)
        savePreferences(projectId, { ...loadPreferences(projectId), ...patch });
      setLocalError('');
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  };
  useEffect(() => {
    setDrawer(null);
    setLoadedURL('');
    setLocalError('');
    setRefreshState({ target: '', value: 'unknown' });
  }, [projectId]);
  const command = (action: 'start' | 'stop') =>
    servers.command(projectId, action).catch(() => {});
  const views = current?.descriptor?.views ?? [];
  const view =
    views.find((v) => v.id === preferences.view) ??
    (!preferences.view ? views[0] : undefined);
  const viewMissing = Boolean(preferences.view && !view);
  const url =
    current?.status === 'ready' && !viewMissing
      ? previewURL(current.url, view?.path, view?.element ? theme : undefined)
      : null;
  // Navigation revisions fence source actions; they do not reload a retained frame.
  const targetKey = `${pane.paneId}:${projectId}:${current?.instanceId ?? 'legacy'}:${current?.generation ?? 0}:${url ?? ''}:${reload}`;
  const refreshMode = previewRefreshMode(current?.descriptor?.adapter);
  const observedRefresh =
    refreshState.target === targetKey ? refreshState.value : 'unknown';
  const refreshLabel =
    refreshMode === 'framework-hmr'
      ? observedRefresh === 'connected'
        ? 'Project HMR connected'
        : observedRefresh === 'disconnected'
          ? 'Project updates disconnected'
          : 'Vite HMR · connection unconfirmed'
      : refreshMode === 'reload-required'
        ? 'Reload after changes'
        : refreshMode === 'none'
          ? 'No UI preview'
          : 'Refresh capability unverified';
  const error = localError || shared.error;
  const sourceTarget = previewSourceFence(pane, current);
  const openSource = (path: string) => {
    if (!acceptsPreviewSource(workspace, servers, sourceTarget, path)) return;
    try {
      void Promise.resolve(
        onSourceSelect?.({
          paneId: pane.paneId,
          projectId,
          path,
          targetRevision: pane.targetRevision,
          instanceId: current!.instanceId,
          generation: current!.generation,
        }),
      ).catch((error) => {
        if (workspace.isCurrentTarget(sourceTarget))
          setLocalError(error instanceof Error ? error.message : String(error));
      });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <section
      id={`${controlsId}-pane`}
      className="project-preview-pane"
      data-feature-id="PROTOTYPING"
      aria-label={
        legacyIds ? 'Project UI preview' : `Project UI preview · ${projectId}`
      }
      hidden={collapsed}
      data-pane-id={pane.paneId}
      data-project-id={projectId}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && drawer) {
          event.preventDefault();
          event.stopPropagation();
          closeDrawer();
        }
      }}
    >
      <header
        className="project-preview-toolbar"
        aria-label="Project preview controls"
        data-devlab-source="plugins/ui-preview/src/pane.tsx"
        data-devlab-id={semantic('preview.toolbar')}
      >
        <strong title={`PROTOTYPING · ${projectId}`}>PROTOTYPING</strong>
        {toolbarActions}
        <span
          className="preview-status"
          role="status"
          aria-live="polite"
          title={error || serverError || current?.status}
          data-state={error || serverError ? 'error' : current?.status}
        >
          {error || serverError
            ? 'Error'
            : needsSetup ? 'Setup required' : (current?.status ?? (api ? 'Loading' : 'Unavailable'))}
        </span>
        <div
          className="preview-drawer-triggers"
          role="group"
          aria-label="Preview control groups"
        >
          <button
            type="button"
            className="preview-server-action"
            aria-label={working === 'stop' ? 'Stopping preview server' : `${serverAction === 'stop' ? 'Stop' : 'Start'} preview server`}
            data-devlab-source="plugins/ui-preview/src/pane.tsx"
            data-devlab-id={semantic(`preview.${serverAction}`)}
            disabled={serverDisabled}
            title={serverTitle}
            onClick={() => void command(serverAction)}
          >{working === 'stop' ? 'Stopping…' : serverAction === 'stop' ? 'Stop' : 'Start'}</button>
          {(['server', 'view', 'prototype', 'inspect', 'tools'] as Drawer[]).map((group) => (
            <button
              key={group}
              type="button"
              ref={(node) => {
                drawerTriggers.current[group] = node;
              }}
              id={`${controlsId}-${group}-trigger`}
              className={group === 'server' ? 'preview-server-options' : undefined}
              aria-label={names[group]}
              title={names[group]}
              aria-expanded={drawer === group}
              aria-controls={`${controlsId}-${group}-drawer`}
              data-devlab-source="plugins/ui-preview/src/pane.tsx"
              data-devlab-id={semantic(`preview.drawer.${group}`)}
              onClick={() =>
                setDrawer((value) => (value === group ? null : group))
              }
            >
              {group === 'server' ? <span aria-hidden="true">⌄</span> : names[group]}
            </button>
          ))}
        </div>
        {onCollapse && (
          <button
            type="button"
            className="preview-collapse"
            data-devlab-source="plugins/ui-preview/src/pane.tsx"
            data-devlab-id={semantic('preview.collapse')}
            aria-label="Collapse UI preview"
            aria-expanded={true}
            aria-controls={`${controlsId}-pane`}
            onClick={() => {
              setDrawer(null);
              onCollapse();
            }}
          >
            ›
          </button>
        )}
      </header>
      <section
        className="preview-drawer"
        role="region"
        hidden={drawer !== 'server'}
        id={`${controlsId}-server-drawer`}
        aria-labelledby={`${controlsId}-server-trigger`}
        data-devlab-source="plugins/ui-preview/src/pane.tsx"
        data-devlab-id={semantic('preview.panel.server')}
      >
        <div className="preview-drawer-content">
          <button type="button" className="preview-drawer-close" aria-label="Close preview drawer"
            title="Close Server controls" data-devlab-source="plugins/ui-preview/src/pane.tsx"
            data-devlab-id={semantic('preview.drawer.close.server')} onClick={closeDrawer}>×</button>
          <strong className="preview-server-caption">Server</strong>
          <small className="preview-server-state">{current?.status ?? 'Checking…'}</small>
          <button
            data-devlab-source="plugins/ui-preview/src/pane.tsx"
            data-devlab-id={semantic('preview.retry')}
            disabled={!!working}
            onClick={() => {
              void servers.refresh(projectId).catch(() => {});
              setReload((v) => v + 1);
            }}
          >
            Retry
          </button>
        </div>
      </section>
      <section
        className="preview-drawer preview-view-bar"
        role="region"
        hidden={drawer !== 'view'}
        id={`${controlsId}-view-drawer`}
        aria-labelledby={`${controlsId}-view-trigger`}
        data-devlab-source="plugins/ui-preview/src/pane.tsx"
        data-devlab-id={semantic('preview.panel.view')}
      >
        <div className="preview-drawer-content">
          {configurationActions}
          
          <label>
            View{' '}
            <select
              data-devlab-source="plugins/ui-preview/src/pane.tsx"
              data-devlab-id={semantic('preview.view')}
              value={view?.id ?? ''}
              disabled={!views.length || !!workspace.snapshot().expandedPaneId}
              onChange={(event) => update({ view: event.target.value })}
            >
              {!views.length && <option value="">App</option>}
              {viewMissing && (
                <option value={preferences.view}>
                  Unavailable · {preferences.view}
                </option>
              )}
              {views.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Viewport{' '}
            <select
              data-devlab-source="plugins/ui-preview/src/pane.tsx"
              data-devlab-id={semantic('preview.viewport')}
              value={preferences.viewport}
              disabled={!!workspace.snapshot().expandedPaneId}
              onChange={(event) =>
                update({
                  viewport: event.target
                    .value as PreviewPreferences['viewport'],
                })
              }
            >
              <option value="fit">Fit</option>
              <option value="desktop">Desktop · 1280</option>
              <option value="mobile">Mobile · 390</option>
            </select>
          </label>
          {paneActions}
          <small
            className="preview-view-refresh"
            role="img"
            aria-label={`Project refresh policy: ${refreshLabel}`}
            title={`${refreshLabel}. Compatible updates preserve preview; other changes may reload it.`}
            data-devlab-id={semantic('preview.refresh-policy')}
            data-devlab-source="plugins/ui-preview/src/pane.tsx"
          >
            <span aria-hidden="true">↻</span>
          </small>
          {url && (
            <a
              data-devlab-source="plugins/ui-preview/src/pane.tsx"
              data-devlab-id={semantic('preview.open')}
              aria-label="Open preview in new tab"
              title="Open preview in new tab"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span aria-hidden="true">↗</span>
            </a>
          )}
          <button
            type="button"
            aria-label="Close preview drawer"
            title="Close View controls"
            data-devlab-source="plugins/ui-preview/src/pane.tsx"
            data-devlab-id={semantic('preview.drawer.close.view')}
            onClick={closeDrawer}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </section>
      <section
        className="preview-drawer"
        role="region"
        hidden={drawer !== 'inspect'}
        id={`${controlsId}-inspect-drawer`}
        aria-labelledby={`${controlsId}-inspect-trigger`}
        data-devlab-source="plugins/ui-preview/src/pane.tsx"
        data-devlab-id={semantic('preview.panel.inspect')}
      >
        <div className="preview-drawer-content">
          <button type="button" className="preview-drawer-close" aria-label="Close preview drawer"
            title="Close Inspect controls" data-devlab-source="plugins/ui-preview/src/pane.tsx"
            data-devlab-id={semantic('preview.drawer.close.inspect')} onClick={closeDrawer}>×</button>
          {url && current && view?.element && <ElementSourceTools key={`element:${targetKey}`}
            client={client} element={view.element} target={sourceTarget} viewId={view.id} viewLabel={view.label} url={url} theme={theme}
            workspace={workspace} servers={servers} onSourceSelect={onSourceSelect ? openSource : undefined}
            active={drawer === 'inspect' && !preferences.collapsed} semanticPrefix={legacyIds ? '' : pane.paneId + '.'} />}
          {url && current && (
            <ElementInspector
              key={targetKey}
              active={drawer === 'inspect' && !preferences.collapsed}
              frame={frame}
              projectId={projectId}
              generation={`${current.instanceId ?? 'legacy'}-${current.generation}`}
              url={url}
              targetKey={`${loadedURL}:${frameLoad}`}
              onRefreshState={(value) =>
                setRefreshState((previous) =>
                  previous.target === targetKey && previous.value === value
                    ? previous
                    : { target: targetKey, value },
                )
              }
              onSourceSelect={openSource}
              semanticPrefix={legacyIds ? '' : pane.paneId + '.'}
              tokenFiles={current.descriptor?.tokens}
            />
          )}
        </div>
      </section>
      <section
        className="preview-drawer"
        role="region"
        hidden={drawer !== 'tools'}
        id={`${controlsId}-tools-drawer`}
        aria-labelledby={`${controlsId}-tools-trigger`}
        data-devlab-source="plugins/ui-preview/src/pane.tsx"
        data-devlab-id={semantic('preview.panel.tools')}
      >
        <div className="preview-drawer-content">
          <button type="button" className="preview-drawer-close" aria-label="Close preview drawer"
            title="Close Tools controls" data-devlab-source="plugins/ui-preview/src/pane.tsx"
            data-devlab-id={semantic('preview.drawer.close.tools')} onClick={closeDrawer}>×</button>
          {current?.status === 'ready' && (
            <DevToolsControls
              key={projectId}
              client={client}
              projectId={projectId}
              semanticPrefix={legacyIds ? '' : pane.paneId + '.'}
              paneId={pane.paneId}
              viewId={view?.id}
            />
          )}
          <p className="project-preview-capability" title={frameDescription}>{frameDescription}</p>
        </div>
      </section>
      {(error || serverError) && (
        <p className="project-preview-error" role="alert">
          {error || serverError}
        </p>
      )}
      <section id={`${controlsId}-prototype-drawer`} aria-labelledby={`${controlsId}-prototype-trigger`} hidden={drawer !== 'prototype'} className="preview-preimp-host">
        <PrototypePanel client={client} projectId={projectId} open={drawer === 'prototype'} />
      </section>
      {url ? (
        <div
          className="project-preview-stage"
          style={drawer === 'prototype' ? { display: 'none' } : undefined}
          data-viewport={preferences.viewport}
        >
          {loadedURL !== targetKey && (
            <span className="project-preview-loading" role="status">
              Loading project page…
            </span>
          )}
          <iframe
            ref={frame}
            key={targetKey}
            className="project-preview-frame"
            title={`Project UI · ${projectId}`}
            src={url}
            data-devlab-source="plugins/ui-preview/src/pane.tsx"
            data-devlab-id={semantic('preview.frame')}
            data-devlab-project-id={projectId}
            data-pane-id={pane.paneId}
            data-devlab-generation={String(current?.generation ?? 0)}
            data-devlab-instance-id={current?.instanceId}
            referrerPolicy="no-referrer"
            onLoad={(event) => {
              if (event.currentTarget !== frame.current) return;
              setLoadedURL(targetKey);
              setFrameLoad((value) => value + 1);
            }}
          />
        </div>
      ) : (
        <div className="project-preview-empty" role="status" style={drawer === 'prototype' ? { display: 'none' } : undefined}>
          <p>{viewMissing
            ? 'The selected preview view is unavailable. Choose an existing view.'
            : !api
              ? 'Project server capability is unavailable.'
              : current?.descriptor?.adapter === 'none'
                ? 'This project has no browser UI.'
                : current?.status === 'unconfigured' ||
                    current?.status === 'invalid'
                  ? 'Preview configuration needs attention. See Server options for details.'
                  : current?.status === 'installing'
                    ? 'Installing project dependencies…'
                    : current?.status === 'starting'
                      ? 'Waiting for the project server…'
                      : !current ? 'Checking project preview…' : 'Start this project to preview its UI.'}</p>
        </div>
      )}
    </section>
  );
}
