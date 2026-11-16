import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { RegistryArtifactSchema } from '@creoaurea/pop-the-hood/contracts';
import { anatomyLevel, layoutAnatomy, BLOCK_WIDTH, BLOCK_HEIGHT } from '../plugins/ui-hood/src/anatomy-model.ts';

test('generated anatomy preserves exact owners, source coverage and evidence through collapse', async () => {
  const artifact = RegistryArtifactSchema.parse(JSON.parse(await readFile(new URL('../dist/architecture.json', import.meta.url), 'utf8')));
  const graph = artifact.catalog.graph, before = JSON.stringify(graph);
  const root = anatomyLevel(graph);
  assert(root.blocks.some(block => block.item.id === 'layer:browser'));
  assert(root.blocks.some(block => block.item.id === 'layer:backend'));
  const owners = graph.items.filter(item => item.id.startsWith('owner:'));
  assert(owners.length > 20);
  for (const owner of owners) {
    assert(owner.parentId?.startsWith('layer:'));
    assert(anatomyLevel(graph, owner.parentId).blocks.some(block => block.item.id === owner.id));
  }
  assert.equal(root.blocks.reduce((sum, block) => sum + block.files, 0), graph.items.filter(item => item.kind === 'file').length);
  assert(root.wires.length > 0);
  const ids = new Set(root.blocks.map(block => block.item.id));
  for (const wire of root.wires) { assert(ids.has(wire.source) && ids.has(wire.target)); assert.notEqual(wire.source, wire.target); assert(wire.count > 0); }
  // All levels must fit their rectangles without overlap, including cyclic aggregate dependencies.
  for (const parent of [null, ...root.blocks.map(block => block.item.id)]) {
    const level = anatomyLevel(graph, parent), positions = layoutAnatomy(level.blocks, level.wires);
    const points = [...positions.values()];
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!; assert(Number.isFinite(a.x) && Number.isFinite(a.y));
      for (const b of points.slice(i + 1)) assert(Math.abs(a.x - b.x) >= BLOCK_WIDTH || Math.abs(a.y - b.y) >= BLOCK_HEIGHT, `overlap at ${parent}`);
    }
  }
  assert.equal(JSON.stringify(graph), before, 'inspection must not mutate its source');
});

test('empty and malformed imported ancestry stay finite and do not create false wires', () => {
  assert.deepEqual(anatomyLevel({ items: [], edges: [] }), { blocks: [], wires: [] });
  const graph = { items: [
    { id: 'a', parentId: 'b', label: 'a', kind: 'group' as const, detail: '' },
    { id: 'b', parentId: 'a', label: 'b', kind: 'group' as const, detail: '' },
  ], edges: [] };
  assert.deepEqual(anatomyLevel(graph), { blocks: [], wires: [] });
});
