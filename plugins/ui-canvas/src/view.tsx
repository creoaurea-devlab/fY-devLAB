import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useId,
  type ReactNode,
} from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  NodeResizer,
  BackgroundVariant,
  Handle,
  Position,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  useReactFlow,
  type Node,
  type Edge,
  type NodeProps,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from '@xyflow/react';
import { useSyncExternalStore } from 'react';
import { ChevronLeft, LayoutGrid, X, Copy, Trash2 } from 'lucide-react';
import type { UIPluginProps, CanvasWorkspace, CanvasViewOptions } from '@devlab/ui-contracts';
import { agentData } from './workspace.ts';
import '@xyflow/react/dist/style.css';
import './canvas.css';

const TerminalContext = createContext<
  Pick<UIPluginProps, 'renderTerminal' | 'renderBrowser'> & Pick<CanvasViewOptions, 'onTerminalStarted' | 'terminalPresentationActive'> & {
    projectId: string;
    registry?: UIPluginProps['client']['registry'];
    dockedTerminal?: { nodeId: string; sessionId: string };
    dockedTerminals?: readonly { nodeId: string; sessionId?: string }[];
  }
>({ projectId: 'default' });
const NodeOptionsContext = createContext<{
  nodeId: string | null;
  drawerId: string;
  open: (nodeId: string, trigger: HTMLButtonElement) => void;
}>({ nodeId: null, drawerId: '', open: () => {} });
const catalog = [
  {
    type: 'piAgent',
    label: 'DeepSeek Harness Runtime',
    icon: 'D',
    color: '#e11d48',
    description: 'Native DeepSeek Harness plugins, registry, configuration and individual tests.',
  },
  {
    type: 'browser',
    label: 'Chromium Browser',
    icon: '◎',
    color: '#0d9488',
    description: 'Saved browser profiles, live view and wired agent control.',
  },
  {
    type: 'terminal',
    label: 'Terminal',
    icon: '⌨',
    color: '#0891b2',
    description: 'An interactive local shell, owned by the backend.',
  },
];
function Field({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flow-node-field">
      <span className="flow-node-field-label">{label}</span>
      <span className="flow-node-field-value" title={String(value)}>
        {String(value)}
      </span>
    </div>
  );
}
function NodeFrame({
  id,
  selected,
  data,
  label,
  color,
  icon,
  children,
  inputHandle = 'prompt',
}: {
  id: string;
  selected: boolean;
  data: Record<string, unknown>;
  label: string;
  color: string;
  icon: string;
  children: ReactNode;
  inputHandle?: string;
}) {
  const flow = useReactFlow();
  const options = useContext(NodeOptionsContext);
  return (
    <div className={`flow-node${selected ? ' selected' : ''}`}>
      <Handle
        type="target"
        position={Position.Left}
        id={inputHandle}
        aria-label={
          inputHandle === 'control' ? 'Browser control input' : 'Prompt input'
        }
      />
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        aria-label="Agent output"
      />
      <div
        className="flow-node-header"
        style={{ borderLeft: `3px solid ${color}`, cursor: 'move' }}
      >
        <div
          className="flow-node-header-icon"
          style={{ background: color + '22', color }}
        >
          <span style={{ fontSize: 11 }}>{icon}</span>
        </div>
        <span className="node-heading">{label}</span>
        <button
          type="button"
          className="nodrag nopan node-options-toggle"
          title="Node options"
          aria-label={`Options for ${label}`}
          aria-expanded={options.nodeId === id}
          aria-controls={options.nodeId === id ? options.drawerId : undefined}
          data-devlab-id="canvas.node.options-toggle"
          data-devlab-source="plugins/ui-canvas/src/view.tsx"
          onClick={(event) => {
            event.stopPropagation();
            options.open(id, event.currentTarget);
          }}
        >
          <span aria-hidden="true">•</span>
        </button>
        <button
          className="nodrag node-collapse"
          title={data.collapsed ? 'Expand' : 'Collapse'}
          aria-label={data.collapsed ? 'Expand' : 'Collapse'}
          aria-expanded={!data.collapsed}
          onClick={() =>
            flow.updateNodeData(id, { collapsed: !data.collapsed })
          }
        >
          {data.collapsed ? '▸' : '▾'}
        </button>
      </div>
      {!data.collapsed && <div className="flow-node-body">{children}</div>}
    </div>
  );
}
function AgentNode({ id, data, selected }: NodeProps) {
  const { registry } = useContext(TerminalContext);
  const [runtime, setRuntime] = useState<{ url?: string; status: string; active: number }>({ status: 'Connecting', active: 0 });
  useEffect(() => {
    let active = true;
    if (!registry?.projects) { setRuntime({ status: 'Not connected', active: 0 }); return; }
    void (async () => {
      const projects = await registry.projects!();
      const project = projects.find(item => item.id === 'deepseek-runtime');
      if (!project?.previewUrl) { if (active) setRuntime({ status: 'Not connected', active: 0 }); return; }
      const snapshot = await registry.snapshot('deepseek-runtime');
      if (active) setRuntime({ url: project.previewUrl, status: 'Connected', active: snapshot.plugins.filter(plugin => plugin.state === 'active').length });
    })().catch(() => { if (active) setRuntime({ status: 'Unavailable', active: 0 }); });
    return () => { active = false; };
  }, [registry]);
  return <NodeFrame id={id} data={data} selected={selected}
    label={String(!data.label || data.label === 'Hermes Agent' ? 'DeepSeek Harness Runtime' : data.label)} color="#e11d48" icon="D">
    <Field label="runtime" value={runtime.status} />
    <Field label="native plugins" value={runtime.active} />
    <button type="button" className="nodrag" disabled={!runtime.url}
      onClick={() => { if (runtime.url) window.open(runtime.url, '_blank', 'noopener,noreferrer'); }}>Open runtime</button>
  </NodeFrame>;
}
function SubagentNode({ id, data, selected }: NodeProps) {
  return (
    <NodeFrame
      id={id}
      data={data}
      selected={selected}
      label={String(data.label ?? 'Subagent')}
      color="#8b5cf6"
      icon="↳"
    >
      <div className="flow-node-body">
        <Field label="role" value={data.role ?? 'assistant'} />
        <Field label="task" value={String(data.task ?? '').slice(0, 90)} />
      </div>
    </NodeFrame>
  );
}
function TerminalNode({ id, data, selected }: NodeProps) {
  const terminal = useContext(TerminalContext);
  const docked = terminal.dockedTerminals?.find(value => value.nodeId === id) ?? (terminal.dockedTerminal?.nodeId === id ? terminal.dockedTerminal : undefined);
  const ownsPresentation = terminal.terminalPresentationActive !== false && !docked;
  return (
    <NodeFrame
      id={id}
      data={data}
      selected={selected}
      label={String(data.label ?? 'Terminal')}
      color="#0891b2"
      icon="⌨"
    >
      <div className="nodrag nowheel terminal-node-surface">
        {terminal.renderTerminal ? (
          terminal.renderTerminal({
            projectId: terminal.projectId,
            nodeId: id,
            cwd: typeof data.cwd === 'string' ? data.cwd : '.',
            shell: data.shell === 'sh' ? 'sh' : 'bash',
            sessionId: docked?.sessionId,
            autoStart: ownsPresentation,
            resizeOwner: ownsPresentation,
            inputOwner: ownsPresentation,
            ownership: data.ownership as { mode: 'off' | 'guided' | 'strict'; ownerId?: string } | undefined,
            parentSessionId: typeof data.parentSessionId === 'string' ? data.parentSessionId : undefined,
            onStarted: terminal.onTerminalStarted,
          })
        ) : (
          <div>Terminal renderer unavailable</div>
        )}
      </div>
    </NodeFrame>
  );
}
function BrowserNode({ id, data, selected }: NodeProps) {
  const context = useContext(TerminalContext);
  return (
    <>
      <NodeResizer
        isVisible={selected && !data.collapsed}
        minWidth={560}
        minHeight={360}
        maxWidth={1800}
        maxHeight={1400}
      />
      <NodeFrame
        id={id}
        data={data}
        selected={selected}
        label={String(data.label ?? 'Chromium')}
        color="#0d9488"
        icon="◎"
        inputHandle="control"
      >
        <div className="nodrag nopan nowheel browser-node-surface">
          {context.renderBrowser ? (
            context.renderBrowser({ projectId: context.projectId, nodeId: id })
          ) : (
            <div>Browser renderer unavailable</div>
          )}
        </div>
      </NodeFrame>
    </>
  );
}
function UnknownNode({ id, data, selected }: NodeProps) {
  return (
    <NodeFrame
      id={id}
      data={data}
      selected={selected}
      label={String(data.__canvasType ?? 'Unknown node')}
      color="#94a3b8"
      icon="?"
    >
      Unsupported node type · data retained
    </NodeFrame>
  );
}
const nodeTypes = {
  piAgent: AgentNode,
  subagent: SubagentNode,
  terminal: TerminalNode,
  browser: BrowserNode,
  unknown: UnknownNode,
};
function measuredSize(value: unknown): Node['measured'] {
  if (!value || typeof value !== 'object') return undefined;
  const size = value as Record<string, unknown>;
  const finite = (value: unknown) =>
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 2000
      ? value
      : undefined;
  return { width: finite(size.width), height: finite(size.height) };
}

