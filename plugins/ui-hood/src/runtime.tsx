import { useEffect, useRef, useState } from 'react';
import type { RuntimeClient, RuntimeInventory, WorkspaceSearchResult } from '@devlab/contracts';

/** Host settings and project search are explicit; this view owns no process or workspace. */
export function RuntimePanel({ api, projectId }: { api?: RuntimeClient; projectId: string }) {
  const [inventory, setInventory] = useState<RuntimeInventory>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<WorkspaceSearchResult>();
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const search = useRef<AbortController | undefined>(undefined);
  const generation = useRef(0), saving = useRef(false);
  const refresh = async () => {
    const current = generation.current;
    if (api) { const value = await api.inspect(); if (generation.current === current) setInventory(value); }
  };
  useEffect(() => {
    const current = ++generation.current;
    search.current?.abort(); setResult(undefined); setSearchError(''); setSearching(false); setBusy(false); setError(''); setInventory(undefined);
    if (api) void api.inspect().then(value => { if (generation.current === current) setInventory(value); },
      cause => { if (generation.current === current) setError(String(cause.message ?? cause)); });
    return () => { generation.current++; search.current?.abort(); };
  }, [api, projectId]);
  const save = async (changes?: Record<string, boolean>) => {
    if (!api || !inventory || saving.current) return;
    const current = generation.current;
    saving.current = true; setBusy(true); setError('');
    try {
      const value = changes ? await api.configure({ expectedRevision: inventory.revision, changes })
        : await api.rewind({ expectedRevision: inventory.revision });
      if (generation.current === current) setInventory(value);
    } catch (cause) { if (generation.current === current) setError(cause instanceof Error ? cause.message : 'Could not save runtime selection'); }
    finally { saving.current = false; if (generation.current === current) setBusy(false); }
  };
  const runSearch = async () => {
    if (!api || !query.trim()) return;
    search.current?.abort(); const controller = new AbortController(); search.current = controller;
    const current = generation.current;
    setSearching(true); setSearchError(''); setResult(undefined);
    try {
      const value = await api.search({ projectId, query: query.trim(), maxResults: 30 }, controller.signal);
      if (generation.current === current && search.current === controller) setResult(value);
    } catch (cause) {
      if (generation.current === current && search.current === controller)
        setSearchError(controller.signal.aborted ? 'Search cancelled.' : cause instanceof Error ? cause.message : 'Search failed');
    } finally {
      if (generation.current === current && search.current === controller) {
        setSearching(false); void refresh().catch(cause => { if (generation.current === current) setError(String(cause.message ?? cause)); });
      }
    }
  };
  if (!api) return <p>Runtime controls are unavailable in this host.</p>;
  return <div className="hood-runtime">
    <details open><summary>Host plugin selection</summary>
      <p>Saved switches apply after a deliberate backend restart. Current terminals and previews keep running.</p>
      {error && <p role="alert">{error}</p>}
      {!inventory && !error && <p role="status">Loading runtime inventory…</p>}
      <div className="runtime-actions"><button type="button" disabled={busy} onClick={() => void refresh().catch(cause => setError(String(cause.message ?? cause)))}>Refresh runtime</button>
        <button type="button" disabled={busy || !inventory?.canRewind || projectId !== 'default'} onClick={() => void save()}>Rewind selection</button>
        {inventory?.restartRequired && <strong role="status">Restart required</strong>}</div>
      {projectId !== 'default' && <p>Host selection is editable from the base DevLab project.</p>}
      {inventory?.plugins.map(plugin => <div className="runtime-plugin" key={plugin.id}>
        <label><input type="checkbox" checked={plugin.enabled} aria-label={`Enable ${plugin.id}`}
          disabled={busy || plugin.protected || projectId !== 'default'} onChange={event => void save({ [plugin.id]: event.target.checked })} />
          <strong>{plugin.id}</strong></label>
        <span>{plugin.state} · {plugin.running ? 'running' : 'not running'} · {plugin.enabled ? 'selected' : 'off next start'}</span>
        <small>Requires: {[...plugin.requires, ...plugin.live].join(', ') || 'none'}{plugin.protected ? ' · required for management' : ''}</small>
      </div>)}
    </details>
    <details open><summary>Read-only workspace search</summary>
      <form onSubmit={event => { event.preventDefault(); void runSearch(); }}>
        <label>Search project source<input value={query} maxLength={120} onChange={event => setQuery(event.target.value)} /></label>
        <button type="submit" disabled={searching || !query.trim()}>Search source</button>
        {searching && <button type="button" onClick={() => search.current?.abort()}>Cancel search</button>}
      </form>
      {searching && <p role="status">Searching admitted project files…</p>}
      {searchError && <p role="alert">{searchError}</p>}
      {result && <div aria-live="polite"><p>{result.matches.length} matches · {result.scanned} files · {result.skipped} skipped{result.truncated ? ' · results limited' : ''}</p>
        {result.matches.map((match, index) => <div key={index}><strong>{match.path}:{match.line}</strong><pre>{match.text}</pre></div>)}
      </div>}
    </details>
    <details><summary>Local diagnostics</summary><p>Latest 100 search outcomes; queries and source text are excluded.</p>
      {inventory?.diagnostics.map((event, index) => <p key={index}>{event.at} · {event.operation} · {event.outcome} · {Math.round(event.durationMs)}ms · {event.matches} matches</p>)}
      {!inventory?.diagnostics.length && <p>No local search diagnostics yet.</p>}
    </details>
  </div>;
}
