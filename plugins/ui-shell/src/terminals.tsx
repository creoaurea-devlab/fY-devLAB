import { useEffect, useId, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react';
import { ChevronDown, ChevronUp, Columns2, Ellipsis, Maximize2, PanelBottom, Plus, Rows2 } from 'lucide-react';
import type { TerminalSession } from '@devlab/contracts';
import type { CanvasWorkspaceState, UIPluginProps } from '@devlab/ui-contracts';

type Selection = { nodeId: string; sessionId?: string };
type Ownership = { mode: 'off' | 'guided' | 'strict'; ownerId?: string };
type Tab = Selection & { label: string; status: 'running' | 'exited' | 'stopped' | 'unavailable'; session?: TerminalSession };
type Preferences = { controlsCollapsed?: boolean; selection?: Selection[]; opened?: string[]; order?: string[]; weights?: Record<string, number>; expanded?: boolean; orientation?: 'horizontal' | 'vertical'; height?: number };
type OwnershipInfo = { owners: { id: string; label: string; files: string[] }[]; strict: { available: boolean; reason?: string } };
const STORAGE = 'devlab:terminal-workspace:v1';
const EMPTY: CanvasWorkspaceState = { projectId: 'default', graph: { name: '', nodes: [], edges: [] }, revision: 0, selectedNodeId: null, dirty: false, loading: false, saving: false, error: '', canUndo: false, canRedo: false };
const emptySnapshot = () => EMPTY;
const emptySubscribe = () => () => {};
const keyOf = (value: Selection) => value.sessionId ? `session:${value.sessionId}` : `node:${value.nodeId}`;
const paneKey = keyOf;
function ownership(value: unknown): Ownership {
  if (value && typeof value === 'object' && 'mode' in value && ['off', 'guided', 'strict'].includes(String(value.mode))) {
    const ownerId = 'ownerId' in value && typeof value.ownerId === 'string' ? value.ownerId : undefined;
    if (value.mode === 'off') return { mode: 'off', ...(ownerId ? { ownerId } : {}) };
    if (ownerId && (value.mode === 'guided' || value.mode === 'strict')) return { mode: value.mode, ownerId };
  }
  return { mode: 'off' };
}

function savedPreferences(): Record<string, Preferences> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result: Record<string, Preferences> = {};
    for (const [id, raw] of Object.entries(value)) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const p = raw as Record<string, unknown>;
      const strings = (list: unknown): string[] => Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string' && item.length <= 256).slice(0, 512) : [];
      const selection = Array.isArray(p.selection) ? p.selection.filter((s): s is Selection => !!s && typeof s === 'object' && typeof s.nodeId === 'string' && (s.sessionId === undefined || typeof s.sessionId === 'string')).slice(0, 256) : undefined;
      const weights: Record<string, number> = {};
      if (p.weights && typeof p.weights === 'object') for (const [key, weight] of Object.entries(p.weights)) if (typeof weight === 'number' && Number.isFinite(weight) && weight > 0 && weight < 1000) weights[key] = weight;
      result[id] = { controlsCollapsed: p.controlsCollapsed === true, selection, opened: strings(p.opened), order: strings(p.order), weights, expanded: p.expanded === true, orientation: p.orientation === 'vertical' ? 'vertical' : 'horizontal', height: typeof p.height === 'number' && Number.isFinite(p.height) ? Math.max(180, Math.min(1000, p.height)) : 280 };
    }
    return result;
  } catch { return {}; }
}

