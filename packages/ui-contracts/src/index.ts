import type { ComponentType, ReactNode } from 'react';
import type {
  PreviewNativeTarget,
  RulesService,
  ProjectServers,
  PluginHealth,
  CanvasDocument,
  CanvasGraph,
  SaveCanvas,
  TerminalCreate,
  TerminalSession,
  TerminalReplay,
  RegistryClient,
  ProjectService,
  Project,
  ProjectTree,
  BrowserControl,
  BrowserTarget,
  BrowserFrame,
} from '@devlab/contracts';
export interface ApplicationClient {
  runtime?: import('@devlab/contracts').RuntimeClient;
  /** Public attached API origin for source-bound handoffs; never a credential. */
  readonly backendOrigin?: string;
  health(): Promise<{ phase: string; plugins: PluginHealth[] }>;
  canvas?: CanvasClient;
  terminals?: TerminalClient;
  herdr?: import('@devlab/contracts').HerdrService;
  browsers?: BrowserClient;
  registry?: RegistryClient;
  projects?: ProjectService;
  servers?: ProjectServers;
  rules?: RulesService;
  previewInspector?: {
    openWorkspace(
      projectId: string,
      target?: PreviewNativeTarget,
    ): Promise<{ sessionId: string }>;
    openDevTools(sessionId: string, projectId: string): Promise<unknown>;
    closeWorkspace(sessionId: string): Promise<void>;
  };
}
export type { RegistryClient } from '@devlab/contracts';
export type RulesViewTab = 'rules' | 'checks' | 'harness' | 'memory';
export type RulesViewOptions =
  | { presentation?: 'dialog'; onClose(): void; projectId: string; initialTab?: RulesViewTab }
  | { presentation: 'controls'; projectId: string; onInspect(tab: RulesViewTab): void }
  | { presentation: 'embedded'; projectId: string; initialTab?: RulesViewTab; onClose?: () => void };
