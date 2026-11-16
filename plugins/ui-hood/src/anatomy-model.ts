import { graphlib, layout } from '@dagrejs/dagre';
import type { RegistryCatalog, RegistryItem } from '@creoaurea/pop-the-hood/contracts';

export type AnatomyBlock = { item: RegistryItem; children: RegistryItem[]; files: number };
export type AnatomyWire = { id: string; source: string; target: string; count: number };

/** One level at a time. Wires are aggregated evidence, never invented containment dependencies. */
export function anatomyLevel(graph: RegistryCatalog['graph'], parent: string | null = null) {
  const all = new Map(graph.items.map(item => [item.id, item]));
  const children = new Map<string | null, RegistryItem[]>();
  for (const item of graph.items) {
    const siblings = children.get(item.parentId) ?? [];
    siblings.push(item); children.set(item.parentId, siblings);
  }
  const blocks: AnatomyBlock[] = (children.get(parent) ?? []).map(item => ({
    item, children: children.get(item.id) ?? [], files: 0,
  }));
  const visible = new Map(blocks.map(block => [block.item.id, block]));
  const representatives = new Map<string, string>();
  for (const item of graph.items) {
    let current: RegistryItem | undefined = item;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      const block = visible.get(current.id);
      if (block) {
        representatives.set(item.id, current.id);
        if (item.kind === 'file') block.files++;
        break;
      }
      current = current.parentId ? all.get(current.parentId) : undefined;
    }
  }
  const wires = new Map<string, AnatomyWire>();
  for (const edge of graph.edges) {
    if (!['requires', 'import', 'reexport'].includes(edge.kind)) continue;
    const source = representatives.get(edge.source), target = representatives.get(edge.target);
    if (!source || !target || source === target) continue;
    const id = `${source}->${target}`, existing = wires.get(id);
    if (existing) existing.count++;
    else wires.set(id, { id, source, target, count: 1 });
  }
  return { blocks, wires: [...wires.values()] };
}

export const BLOCK_WIDTH = 300, BLOCK_HEIGHT = 144;

/** Dagre positions real dependency ranks; disconnected blocks occupy a compact shelf. */
export function layoutAnatomy(blocks: AnatomyBlock[], wires: AnatomyWire[]) {
  // Ownership categories are not a DAG: aggregating acyclic owner dependencies can
  // produce category cycles. Stack overview lanes by responsibility, then use
  // Dagre for the real dependency graph inside each layer.
  if (blocks.every(block => block.item.id.startsWith('layer:'))) {
    const order = ['browser', 'coordination', 'backend', 'delivery', 'contracts', 'verification', 'installed'];
    const sorted = [...blocks].sort((a, b) => {
      const rank = (id: string) => { const index = order.indexOf(id.slice(6)); return index < 0 ? order.length : index; };
      return rank(a.item.id) - rank(b.item.id);
    });
    return new Map(sorted.map((block, index) => [block.item.id,
      { x: (index % 2) * (BLOCK_WIDTH + 48), y: Math.floor(index / 2) * (BLOCK_HEIGHT + 40) }]));
  }
  const graph = new graphlib.Graph();
  graph.setGraph({ rankdir: 'TB', nodesep: 36, ranksep: 64, marginx: 24, marginy: 24 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const block of blocks) graph.setNode(block.item.id, { width: BLOCK_WIDTH, height: BLOCK_HEIGHT });
  for (const wire of wires) graph.setEdge(wire.source, wire.target);
  if (blocks.length) layout(graph);
  return new Map(blocks.map((block, index) => {
    const point = graph.node(block.item.id);
    return [block.item.id, wires.length
      ? { x: point.x - BLOCK_WIDTH / 2, y: point.y - BLOCK_HEIGHT / 2 }
      : { x: (index % 3) * (BLOCK_WIDTH + 36), y: Math.floor(index / 3) * (BLOCK_HEIGHT + 48) }];
  }));
}