/** Presentation state only. TerminalService owns every shell and its effective policy. */
export function useTerminalDock({ client, workspace, renderTerminal, active, show }: Pick<UIPluginProps, 'client' | 'workspace' | 'renderTerminal'> & { active: boolean; show?: () => void }) {
  const state = useSyncExternalStore(workspace?.subscribe ?? emptySubscribe, workspace?.snapshot ?? emptySnapshot);
  const projectId = state.projectId, api = client.terminals;
  const [preferences, setPreferences] = useState<Record<string, Preferences>>(savedPreferences);
  const [listed, setListed] = useState<{ projectId: string; sessions: TerminalSession[]; loading: boolean; error: string }>({ projectId, sessions: [], loading: true, error: '' });
  const [policyInfo, setPolicyInfo] = useState<{ projectId: string; value?: OwnershipInfo; error?: string }>({ projectId });
  const [error, setError] = useState('');
  const [rename, setRename] = useState<{ nodeId: string; value: string } | null>(null);
const observations = useRef(new Map<string, number>());
  const context = useRef({ projectId, active }); context.current = { projectId, active };
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const drag = useRef<string | null>(null);
  const splitDrag = useRef<{ pointerId: number; start: number; span: number; before: number; after: number; a: string; b: string } | null>(null);
  const heightDrag = useRef<{ pointerId: number; start: number; height: number } | null>(null);
  const instance = useId().replace(/:/g, '');
  const panelId = `terminal-dock-panel-${instance}`;
  const pref = preferences[projectId] ?? {};
  const expanded = !!pref.expanded;
  const vertical = expanded && pref.orientation === 'vertical';
  const patch = (values: Partial<Preferences>) => setPreferences(all => ({ ...all, [projectId]: { ...all[projectId], ...values } }));
const showMain = () => { patch({ expanded: true }); show?.(); };
const showDock = () => { patch({ expanded: false }); show?.(); };
  const currentList = listed.projectId === projectId ? listed : { projectId, sessions: [], loading: true, error: '' };
  const nodes = state.graph.nodes.filter(node => node.type === 'terminal');
  const label = (nodeId: string) => String(nodes.find(node => node.id === nodeId)?.data.label ?? nodeId);
// A named terminal node is one pane across shell generations. Historical orphan
// sessions keep their exact identity and can only be observed.
const nodeIds = new Set(nodes.map(node => node.id));
const tabs: Tab[] = nodes.map(node => {
const sessions = currentList.sessions.filter(session => session.nodeId === node.id);
const session = sessions.findLast(value => value.status === 'running') ?? sessions.at(-1);
return { nodeId: node.id, session, label: String(node.data.label ?? 'Terminal'), status: session?.status ?? 'stopped' };
});
for (const session of currentList.sessions) if (!nodeIds.has(session.nodeId)) tabs.push({ nodeId: session.nodeId, sessionId: session.id, session, status: session.status, label: label(session.nodeId) });
for (const selected of pref.selection ?? []) if (!nodeIds.has(selected.nodeId) && selected.sessionId && !tabs.some(tab => tab.sessionId === selected.sessionId)) tabs.push({ ...selected, label: label(selected.nodeId), status: 'unavailable' });
const orderIndex = (tab: Tab) => {
const keys = [keyOf(tab), ...(nodeIds.has(tab.nodeId) ? currentList.sessions.filter(session => session.nodeId === tab.nodeId).map(session => `session:${session.id}`) : [])];
return Math.min(...keys.map(key => (pref.order ?? []).indexOf(key)).filter(index => index >= 0), 1e6);
};
  const ordered = [...tabs].sort((a, b) => {
return orderIndex(a) - orderIndex(b);
  });
const resolve = (selection: Selection) => nodeIds.has(selection.nodeId) ? ordered.find(tab => tab.nodeId === selection.nodeId) : ordered.find(tab => keyOf(tab) === keyOf(selection));
  const preferred = ordered.find(tab => tab.nodeId === state.selectedNodeId && tab.status === 'running') ?? ordered.find(tab => tab.nodeId === state.selectedNodeId) ?? ordered.find(tab => tab.status === 'running') ?? ordered[0];
const selected = pref.selection === undefined ? (preferred ? [preferred] : []) : pref.selection.map(resolve).filter((tab): tab is Tab => !!tab).filter((tab, index, values) => values.findIndex(value => keyOf(value) === keyOf(tab)) === index).sort((a, b) => ordered.indexOf(a) - ordered.indexOf(b));
  const selectedKeys = new Set(selected.map(keyOf));
  const visibleOrder = selected.map(keyOf);
  const panes = [...ordered.filter(tab => selectedKeys.has(keyOf(tab))), ...ordered.filter(tab => !selectedKeys.has(keyOf(tab)) && (pref.opened ?? []).includes(paneKey(tab)))];
  const uniquePanes = panes.filter((tab, index) => panes.findIndex(value => paneKey(value) === paneKey(tab)) === index);
  const policy = policyInfo.projectId === projectId ? policyInfo.value : undefined;
  const buttonId = (tab: Selection) => `terminal-dock-tab-${instance}-${encodeURIComponent(keyOf(tab))}`;
  const source = 'plugins/ui-shell/src/terminals.tsx';
  const idProps = (id: string) => ({ 'data-devlab-id': `terminal-dock.${projectId}.${id}`, 'data-devlab-source': source });
  useEffect(() => { try { localStorage.setItem(STORAGE, JSON.stringify(preferences)); } catch { /* Layout stays usable without storage. */ } }, [preferences]);
  useEffect(() => {
    if (!api || !active) return;
    let alive = true; let timer: ReturnType<typeof setTimeout>;
observations.current.set(projectId, (observations.current.get(projectId) ?? 0) + 1);
    const load = async () => {
const observed = observations.current.get(projectId);
const current = () => alive && context.current.projectId === projectId && observations.current.get(projectId) === observed;
      try {
        const sessions = (await api.list(projectId)).filter(session => session.projectId === projectId);
if (current()) {
setListed({ projectId, sessions, loading: false, error: '' });
}
} catch (cause) { if (current()) setListed(value => ({ projectId, sessions: value.projectId === projectId ? value.sessions : [], loading: false, error: cause instanceof Error ? cause.message : String(cause) })); }
      finally { if (alive) timer = setTimeout(() => void load(), 1000); }
    };
    void load();
return () => { alive = false; observations.current.set(projectId, (observations.current.get(projectId) ?? 0) + 1); clearTimeout(timer); };
  }, [api, active, projectId]);
  useEffect(() => {
    if (!api?.ownerships || !active) return;
    let alive = true;
    void api.ownerships(projectId).then(value => { if (alive) setPolicyInfo({ projectId, value }); }).catch(cause => { if (alive) setPolicyInfo({ projectId, error: cause instanceof Error ? cause.message : String(cause) }); });
    return () => { alive = false; };
  }, [api, active, projectId]);

  const choose = (tab: Tab, additive = false) => {
    show?.();
    const key = keyOf(tab);
    const next = additive ? (selectedKeys.has(key) ? selected.filter(value => keyOf(value) !== key) : [...selected, tab]) : [tab];
    patch({ selection: next.map(({ nodeId, sessionId }) => ({ nodeId, ...(sessionId ? { sessionId } : {}) })), opened: [...new Set([...(pref.opened ?? []), ...selected.map(paneKey), paneKey(tab)])] });
  };
  const updateNode = (nodeId: string, values: Record<string, unknown>) => {
    if (!workspace || workspace.snapshot().projectId !== projectId) return;
    const graph = workspace.snapshot().graph;
    workspace.update({ ...graph, nodes: graph.nodes.map(node => node.id === nodeId ? { ...node, data: { ...node.data, ...values } } : node) });
  };
const rememberSession = (session: TerminalSession) => {
const snapshot = workspace?.snapshot();
if (context.current.projectId !== session.projectId || (snapshot && snapshot.projectId !== session.projectId)) return;
observations.current.set(session.projectId, (observations.current.get(session.projectId) ?? 0) + 1);
setListed(value => ({ projectId: session.projectId, loading: false, error: '', sessions: [...(value.projectId === session.projectId ? value.sessions.filter(s => s.id !== session.id) : []), session] }));
if (!workspace || !snapshot) return;
const node = snapshot.graph.nodes.find(value => value.id === session.nodeId);
if (!node) return;
const adoptOwnership = node.data.ownership === undefined && !!session.ownership?.ownerId;
if (!adoptOwnership && !('parentSessionId' in node.data)) return;
try {
workspace.update({ ...snapshot.graph, nodes: snapshot.graph.nodes.map(node => {
if (node.id !== session.nodeId) return node;
const { parentSessionId: _fulfilled, ...data } = node.data;
// Recover missing saved settings from the shell; explicit settings remain authoritative.
return { ...node, data: { ...data, ...(adoptOwnership ? { ownership: ownership(session.ownership) } : {}) } };
}) });
} catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
const addTerminal = (parent?: Tab) => {
if (!workspace || !api) return;
    const snapshot = workspace.snapshot(); if (snapshot.projectId !== projectId) return;
    const original = snapshot.graph.nodes.find(node => node.id === parent?.nodeId);
if (parent && (!original || !parent.session)) return;
    const inherited = ownership(parent?.session?.ownership ?? original?.data.ownership);
    const id = crypto.randomUUID();
const inheritedData = { ...(original?.data ?? {}) }; delete inheritedData.parentSessionId; delete inheritedData.parentNodeId;
const node = { id, type: 'terminal', position: { x: (original?.position.x ?? 40) + 48, y: (original?.position.y ?? 40) + 48 }, data: { ...inheritedData, label: original ? `${String(original.data.label ?? 'Terminal')} fork` : `Terminal ${nodes.length + 1}`, cwd: typeof original?.data.cwd === 'string' ? original.data.cwd : '.', shell: original?.data.shell === 'sh' ? 'sh' : 'bash', width: 500, height: 280, ownership: inherited, ...(parent?.session ? { parentNodeId: parent.nodeId, parentSessionId: parent.session.id } : {}) } };
setError('');
try {
    workspace.update({ ...snapshot.graph, nodes: [...snapshot.graph.nodes, node] });
    workspace.select(id); show?.();
    patch({ selection: [{ nodeId: id }], opened: [...new Set([...(pref.opened ?? []), ...selected.map(paneKey), `node:${id}`])] });
} catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const reorder = (key: string, offset: number, target?: string) => {
    const order = ordered.map(keyOf); const at = order.indexOf(key); if (at < 0) return;
    const to = target ? order.indexOf(target) : Math.max(0, Math.min(order.length - 1, at + offset)); if (to < 0 || at === to) return;
    order.splice(at, 1); order.splice(to, 0, key);
    const selection = [...selected].sort((a, b) => order.indexOf(keyOf(a)) - order.indexOf(keyOf(b))).map(({ nodeId, sessionId }) => ({ nodeId, ...(sessionId ? { sessionId } : {}) }));
    patch({ order, selection });
  };
  const setPair = (a: string, b: string, before: number, after: number) => patch({ weights: { ...(pref.weights ?? {}), [a]: Math.max(.15, before), [b]: Math.max(.15, after) } });
  const startSplit = (event: PointerEvent<HTMLDivElement>, a: string, b: string) => {
    if (event.button !== 0) return;
    const parent = event.currentTarget.parentElement!;
    const left = [...parent.querySelectorAll<HTMLElement>(':scope > .terminal-workspace-pane')].find(element => element.dataset.paneKey === a);
    const right = [...parent.querySelectorAll<HTMLElement>(':scope > .terminal-workspace-pane')].find(element => element.dataset.paneKey === b);
    if (!left || !right) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    splitDrag.current = { pointerId: event.pointerId, start: vertical ? event.clientY : event.clientX, span: vertical ? left.clientHeight + right.clientHeight : left.clientWidth + right.clientWidth, before: pref.weights?.[a] ?? 1, after: pref.weights?.[b] ?? 1, a, b };
  };
  const tabButtons = ordered.map((tab, index) => <button key={keyOf(tab)} ref={element => { if (element) tabRefs.current.set(keyOf(tab), element); else tabRefs.current.delete(keyOf(tab)); }} id={buttonId(tab)} role="tab" aria-selected={selectedKeys.has(keyOf(tab))} aria-controls={panelId} tabIndex={index === 0 || selectedKeys.has(keyOf(tab)) ? 0 : -1} className={`terminal-tab${selectedKeys.has(keyOf(tab)) ? ' terminal-tab--active' : ''}`} title={`${tab.label} · ${tab.status}${tab.session ? ` · ${tab.session.cwd}` : ''} · Shift-click to show together`} data-terminal-session-id={tab.session?.id ?? tab.sessionId ?? ''} data-terminal-node-id={tab.nodeId} {...idProps(`tab.${keyOf(tab)}`)} draggable onDragStart={event => { drag.current = keyOf(tab); event.dataTransfer.setData('text/plain', keyOf(tab)); }} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (drag.current) reorder(drag.current, 0, keyOf(tab)); drag.current = null; }} onDragEnd={() => { drag.current = null; }} onClick={event => choose(tab, event.shiftKey)} onKeyDown={event => {
    if (event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); reorder(keyOf(tab), event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1); return; }
    const next = event.key === 'ArrowRight' ? (index + 1) % ordered.length : event.key === 'ArrowLeft' ? (index + ordered.length - 1) % ordered.length : event.key === 'Home' ? 0 : event.key === 'End' ? ordered.length - 1 : null;
    if (next === null) return; event.preventDefault(); const value = ordered[next]; if (value) { choose(value, event.shiftKey); tabRefs.current.get(keyOf(value))?.focus(); }
  }}><span aria-hidden="true" className={`terminal-tab-status-dot terminal-tab-status-dot--${tab.status === 'running' ? 'running' : 'stopped'}`} />{tab.label}<span className="terminal-tab-state">{tab.status}</span></button>);

  const dockedTerminals = active ? selected.filter(tab => nodeIds.has(tab.nodeId)).map(tab => ({ nodeId: tab.nodeId, ...(tab.session ? { sessionId: tab.session.id } : {}) })) : [];