function ConfigDrawer({ workspace, id, close }: {
  workspace: CanvasWorkspace;
  id: string;
  close: () => void;
}) {
  const state = useSyncExternalStore(workspace.subscribe, workspace.snapshot);
  const drawer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    drawer.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, [state.selectedNodeId]);
  const node = state.graph.nodes.find((n) => n.id === state.selectedNodeId);
  if (!node) return null;
  const meta = catalog.find((m) => m.type === node.type);
  const update = (partial: Record<string, unknown>) =>
    workspace.update({
      ...state.graph,
      nodes: state.graph.nodes.map((n) =>
        n.id === node.id ? { ...n, data: { ...n.data, ...partial } } : n,
      ),
    });
  const field = (
    label: string,
    key: string,
    type = 'text',
    fallback: string | number = '',
  ) => (
    <label className="config-field" key={key}>
      {label}
      <input
        aria-label={label}
        type={type}
        value={String(node.data[key] ?? fallback)}
        onChange={(e) => {
          const value =
            type === 'number' ? Number(e.target.value) : e.target.value;
          if (type !== 'number' || Number.isFinite(value))
            update({ [key]: value });
        }}
      />
    </label>
  );
  return (
    <div
      ref={drawer}
      id={id}
      className="config-drawer"
      role="dialog"
      aria-label="Node options"
      data-devlab-id="canvas.node.options-drawer"
      data-devlab-source="plugins/ui-canvas/src/view.tsx"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className="config-header">
        <div
          className="config-icon"
          style={{
            background: (meta?.color ?? '#94a3b8') + '22',
            color: meta?.color,
          }}
        >
          {meta?.icon ?? '↳'}
        </div>
        <div className="config-heading">
          <strong>{meta?.label ?? node.type}</strong>
          <small>{node.id}</small>
        </div>
        <button
          title="Duplicate node"
          aria-label="Duplicate node"
          data-testid="btn-duplicate-node"
          onClick={() => {
            const copy = {
              ...node,
              id: crypto.randomUUID(),
              position: { x: node.position.x + 48, y: node.position.y + 48 },
              selected: false,
            };
            workspace.update({
              ...state.graph,
              nodes: [...state.graph.nodes, copy],
            });
            workspace.select(copy.id);
          }}
        >
          <Copy size={12} />
        </button>
        <button
          title="Delete node"
          aria-label="Delete node"
          data-testid="btn-delete-node"
          onClick={() =>
            workspace.update({
              ...state.graph,
              nodes: state.graph.nodes.filter((n) => n.id !== node.id),
              edges: state.graph.edges.filter(
                (e) => e.source !== node.id && e.target !== node.id,
              ),
            })
          }
        >
          <Trash2 size={12} />
        </button>
        <button
          title="Close configuration"
          aria-label="Close configuration"
          data-testid="btn-close-drawer"
          onClick={close}
        >
          <X size={12} />
        </button>
      </div>
      <div className="config-fields">
        {field('Label', 'label')}
        {node.type === 'piAgent' ? (
          <>
            <div className="config-section">DeepSeek Harness Runtime</div>
            <p className="config-note">Open the runtime to select native plugins and run individual tests. Existing saved agent data is preserved below.</p>
            <details><summary>Saved legacy agent data</summary>
            <div className="config-section">Provider & Model</div>
            <label className="config-field">
              Provider
              <select
                aria-label="Provider"
                value={String(node.data.provider ?? 'offline')}
                onChange={() => update({ provider: 'offline', model: 'echo' })}
              >
                <option value="offline">Offline</option>
                {node.data.provider && node.data.provider !== 'offline' ? (
                  <option value={String(node.data.provider)}>
                    {String(node.data.provider)} (not connected)
                  </option>
                ) : null}
              </select>
            </label>
            <label className="config-field">
              Model
              <input
                value={String(node.data.model ?? 'echo')}
                readOnly
                aria-label="Model"
              />
            </label>
            <div className="config-section">Thinking</div>
            <label className="config-field">
              Thinking Level
              <select
                aria-label="Thinking Level"
                value={String(node.data.thinkingLevel ?? 'off')}
                onChange={(e) => update({ thinkingLevel: e.target.value })}
              >
                {['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].map(
                  (level) => (
                    <option key={level}>{level}</option>
                  ),
                )}
              </select>
            </label>
            <div className="config-section">Generation</div>
            {field('Max Tokens', 'maxTokens', 'number', 4096)}
            {field('Temperature', 'temperature', 'number', 0.7)}
            <div className="config-section">Execution</div>
            {field('Max Turns', 'maxTurns', 'number', 25)}
            {field('Max Budget', 'maxBudgetUsd', 'number', 2)}
            <div className="config-section">System Prompt</div>
            <label className="config-field">
              System prompt
              <textarea
                aria-label="System prompt"
                rows={5}
                value={String(node.data.systemPrompt ?? '')}
                onChange={(e) => update({ systemPrompt: e.target.value })}
              />
            </label>
            <p className="config-note">
              The offline echo model does not use generation settings. They are
              saved with this agent.
            </p>
          </details>
          </>
        ) : node.type === 'terminal' ? (
          <>
            <div className="config-section">Terminal</div>
            {field('Width', 'width', 'number', 380)}
            {field('Height', 'height', 'number', 220)}
            {field('Working directory', 'cwd', 'text', '.')}
            <label className="config-field">
              Shell
              <select
                aria-label="Shell"
                value={node.data.shell === 'sh' ? 'sh' : 'bash'}
                onChange={(e) => update({ shell: e.target.value })}
              >
                <option value="bash">bash</option>
                <option value="sh">sh</option>
              </select>
            </label>
            <p className="config-note">
              Start explicitly in the node. Directory and shell changes apply to
              the next session. Browser reload reconnects; backend shutdown
              stops sessions.
            </p>
          </>
        ) : node.type === 'browser' ? (
          <>
            <div className="config-section">Chromium browser</div>
            {field('Start URL', 'url', 'text', 'about:blank')}
            {field('Width', 'width', 'number', 900)}
            {field('Height', 'height', 'number', 620)}
            <label className="config-field">
              Profile
              <select
                aria-label="Browser profile"
                value={
                  node.data.mode === 'temporary' ? 'temporary' : 'persistent'
                }
                onChange={(e) => update({ mode: e.target.value })}
              >
                <option value="persistent">Saved cookies and storage</option>
                <option value="temporary">Temporary session</option>
              </select>
            </label>
            <p className="config-note">
              Browser ID: {node.id}. Wire agent output to its control input,
              then save. Start and Stop are explicit; removing a node preserves
              its profile.
            </p>
          </>
        ) : (
          <>
            <div className="config-section">Node data</div>
            <p className="config-note">
              {node.type === 'subagent'
                ? 'Delegated agent configuration'
                : 'Unsupported type; original data is retained on save and export.'}
            </p>
            <pre className="config-data">
              {JSON.stringify(node.data, null, 2)}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}

function Editor({
  client,
  workspace,
  canvasOptions,
  renderTerminal,
  renderBrowser,
}: UIPluginProps & { workspace: CanvasWorkspace }) {
  const state = useSyncExternalStore(workspace.subscribe, workspace.snapshot),
    flow = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const catalogId = useId();
  const availableCatalog = catalog.filter(item => item.type !== 'browser' || Boolean(client.browsers));
  const graph = state.graph;
  const [pattern, setPattern] = useState(BackgroundVariant.Lines);
  const [optionsNodeId, setOptionsNodeId] = useState<string | null>(null);
  const optionsTrigger = useRef<HTMLButtonElement | null>(null);
  const optionsDrawerId = useId();
  const optionsVisible = optionsNodeId !== null &&
    optionsNodeId === state.selectedNodeId &&
    graph.nodes.some((node) => node.id === optionsNodeId);
  const closeOptions = () => {
    setOptionsNodeId(null);
    if (optionsTrigger.current?.isConnected) optionsTrigger.current.focus();
  };
  useEffect(() => {
    if (!optionsVisible) setOptionsNodeId(null);
  }, [optionsVisible]);
  useEffect(() => setOptionsNodeId(null), [state.projectId]);
  const nodes = useMemo<Node[]>(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: Object.hasOwn(nodeTypes, n.type) ? n.type : 'unknown',
        position: n.position,
        selected: n.selected === true,
        measured: measuredSize(n.measured),
        data: { ...n.data, __canvasType: n.type },
        dragHandle: '.flow-node-header',
        ...(n.type === 'browser'
          ? {
              style: {
                width: Math.min(
                  1800,
                  Math.max(560, Number(n.data.width) || 900),
                ),
                height: n.data.collapsed
                  ? 20
                  : Math.min(1400, Math.max(360, Number(n.data.height) || 620)),
              },
            }
          : {}),
        ...(n.type === 'terminal'
          ? {
              style: {
                width: Math.min(
                  1000,
                  Math.max(240, Number(n.data.width) || 380),
                ),
                height: Math.min(
                  1200,
                  Math.max(160, Number(n.data.height) || 220),
                ),
              },
            }
          : {}),
      })),
    [graph.nodes],
  );
  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        selected: e.selected === true,
        label: e.targetHandle === 'control' ? 'browser control' : undefined,
      })),
    [graph.edges],
  );
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const graph = workspace.snapshot().graph;
      // Keep measured geometry in the editing session for React Flow/minimap.
      // The persistence adapter strips these renderer observations before save.
      const edits = changes;
      if (!edits.length || workspace.snapshot().loading) return;
      // Replace changes (collapse) contain renderer-only data; merge data into the original payload.
      const mapped = edits.map((change) => {
        if (change.type !== 'replace') return change;
        const original = graph.nodes.find((n) => n.id === change.id);
        return {
          ...change,
          item: {
            ...original,
            ...(original ? {} : change.item),
            data: {
              ...original?.data,
              ...Object.fromEntries(
                Object.entries(change.item.data).filter(
                  ([key]) => key !== '__canvasType',
                ),
              ),
            },
          },
        } as NodeChange;
      });
      const next = applyNodeChanges(mapped, graph.nodes as Node[]);
      const ids = new Set(next.map((n) => n.id));
      workspace.update({
        ...graph,
        nodes: next.map((n) => ({
          ...n,
          type:
            graph.nodes.find((old) => old.id === n.id)?.type ??
            n.type ??
            'unknown',
          ...(n.type === 'browser' && !n.data.collapsed
            ? {
                data: {
                  ...n.data,
                  width: n.width ?? n.data.width,
                  height: n.height ?? n.data.height,
                },
              }
            : {}),
        })),
        edges: graph.edges.filter(
          (e) => ids.has(e.source) && ids.has(e.target),
        ),
      });
    },
    [workspace],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (workspace.snapshot().loading) return;
      const graph = workspace.snapshot().graph;
      workspace.update({
        ...graph,
        edges: applyEdgeChanges(changes, graph.edges as Edge[]),
      });
    },
    [workspace],
  );
  const onConnect = useCallback(
    (connection: Connection) => {
      if (workspace.snapshot().loading) return;
      const graph = workspace.snapshot().graph;
      if (
        connection.targetHandle === 'control' &&
        !graph.nodes.some(
          (n) =>
            n.id === connection.source &&
            ['piAgent', 'subagent'].includes(n.type),
        )
      )
        return;
      workspace.update({
        ...graph,
        edges: addEdge(
          { ...connection, id: crypto.randomUUID() },
          graph.edges as Edge[],
        ),
      });
    },
    [workspace],
  );
  const add = (type: string, position?: { x: number; y: number }) => {
    if (!availableCatalog.some(item => item.type === type)) return;
    const box = wrapper.current?.getBoundingClientRect();
    const center =
      position ??
      flow.screenToFlowPosition({
        x: (box?.x ?? 440) + (box?.width ?? 800) / 2,
        y: (box?.y ?? 48) + 120,
      });
    const id = crypto.randomUUID();
    workspace.update({
      ...graph,
      nodes: [
        ...graph.nodes,
        {
          id,
          type,
          position: center,
          data:
            type === 'piAgent'
              ? agentData()
              : type === 'browser'
                ? {
                    label: `Browser ${graph.nodes.filter((n) => n.type === 'browser').length + 1}`,
                    url: 'about:blank',
                    mode: 'persistent',
                    width: 900,
                    height: 620,
                  }
                : {
                    label: `Terminal ${graph.nodes.filter((n) => n.type === 'terminal').length + 1}`,
                    width: 380,
                    height: 220,
                    status: 'idle',
                  },
        },
      ],
    });
    workspace.select(id);
  };
  useEffect(() => {
    if (graph.viewport && !state.loading)
      void flow.setViewport(graph.viewport, { duration: 0 });
  }, [flow, graph.viewport, state.loading]);
  useEffect(() => {
    const element = wrapper.current;
    if (!element || state.loading) return;
    const zoomTerminalWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !(event.target instanceof Element)) return;
      const terminal = event.target.closest('.terminal-node-surface');
      if (!terminal || !element.contains(terminal)) return;
      event.preventDefault();
      event.stopPropagation();
      const viewport = flow.getViewport();
      const factor = event.deltaMode === 1 ? 0.05 : event.deltaMode === 2 ? 1 : 0.002;
      const zoom = Math.max(
        0.15,
        Math.min(2.5, viewport.zoom * 2 ** (-event.deltaY * factor)),
      );
      if (zoom === viewport.zoom) return;
      const point = flow.screenToFlowPosition(
        { x: event.clientX, y: event.clientY },
        { snapToGrid: false },
      );
      const bounds = element.getBoundingClientRect();
      void flow.setViewport(
        {
          x: event.clientX - bounds.left - point.x * zoom,
          y: event.clientY - bounds.top - point.y * zoom,
          zoom,
        },
        { duration: 0 },
      );
    };
    element.addEventListener('wheel', zoomTerminalWheel, {
      capture: true,
      passive: false,
    });
    return () => element.removeEventListener('wheel', zoomTerminalWheel, true);
  }, [flow, state.loading]);
  const unsupported = graph.nodes.filter(
    (n) => !['piAgent', 'subagent', 'terminal', 'browser'].includes(n.type),
  ).length;
  if (state.loading)
    return <div className="canvas-loading">Loading saved graph…</div>;
  return (
    <NodeOptionsContext.Provider value={{
      nodeId: optionsVisible ? optionsNodeId : null,
      drawerId: optionsDrawerId,
      open: (nodeId, trigger) => {
        optionsTrigger.current = trigger;
        if (optionsVisible && optionsNodeId === nodeId) {
          closeOptions();
        } else {
          workspace.select(nodeId);
          setOptionsNodeId(nodeId);
        }
      },
    }}>
    <TerminalContext.Provider
      value={{
        projectId: state.projectId,
        registry: client.registry,
        renderTerminal,
        renderBrowser,
            onTerminalStarted: canvasOptions?.onTerminalStarted,
              terminalPresentationActive: canvasOptions?.terminalPresentationActive,
        dockedTerminal: canvasOptions?.dockedTerminal,
              dockedTerminals: canvasOptions?.dockedTerminals,
      }}
    >
      {(
        <div className="node-palette" id={catalogId} hidden={canvasOptions?.paletteVisible === false} data-testid="node-palette" data-devlab-id="canvas.catalog" data-devlab-source="plugins/ui-canvas/src/view.tsx">
          <div className="palette-header">
            <div>
              <strong>Node Catalog</strong>
              <button
                className="tree-action-btn"
                title="Collapse Node Catalog"
                data-testid="btn-collapse-palette"
                onClick={() => canvasOptions?.setPaletteVisible(false)}
              >
                <ChevronLeft size={13} />
              </button>
            </div>
            <p>
              Drag an available block onto this project canvas.
              Delegated agents join the graph automatically.
            </p>
          </div>
          <div className="palette-nodes">
            {availableCatalog.map((meta) => (
              <button
                type="button"
                className="palette-item"
                draggable
                key={meta.type}
                data-testid={`palette-item-${meta.type}`}
                title={`Add ${meta.label}`}
                onClick={() => add(meta.type)}
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    'application/claude-flow-node',
                    meta.type,
                  );
                  e.dataTransfer.effectAllowed = 'copy';
                }}
              >
                <div
                  className="palette-item-icon"
                  style={{ background: meta.color + '22', color: meta.color }}
                >
                  {meta.icon}
                </div>
                <div>
                  <strong>{meta.label}</strong>
                  <small>{meta.description}</small>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      {(
        <div className="node-palette-collapsed" hidden={canvasOptions?.paletteVisible !== false}>
          <button
            className="tree-action-btn"
            title="Show Node Catalog"
            aria-label="Show Node Catalog"
            aria-controls={catalogId}
            aria-expanded={canvasOptions?.paletteVisible !== false}
            data-devlab-id="canvas.catalog.open"
            data-devlab-source="plugins/ui-canvas/src/view.tsx"
            data-testid="btn-expand-palette"
            onClick={() => canvasOptions?.setPaletteVisible(true)}
          >
            <LayoutGrid size={14} />
          </button>
        </div>
      )}
      <div
        ref={wrapper}
        className="canvas-wrapper"
        data-testid="canvas-wrapper"
        data-devlab-id="canvas.viewport"
        data-devlab-source="plugins/ui-canvas/src/view.tsx"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(e) => {
          e.preventDefault();
          const type = e.dataTransfer.getData('application/claude-flow-node');
          if (availableCatalog.some((m) => m.type === type))
            add(
              type,
              flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }),
            );
        }}
      >
        {canvasOptions?.setMinimapVisible && (
          <button
            type="button"
            className="canvas-minimap-toggle nodrag nopan"
            aria-label="Toggle canvas minimap"
            aria-pressed={canvasOptions.minimapVisible !== false}
            data-devlab-id="canvas.minimap-toggle"
            data-devlab-source="plugins/ui-canvas/src/view.tsx"
            onClick={() => canvasOptions.setMinimapVisible?.(canvasOptions.minimapVisible === false)}
          >
            Minimap {canvasOptions.minimapVisible !== false ? 'on' : 'off'}
          </button>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onBeforeDelete={async ({
            nodes: removedNodes,
            edges: removedEdges,
          }) => {
            const graph = workspace.snapshot().graph;
            const nodeIds = new Set(removedNodes.map((node) => node.id));
            const edgeIds = new Set(removedEdges.map((edge) => edge.id));
            workspace.update({
              ...graph,
              nodes: graph.nodes.filter((node) => !nodeIds.has(node.id)),
              edges: graph.edges.filter(
                (edge) =>
                  !edgeIds.has(edge.id) &&
                  !nodeIds.has(edge.source) &&
                  !nodeIds.has(edge.target),
              ),
            });
            // Commit one graph edit, so undo restores the node and its connections together.
            return false;
          }}
          onNodeClick={(_event, node) => workspace.select(node.id)}
          onPaneClick={() => workspace.select(null)}
          onMoveEnd={(_event, viewport) => {
            if (!workspace.snapshot().loading)
              workspace.update({ ...workspace.snapshot().graph, viewport });
          }}
          defaultViewport={graph.viewport}
          fitView={!graph.viewport}
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.15}
          maxZoom={2.5}
          snapToGrid
          snapGrid={[12, 12]}
          selectionOnDrag
          panOnDrag={[1, 2]}
          selectNodesOnDrag={false}
          multiSelectionKeyCode="Shift"
          deleteKeyCode={['Backspace', 'Delete']}
          style={{
            background:
              typeof graph.background === 'string'
                ? graph.background
                : undefined,
          }}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{
            animated: false,
            style: { stroke: 'hsl(var(--border))', strokeWidth: 1.5 },
          }}
        >
          <Background
            variant={pattern}
            gap={24}
            size={pattern === BackgroundVariant.Dots ? 1.5 : 5}
            lineWidth={0.6}
            color="hsl(var(--border))"
          />
          <Controls
            position="bottom-right"
            showInteractive={false}
            style={{ margin: '0 0 352px 0' }}
          />
          {canvasOptions?.minimapVisible !== false && (
            <div
              data-devlab-id="canvas.minimap"
              data-devlab-source="plugins/ui-canvas/src/view.tsx"
              style={{ display: 'contents' }}
            >
              <MiniMap
                position="bottom-right"
                ariaLabel="Workflow minimap"
                style={{
                  marginBottom: 352,
                  marginRight: 56,
                  width: 140,
                  height: 90,
                }}
                nodeColor={(n) =>
                  catalog.find((m) => m.type === n.type)?.color ?? '#8b5cf6'
                }
              />
            </div>
          )}
        </ReactFlow>
        <section
          className="canvas-studio"
          aria-label="Canvas Studio"
          hidden={graph.nodes.length > 0}
        >
          <div className="canvas-studio-eyebrow">
            <span /> YOUR WORKSPACE
          </div>
          <h2>Canvas Studio</h2>
          <p>A little space for your next idea.</p>
          <div
            className="canvas-studio-patterns"
            role="group"
            aria-label="Background pattern"
          >
            {[
              { value: BackgroundVariant.Lines, label: 'Grid' },
              { value: BackgroundVariant.Dots, label: 'Dots' },
              { value: BackgroundVariant.Cross, label: 'Cross' },
            ].map(({ value, label }) => (
              <button
                type="button"
                key={value}
                aria-pressed={pattern === value}
                onClick={() => setPattern(value)}
              >
                <span
                  className={`pattern-preview pattern-preview-${value}`}
                  aria-hidden="true"
                />
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="canvas-studio-add"
            onClick={() => add('piAgent')}
          >
            <span aria-hidden="true">+</span> Add a runtime
          </button>
          <small>
            {graph.nodes.length} {graph.nodes.length === 1 ? 'node' : 'nodes'} ·
            Ready to explore
          </small>
        </section>
        {!graph.nodes.length && (
          <div className="canvas-empty">
            <div>⬡</div>
            <strong>Empty canvas</strong>
            <span>
              Drag an available block onto the canvas to start.
            </span>
          </div>
        )}
        {unsupported > 0 && (
          <div className="canvas-warning" data-testid="import-warning">
            {unsupported} unsupported node type(s) retained in this graph.
          </div>
        )}
        {optionsVisible && (
          <ConfigDrawer workspace={workspace} id={optionsDrawerId} close={closeOptions} />
        )}
      </div>
    </TerminalContext.Provider>
    </NodeOptionsContext.Provider>
  );
}
export function CanvasView(props: UIPluginProps) {
  if (!props.workspace)
    return (
      <div className="canvas-loading" role="alert">
        Canvas commands are unavailable.
      </div>
    );
  if (props.workspace.snapshot().loading)
    return <LoadingCanvas {...props} workspace={props.workspace} />;
  return (
    <ReactFlowProvider>
      <Editor {...props} workspace={props.workspace} />
    </ReactFlowProvider>
  );
}
function LoadingCanvas(props: UIPluginProps & { workspace: CanvasWorkspace }) {
  const state = useSyncExternalStore(
    props.workspace.subscribe,
    props.workspace.snapshot,
  );
  return state.loading ? (
    <div className="canvas-loading">Loading saved graph…</div>
  ) : (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  );
}
