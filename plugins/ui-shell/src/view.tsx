import { HerdrWorkspace } from './herdr.tsx';
import { IconButton, SettingsPanel } from './controls.tsx';
import { useWorkspaceFocus } from './workspace-focus.ts';
import { useTerminalDock } from './terminals.tsx';
import { ServerSessions } from './servers.tsx';
import creoAureaLogo from './creo-aurea-devlab.png';
import {
  useEffect,
  useRef,
  useId,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  FolderOpen,
  ChevronDown,
  GitBranch,
  Palette,
  Layout,
  AlignCenter,
  LayoutGrid,
  Map as MapIcon,
  Wrench,
  ListChecks,
  RotateCcw,
  Trash2,
  Download,
  Upload,
  Settings2,
  Sun,
  Moon,
  Terminal,
  TerminalSquare,
  X,
  Maximize2,
  Minimize2,
  Save,
  Undo2,
  Redo2,
} from 'lucide-react';
import {
  CanvasGraphSchema,
  type PluginHealth,
} from '@devlab/contracts';
import type { CanvasWorkspaceState, UIPluginProps, RulesViewTab } from '@devlab/ui-contracts';

const EMPTY: CanvasWorkspaceState = {
  projectId: 'default',
  graph: { name: 'My Agent Flow', nodes: [], edges: [] },
  revision: 0,
  selectedNodeId: null,
  dirty: false,
  loading: false,
  saving: false,
  error: '',
  canUndo: false,
  canRedo: false,
};
const subscribeEmpty = () => () => {};
const emptySnapshot = () => EMPTY;
/** Original workspace geometry and visual tokens; all data access crosses typed ports. */
export function WorkspaceShell({
  onDevelopPlugin,
  previewWorkspace,
  client,
  workspace,
  renderCanvas,
  renderHood,
  renderRules,
  projectWorkspace,
  renderProjects,
  renderPreview,
  renderTerminal,
}: UIPluginProps) {
  const state = useSyncExternalStore(
    workspace?.subscribe ?? subscribeEmpty,
    workspace?.snapshot ?? emptySnapshot,
  );
  const projectState = useSyncExternalStore(
    projectWorkspace?.subscribe ?? subscribeEmpty,
    projectWorkspace?.snapshot ?? (() => null),
  );
  const [rootView, setRootView] = useState<'workspace' | 'devlab'>('workspace');
  const effectiveRootView = projectState?.projects.length ? (projectState.projects.find(project => project.id === projectState.projectId)?.development ? 'devlab' : 'workspace') : rootView;
  const rootLocations = useRef({ workspace: { projectId: 'default', groupId: 'current' }, devlab: { projectId: '', groupId: 'current' } });
  const [navigationError, setNavigationError] = useState('');
  const rememberRoot = () => {
    rootLocations.current[effectiveRootView] = { projectId: projectWorkspace?.snapshot().projectId ?? 'default', groupId: previewWorkspace?.snapshot().groupId ?? 'current' };
  };
  const selectRoot = async (next: 'workspace' | 'devlab') => {
    if (!projectWorkspace) return;
    if (next === effectiveRootView) { await projectWorkspace.select(projectWorkspace.snapshot().projectId); return; }
    rememberRoot();
    const target = rootLocations.current[next];
    const projectId = target.projectId || projectWorkspace.snapshot().projects.find(project => !!project.development === (next === 'devlab'))?.id;
    if (!projectId) return;
    try {
      if (await projectWorkspace.select(projectId) === false) return;
      if (previewWorkspace?.snapshot().groups.some(group => group.id === target.groupId)) previewWorkspace.selectGroup(target.groupId);
      setRootView(next);
      setNavigationError('');
    } catch (error) { setNavigationError(String(error)); }
  };
  const [inspection, setInspection] = useState<'hood' | 'rules' | null>(null);
  const [rulesTab, setRulesTab] = useState<RulesViewTab>('rules');
  const inspectionTrigger = useRef<HTMLElement | null>(null);
  const openInspection = (view: 'hood' | 'rules') => {
    if (!inspection) inspectionTrigger.current = document.activeElement as HTMLElement | null;
    setInspection(view);
  };
  const closeInspection = () => {
    setInspection(null);
    requestAnimationFrame(() => { if (inspectionTrigger.current?.isConnected) inspectionTrigger.current.focus(); });
  };
  const previewFocus = useWorkspaceFocus();
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem('devlab:theme') !== 'light';
    } catch {
      return true;
    }
  });
  const [explorer, setExplorer] = useState(true),
    [paletteVisible, setPaletteVisible] = useState(true);
  const projectsId = useId();
  const projectsElement = useRef<HTMLDivElement>(null);
  const workspaceBody = useRef<HTMLDivElement>(null);
  const drawerTrigger = useRef<HTMLElement | null>(null);
  const [compact, setCompact] = useState(() => matchMedia('(max-width: 1100px)').matches);
  const [compactDrawer, setCompactDrawer] = useState<'projects' | 'catalog' | null>(null);
  const projectsOpen = compact ? compactDrawer === 'projects' : explorer;
  const catalogOpen = compact ? compactDrawer === 'catalog' : paletteVisible;
  const restoreDrawerFocus = () => { requestAnimationFrame(() => { if (drawerTrigger.current?.isConnected) drawerTrigger.current.focus(); }); };
  const setProjectsOpen = (next: boolean) => {
    if (next) drawerTrigger.current = document.activeElement as HTMLElement;
    if (compact) setCompactDrawer(next ? 'projects' : null); else setExplorer(next);
    if (!next) restoreDrawerFocus();
  };
  const setCatalogOpen = (next: boolean) => {
    if (next) drawerTrigger.current = document.activeElement as HTMLElement;
    if (compact) setCompactDrawer(next ? 'catalog' : null); else setPaletteVisible(next);
    if (!next) restoreDrawerFocus();
  };
  useEffect(() => {
    const media = matchMedia('(max-width: 1100px)');
    const change = () => { setCompact(media.matches); setCompactDrawer(null); };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!compactDrawer) return;
    const tick = requestAnimationFrame(() => {
      const region = compactDrawer === 'projects' ? projectsElement.current : workspaceBody.current?.querySelector('.node-palette');
      region?.querySelector<HTMLElement>('button:not(:disabled),input:not(:disabled),summary')?.focus();
    });
    return () => cancelAnimationFrame(tick);
  }, [compactDrawer]);

  const [minimapVisible, setMinimapVisible] = useState(() => {
    try {
      return localStorage.getItem('devlab:workflow-minimap') !== 'false';
    } catch {
      return true;
    }
  });
  const [settings, setSettings] = useState(false),
    [menu, setMenu] = useState(false);
  const [execution, setExecution] = useState(false),
    [maximized, setMaximized] = useState(false),
    [terminalTab, setTerminalTab] = useState(false),
    [serverTab, setServerTab] = useState(false);
  const [terminalMounted, setTerminalMounted] = useState(false);
  // Older retained owners keep the legacy flags until the user deliberately reloads.
  const outputOpen = projectState?.output === undefined ? execution : projectState.output !== null;
  const outputTerminal = projectState?.output === undefined ? terminalTab : projectState.output === 'terminal';
  const outputHerdr = projectState?.output === 'herdr';
  const [herdrMounted, setHerdrMounted] = useState(outputHerdr);
  const outputServers = projectState?.output === undefined ? serverTab : projectState.output === 'servers';
  const outputTrigger = useRef<HTMLElement | null>(null);
  const closeOutput = (restoreFocus = true) => {
    projectWorkspace?.setOutput?.(null);
    setExecution(false); 
    if (restoreFocus) requestAnimationFrame(() => { if (outputTrigger.current?.isConnected) outputTrigger.current.focus(); });
  };
  const openOutput = (view: 'terminal' | 'servers' | 'herdr') => {
    outputTrigger.current = document.activeElement as HTMLElement;
    if (view === 'terminal') setTerminalMounted(true);
    if (view === 'herdr') setHerdrMounted(true);
    projectWorkspace?.setOutput?.(view);
    setServerTab(view === 'servers'); setTerminalTab(view === 'terminal');
     setExecution(true);
  };
  const selectOutput = (view: 'terminal' | 'servers') => {
    const same = view === 'servers' ? outputServers : outputTerminal;
    if (outputOpen && same) closeOutput(); else openOutput(view);
  };
  const [error, setError] = useState('');
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [health, setHealth] = useState<PluginHealth[] | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const terminalDock = useTerminalDock({
    client,
    workspace,
    renderTerminal,
    active: outputOpen && outputTerminal && !outputServers,
    show: () => openOutput('terminal'),
  });
  const terminalVisible = outputOpen && outputTerminal && !outputServers;
  const mainTerminal = terminalVisible && terminalDock.expanded && !previewFocus.mode;
  const selectCanvasView = (mode: 'flow' | 'build') => {

    terminalDock.showDock();
    closeOutput(false);
    projectWorkspace?.setMode(mode);
  };
  const graph = state.graph;
  const action = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const update = (next: typeof graph) => {
    try {
      workspace?.update(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const layout = () => workspace?.arrange?.(true);
  const alignSelected = () => {
    if (projectState?.mode === 'build' || mainTerminal || outputHerdr) return;
    workspace?.arrange?.();
  };
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (inspection) {
        if (event.key === 'Escape') { event.preventDefault(); closeInspection(); }
        return;
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      // Interactive terminal programs own their Escape and control-key sequences.
      if (target?.closest('.devlab-terminal')) return;
      if (event.key === 'Escape') {
        if (settings || health || menu) { event.preventDefault(); setSettings(false); setHealth(null); setMenu(false); return; }
        if (outputOpen) { event.preventDefault(); closeOutput(); return; }
        if (compactDrawer) { event.preventDefault(); setCompactDrawer(null); restoreDrawerFocus(); return; }
        if (previewFocus.mode) { event.preventDefault(); void previewFocus.exit(); return; }
        setSettings(false);
        setMenu(false);
        setHealth(null);
        workspace?.select(null);
      }
      const editing =
        !!target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
        target.isContentEditable);
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        void workspace?.save();
      }
      if (event.key === '`') {
        event.preventDefault();
        terminalVisible ? closeOutput() : openOutput('terminal');
      }
      if (!editing && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? workspace?.redo() : workspace?.undo();
      }
      if (!editing && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        alignSelected();
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  });
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (state.dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [state.dirty]);
  const exportFlow = () => {
    const blob = new Blob(
      [JSON.stringify({ ...graph, version: '2.0.0' }, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob),
      anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${graph.name.replace(/[^\w-]+/g, '-')}.flow.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const icon = (
    title: string,
    child: ReactNode,
    fn: () => void,
    testId?: string,
    disabled = false,
  ) => (
    <IconButton
      key={title}
      title={title}
      onClick={fn}
      testId={testId}
      disabled={disabled}
    >
      {child}
    </IconButton>
  );
  const outputPanel = (
      <div className="execution-panel" role="region" aria-label="Workspace output" data-devlab-id="workspace.output.drawer" data-devlab-source="plugins/ui-shell/src/view.tsx" hidden={!outputOpen} data-terminal-workspace={mainTerminal || outputHerdr} style={outputHerdr ? {height:'100%',maxHeight:'none'} : outputTerminal && !outputServers ? { height: mainTerminal ? '100%' : terminalDock.height, maxHeight: mainTerminal ? 'none' : '60vh' } : {height:maximized?'72vh':'clamp(160px,28vh,320px)',maxHeight:maximized?'72vh':'36vh'}} >
        {(terminalMounted || outputTerminal) && <div className="workspace-terminal-retained" hidden={!outputOpen || !outputTerminal || outputServers}>{terminalDock.panel}</div>}
        {outputOpen && outputServers && <ServerSessions client={client} />}
        {(herdrMounted || outputHerdr) && <div className="workspace-terminal-retained" hidden={!outputOpen || !outputHerdr}><HerdrWorkspace client={client} projectId={state.projectId} active={outputOpen && outputHerdr} renderTerminal={renderTerminal} /></div>}
      </div>
  );
  const editingStage = (
    <>
      <div
        className="project-flow-stage"
        style={{ display: mainTerminal || outputHerdr || projectState?.mode === 'build' || previewFocus.mode ? 'none' : 'flex' }}
      >
        {renderCanvas ? (
          renderCanvas({
        paletteVisible: catalogOpen,
        setPaletteVisible: setCatalogOpen,
            minimapVisible,
            setMinimapVisible: (next) => {
              setMinimapVisible(next);
              try { localStorage.setItem('devlab:workflow-minimap', String(next)); } catch {}
            },
            dockedTerminal: terminalDock.dockedTerminal,
            dockedTerminals: terminalDock.dockedTerminals,
            onTerminalStarted: terminalDock.onTerminalStarted,
            terminalPresentationActive: !mainTerminal && !outputHerdr && projectState?.mode !== 'build' && !previewFocus.mode,
          })
        ) : (
          <div className="canvas-loading">Loading canvas module…</div>
        )}
      </div>
      {renderProjects && (
        <div className="project-build-stage" hidden={mainTerminal || outputHerdr || projectState?.mode !== 'build' || !!previewFocus.mode}>
          {renderProjects({ view: 'canvas' })}
        </div>
      )}
      {outputPanel}
    </>
  );
  return (
    <div
      className={`devlab${dark ? ' dark' : ''}`}
      data-canvas-mode={projectState?.mode ?? 'flow'}
      data-terminal-mainview={mainTerminal || outputHerdr}
      ref={previewFocus.root}
      data-preview-focused={!!previewFocus.mode}
      data-preview-focus-mode={previewFocus.mode ?? ''}
      data-testid="flow-editor-root"
    >
      <div className="toolbar">
        <div className="project-mode-toggle" aria-label="Root workspace">
          <button type="button" aria-pressed={effectiveRootView === 'workspace'} onClick={() => void selectRoot('workspace')}>Workspace</button>
          <button type="button" aria-pressed={effectiveRootView === 'devlab'} disabled={!projectState?.projects.some(project => project.development)} onClick={() => void selectRoot('devlab')}>DEVLAB</button>
        </div>
        {navigationError && <span role="alert">{navigationError}</span>}
        <div className="devlab-brand">
          <img className="devlab-brand-logo" src={creoAureaLogo} alt="Creo Aurea devLAB" width="326" height="100" />
          <div>
            <small>
              v2 · Agent Editor{state.saving && <span title="Saving…"> ·</span>}
            </small>
          </div>
        </div>
        {projectWorkspace ? (
          <>
            <select
              className="project-switcher"
              aria-label="Active project"
              value={state.projectId}
              disabled={projectState?.busy}
              onChange={(e) =>
                void projectWorkspace.select(e.target.value).catch(() => {})
              }
            >
              {projectState?.projects.filter(project => !!project.development === (effectiveRootView === 'devlab')).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.label}
                </option>
              ))}
            </select>
        <div className="project-mode-toggle workspace-view-switch" aria-label="Workspace view">
              <button
            aria-pressed={!mainTerminal && !outputHerdr && projectState?.mode === 'flow'}
            onClick={() => selectCanvasView('flow')}
              >
                Workflow
              </button>
              <button
            aria-pressed={!mainTerminal && !outputHerdr && projectState?.mode === 'build'}
            onClick={() => selectCanvasView('build')}
              >
                Build canvas
              </button>
          <button type="button" aria-pressed={mainTerminal} data-testid="workspace-view-terminals" data-devlab-id="workspace.view.terminals" data-devlab-source="plugins/ui-shell/src/view.tsx" onClick={() => {   terminalDock.showMain(); }}>Terminals</button>
          {client.herdr && <button type="button" aria-pressed={outputHerdr} data-testid="workspace-view-herdr" onClick={() => openOutput('herdr')}>Herdr</button>}
            </div>
          </>
        ) : (
          <button className="project-switcher" disabled>
            <FolderOpen size={12} />
            Default Project
            <ChevronDown size={10} />
          </button>
        )}
        <div className="workspace-flow-tools">
        <input
          aria-label="Flow name"
          data-testid="flow-name-input"
          className="flow-title"
          value={nameDraft ?? graph.name}
          disabled={!workspace || state.loading}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => {
            if (nameDraft?.trim()) update({ ...graph, name: nameDraft.trim() });
            setNameDraft(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <span className="graph-badge">
          <GitBranch size={9} />
          {graph.nodes.length}n · {graph.edges.length}e · {graph.nodes.filter(node => node.type === 'piAgent' || node.type === 'subagent').length}ag
        </span>
        <label className="canvas-color" title="Canvas background color">
          <Palette size={13} />
          <input
            type="color"
            aria-label="Canvas background color"
            value={
              typeof graph.background === 'string'
                ? graph.background
                : '#0d1117'
            }
            onChange={(e) => update({ ...graph, background: e.target.value })}
            disabled={!workspace}
          />
        </label>
        <div className="toolbar-spacer" />
        {icon(
          'Layout nodes',
          <Layout size={13} />,
          layout,
          'btn-layout',
          !workspace?.arrange || projectState?.mode === 'build',
        )}
        {icon(
          'Align selected nodes',
          <AlignCenter size={13} />,
          alignSelected,
          'btn-align-selected',
          !workspace?.arrange || projectState?.mode === 'build' || graph.nodes.filter(node => node.selected).length < 2,
        )}
        <IconButton
          title="Toggle Node Catalog"
          onClick={() => setCatalogOpen(!catalogOpen)}
          testId="btn-toggle-catalog"
          active={catalogOpen}
        >
          <LayoutGrid size={13} />
        </IconButton>
        <button
          type="button"
          className={`icon-button${minimapVisible ? ' active-icon' : ''}`}
          title="Toggle workflow minimap"
          aria-label="Toggle workflow minimap"
          aria-pressed={minimapVisible}
          data-testid="btn-toggle-minimap"
          data-devlab-id="workspace.minimap-toggle"
          data-devlab-source="plugins/ui-shell/src/view.tsx"
          disabled={!renderCanvas || projectState?.mode === 'build'}
          onClick={() => {
            const next = !minimapVisible;
            setMinimapVisible(next);
            try {
              localStorage.setItem('devlab:workflow-minimap', String(next));
            } catch {
              // The view preference remains usable without browser storage.
            }
          }}
        >
          <MapIcon size={13} aria-hidden="true" />
        </button>
        </div>
        {mainTerminal && terminalDock.toolbar}
        <div className="terminal-toolbar-spacer" aria-hidden="true" />
        {icon(
          'Pop the Hood',
          <Wrench size={13} />,
          () => openInspection('hood'),
          'btn-hood',
          !renderHood,
        )}
        <button type="button" className="icon-button" title="Rules Board" aria-label="Rules Board" aria-haspopup="dialog"
          disabled={!renderRules} data-testid="btn-rules" data-devlab-id="workspace.rules.open" data-devlab-source="plugins/ui-shell/src/view.tsx"
          onClick={() => { setRulesTab('rules'); openInspection('rules'); }}><ListChecks size={13} aria-hidden="true" /></button>

        <div className="workspace-flow-tools">
        {icon(
          'Reload saved graph',
          <RotateCcw size={13} />,
          () => {
            if (
              !state.dirty ||
              confirm('Discard unsaved edits and reload the saved graph?')
            )
              void workspace?.reload();
          },
          'btn-load-default',
          !workspace,
        )}
        {icon(
          'Clear canvas',
          <Trash2 size={13} />,
          () => {
            if (confirm('Clear all nodes and connections?'))
              update({ ...graph, nodes: [], edges: [] });
          },
          'btn-clear',
          !workspace || projectState?.mode === 'build',
        )}
        {icon(
          'Export flow',
          <Download size={13} />,
          exportFlow,
          'btn-export',
          !workspace,
        )}
        {icon(
          'Import flow',
          <Upload size={13} />,
          () => input.current?.click(),
          'btn-import',
          !workspace,
        )}
        </div>
        <div className="gear-menu">
          {icon(
            'Settings',
            <Settings2 size={13} />,
            () => setMenu((v) => !v),
            'btn-gear',
          )}
          {menu && (
            <div className="settings-menu">
              <button
                data-testid="menu-api-keys"
                onClick={() => {
                  setSettings(true);
                  setMenu(false);
                }}
              >
                Keyboard shortcuts
              </button>
              <a href="/?view=kernel">Kernel Lab</a>
            </div>
          )}
        </div>
        {icon(
          dark ? 'Light mode' : 'Dark mode',
          dark ? <Sun size={13} /> : <Moon size={13} />,
          () => {
            setDark((v) => !v);
            try {
              localStorage.setItem('devlab:theme', dark ? 'light' : 'dark');
            } catch {
              /* Theme still works in memory. */
            }
          },
          'btn-theme-toggle',
        )}
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          hidden
          data-testid="flow-import-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            void action(async () => {
              if (file.size > 2 * 1024 * 1024)
                throw new Error('Flow file exceeds 2 MiB');
              const value = JSON.parse(await file.text()) as Record<
                string,
                unknown
              >;
              const next = CanvasGraphSchema.parse(value.graph ?? value);
              workspace?.update(next);
              workspace?.select(null);
            });
          }}
        />
      </div>
      {(state.error || error || projectState?.error) && (
        <div className="workspace-error" role="alert">
          {state.error || error || projectState?.error}
          <button
            onClick={() => {
              setError('');
              projectWorkspace?.clearError();
            }}
            aria-label="Dismiss notification"
          >
            <X size={12} />
          </button>
        </div>
      )}
      <div className="workspace-body" ref={workspaceBody} data-compact={compact}>
        <div className="workspace-projects" ref={projectsElement} id={projectsId} hidden={!projectsOpen} data-devlab-id="workspace.projects.drawer" data-devlab-source="plugins/ui-shell/src/view.tsx">
          {renderProjects ? renderProjects({view:'explorer', developmentOnly: effectiveRootView === 'devlab', collapse:()=>setProjectsOpen(false), onInspectRules: (tab) => { setRulesTab(tab); openInspection('rules'); }}) : <div className="project-explorer-container"><div className="project-explorer-empty">Project adapter is unavailable</div></div>}
        </div>
        <div className="project-explorer-collapsed" hidden={projectsOpen}>
          <button className="tree-action-btn" aria-label="Expand project explorer" aria-expanded={projectsOpen} aria-controls={projectsId} data-devlab-id="workspace.projects.open" data-devlab-source="plugins/ui-shell/src/view.tsx" onClick={()=>setProjectsOpen(true)}><FolderOpen size={14}/></button>
        </div>
      <div className="workspace-main-stage">
      {renderPreview
          ? renderPreview({
                theme: dark ? 'dark' : 'light',
              projectId: projectState?.projectId ?? 'default',
              workspaceFocused: !!previewFocus.mode,
              fullscreen: { native: previewFocus.mode === 'native', pending: previewFocus.pending,
                enter: previewFocus.enter, exit: previewFocus.exit },
              initialEditorRatio: mainTerminal ? 60 : undefined,
            children: editingStage,
              onSourceSelect: (path) => void projectWorkspace?.openFile(path),
            })
          : editingStage}
      </div>
      <div className="workspace-output-space" hidden={!outputOpen || mainTerminal || outputHerdr} aria-hidden="true" style={{height: terminalVisible ? terminalDock.height : maximized ? '72vh' : 'clamp(160px,28vh,320px)', maxHeight: terminalVisible ? '60vh' : maximized ? '72vh' : '36vh'}} />
      </div>
      <div className="execution-tabs workspace-rail" data-testid="workspace-rail" data-devlab-id="workspace.rail" data-devlab-source="plugins/ui-shell/src/view.tsx">
        {renderPreview && <>
          <button type="button" aria-label={previewFocus.mode ? 'Exit preview focus' : 'Focus previews'} aria-pressed={!!previewFocus.mode} data-devlab-id="workspace.preview.focus" data-devlab-source="plugins/ui-shell/src/view.tsx" onClick={event=>{if(previewFocus.mode)void previewFocus.exit();else previewFocus.maximize(event.currentTarget);}}><LayoutGrid size={12}/><span>{previewFocus.mode?'Exit focus':'Previews'}</span></button>
          <button type="button" hidden={!!previewFocus.mode} aria-label="Fullscreen preview workspace" disabled={previewFocus.pending} data-devlab-id="workspace.preview.fullscreen" data-devlab-source="plugins/ui-shell/src/view.tsx" onClick={event=>void previewFocus.enter(event.currentTarget)}><Maximize2 size={12}/></button>
          {previewFocus.error && <small role="status" className="workspace-focus-error" title={previewFocus.error}>{previewFocus.error}</small>}
        </>}

          <Terminal size={12} />
          <div
            className="agent-tabs"
            role={terminalVisible && !terminalDock.expanded ? 'tablist' : undefined}
          aria-multiselectable={terminalVisible && !terminalDock.expanded ? true : undefined}
            aria-label={
              terminalVisible && !terminalDock.expanded ? 'Terminal sessions' : undefined
            }
            data-devlab-id="workspace.output.tabs"
            data-devlab-source="plugins/ui-shell/src/view.tsx"
          >
            {terminalVisible ? terminalDock.tabs : null}
          </div>
          <button
            className={outputTerminal && !outputServers ? 'active-tab' : ''}
            aria-pressed={outputOpen && outputTerminal && !outputServers}
            data-devlab-id="workspace.output.terminal"
            data-devlab-source="plugins/ui-shell/src/view.tsx"
            onClick={() => {
              if (terminalVisible && !terminalDock.expanded) closeOutput();
              else terminalDock.showDock();
            }}
          >
            <TerminalSquare size={9} /> Terminal
          </button>
          <button
            className={outputServers ? 'active-tab' : ''}
            aria-pressed={outputOpen && outputServers}
            data-devlab-id="workspace.output.servers"
            data-devlab-source="plugins/ui-shell/src/view.tsx"
            onClick={() => {
              selectOutput('servers');
            }}
          >
            Servers
          </button>
          {icon(
            outputOpen ? 'Hide output' : 'Show output',
            <ChevronDown size={13} />,
            () => { if (outputOpen) closeOutput(); else { openOutput('terminal'); } },
            'execution-toggle',
          )}
          {outputOpen && (
            <>
              {icon(
                maximized ? 'Restore output size' : 'Enlarge output',
                maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />,
                () => setMaximized((v) => !v),
              )}
              {icon('Close lower panel', <X size={13} />, () =>
                closeOutput(),
              )}
            </>
          )}
