import { createHash } from 'node:crypto';
import { ApplicationError, canonicalJson, RegistrySnapshotSchema, type RegistryMap,
  type RegistryClient, type RegistrySnapshot, type RegistryItem, type RegistryEdge, type DeepSeekInventory } from '@devlab/contracts';

/** One public discovery outlet; no execution callbacks or credentials cross this seam. */
export function routeDeepSeekRegistry(inventory: DeepSeekInventory): RegistrySnapshot {
  const items: RegistryItem[] = [{ id: 'deepseek:root', kind: 'group', parentId: null, label: 'DeepSeek Harness Runtime', detail: 'Independent upstream Cordis process; package inventory is separate from activation.' }];
  const edges: RegistryEdge[] = [], ids = new Set(inventory.packages.map(row => row.id));
  const live = new Map(inventory.entries.map(row => [row.module, row]));
  for (const row of inventory.packages) {
    const state = live.get(row.id);
    items.push({ id: 'deepseek:package:' + row.id, kind: state ? 'plugin' : 'module', parentId: 'deepseek:root', label: row.id,
      detail: `${row.version} · ${row.license} · ${state?.state ?? 'off'} · ${row.installed ? 'installed' : 'not installed'}\n${row.description}` });
    for (const dependency of row.dependencies) if (ids.has(dependency)) edges.push({ id: `deepseek:dependency:${row.id}:${dependency}`,
      source: 'deepseek:package:' + row.id, target: 'deepseek:package:' + dependency, kind: 'requires', label: 'package dependency', evidence: [] });
  }
  const graph = { items, edges }, snapshotId = createHash('sha256').update(canonicalJson({ graph, entries: inventory.entries })).digest('hex');
  return RegistrySnapshotSchema.parse({ catalog: { schemaVersion: 1, snapshotId, builtAt: new Date().toISOString(), graph, channels: [] },
    plugins: inventory.entries.map(row => ({ id: 'deepseek/' + row.id, version: inventory.packages.find(pkg => pkg.id === row.module)?.version ?? 'unknown',
      provides: [], requires: row.requires, live: [], capabilities: [], reload: 'restart',
      state: row.state === 'active' ? 'active' : row.state === 'failed' ? 'failed' : row.state === 'disposed' || row.state === 'disabled' ? 'disposed' : 'unknown', generation: 1, leases: 0 })),
    wiring: { items: [], edges: [] } });
}
export function deepSeekRegistryClient(origin: string): RegistryClient {
  const base = new URL(origin);
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password || base.pathname !== '/')
    throw new ApplicationError('INVALID_INPUT', 'DeepSeek runtime must use a loopback HTTP origin');
  return { async snapshot() {
    const response = await fetch(new URL('/api/registry', base), { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new ApplicationError('SERVICE_UNAVAILABLE', 'DeepSeek runtime registry is unavailable');
    return RegistrySnapshotSchema.parse(await response.json());
  }, async source() { throw new ApplicationError('PATH_DENIED', 'Upstream source is read-only and managed by its release'); },
    async projects() { return [{ id: 'deepseek-runtime', label: 'DeepSeek Harness Runtime', previewUrl: base.origin }]; } };
}
/** Add the foreign graph without changing the host kernel or its service authority. */
export function federateRegistry(main: RegistryMap, upstream: RegistryClient): RegistryMap {
  return { ...main, async snapshot(projectId) {
    if (projectId === 'deepseek-runtime') return upstream.snapshot();
    const base = await main.snapshot(projectId);
    let extra: RegistrySnapshot;
    try { extra = await upstream.snapshot(); }
    catch { return RegistrySnapshotSchema.parse({ ...base, observation: { mode: 'snapshot', projectId: projectId ?? 'workspace', revision: 0, status: 'stale', message: 'DeepSeek Harness Runtime is unavailable; host snapshot retained' } }); }
    const graph = { items: [...base.catalog.graph.items, ...extra.catalog.graph.items], edges: [...base.catalog.graph.edges, ...extra.catalog.graph.edges] };
    return RegistrySnapshotSchema.parse({ ...base, catalog: { ...base.catalog, graph,
      snapshotId: createHash('sha256').update(base.catalog.snapshotId + extra.catalog.snapshotId).digest('hex') },
      plugins: [...base.plugins, ...extra.plugins], wiring: { items: [...base.wiring.items, ...extra.wiring.items], edges: [...base.wiring.edges, ...extra.wiring.edges] } });
  }, async projects() { return [...await main.projects?.() ?? [], ...await upstream.projects?.() ?? []]; } };
}
