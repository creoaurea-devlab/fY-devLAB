import { useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, Handle, Position, MarkerType,
  type Node, type NodeProps } from '@xyflow/react';
import type { RegistryClient, RegistrySnapshot } from '@creoaurea/pop-the-hood/contracts';
import { anatomyLevel, layoutAnatomy, BLOCK_WIDTH, BLOCK_HEIGHT, type AnatomyBlock } from './anatomy-model.ts';
import '@xyflow/react/dist/style.css';

type BlockNode = Node<{ block: AnatomyBlock; open: (id: string) => void }, 'anatomy'>;
function Block({ data }: NodeProps<BlockNode>) {
  const { item, children, files } = data.block;
  return <div className="anatomy-block">
    <Handle type="target" position={Position.Top} />
    <small>{item.id.startsWith('layer:') ? 'OWNERSHIP LAYER' : item.id.startsWith('owner:') ? 'CAPABILITY OWNER' : item.kind.toUpperCase()}</small>
    <strong>{item.label}</strong>
    <p>{item.detail.split('\n')[0]}</p>
    <footer><span>{files} files · {children.length} blocks</span>
      {!!children.length && <button type="button" className="nodrag nopan" aria-label={`Open ${item.label}`}
        onClick={() => data.open(item.id)}>Open →</button>}</footer>
    <Handle type="source" position={Position.Bottom} />
  </div>;
}
const nodeTypes = { anatomy: Block };

