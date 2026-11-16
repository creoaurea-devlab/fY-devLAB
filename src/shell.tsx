import { openPreviewSource } from '@devlab/ui-preview';
import {
  Component,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { UIRegistry } from '@devlab/ui-host';
import type {
  ApplicationClient,
  UIPlugin,
  CanvasWorkspace,
  ProjectWorkspace,
  PreviewWorkspace,
} from '@devlab/ui-contracts';
class PanelBoundary extends Component<
  { children: ReactNode; resetKey: number },
  { error: string }
> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  componentDidUpdate(previous: { children: ReactNode; resetKey: number }) {
    if (this.state.error && previous.resetKey !== this.props.resetKey)
      this.setState({ error: '' });
  }
  render() {
    return this.state.error ? (
      <section className="panel error" role="alert">
        Panel unavailable: {this.state.error}
      </section>
    ) : (
      this.props.children
    );
  }
}
interface Props {
  registry: UIRegistry;
  catalog: readonly UIPlugin[];
  toggle: (plugin: UIPlugin) => void;
  client: ApplicationClient;
  workspace?: CanvasWorkspace;
  projectWorkspace?: ProjectWorkspace;
  previewWorkspace?: PreviewWorkspace;
}
export function Shell({
  registry,
  catalog,
  toggle,
  client,
  workspace: baseWorkspace,
  projectWorkspace,
  previewWorkspace,
}: Props) {
  const projectState = useSyncExternalStore(
    projectWorkspace?.subscribe ?? (() => () => {}),
    projectWorkspace?.snapshot ?? (() => null),
  );
  const workspace = projectState?.workspace ?? baseWorkspace;
  const plugins = useSyncExternalStore(registry.subscribe, registry.snapshot);
  const revision = registry.revision();
  const [draft, setDraft] = useState(() => {
      try {
        return sessionStorage.getItem('devlab:draft') ?? '';
      } catch {
        return '';
      }
    }),
    [error, setError] = useState('');
  const updateDraft = (value: string) => {
    setDraft(value);
    try {
      sessionStorage.setItem('devlab:draft', value);
    } catch {
      /* In-memory draft remains usable when browser storage is unavailable. */
    }
  };
  const togglePanel = (plugin: UIPlugin) => {
    try {
      toggle(plugin);
      setError('');
    } catch (e) {
      setError(String(e));
    }
  };
  const workspacePlugin = plugins.find((p) => p.slot === 'workspace');
  if (
    workspacePlugin &&
    new URLSearchParams(location.search).get('view') !== 'kernel'
  ) {
    const canvas = plugins.find((p) => p.slot === 'canvas');
    const terminal = plugins.find((p) => p.slot === 'terminal');
    const browser = plugins.find((p) => p.slot === 'browser');
    const hood = plugins.find((p) => p.slot === 'hood');
    const rules = plugins.find((p) => p.id === 'ui-rules');
    const projects = plugins.find((p) => p.slot === 'project');
    const preview = plugins.find((p) => p.slot === 'preview');
    return (
      <PanelBoundary resetKey={revision}>
        <workspacePlugin.Component
          onDevelopPlugin={client.projects?.fork && client.servers && projectWorkspace && previewWorkspace ? async (pluginId) => {
            const sourceProjectId = projectWorkspace.snapshot().projectId;
            let intent = projectWorkspace.navigationRevision?.();
            const current = () => projectWorkspace.navigationRevision?.() === intent;
            const elementIds = new Set(registry.catalog().find(plugin => plugin.id === pluginId)?.elements?.map(element => element.id));
            const source = await client.servers?.inspect(sourceProjectId);
            const view = source?.descriptor?.views.find(view => elementIds.has(new URL(view.path, location.origin).searchParams.get('element') ?? ''));
            if (!current()) return;
            const fork = await client.projects!.fork!({ sourceProjectId, pluginId });
            if (!current()) return;
            if (!fork.development) throw new Error('Development fork metadata is unavailable.');
            await projectWorkspace.refresh();
            if (!current()) return;
            const server = await client.servers!.start(fork.id);
            if (!current()) return;
            if (server.status !== 'ready' || !server.url) {
              throw new Error(server.error || `Development preview is ${server.status}. The fork remains available in DEVLAB.`);
            }
            try {
              const selecting = projectWorkspace.select(fork.id, intent);
              intent = projectWorkspace.navigationRevision?.();
              if (await selecting === false || !current()) return;
              const selected = projectWorkspace.snapshot();
              if (selected.projectId !== fork.id || selected.error || selected.tree?.project.id !== fork.id) {
                throw new Error(selected.error || 'Development project could not be selected.');
              }
              const directory = fork.development.sourcePath.replace(/\/$/, '');
              const files = selected.tree.entries.filter(entry => entry.kind === 'file' && entry.editable && entry.path.startsWith(`${directory}/`));
              const sourcePath = view?.element?.sources.find(path => files.some(entry => entry.path === path))
                ?? files.find(entry => entry.path === `${directory}/src/index.ts`)?.path
                ?? files.find(entry => /\.(?:[cm]?[jt]sx?|css|json)$/.test(entry.path))?.path;
              if (!sourcePath) throw new Error('No editable development source was found in the plugin directory.');
              await projectWorkspace.openFile(sourcePath);
              if (!current()) return;
              const opened = projectWorkspace.snapshot();
              if (!opened.editor || opened.editor.path !== sourcePath || opened.editor.readOnly || opened.error) {
                throw new Error(opened.error || 'Development source could not be opened.');
              }
            } catch (error) {
              if (!current()) return;
              await projectWorkspace.select(sourceProjectId, intent);
              throw error;
            }
            const groupId = previewWorkspace.createGroup(fork.label, [fork.id]);
            previewWorkspace.selectGroup(groupId);
            if (view) previewWorkspace.updatePane(previewWorkspace.snapshot().activePaneId, { viewId: view.id });
          } : undefined}
          client={client}
          draft={draft}
          setDraft={updateDraft}
          workspace={workspace}
          projectWorkspace={projectWorkspace}
          previewWorkspace={previewWorkspace}
          renderTerminal={
            terminal
              ? (terminalOptions) => (
                  <PanelBoundary resetKey={revision}>
                    <terminal.Component
                      client={client}
                      draft={draft}
                      setDraft={updateDraft}
                      terminalOptions={terminalOptions}
                    />
                  </PanelBoundary>
                )
              : undefined
          }
          renderPreview={
            preview
              ? (options) => (
                  <PanelBoundary resetKey={revision}>
                    <preview.Component
                      client={client}
                      draft={draft}
                      setDraft={updateDraft}
                      previewWorkspace={previewWorkspace}
                      previewOptions={{
                        ...options,
                        onSourceSelectTarget: async (target) => {
                          if (
                            !previewWorkspace ||
                            !projectWorkspace ||
                            !client.servers
                          )
                            throw new Error(
                              'Project-targeted source navigation is unavailable.',
                            );
                          await openPreviewSource(
                            previewWorkspace,
                            projectWorkspace,
                            client.servers,
                            target,
                          );
                        },
                      }}
                    />
                  </PanelBoundary>
                )
              : undefined
          }
          renderProjects={
            projects && projectWorkspace
              ? (options) => (
                  <PanelBoundary resetKey={revision}>
                    <projects.Component
                      client={client}
                      draft={draft}
                      setDraft={updateDraft}
                      projectWorkspace={projectWorkspace}
                      projectOptions={options}
                      previewWorkspace={previewWorkspace}
                    />
                  </PanelBoundary>
                )
              : undefined
          }
          renderRules={rules ? (options) => (
            <PanelBoundary resetKey={revision}>
              <rules.Component client={client} draft={draft} setDraft={updateDraft} rulesOptions={options} />
            </PanelBoundary>
          ) : undefined}
          renderHood={
            hood
              ? (options) => (
                  <PanelBoundary resetKey={revision}>
                    <hood.Component
                      client={client}
                      draft={draft}
                      setDraft={updateDraft}
                      projectWorkspace={projectWorkspace}
                      hoodOptions={{
                        ...options,
                        renderWisdohm: rules ? (tab) => <rules.Component client={client} draft={draft} setDraft={updateDraft}
                          rulesOptions={{presentation: 'embedded', projectId: projectState?.projectId ?? 'default', initialTab: tab, onClose: options.onClose}} /> : undefined,
                        uiContributions: plugins.map((p) => ({
                          id: p.id,
                          title: p.title,
                          slot: p.slot ?? 'panel',
                        })),
                      }}
                    />
                  </PanelBoundary>
                )
              : undefined
          }
          renderCanvas={
            canvas
              ? (options) => (
                  <PanelBoundary resetKey={revision}>
                    <canvas.Component
                      client={client}
                      draft={draft}
                      setDraft={updateDraft}
                      workspace={workspace}
                      canvasOptions={options}
                      renderBrowser={
                        browser
                          ? (browserOptions) => (
                              <PanelBoundary resetKey={revision}>
                                <browser.Component
                                  key={
                                    browserOptions.projectId +
                                    '/' +
                                    browserOptions.nodeId
                                  }
                                  client={client}
                                  draft={draft}
                                  setDraft={updateDraft}
                                  workspace={workspace}
                                  browserOptions={browserOptions}
                                />
                              </PanelBoundary>
                            )
                          : undefined
                      }
                      renderTerminal={
                        terminal
                          ? (terminalOptions) => (
                              <PanelBoundary resetKey={revision}>
                                <terminal.Component
                                  client={client}
                                  draft={draft}
                                  setDraft={updateDraft}
                                  terminalOptions={terminalOptions}
                                />
                              </PanelBoundary>
                            )
                          : undefined
                      }
                    />
                  </PanelBoundary>
                )
              : undefined
          }
        />
      </PanelBoundary>
    );
  }
  const panels = plugins.filter((p) => !p.slot || p.slot === 'panel');
  return (
    <div className="shell kernel-lab">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Creo Aurea home">
          <span className="brand-mark">c.</span>
          <div>
            CREO AUREA<span>KERNEL LAB</span>
          </div>
        </a>
        <div className="nav-label">YOUR WORKSPACE</div>
        <div className="nav-item selected">
          <span>◈</span> Foundation<span className="nav-count">01</span>
        </div>
        <div className="nav-label contributions-label">UI CONTRIBUTIONS</div>
        <p className="sidebar-hint">Compose your workspace.</p>
        {catalog
          .filter((p) => !p.slot || p.slot === 'panel')
          .map((plugin) => (
            <label className="contribution" key={plugin.id}>
              <input
                type="checkbox"
                checked={plugins.some((p) => p.id === plugin.id)}
                onChange={() => togglePanel(plugin)}
              />
              <span>{plugin.title}</span>
            </label>
          ))}
        <div className="sidebar-bottom">
          <span className="dot active" />
          <div>
            Local & independent<span>No external model connected</span>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <span className="breadcrumb">devLAB / foundation</span>
            <h1>Room to build.</h1>
            <p>A living workspace, composed from independent plugins.</p>
          </div>
          <span className="version">
            FOUNDATION <b>0.1</b>
          </span>
        </header>
        <div className="principles">
          <div>
            <span>01</span>
            <strong>Typed contracts</strong>
          </div>
          <div>
            <span>02</span>
            <strong>Owned lifecycles</strong>
          </div>
          <div>
            <span>03</span>
            <strong>Persistent workspace</strong>
          </div>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="panels">
          {panels.map((plugin) => (
            <PanelBoundary key={plugin.id} resetKey={revision}>
              <plugin.Component
                client={client}
                draft={draft}
                setDraft={updateDraft}
              />
            </PanelBoundary>
          ))}
        </div>
        {!panels.length && (
          <section className="panel empty">
            The shell is still here.
            <span>Enable a UI contribution to bring a panel back.</span>
          </section>
        )}
        <footer>
          <span>COMPOSE. RUN. REPLACE.</span>
          <span>One host · independent capabilities</span>
        </footer>
      </main>
    </div>
  );
}