const dockedTerminal = dockedTerminals.find((value): value is { nodeId: string; sessionId: string } => typeof value.sessionId === 'string');
const dismissActions = (element: HTMLElement) => {
const details = element.closest('details');
if (details) { details.open = false; details.querySelector('summary')?.focus(); }
};
const workspaceActions = <>
<button type="button" className="icon-button" title="New terminal" aria-label="New terminal" disabled={!api || !workspace || state.loading} onClick={() => addTerminal()} {...idProps('new')}><Plus size={13} aria-hidden="true" /></button>
<button type="button" className="icon-button" title={expanded ? 'Dock terminals' : 'Open terminals in main view'} aria-label={expanded ? 'Dock terminals' : 'Open terminals in main view'} onClick={expanded ? showDock : showMain} {...idProps(expanded ? 'dock' : 'expand')}>{expanded ? <PanelBottom size={13} aria-hidden="true" /> : <Maximize2 size={13} aria-hidden="true" />}</button>
{expanded && <button type="button" className="icon-button" title={vertical ? 'Side by side' : 'Stack vertically'} aria-label={vertical ? 'Side by side' : 'Stack vertically'} onClick={() => patch({ orientation: vertical ? 'horizontal' : 'vertical' })} {...idProps('orientation')}>{vertical ? <Columns2 size={13} aria-hidden="true" /> : <Rows2 size={13} aria-hidden="true" />}</button>}
</>;
const toolbar = <div className={expanded ? 'terminal-toolbar-controls' : 'terminal-workspace-toolbar'} {...idProps('toolbar')}>
{expanded && <div className="terminal-workspace-tabs" role="tablist" aria-multiselectable="true" aria-label="Terminal sessions">{tabButtons}</div>}
{!selected.length && workspaceActions}
</div>;
const panel = <div id={panelId} role="tabpanel" aria-label="Terminal sessions" className="terminal-dock" data-testid="terminal-sessions" data-expanded={expanded} data-orientation={vertical ? 'vertical' : 'horizontal'} {...idProps('panel')}>
<div className="terminal-panel-height" role="separator" tabIndex={0} aria-label="Resize terminal panel" aria-orientation="horizontal" aria-valuemin={180} aria-valuemax={1000} aria-valuenow={pref.height ?? 280} {...idProps('height')} onPointerDown={event => { if (expanded || event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); heightDrag.current = { pointerId: event.pointerId, start: event.clientY, height: pref.height ?? 280 }; }} onPointerMove={event => { const value = heightDrag.current; if (value?.pointerId === event.pointerId) patch({ height: Math.max(180, Math.min(1000, window.innerHeight - 100, value.height + value.start - event.clientY)) }); }} onPointerUp={() => { heightDrag.current = null; }} onPointerCancel={() => { heightDrag.current = null; }} onKeyDown={event => { if (!expanded && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) { event.preventDefault(); patch({ height: Math.max(180, Math.min(1000, window.innerHeight - 100, (pref.height ?? 280) + (event.key === 'ArrowUp' ? 24 : -24))) }); } }} />
{!expanded && !selected.length && toolbar}
{!api || !renderTerminal ? <p className="terminal-dock-empty" role="status">Terminal renderer is unavailable.</p> : <div className={`terminal-workspace-panes${vertical ? ' terminal-workspace-panes--vertical' : ''}`} {...idProps('panes')}>
      {uniquePanes.flatMap(tab => {
        const key = keyOf(tab), pk = paneKey(tab), visible = selectedKeys.has(key), node = nodes.find(value => value.id === tab.nodeId);
        const effective = ownership(tab.session?.ownership);
        const cfg = ownership(node?.data.ownership ?? tab.session?.ownership), mode = cfg.mode;
        const current = tab.session?.status === 'running';
        const cwd = typeof node?.data.cwd === 'string' && !/^(?:[\\/]|[A-Za-z]:)/.test(node.data.cwd) ? node.data.cwd : '.';
        const index = visibleOrder.indexOf(key), next = selected[index + 1];
        const parentSessionId = typeof node?.data.parentSessionId === 'string' ? node.data.parentSessionId : undefined;
const policyPending = current && JSON.stringify(cfg) !== JSON.stringify(effective);
const policyTitle = `${current ? 'Running' : tab.status} · ${current ? effective.mode : mode}${(current ? effective.ownerId : cfg.ownerId) ? ` · ${(current ? effective.ownerId : cfg.ownerId)}` : ''}${policyPending ? ' · Updated settings apply after this shell exits' : ''}`;
const pane = <section key={pk} data-pane-key={pk} data-terminal-node-id={tab.nodeId} data-terminal-session-id={tab.session?.id ?? tab.sessionId ?? ''} data-ownership-mode={current ? effective.mode : cfg.mode} data-ownership-id={(current ? effective.ownerId : cfg.ownerId) ?? ''} className="terminal-workspace-pane" hidden={!visible} style={{ flexGrow: pref.weights?.[pk] ?? 1 }} {...idProps(`pane.${key}`)}>
<div className="terminal-pane-toolbar" {...idProps(`header.${key}`)}>
{rename?.nodeId === tab.nodeId ? <input autoFocus aria-label="Terminal name" maxLength={120} value={rename.value} onChange={event => setRename({ nodeId: tab.nodeId, value: event.target.value })} onBlur={() => { if (rename.value.trim()) updateNode(tab.nodeId, { label: rename.value.trim() }); setRename(null); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setRename(null); } }} {...idProps(`name.${key}`)} /> : <button type="button" className="terminal-pane-name" disabled={!node} title="Rename terminal" aria-label={`Rename ${tab.label}`} onClick={() => setRename({ nodeId: tab.nodeId, value: tab.label })} {...idProps(`rename.${key}`)}>{tab.label}</button>}
{index === 0 && <>
<span id={`${panelId}-controls`} className="terminal-pane-controls" hidden={!!pref.controlsCollapsed}>{workspaceActions}</span>
<button type="button" className="icon-button" aria-label={pref.controlsCollapsed ? 'Expand terminal controls' : 'Collapse terminal controls'} title={pref.controlsCollapsed ? 'Expand terminal controls' : 'Collapse terminal controls'} aria-expanded={!pref.controlsCollapsed} aria-controls={`${panelId}-controls`} onClick={() => patch({ controlsCollapsed: !pref.controlsCollapsed })} {...idProps('controls.toggle')}>{pref.controlsCollapsed ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronUp size={12} aria-hidden="true" />}</button>
</>}
<span className="terminal-pane-state" title={policyTitle} role="status"><span aria-hidden="true" className={`terminal-tab-status-dot terminal-tab-status-dot--${current ? 'running' : 'stopped'}`} />{current ? effective.mode : node ? 'ready' : tab.status}{policyPending && <span aria-label="Settings pending"> ·</span>}</span>
<details className="terminal-pane-actions" {...idProps(`actions.${key}`)} onToggle={event => {
const details = event.currentTarget;
if (!details.open) return;
const anchor = details.querySelector('summary')!.getBoundingClientRect(), menu = details.querySelector<HTMLElement>('.terminal-pane-menu')!;
const width = Math.min(264, window.innerWidth - 16), height = Math.min(menu.scrollHeight, window.innerHeight - 16);
menu.style.left = `${Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8))}px`;
menu.style.top = `${anchor.bottom + height + 8 <= window.innerHeight ? anchor.bottom + 4 : Math.max(8, anchor.top - height - 4)}px`;
}} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false; }} onKeyDown={event => { if (event.key === 'Escape' && event.currentTarget.open) { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}>
<summary className="icon-button" aria-label={`Actions for ${tab.label}`} title={`Actions for ${tab.label}`}><Ellipsis size={13} aria-hidden="true" /></summary>
<div className="terminal-pane-menu" role="group" aria-label={`Settings for ${tab.label}`}>
<button type="button" disabled={!node || !tab.session} aria-label={`Fork ${tab.label}`} title="Open a fresh terminal inheriting this session’s effective ownership" onClick={event => { dismissActions(event.currentTarget); addTerminal(tab); }} {...idProps(`fork.${key}`)}>Fork terminal</button>
<button type="button" disabled={ordered[0] === tab} aria-label={`Move ${tab.label} earlier`} onClick={event => { reorder(key, -1); dismissActions(event.currentTarget); }} {...idProps(`earlier.${key}`)}>Move earlier</button>
<button type="button" disabled={ordered.at(-1) === tab} aria-label={`Move ${tab.label} later`} onClick={event => { reorder(key, 1); dismissActions(event.currentTarget); }} {...idProps(`later.${key}`)}>Move later</button>
<label>Ownership <select aria-label={`Ownership for ${tab.label}`} value={cfg.ownerId ?? ''} disabled={!node || !policy} onChange={event => updateNode(tab.nodeId, { ownership: event.target.value ? { mode: cfg.mode === 'off' ? 'guided' : cfg.mode, ownerId: event.target.value } : { mode: 'off' } })} {...idProps(`owner.${key}`)}><option value="">Unassigned</option>{policy?.owners.map(owner => <option key={owner.id} value={owner.id}>{owner.label}</option>)}</select></label>
<label>Mode <select aria-label={`Ownership mode for ${tab.label}`} value={mode} disabled={!node} onChange={event => updateNode(tab.nodeId, { ownership: event.target.value === 'off' ? { mode: 'off', ...(cfg.ownerId ? { ownerId: cfg.ownerId } : {}) } : { mode: event.target.value, ownerId: cfg.ownerId ?? policy?.owners[0]?.id } })} {...idProps(`mode.${key}`)}><option value="off">Off</option><option value="guided" disabled={!policy?.owners.length}>Guided · advisory</option><option value="strict" disabled={!policy?.strict.available || !policy.owners.length}>Strict · write locked</option></select></label>
<p>Run exit in the terminal to apply updated settings. A fresh shell opens automatically after a clean exit. Strict limits writes to existing owned files and private scratch, and blocks network access.</p>
{mode === 'guided' && <p>Guided is advisory; commands retain normal local-user access.</p>}
{cfg.mode === 'strict' && !policy?.strict.available && <p role="alert">Strict launch is unavailable: {policy?.strict.reason ?? 'checking confinement support'}</p>}
</div>
</details>
</div>
{renderTerminal({ projectId, nodeId: tab.nodeId, ...(node ? {} : { sessionId: tab.sessionId }), cwd, shell: node ? node.data.shell === 'sh' ? 'sh' : 'bash' : tab.session?.shell ?? 'bash', instanceId: `dock-${projectId}-${pk}`, autoStart: !!node && active && visible, resizeOwner: !!node && active && visible, inputOwner: !!node && active && visible, ownership: cfg, ...(parentSessionId ? { parentSessionId } : {}), onStarted: rememberSession })}
</section>;
        if (!visible || !next) return [pane];
        const nk = paneKey(next);
        return [pane, <div key={`divider:${pk}:${nk}`} className="terminal-pane-divider" role="separator" tabIndex={0} aria-orientation={vertical ? 'horizontal' : 'vertical'} aria-label={`Resize ${tab.label} and ${next.label}`} aria-valuemin={10} aria-valuemax={90} aria-valuenow={Math.round(100 * (pref.weights?.[pk] ?? 1) / ((pref.weights?.[pk] ?? 1) + (pref.weights?.[nk] ?? 1)))} {...idProps(`divider.${key}`)} onPointerDown={event => startSplit(event, pk, nk)} onPointerMove={event => { const value = splitDrag.current; if (value?.pointerId !== event.pointerId) return; const total = value.before + value.after, change = ((vertical ? event.clientY : event.clientX) - value.start) / Math.max(1, value.span) * total, before = Math.max(total * .1, Math.min(total * .9, value.before + change)); setPair(value.a, value.b, before, total - before); }} onPointerUp={() => { splitDrag.current = null; }} onPointerCancel={() => { splitDrag.current = null; }} onKeyDown={event => { const negative = vertical ? 'ArrowUp' : 'ArrowLeft', positive = vertical ? 'ArrowDown' : 'ArrowRight'; if (event.key !== negative && event.key !== positive) return; event.preventDefault(); const before = pref.weights?.[pk] ?? 1, after = pref.weights?.[nk] ?? 1, change = (before + after) * .05 * (event.key === negative ? -1 : 1); setPair(pk, nk, before + change, after - change); }} />];
      })}
      {!selected.length && <p className="terminal-dock-empty" role="status">{currentList.loading ? 'Checking terminal sessions…' : tabs.length ? 'Select terminal headers, or create a new terminal.' : 'Create a terminal, or add a terminal node on the canvas.'}</p>}
    </div>}
    {(error || currentList.error || (policyInfo.projectId === projectId && policyInfo.error)) && <p className="terminal-dock-error" role="alert">{error || currentList.error || policyInfo.error}</p>}
  </div>;
 return { tabs: expanded ? null : tabButtons, toolbar, panel, dockedTerminals, dockedTerminal, onTerminalStarted: rememberSession, expanded, showMain, showDock, height: pref.height ?? 280 };
}
