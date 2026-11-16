import { useEffect, useRef, useState } from 'react';
import type { ApplicationClient } from '@devlab/ui-contracts';
import type { PreimpCommand, PreimpSnapshot, ProjectText } from '@devlab/contracts';

export function PrototypePanel({ client, projectId, open }: { client: ApplicationClient; projectId: string; open: boolean }) {
  const visited = useRef(new Set<string>());
  if (open) visited.current.add(projectId);
  return <div className="preview-preimp" hidden={!open}>
    {[...visited.current].map(id => <ProjectPrototype key={id} client={client} projectId={id} active={open && id === projectId} />)}
  </div>;
}

function ProjectPrototype({ client, projectId, active }: { client: ApplicationClient; projectId: string; active: boolean }) {
  const [snapshot, setSnapshot] = useState<PreimpSnapshot>();
  const [file, setFile] = useState<ProjectText>();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [creating, setCreating] = useState(false), [owner, setOwner] = useState('');
  const [evidence, setEvidence] = useState(''), [reviewed, setReviewed] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const api = client.projects;
  const selected = snapshot?.selected, dirty = Boolean(file && file.text !== text);
  const folder = selected ? `_preimp/${selected.task.id}` : '';
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  async function run(operation: () => Promise<void>) {
    setBusy(true); setError('');
    try { await operation(); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (alive.current) setBusy(false); }
  }
  async function request(command: PreimpCommand) {
    if (!api?.preimp) throw new Error('Preimplementation needs the updated project service. Save drafts before deliberately restarting its backend.');
    const next = await api.preimp(projectId, command);
    if (!alive.current) return;
    setSnapshot(next); setReviewed(false);
    if (command.action === 'create' || command.action === 'inspect') {
      setFile(next.selected?.plan); setText(next.selected?.plan.text ?? ''); setEvidence('');
    }
  }
  useEffect(() => {
    if (active && !snapshot && !busy && !error) void run(() => request({ action: 'list' }));
  }, [active, snapshot, busy, error]);
  async function chooseFile(path: string) {
    if (!api) return;
    await run(async () => { const value = await api.read(projectId, path); if (alive.current) { setFile(value); setText(value.text); } });
  }
  return <section className="preview-preimp-project" hidden={!active} aria-label={`Feature prototypes · ${projectId}`}>
    <div className="preview-drawer-content">
      <label>Task <select aria-label="Staged task" value={selected?.task.id ?? ''} disabled={busy || dirty}
        onChange={e => { if (e.target.value) void run(() => request({ action: 'inspect', id: e.target.value })); }}>
        <option value="">Select a task</option>
        {snapshot?.tasks.map(t => <option value={t.id} key={t.id}>{t.title} · {t.status}</option>)}
      </select></label>
      <button disabled={busy || dirty} onClick={() => setCreating(!creating)} aria-expanded={creating}>New task</button>
      <button disabled={busy || dirty} onClick={() => void run(() => request(selected ? { action: 'inspect', id: selected.task.id } : { action: 'list' }))}>Refresh</button>
      {selected && <small>{selected.status} · {selected.task.ownerId}</small>}
    </div>
    {error && <p className="project-preview-error" role="alert">{error}</p>}
    {creating && <form className="preview-preimp-create" onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      void run(async () => {
        await request({ action: 'create', id: String(data.get('id')), title: String(data.get('title')), ownerId: owner,
          paths: String(data.get('paths')).split('\n').map(p => p.trim()).filter(Boolean) });
        if (alive.current) setCreating(false);
      });
    }}>
      <label>Task ID<input name="id" required pattern="[a-z][a-z0-9-]{0,63}" placeholder="compact-node-catalog" disabled={busy} /></label>
      <label>Title<input name="title" required maxLength={120} disabled={busy} /></label>
      <label>Owner<select aria-label="Task owner" required value={owner} onChange={e => setOwner(e.target.value)} disabled={busy}>
        <option value="">Choose canonical owner</option>{snapshot?.owners.map(o => <option value={o.id} key={o.id}>{o.id}</option>)}
      </select></label>
      {owner && <small>{snapshot?.owners.find(o => o.id === owner)?.purpose}</small>}
      <label>Destination files, one per line<textarea name="paths" required rows={3} disabled={busy} placeholder={snapshot?.owners.find(o => o.id === owner)?.paths.slice(0, 2).join('\n')} /></label>
      <button disabled={busy || dirty || !owner}>Create staged task</button>
    </form>}
    {!selected && !creating && <p className="project-preview-capability">Create a task to plan and prototype a feature before changing live source.</p>}
    {selected && <>
      <details className="preview-preimp-editor">
        <summary>Plan & staged source{dirty ? ' · unsaved' : ''}</summary>
        <div className="preview-drawer-content">
          <label>File<select aria-label="Staged file" value={file?.path ?? ''} disabled={busy || dirty}
            onChange={e => void chooseFile(e.target.value)}>
            {['PLAN.md', 'prototype.html', ...selected.task.files.map(f => 'files/' + f.path)].map(path => <option key={path} value={folder + '/' + path}>{path}</option>)}
          </select></label>
          <button disabled={busy || !dirty || selected.status !== 'staged'} onClick={() => void run(async () => {
            if (!file || !api) return;
            const value = await api.write({ projectId, path: file.path, text, expectedHash: file.sha256 });
            if (!alive.current) return;
            setFile(value); setText(value.text);
            await request({ action: 'inspect', id: selected.task.id });
            // Keep the chosen file after refreshing the preview and invalidating any old review.
            if (alive.current) { setFile(value); setText(value.text); }
          })}>Save</button>
          <button disabled={busy || !dirty} onClick={() => setText(file?.text ?? '')}>Discard edit</button>
        </div>
        <textarea aria-label="Staged source text" rows={10} spellCheck={false} value={text} readOnly={busy || selected.status !== 'staged'}
          onChange={e => { setText(e.target.value); setReviewed(false); }} />
      </details>
      <div className="preview-drawer-content">
        <small>Prototype · simulated data · sandboxed</small>
        <button disabled={busy || dirty || selected.status === 'merged'} onClick={() => void run(() => request({ action: 'review', id: selected.task.id }))}>Review merge</button>
      </div>
      {selected.review && <details className="preview-preimp-review" open>
        <summary>Review changes · {selected.review.files.filter(f => f.changed).length} files</summary>
        {selected.review.conflicts.map(c => <p key={c} role="alert">{c}</p>)}
        {selected.review.files.map(f => <details key={f.path}><summary>{f.path}{f.changed ? '' : ' · unchanged'}</summary>
          <div className="preview-preimp-diff"><div><strong>Current source</strong><pre>{f.before ?? '(new file)'}</pre></div><div><strong>Staged source</strong><pre>{f.after}</pre></div></div>
        </details>)}
        <label>Checks and limitations<textarea aria-label="Merge evidence" value={evidence} maxLength={4000} onChange={e => setEvidence(e.target.value)} placeholder="Record checks actually run and any remaining limitations." /></label>
        <label><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} /> I reviewed these changes and saved affected editor drafts.</label>
        <button disabled={busy || dirty || !reviewed || !evidence.trim() || selected.review.conflicts.length > 0} onClick={() => void run(() => request({ action: 'promote', id: selected.task.id, revision: selected.review!.revision, evidence }))}>
          {selected.status === 'merging' ? 'Resume reviewed merge' : 'Merge reviewed files'}
        </button>
        <small>Source files only. Plugin activation and checks remain explicit. Recovery copies stay in the task folder.</small>
      </details>}
      <iframe className="preview-preimp-frame" title={`Feature prototype · ${selected.task.title}`} sandbox="allow-scripts" referrerPolicy="no-referrer"
        src={new URL(`/api/projects/${encodeURIComponent(projectId)}/preimp/${encodeURIComponent(selected.task.id)}/prototype?revision=${selected.prototype.sha256}`, client.backendOrigin || location.origin).href} />
    </>}
  </section>;
}
