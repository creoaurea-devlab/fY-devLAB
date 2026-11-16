import { useEffect, useRef, useState } from 'react';
import type { HerdrCommand, HerdrSnapshot } from '@devlab/contracts';
import type { ApplicationClient, UIPluginProps } from '@devlab/ui-contracts';

type Props = { client: ApplicationClient; projectId: string; active: boolean; renderTerminal: UIPluginProps['renderTerminal'] };
export function HerdrWorkspace(props: Props) {
  const [visited, setVisited] = useState<string[]>([props.projectId]);
  useEffect(() => { if (props.active) setVisited(ids => ids.includes(props.projectId) ? ids : [...ids, props.projectId]); }, [props.active, props.projectId]);
  return <div className="herdr-workspace">{visited.map(projectId => <HerdrProject key={projectId} {...props} projectId={projectId} active={props.active && props.projectId === projectId} />)}</div>;
}

function HerdrProject({ client, projectId, active, renderTerminal }: Props) {
  const [state, setState] = useState<HerdrSnapshot | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(''), [label, setLabel] = useState(''), [text, setText] = useState('');
  const live = useRef(true), revision = useRef(0), working = useRef(false);
  const api = client.herdr;
  useEffect(() => { live.current = true; return () => { live.current = false; ++revision.current; }; }, []);
  useEffect(() => {
    if (!active || !api) return;
    let closed = false, timer: ReturnType<typeof setTimeout>, fetching = false, pending = false;
    const refresh = async () => {
      if (closed) return;
      if (fetching) { pending = true; return; } fetching = true;
      const generation = revision.current;
      try {
        if (!working.current) {
          const next = await api.snapshot(projectId);
          if (!closed && generation === revision.current) { setState(next); setError(''); }
        }
      } catch (e) { if (!closed && generation === revision.current) setError((e as Error).message); }
      finally { fetching = false; if (!closed && (pending || !api.subscribe)) { const soon = pending; pending = false; timer = setTimeout(() => void refresh(), soon ? 50 : 2000); } }
    };
    const unsubscribe = api.subscribe?.(projectId, () => void refresh());
    void refresh(); return () => { closed = true; clearTimeout(timer); unsubscribe?.(); };
  }, [active, api, projectId]);
  async function act(command: HerdrCommand) {
    if (!api || working.current) return;
    working.current = true; ++revision.current; setBusy(true); setError('');
    try { const next = await api.command(projectId, command); if (live.current) setState(next); }
    catch (e) { if (live.current) setError((e as Error).message); }
    finally { working.current = false; if (live.current) setBusy(false); }
  }
  const running = state?.state === 'running' && !error;
  const canStop = state?.state === 'running' || state?.state === 'error';
  const pane = state?.panes.find(p => p.id === selected) ?? state?.panes.find(p => p.focused) ?? state?.panes[0];
  const attachment = state?.attachment;
  return <section className="herdr-project" aria-label="Herdr workspace" hidden={!active} data-herdr-state={state?.state ?? 'loading'}>
    <div className="herdr-toolbar">
      <strong>Herdr</strong><span role="status">{busy ? 'Working…' : error ? 'State unavailable' : state?.state ?? 'Checking…'}</span>
      <select aria-label="Herdr workspace" disabled={!running || busy} value={state?.workspaces.find(w => w.focused)?.id ?? ''} onChange={e => void act({ type: 'select', workspaceId: e.target.value })}>
        {!state?.workspaces.length && <option value="">No workspace</option>}
        {state?.workspaces.map(w => <option key={w.id} value={w.id}>{w.label}</option>)}
      </select>
      {!running && <button disabled={busy || state?.state !== 'stopped'} onClick={() => void act({ type: 'start' })}>Start runtime</button>}
      {(running || attachment) && <button disabled={busy} onClick={() => void act({ type: attachment ? 'detach' : 'attach' })}>{attachment ? 'Detach' : 'Attach TUI'}</button>}
      <details className="herdr-actions" onKeyDown={event => { if (event.key === 'Escape' && event.currentTarget.open) { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}><summary>Actions &amp; policy</summary><div className="herdr-options">
        <p>Project access: <code>/workspace</code> · Network: offline. Policy: <code>{state?.policy.revision ?? 'checking'}</code>.</p>
        <p>Detach leaves pane processes running. Stop runtime ends all work in this project’s Herdr environment.</p>
        <div className="herdr-fields"><input aria-label="Herdr name" placeholder="Workspace or pane name" maxLength={80} value={label} onChange={e => setLabel(e.target.value)} />
          <button disabled={!running || busy || !label.trim()} onClick={() => void act({ type: 'create', label })}>New workspace</button>
          <button disabled={!canStop || busy} onClick={() => { if (window.confirm('Stop this project’s Herdr runtime and all its pane processes?')) void act({ type: 'stop' }); }}>Stop runtime</button></div>
        <div className="herdr-fields"><select aria-label="Herdr pane" value={pane?.id ?? ''} onChange={e => setSelected(e.target.value)} disabled={!running || busy}>
          {!state?.panes.length && <option value="">No pane</option>}{state?.panes.map(p => <option key={p.id} value={p.id}>{p.workspaceId} / {p.label}</option>)}
        </select>
          <button disabled={!pane || busy || !running} onClick={() => pane && void act({ type: 'focus', paneId: pane.id })}>Focus</button>
          <button disabled={!pane || busy || !running} onClick={() => pane && void act({ type: 'zoom', paneId: pane.id, mode: pane.zoomed ? 'off' : 'on' })}>{pane?.zoomed ? 'Unzoom' : 'Zoom pane'}</button>
          <button disabled={!pane || busy || !running || !label.trim()} onClick={() => pane && void act({ type: 'rename', paneId: pane.id, label })}>Rename</button>
          <button disabled={!pane || busy || !running} onClick={() => { if (pane && window.confirm('Close this Herdr pane and its running process?')) void act({ type: 'close', paneId: pane.id }); }}>Close pane</button></div>
        {pane && <p>Tab: {pane.tabId} · Agent: {pane.agent ?? 'none'} · Status: {error ? 'unavailable' : pane.agentStatus}</p>}
        <div className="herdr-fields">{(['right', 'down'] as const).map(direction => <button key={direction} disabled={!pane || busy || !running} onClick={() => pane && void act({ type: 'split', paneId: pane.id, direction })}>Split {direction}</button>)}
          {(['left', 'right', 'up', 'down'] as const).map(direction => <button key={direction} disabled={!pane || busy || !running} onClick={() => pane && void act({ type: 'resize', paneId: pane.id, direction, amount: 0.1 })}>Resize {direction}</button>)}</div>
        <div className="herdr-fields"><textarea aria-label="Herdr pane input" placeholder="Send exact text to selected pane" maxLength={16384} value={text} onChange={e => setText(e.target.value)} /><button disabled={!pane || !running || busy || !text} onClick={() => pane && void act({ type: 'input', paneId: pane.id, text })}>Send text</button>
          <button disabled={!pane || !running || busy} onClick={() => pane && void act({ type: 'key', paneId: pane.id, key: 'enter' })}>Press Enter</button>
          <button disabled={!pane || !running || busy} onClick={() => pane && void act({ type: 'key', paneId: pane.id, key: 'ctrl+c' })}>Interrupt</button></div>
      </div></details>
    </div>
    {error && <p className="herdr-notice" role="alert">{error}</p>}
    {!attachment && <div className="herdr-empty"><h3>{state?.state === 'unavailable' ? 'Containment is unavailable' : running ? 'Your Herdr runtime is running' : 'Your project’s own Herdr runtime'}</h3><p>{state?.message ?? 'Checking the private runtime…'}</p><p>{running ? 'Attach the TUI to work with its panes. Sessions continue while this view is hidden.' : 'Herdr starts only when the host can enforce the project boundary. Other desktop sessions are outside this runtime.'}</p></div>}
    {attachment && <div className="herdr-tui">{renderTerminal?.({ projectId, nodeId: attachment.nodeId, sessionId: attachment.id, cwd: '/workspace', shell: 'bash', autoStart: false, inputOwner: active, resizeOwner: active, instanceId: 'herdr:' + projectId })}</div>}
  </section>;
}