export interface HoodViewOptions {
  onDevelopPlugin?(pluginId: string): Promise<void>;
  onClose(): void;
  projectId?: string;
  uiContributions: { id: string; title: string; slot: string }[];
  renderWisdohm?: (tab: 'harness' | 'memory') => ReactNode;
}
export interface TerminalClient {
  ownerships?(projectId: string): Promise<import('@devlab/contracts').TerminalOwnerships>;
  list(projectId: string): Promise<TerminalSession[]>;
  create(command: TerminalCreate): Promise<TerminalSession>;
  inspect(id: string): Promise<TerminalSession>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  close(id: string): Promise<TerminalSession>;
  listen(
    id: string,
    after: number,
    receive: (event: TerminalReplay) => void,
    error: () => void,
  ): () => void;
}
export interface BrowserClient extends BrowserControl {
  frame(target: BrowserTarget, signal?: AbortSignal): Promise<BrowserFrame>;
}
export interface BrowserViewOptions {
  projectId: string;
  nodeId: string;
}
export interface TerminalViewOptions {
  /** Visible input owners keep a shell ready; exact historical sessions never launch. */
  autoStart?: boolean;
  ownership?: { mode: 'off' | 'guided' | 'strict'; ownerId?: string };
  parentSessionId?: string;
  inputOwner?: boolean;
  projectId: string;
  nodeId: string;
  cwd: string;
  shell: 'bash' | 'sh';
  /** Exact history/session selection; absent keeps canvas node reconnect behavior. */
  sessionId?: string;
  /** Only the visible active presentation may resize the backend PTY. */
  resizeOwner?: boolean;
  /** Unique presentation identity, separate from the persisted graph node ID. */
  instanceId?: string;
  onStarted?: (session: TerminalSession) => void;
}
export interface CanvasClient {
  load(projectId: string): Promise<CanvasDocument | null>;
  save(command: SaveCanvas): Promise<CanvasDocument>;
}
export interface CanvasWorkspaceState {
  projectId: string;
  graph: CanvasGraph;
  revision: number;
  selectedNodeId: string | null;
  dirty: boolean;
  loading: boolean;
  saving: boolean;
  error: string;
  canUndo: boolean;
  canRedo: boolean;
}
/** One editing owner; views observe stable snapshots and submit explicit commands. */
export interface CanvasWorkspace {
  subscribe(listener: () => void): () => void;
  snapshot(): CanvasWorkspaceState;
  update(graph: CanvasGraph): void;
  select(id: string | null): void;
  /** Arrange selected nodes, or all nodes, without changing identities or viewport. */
  arrange?(all?: boolean): void;
  undo(): void;
  redo(): void;
  save(): Promise<void>;
  reload(): Promise<void>;
  dispose(): void;
}
export interface UIPluginProps {
  onDevelopPlugin?(pluginId: string): Promise<void>;
  client: ApplicationClient;
  draft: string;
  setDraft: (value: string) => void;
  workspace?: CanvasWorkspace;
  projectWorkspace?: ProjectWorkspace;
  previewWorkspace?: PreviewWorkspace;
  projectOptions?: ProjectViewOptions;
  renderProjects?: (options: ProjectViewOptions) => ReactNode;
  children?: ReactNode;
  canvasOptions?: CanvasViewOptions;
  terminalOptions?: TerminalViewOptions;
  browserOptions?: BrowserViewOptions;
  previewOptions?: PreviewViewOptions;
  renderPreview?: (options: PreviewViewOptions) => ReactNode;
  renderBrowser?: (options: BrowserViewOptions) => ReactNode;
  rulesOptions?: RulesViewOptions;
  renderRules?: (options: RulesViewOptions) => ReactNode;
  hoodOptions?: HoodViewOptions;
  renderHood?: (
    options: Pick<HoodViewOptions, 'onClose' | 'projectId' | 'onDevelopPlugin'>,
  ) => ReactNode;
  renderTerminal?: (options: TerminalViewOptions) => ReactNode;
  renderCanvas?: (options: CanvasViewOptions) => ReactNode;
}
export interface CanvasViewOptions {
  /** Retain hidden renderers while relinquishing terminal launch, input and PTY sizing. */
  terminalPresentationActive?: boolean;
  /** Report adoption/creation to the shared graph owner, including fulfilled fork intent. */
  onTerminalStarted?: TerminalViewOptions['onStarted'];
  paletteVisible: boolean;
  setPaletteVisible(value: boolean): void;
  minimapVisible?: boolean;
  setMinimapVisible?(value: boolean): void;
  /** Exact running session rendered in the dock; canvas observes without resizing. */
  dockedTerminal?: { nodeId: string; sessionId: string };
  /** Reserve selected nodes before their first session exists, with one input/resize owner. */
  dockedTerminals?: readonly { nodeId: string; sessionId?: string }[];
}
export interface UIPlugin {
  /** Explicit iframe renderers; selecting one never mounts the whole workspace. */
  elements?: readonly { id: string; Component: ComponentType<UIPluginProps> }[];
  id: string;
  apiVersion: 1;
  title: string;
  slot?:
    | 'workspace'
    | 'canvas'
    | 'terminal'
    | 'browser'
    | 'preview'
    | 'hood'
    | 'project'
    | 'panel';
  Component: ComponentType<UIPluginProps>;
}

