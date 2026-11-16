import { useEffect, useMemo, useRef } from 'react';
import { HoodView as PortableHood } from '@creoaurea/pop-the-hood/react';
import type { RegistryClient, RegistryEvent, RulesSnapshot } from '@devlab/contracts';
import './memory.css';

/** This adapter observes the already-read snapshot; it never queries SQL or the filesystem. */
export function MemoryLayer({ snapshot, onClose }: { snapshot: RulesSnapshot; onClose?: () => void }) {
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const revision = useRef(0);
  const subscribers = useMemo(() => new Set<(event: RegistryEvent) => void>(), [snapshot.projectId]);
  const client = useMemo<RegistryClient>(() => ({
    async snapshot(projectId) {
      const current = latest.current;
      if (projectId && projectId !== current.projectId) throw new Error('Memory observation belongs to a different project.');
      const memory = current.harness?.memoryGraph;
      if (!memory || memory.status !== 'ready') throw new Error('Memory graph is unavailable for this observation.');
      return {
        catalog: { schemaVersion: 1, snapshotId: memory.snapshotId,
          builtAt: new Date(current.observedAt).toISOString(), graph: memory.graph, channels: [] },
        plugins: [], wiring: { items: [], edges: [] },
        observation: { mode: 'snapshot', projectId: current.projectId, revision: revision.current, status: 'ready',
          message: 'Read-only SQLite observation. Refresh the WISDOHM snapshot to inspect again.' },
      };
    },
    async projects() { return [{ id: latest.current.projectId, label: 'WISDOHM memory' }]; },
    async source(path) {
      const source = latest.current.sources.find(item => item.path === path);
      if (!source?.sha256 || source.truncated || ['missing', 'invalid'].includes(source.status))
        throw new Error('Complete safe source text is unavailable in this observation.');
      return { path: source.path, sha256: source.sha256, text: source.text };
    },
    listen(projectId, receive) {
      if (projectId !== latest.current.projectId) return () => {};
      subscribers.add(receive);
      return () => { subscribers.delete(receive); };
    },
  }), [snapshot.projectId, subscribers]);

  useEffect(() => {
    revision.current++;
    // These notifications invalidate local presentation only; the observation remains a snapshot.
    for (const receive of subscribers)
      receive({ kind: 'snapshot', projectId: snapshot.projectId, revision: revision.current });
  }, [snapshot, subscribers]);

  const graph = snapshot.harness?.memoryGraph;
  if (!graph || graph.status !== 'ready') return <section className="wisdohm-memory" data-testid="wisdohm-memory">
    <p role="status">Memory visualization is unavailable for this observation.</p>
    <p>Refresh after selecting a project with readable WISDOHM SQLite memory. An unavailable database is different from an empty table.</p>
  </section>;

  const labels = { sessions: 'Sessions', memory: 'Memory facts', events: 'History events', claims: 'Ownership claims' };
  return <section className="wisdohm-memory" data-testid="wisdohm-memory" aria-label="WISDOHM memory layer"
    data-project-id={snapshot.projectId} data-snapshot-id={graph.snapshotId}>
    <dl className="wisdohm-memory-counts" aria-label="Displayed and total SQLite records">
      {graph.tables.map(table => <div key={table.table} data-memory-table={table.table}>
        <dt>{labels[table.table]}</dt><dd><strong>{table.shown}</strong> shown / {table.total} total</dd>
      </div>)}
    </dl>
    <p className="wisdohm-memory-caption">Observed {snapshot.observedAt}. Expand a table or record to inspect its metadata.
      {' '}Arrows link actual <code>task_id</code> references to session <code>id</code> values.</p>
    {graph.truncated && <p className="wisdohm-memory-notice" role="status">This graph shows a bounded sample. Totals describe the observed database; some record details are outside the sample.</p>}
    <div className="wisdohm-memory-canvas">
      <PortableHood key={snapshot.projectId} client={client} initialProjectId={snapshot.projectId} initialDepth={2}
        title="WISDOHM memory" theme="inherit" presentation="embedded" onClose={onClose}
        toolbarActions={<small>Read-only memory snapshot. Use Refresh above to read the database again.</small>} />
    </div>
  </section>;
}