<span className="toolbar-spacer" />
        <button
          className="footer-save"
          data-testid="save-graph"
          onClick={() => void workspace?.save()}
          disabled={!workspace || state.loading || state.saving}
        >
          <Save size={11} />
          <span data-testid="save-state">
            {state.loading
              ? 'Loading…'
              : state.saving
                ? 'Saving…'
                : state.dirty
                  ? 'Unsaved changes'
                  : state.revision
                    ? 'Saved'
                    : 'New flow'}
          </span>
        </button>
        <IconButton
          title="Undo"
          onClick={() => workspace?.undo()}
          disabled={!state.canUndo}
        >
          <Undo2 size={11} />
        </IconButton>
        <IconButton
          title="Redo"
          onClick={() => workspace?.redo()}
          disabled={!state.canRedo}
        >
          <Redo2 size={11} />
        </IconButton>
      </div>
      {(settings || health) && <SettingsPanel health={health} onClose={() => { setSettings(false); setHealth(null); }} />}
      {inspection === 'hood' &&
        renderHood?.({
          onClose: closeInspection,
          onDevelopPlugin: onDevelopPlugin ? async (pluginId) => {
            rememberRoot();
            const intent = projectWorkspace?.navigationRevision?.();
            await onDevelopPlugin(pluginId);
            if (intent !== undefined && projectWorkspace?.navigationRevision?.() !== intent + 1) return;
            setRootView('devlab');
            rootLocations.current.devlab = { projectId: projectWorkspace!.snapshot().projectId, groupId: previewWorkspace?.snapshot().groupId ?? 'current' };
            setProjectsOpen(true);
            closeInspection();
          } : undefined,
          projectId:
            state.projectId === 'default' ? 'workspace' : state.projectId,
        })}
      {inspection === 'rules' && renderRules?.({
        onClose: closeInspection,
        projectId: projectState?.projectId ?? state.projectId,
        initialTab: rulesTab,
      })}
    </div>
  );
}