export interface ProjectEditorState {
  path: string;
  text: string;
  expectedHash: string | null;
  dirty: boolean;
  loading: boolean;
  readOnly: boolean;
}
export interface ProjectWorkspaceState {
  projects: Project[];
  projectId: string;
  tree: ProjectTree | null;
  workspace: CanvasWorkspace;
  mode: 'flow' | 'build';
  output?: 'terminal' | 'servers' | 'herdr' | null;
  showFiles: boolean;
  busy: boolean;
  error: string;
  editor: ProjectEditorState | null;
}
export interface ProjectWorkspace {
  /** A full document restart must wait for save/export or explicit discard. */
  hasUnsavedDrafts?(projectId?: string): boolean;
  subscribe(listener: () => void): () => void;
  snapshot(): ProjectWorkspaceState;
  start(): Promise<void>;
  refresh(): Promise<void>;
  /** False means superseded. An expected revision fences delayed navigation callers. */
  select(projectId: string, expectedNavigation?: number): Promise<boolean>;
  navigationRevision?(): number;
  setOutput?(view: 'terminal' | 'servers' | 'herdr' | null): void;
  create(id: string, label: string): Promise<void>;
  /** Delete the selected development thread after confirmation; reject unsaved work. */
  deleteThread(projectId: string): Promise<void>;
  openFolder(path: string): Promise<void>;
  setMode(mode: 'flow' | 'build'): void;
  showFiles(value: boolean): void;
  openFile(path: string, discardDraft?: boolean): Promise<void>;
  newFile(path: string): void;
  changeText(text: string): void;
  saveFile(): Promise<void>;
  closeEditor(): void;
  clearError(): void;
  createModule(path: string): Promise<void>;
  sourceClient(projectId?: string): RegistryClient;
  dispose(): void;
}
export interface ProjectViewOptions {
  developmentOnly?: boolean;
  view: 'explorer' | 'canvas';
  collapse?: () => void;
  renderControls?: (projectId: string) => ReactNode;
  onInspectRules?: (tab: RulesViewTab) => void;
}

export interface PreviewViewOptions {
  /** Existing app theme for explicitly registered first-party elements only. */
  theme?: 'light' | 'dark';
  /** First-use editor share; existing saved preview preferences remain authoritative. */
  initialEditorRatio?: number;
  /** Presentation only; retained editor/panes and backend owners stay mounted. */
  workspaceFocused?: boolean;
  /** Host fullscreen includes the existing bottom dock without reparenting panes. */
  fullscreen?: {
    native: boolean;
    pending: boolean;
    enter(trigger: HTMLElement): Promise<boolean>;
    exit(): Promise<void>;
  };
  onSourceSelectTarget?: (target: PreviewSourceTarget) => void | Promise<void>;
  projectId: string;
  children?: ReactNode;
  onSourceSelect?: (path: string) => void;
}

export type PreviewViewport = 'fit' | 'desktop' | 'mobile';
export interface PreviewPaneSpec {
  paneId: string;
  projectId: string;
  viewId: string;
  viewport: PreviewViewport;
  targetRevision: number;
}
export interface PreviewGroup {
  id: string;
  name: string;
  kind: 'current' | 'named';
  panes: readonly PreviewPaneSpec[];
  columns: number;
  rows: number;
}
export interface PreviewTarget {
  paneId: string;
  projectId: string;
  targetRevision: number;
}
export interface PreviewSourceTarget {
  paneId: string;
  projectId: string;
  path: string;
  targetRevision: number;
  instanceId?: string;
  generation: number;
}
export interface PreviewWorkspaceState {
  revision: number;
  groups: readonly PreviewGroup[];
  groupId: string;
  activePaneId: string;
  projects: readonly Project[];
  editorProjectId: string;
  expandedPaneId: string | null;
  expandedMode: 'native' | 'maximized' | null;
  persistence: 'memory' | 'saved' | 'unavailable' | 'invalid';
  persistenceMessage: string;
  error: string;
}
export interface PreviewWorkspace {
  subscribe(listener: () => void): () => void;
  snapshot(): PreviewWorkspaceState;
  syncProjects(
    projects: readonly Project[],
    editorProjectId: string,
    workspaceIdentity?: string,
  ): void;
  createGroup(name: string, projectIds?: readonly string[]): string;
  renameGroup(id: string, name: string): void;
  deleteGroup(id: string): void;
  selectGroup(id: string): void;
  setPaneCount(count: number): void;
  addPane(projectId: string, viewId?: string): string;
  removePane(paneId: string): void;
  assignPane(paneId: string, projectId: string, viewId?: string): void;
  updatePane(
    paneId: string,
    patch: { viewId?: string; viewport?: PreviewViewport },
  ): void;
  reorderPane(paneId: string, index: number): void;
  setRatios(columns: number, rows: number): void;
  selectPane(paneId: string): void;
  setExpanded(paneId: string | null, mode?: 'native' | 'maximized'): void;
  captureTarget(paneId: string): PreviewTarget;
  isCurrentTarget(target: PreviewTarget): boolean;
  acceptStorage(raw: string | null): void;
  dispose(): void;
}

