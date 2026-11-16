import { RuntimePanel } from './runtime.tsx';
import type { RuntimeClient } from '@devlab/contracts';
import { useEffect, useRef, useState } from 'react';
import type { RegistryClient, RegistrySnapshot } from '@creoaurea/pop-the-hood/contracts';

/** Runtime services and UI contributions are separate registration authorities. */
export function PluginPanel({ api, projectId, contributions, onDevelop, runtime, searchProjectId = 'default' }: {
  api?: RegistryClient; projectId?: string; runtime?: RuntimeClient; searchProjectId?: string;
  contributions: { id: string; title: string; slot: string }[];
  onDevelop?: (pluginId: string) => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<RegistrySnapshot>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState('');
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState('');
  const request = useRef(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    if (!api) { setError('Plugin registry is unavailable.'); setLoading(false); return; }
    void api.snapshot(projectId).then(value => { if (active) setSnapshot(value); }, cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load plugins.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, projectId, attempt]);
  const backend = snapshot?.plugins ?? [];
  const selectedKey = selection || (contributions[0] ? `ui:${contributions[0].id}` : backend[0] ? `backend:${backend[0].id}` : '');
  const ui = contributions.find(item => `ui:${item.id}` === selectedKey);
  const plugin = backend.find(item => `backend:${item.id}` === selectedKey);
  const id = ui?.id ?? plugin?.id;
  const choose = (key: string) => { setSelection(key); setActionError(''); };
  const develop = async () => {
    if (!id || !onDevelop || request.current) return;
    request.current = true; setPending(true); setActionError('');
    try { await onDevelop(id); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Could not create the development thread.'); }
    finally { request.current = false; setPending(false); }
  };
  return <div className="hood-plugin-layout">
    <aside className="hood-plugin-list" aria-label="Registered plugins">
      <h2>UI plugins</h2>
      {contributions.map(item => <button type="button" key={item.id} aria-pressed={selectedKey === `ui:${item.id}`}
        onClick={() => choose(`ui:${item.id}`)}><strong>{item.title}</strong><small>{item.id} · {item.slot}</small></button>)}
      {!contributions.length && <p>No UI contributions registered.</p>}
      <h2>Backend plugins</h2>
      {backend.map(item => <button type="button" key={item.id} aria-pressed={selectedKey === `backend:${item.id}`}
        onClick={() => choose(`backend:${item.id}`)}><strong>{item.id}</strong><small>{item.state} · v{item.version}</small></button>)}
      {loading && <p role="status">Loading runtime plugins…</p>}
      {error && <div role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Retry plugins</button></div>}
      {!loading && !error && !backend.length && <p>No backend registrations in this snapshot.</p>}
    </aside>
    <main className="hood-plugin-detail" aria-label="Selected plugin">
      <RuntimePanel api={runtime} projectId={searchProjectId} />
      {id ? <>
        <header><div><small>{ui ? 'UI contribution' : 'Runtime registration'}</small><h2>{ui?.title ?? id}</h2><code>{id}</code></div>
          <button type="button" disabled={!onDevelop || pending} onClick={() => void develop()}
            title={!onDevelop ? 'Development threads are unavailable in this host.' : 'Create an isolated DevLab development thread'}>
            {pending ? 'Creating thread…' : 'Edit / Develop'}</button></header>
        {!onDevelop && <p>Development threads are unavailable in this host.</p>}
        {actionError && <p role="alert">{actionError}</p>}
        <section><h3>Plugin core</h3>
          {ui ? <><p>Registered UI slot: <strong>{ui.slot}</strong></p><p>This browser contribution does not declare runtime service dependencies.</p></>
            : plugin && <><p>State: <strong>{plugin.state}</strong> · Version: {plugin.version} · Reload: {plugin.reload}</p>
              <h4>Provides</h4><p>{plugin.provides.join(', ') || 'No services declared.'}</p>
              <h4>Capabilities</h4><p>{plugin.capabilities.join(', ') || 'No capabilities declared.'}</p></>}
        </section>
        {plugin && <section><h3>Dependencies</h3>
          {Array.from(new Set([...plugin.requires, ...plugin.live])).map(service => {
            const providers = backend.filter(candidate => candidate.provides.includes(service));
            return <div className="hood-plugin-dependency" key={service}><div><strong>{service}</strong><small>{plugin.requires.includes(service) ? 'Required service' : 'Live service'}</small></div>
              <div>{providers.length ? providers.map(provider => <button type="button" key={provider.id} onClick={() => choose(`backend:${provider.id}`)}>{provider.id} · {provider.state}</button>) : <span>No registered provider</span>}</div></div>;
          })}
          {!plugin.requires.length && !plugin.live.length && <p>No required or live services declared.</p>}
        </section>}
        <p className="hood-plugin-note">WISDOHM harness and Memory expose governance protocols, agent profiles and records as inspection data in their own layers.</p>
      </> : <p>Select a registered plugin to inspect its core and dependencies.</p>}
    </main>
  </div>;
}