/** Read-only inspection owns only its fetch/listener and presentation state. */
export function AnatomyView({ api, projectId, onSourceGraph }: { api?: RegistryClient; projectId?: string; onSourceGraph: () => void }) {
  const [snapshot, setSnapshot] = useState<RegistrySnapshot>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [parent, setParent] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showWires, setShowWires] = useState(false);
  const scope = useRef({ api, projectId });
  useEffect(() => {
    let active = true, revision = 0;
    if (scope.current.api !== api || scope.current.projectId !== projectId) {
      scope.current = { api, projectId };
      setSnapshot(undefined); setParent(null); setSelected(null); setQuery('');
    }
    const refresh = async () => {
      const current = ++revision;
      setLoading(true); setError('');
      try {
        if (!api) throw new Error('Architecture registry is unavailable.');
        const value = await api.snapshot(projectId);
        if (active && current === revision) setSnapshot(value);
      } catch (cause) {
        if (active && current === revision) setError(cause instanceof Error ? cause.message : 'Could not load architecture.');
      } finally { if (active && current === revision) setLoading(false); }
    };
    void refresh();
    const unsubscribe = api?.listen?.(projectId ?? 'default', () => { void refresh(); }, () => {
      if (active) setError('Live updates disconnected. Refresh to check the current source.');
    });
    return () => { active = false; unsubscribe?.(); };
  }, [api, projectId, attempt]);
  const graph = snapshot?.catalog.graph;
  const all = useMemo(() => new Map(graph?.items.map(item => [item.id, item]) ?? []), [graph]);
  const level = useMemo(() => anatomyLevel(graph ?? { items: [], edges: [] }, all.has(parent ?? '') ? parent : null), [graph, all, parent]);
  const positions = useMemo(() => layoutAnatomy(level.blocks, level.wires), [level]);
  const open = (id: string | null) => { setParent(id); setSelected(null); setQuery(''); };
  const needle = query.trim().toLowerCase();
  const matches = (block: AnatomyBlock) => !needle || [block.item.label, block.item.detail, block.item.path ?? '',
    ...block.children.map(item => item.label)].some(text => text.toLowerCase().includes(needle));
  const nodes: BlockNode[] = level.blocks.map(block => ({ id: block.item.id, type: 'anatomy',
    position: positions.get(block.item.id)!, data: { block, open },
    // The renderer and Dagre share fixed dimensions. Preserve them across controlled
    // snapshot updates instead of depending on an earlier DOM measurement.
    width: BLOCK_WIDTH, height: BLOCK_HEIGHT,
    style: { width: BLOCK_WIDTH, height: BLOCK_HEIGHT, opacity: matches(block) ? 1 : .22 },
    selected: selected === block.item.id,
    ariaLabel: block.item.label,
  }));
  const edges = level.wires.map(wire => ({ ...wire, type: 'smoothstep',
    label: `${wire.count}`, markerEnd: { type: MarkerType.ArrowClosed },
    hidden: !showWires && wire.source !== selected && wire.target !== selected,
    style: { stroke: 'hsl(var(--primary))', strokeWidth: 1.5 },
    labelStyle: { fill: 'hsl(var(--foreground))' }, labelBgStyle: { fill: 'hsl(var(--card))' },
  }));
  const item = all.get(selected ?? parent ?? '');
  const ownerCount = graph?.items.filter(item => item.id.startsWith('owner:')).length ?? 0;
  const relations = graph?.edges.filter(edge => selected && (edge.source === selected || edge.target === selected)) ?? [];
  const breadcrumbs = [];
  let ancestor = all.get(parent ?? '');
  const seen = new Set<string>();
  while (ancestor && !seen.has(ancestor.id)) {
    seen.add(ancestor.id); breadcrumbs.unshift(ancestor);
    ancestor = ancestor.parentId ? all.get(ancestor.parentId) : undefined;
  }
  return <div className="anatomy" data-testid="app-anatomy">
    <div className="anatomy-tools">
      <nav aria-label="Architecture path"><button onClick={() => open(null)}>All layers</button>
        {breadcrumbs.map(crumb => <button key={crumb.id} onClick={() => open(crumb.id)}> / {crumb.label}</button>)}</nav>
      <label className="anatomy-search">Find <input aria-label="Find an ownership block" value={query} onChange={event => setQuery(event.target.value)} placeholder="Owner or responsibility…" /></label>
      <label><input type="checkbox" checked={showWires} onChange={event => setShowWires(event.target.checked)} /> All connections</label>
      <button onClick={() => setAttempt(value => value + 1)}>Refresh</button>
    </div>
    <div className="anatomy-summary"><span>{ownerCount} owners · {snapshot?.plugins.length ?? 0} backend plugins · {level.blocks.length} visible blocks</span>
      <span>{parent ? 'Dagre · top to bottom' : 'Stacked ownership layers'} · select a block to trace dependencies</span></div>
    {loading && <p role="status" className="anatomy-notice">Loading architecture…</p>}
    {error && <p role="alert" className="anatomy-notice">{error}</p>}
    {snapshot?.observation?.status === 'stale' && <p role="status" className="anatomy-notice">Snapshot is stale. {snapshot.observation.message}</p>}
    <div className="anatomy-body">
      <div className="anatomy-canvas">
        {!!nodes.length && <ReactFlow key={`${parent ?? 'root'}:${snapshot?.catalog.snapshotId}`} nodes={nodes} edges={edges}
          nodeTypes={nodeTypes} nodesDraggable={false} nodesConnectable={false} edgesFocusable={false}
          minZoom={.1} maxZoom={1.8} fitView fitViewOptions={{ padding: .15, maxZoom: 1 }}
          onNodeClick={(_, node) => setSelected(node.id)} onNodeDoubleClick={(_, node) => {
            if (level.blocks.find(block => block.item.id === node.id)?.children.length) open(node.id);
          }} onPaneClick={() => setSelected(null)}>
          <Background gap={20} size={1} /><Controls showInteractive={false} />
        </ReactFlow>}
        {!loading && !error && !nodes.length && <p className="anatomy-notice">No architecture blocks in this snapshot. <button onClick={onSourceGraph}>Open source graph</button></p>}
      </div>
      <aside className="anatomy-inspector" aria-label="Ownership details">
        <small>{item ? 'SELECTED BLOCK' : 'APP TOPOLOGY'}</small>
        <h2>{item?.label ?? 'Under the hood'}</h2>
        <p>{item?.detail ?? 'Open a layer to see its owners, then open an owner to inspect its files. Select a block to see its connections.'}</p>
        {item?.path && <code>{item.path}</code>}
        {!item && <><h3>Boundaries & isolation</h3><p>Layers show responsibility. They are not process sandboxes. The terminal service owns Off, Guided and Strict policy; Strict enforces filesystem and process confinement.</p><p>Project guidance is inspection data. The planning executor remains disconnected.</p></>}
        {!!relations.length && <><h3>Declared connections</h3><ul>{relations.slice(0, 40).map(edge => <li key={edge.id}>
          {edge.source === selected ? 'Uses ' : 'Used by '}{all.get(edge.source === selected ? edge.target : edge.source)?.label ?? 'Unknown'}
          <small>{edge.kind}{edge.typeOnly ? ' · type only' : ''}</small>
        </li>)}</ul>{relations.length > 40 && <p>{relations.length - 40} more in the source graph.</p>}</>}
        <h3>{needle ? 'Matching blocks' : 'Blocks at this level'}</h3>
        <div className="anatomy-list">{level.blocks.filter(matches).map(block => <div key={block.item.id}>
          <button aria-pressed={selected === block.item.id} onClick={() => setSelected(block.item.id)}>{block.item.label}</button>
          {!!block.children.length && <button aria-label={`Browse ${block.item.label}`} onClick={() => open(block.item.id)}>→</button>}
        </div>)}{!level.blocks.some(matches) && <p>No matching blocks.</p>}</div>
        <button className="anatomy-source" onClick={onSourceGraph}>Detailed source & runtime graph →</button>
        {snapshot && <p className="anatomy-built">Built {new Date(snapshot.catalog.builtAt).toLocaleString()}. Owner groups come from selected YAML definitions; arrows show declared or analyzed dependencies.</p>}
      </aside>
    </div>
  </div>;
}
