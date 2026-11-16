import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Copy, ListChecks, RefreshCw, X } from 'lucide-react';
import type { RulesCheck, RulesSource } from '@devlab/contracts';
import type { UIPluginProps, RulesViewTab } from '@devlab/ui-contracts';

import { HarnessView } from './harness.tsx';
import { useRulesSnapshot } from './use-snapshot.ts';

const MemoryLayer = lazy(() => import('./memory.tsx').then(module => ({ default: module.MemoryLayer })));

const PAGE_SIZE = 50;
const sourceStates = ['current', 'stale', 'missing', 'invalid', 'unverified'] as const;
const freshnessStates = ['current', 'stale', 'unverified', 'historical'] as const;
const resultStates = ['passed', 'failed', 'unknown'] as const;

function Badge({ label, state }: { label: string; state: string }) {
  return <span className="rules-badge" data-state={state}>{label}</span>;
}

function SourceDetails({ source }: { source: RulesSource }) {
  return <div className="rules-source-details">
    <dl>
      <dt>Source</dt><dd><code>{source.path}</code></dd>
      <dt>Validity</dt><dd>{source.status}</dd>
      <dt>Review guidance</dt><dd>{source.review === 'required' ? 'Human review is required. This board does not record review completion.' : 'Reference material. Review its relevance to the current task.'}</dd>
      <dt>Observed SHA-256</dt><dd><code>{source.sha256 ?? 'No digest available'}</code></dd>
      <dt>Reviewed SHA-256</dt><dd><code>{source.expectedSha256 ?? 'No reviewed pin configured'}</code></dd>
    </dl>
    {source.truncated && <p className="rules-notice">Source text is truncated. Read the complete file before reviewing it.</p>}
    {source.text ? <details><summary>Source text</summary><pre>{source.text}</pre></details> : <p>No source text is available.</p>}
  </div>;
}

function CheckDetails({ check }: { check: RulesCheck }) {
  return <div className="rules-check-details">
    <p>{check.reason}</p>
    <dl>
      <dt>Session</dt><dd><code>{check.sessionId}</code></dd>
      <dt>Recorded</dt><dd>{check.recordedAt ?? 'No recording time available'}</dd>
      <dt>Exit code</dt><dd>{check.exitCode ?? 'Not recorded'}</dd>
    </dl>
    {check.evidence.length ? <ul className="rules-evidence" aria-label="Check evidence">
      {check.evidence.map((item, index) => <li key={`${item.path}:${index}`}>
        <code>{item.path}</code> <Badge label={item.status} state={item.status} />
        <div>Recorded digest: <code>{item.expectedSha256 ?? 'Not recorded'}</code></div>
        <div>Observed digest: <code>{item.actualSha256 ?? 'Not available'}</code></div>
      </li>)}
    </ul> : <p>No source-bound evidence is available for this receipt.</p>}
  </div>;
}

/** Presentation only: the service owns source validity and receipt freshness. */
export function RulesView({ client, rulesOptions }: UIPluginProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const scopeId = useId();
  const tabsId = useId();
  const projectId = rulesOptions?.projectId ?? 'default';
  const embedded = rulesOptions?.presentation === 'embedded';
  const onClose = rulesOptions && rulesOptions.presentation !== 'controls' ? rulesOptions.onClose : undefined;
  const requestedTab = rulesOptions?.presentation === 'controls' ? 'rules' : rulesOptions?.initialTab ?? 'rules';
  const api = client.rules;
  const { snapshot: current, loading, error, refresh } = useRulesSnapshot(api, projectId);
  const [copied, setCopied] = useState('');
  const [tab, setTab] = useState<RulesViewTab>(requestedTab);
  const [memoryVisited, setMemoryVisited] = useState(requestedTab === 'memory');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [sourceState, setSourceState] = useState('all');
  const [review, setReview] = useState('all');
  const [result, setResult] = useState('all');
  const [freshness, setFreshness] = useState('all');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const scope = useRef({ projectId, requestedTab });

  useEffect(() => {
    if (scope.current.projectId !== projectId) {
      setQuery(''); setCategory('all'); setSourceState('all'); setReview('all');
      setResult('all'); setFreshness('all'); setCopied(''); setTab(requestedTab);
      setMemoryVisited(requestedTab === 'memory');
    } else if (scope.current.requestedTab !== requestedTab) {
      setTab(requestedTab);
    }
    scope.current = { projectId, requestedTab };
  }, [projectId, requestedTab]);
  useEffect(() => { if (tab === 'memory') setMemoryVisited(true); }, [tab]);
  useEffect(() => { setLimit(PAGE_SIZE); }, [query, category, sourceState, review, result, freshness, tab]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    // Effect replay during compatible refresh preserves the connected dialog/focus.
    return () => { queueMicrotask(() => { if (!element.isConnected && element.open) element.close(); }); };
  }, [embedded]);

  const needle = query.trim().toLocaleLowerCase();
  const rows = useMemo(() => (current?.sources ?? []).flatMap(source => {
    if (category !== 'all' && source.category !== category || sourceState !== 'all' && source.status !== sourceState || review !== 'all' && source.review !== review) return [];
    const entries = source.numberedRules.length
      ? source.numberedRules.map(rule => ({ source, id: `${source.id}:${rule.number}:${rule.line}`, title: `Rule ${rule.number}`, text: rule.text, line: rule.line }))
      : [{ source, id: source.id, title: source.label, text: source.text || 'Source unavailable', line: 1 }];
    return entries.filter(row => !needle || `${source.label} ${source.path} ${source.category} ${row.title} ${row.text}`.toLocaleLowerCase().includes(needle));
  }), [current, category, sourceState, review, needle]);
  const checks = useMemo(() => (current?.checks ?? []).filter(check =>
    (result === 'all' || check.result === result) && (freshness === 'all' || check.freshness === freshness) &&
    (!needle || `${check.id} ${check.sessionId} ${check.command} ${check.reason} ${check.evidence.map(item => item.path).join(' ')}`.toLocaleLowerCase().includes(needle))),
  [current, result, freshness, needle]);
  const categories = [...new Set(current?.sources.map(source => source.category) ?? [])];
  const listTab = tab === 'rules' || tab === 'checks';
  const visibleCount = tab === 'rules' ? rows.length : checks.length;
  const tabs: { id: RulesViewTab; label: string }[] = [
    { id: 'rules', label: 'Rules and guidance' }, { id: 'checks', label: 'Automatic checks' },
    { id: 'harness', label: 'Harness' }, { id: 'memory', label: 'Memory layer' },
  ];
  const copy = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied('Command copied. It has not been executed.');
    } catch {
      setCopied('Clipboard unavailable. Select and copy the displayed command text.');
    }
  };
  const handleKey = (event: KeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') event.preventDefault();
  };
  const body = <>
    <header className="rules-toolbar">
      <ListChecks size={14} aria-hidden="true" /><h1 id={titleId}>{embedded ? 'WISDOHM' : 'Rules Board'}</h1>
      <span className="rules-toolbar-spacer" />
      <button type="button" aria-label="Refresh rules snapshot" title="Read sources and recorded evidence again; does not run checks" disabled={loading || !api}
        data-devlab-id="rules.refresh" data-devlab-source="plugins/ui-rules/src/view.tsx" onClick={() => void refresh()}><RefreshCw size={13} aria-hidden="true" /></button>
      {!embedded && <button type="button" aria-label="Close Rules Board" title="Close Rules Board" data-devlab-id="rules.close" data-devlab-source="plugins/ui-rules/src/view.tsx" onClick={onClose}><X size={13} aria-hidden="true" /></button>}
    </header>
    <div className="rules-scroll">
      <p id={scopeId} className="rules-scope">Project <code>{projectId}</code> · Read-only inspection. Source validity, recorded checks and human review are separate evidence.</p>
      {loading && <p role="status">{current ? 'Refreshing snapshot…' : 'Loading rules snapshot…'}</p>}
      {error && <p role="alert" className="rules-error">{error}{current && ' The last successful snapshot is shown below; refresh failed and it may be out of date.'}</p>}
      {current && <>
        <section className="rules-overview" aria-label="Rules authority and memory">
          <div><strong>Authority</strong><Badge label={current.authority.status} state={current.authority.status} /><span>{current.edition}{current.authority.version ? ` · ${current.authority.version}` : ''}</span><code>{current.authority.entryPath || 'No authority entry'}</code></div>
          <div><strong>Operational memory</strong><Badge label={current.memory.status} state={current.memory.status} /><span>{current.memory.records} records · {current.memory.sessions} sessions</span><span>{current.memory.reason}</span>{current.authority.memoryPath && <code>{current.authority.memoryPath}</code>}</div>
          <div><strong>Observed</strong><span>{current.observedAt}</span><span>{current.sources.length} sources · {current.checks.length} check receipts</span><span>Passing receipts do not establish universal rule or SOLID compliance.</span></div>
        </section>
        {!!current.warnings.length && <details className="rules-warnings"><summary>Snapshot warnings ({current.warnings.length})</summary><ul>{current.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
        <div className="rules-view-tabs" role="tablist" aria-label="Rules evidence views" onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const active = tabs.findIndex(item => item.id === tab);
          const next = event.key === 'Home' ? tabs[0]!.id : event.key === 'End' ? tabs.at(-1)!.id : tabs[(active + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]!.id;
          setTab(next);
          event.currentTarget.querySelector<HTMLButtonElement>(`[data-rules-tab="${next}"]`)?.focus();
        }}>
          {tabs.map(item => <button key={item.id} type="button" role="tab" id={`${tabsId}-${item.id}-tab`} aria-selected={tab === item.id}
            aria-controls={`${tabsId}-${item.id}`} tabIndex={tab === item.id ? 0 : -1} data-rules-tab={item.id} onClick={() => setTab(item.id)}>{item.label}</button>)}
        </div>
        {listTab && <>
          <div className="rules-filters">
            <label className="rules-search">Search <input type="search" aria-label="Search rules and evidence" value={query} onChange={event => setQuery(event.target.value)} data-devlab-id="rules.search" data-devlab-source="plugins/ui-rules/src/view.tsx" /></label>
            {tab === 'rules' ? <>
              <label>Category <select aria-label="Rule category" value={category} onChange={event => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map(item => <option key={item}>{item}</option>)}</select></label>
              <label>Source validity <select aria-label="Source validity" value={sourceState} onChange={event => setSourceState(event.target.value)}><option value="all">All source states</option>{sourceStates.map(item => <option key={item}>{item}</option>)}</select></label>
              <label>Review guidance <select aria-label="Review guidance" value={review} onChange={event => setReview(event.target.value)}><option value="all">All guidance</option><option value="required">Human review required</option><option value="reference">Reference only</option></select></label>
            </> : <>
              <label>Result <select aria-label="Check result" value={result} onChange={event => setResult(event.target.value)}><option value="all">All results</option>{resultStates.map(item => <option key={item}>{item}</option>)}</select></label>
              <label>Freshness <select aria-label="Check freshness" value={freshness} onChange={event => setFreshness(event.target.value)}><option value="all">All freshness states</option>{freshnessStates.map(item => <option key={item}>{item}</option>)}</select></label>
            </>}
          </div>
          <p className="rules-count" role="status">{visibleCount} matching {tab === 'rules' ? 'rules or guidance entries' : 'check receipts'}{visibleCount > limit ? ` · showing ${limit}` : ''}</p>
        </>}
        <section id={`${tabsId}-rules`} role="tabpanel" aria-labelledby={`${tabsId}-rules-tab`} hidden={tab !== 'rules'}>
          {!current.sources.length ? <p>No rule sources are available for this project.</p> : !rows.length ? <p>No rules match these filters.</p> : <ul className="rules-list" aria-label="Rules and guidance entries">
            {rows.slice(0, limit).map(row => <li key={row.id}><details className="rules-entry" data-source-id={row.source.id}>
              <summary><span className="rules-entry-title">{row.source.label} · {row.title}</span><Badge label={`Source ${row.source.status}`} state={row.source.status} /><Badge label={row.source.review === 'required' ? 'Human review required' : 'Reference'} state="guidance" /><span className="rules-entry-preview">{row.text}</span><code>{row.source.path}:{row.line}</code></summary>
              <div className="rules-entry-body"><p className="rules-full-text">{row.text}</p><SourceDetails source={row.source} /></div>
            </details></li>)}
          </ul>}
        </section>
        <section id={`${tabsId}-checks`} role="tabpanel" aria-labelledby={`${tabsId}-checks-tab`} hidden={tab !== 'checks'}>
          <p className="rules-notice">These receipts record command results and supporting evidence. They do not establish coverage of individual rules. Historical or unverified receipts do not show that checks passed against the current source.</p>
          {!current.checks.length ? <p>No automatic check evidence is recorded.</p> : !checks.length ? <p>No check receipts match these filters.</p> : <ul className="rules-list" aria-label="Automatic check receipts">
            {checks.slice(0, limit).map(check => <li key={check.id}><details className="rules-entry" data-check-id={check.id}>
              <summary><code className="rules-entry-title">{check.command}</code><Badge label={`Result ${check.result}`} state={check.result} /><Badge label={`Freshness ${check.freshness}`} state={check.freshness} /><span className="rules-entry-preview">{check.reason}</span></summary>
              <div className="rules-entry-body"><CheckDetails check={check} /></div>
            </details></li>)}
          </ul>}
        </section>
        <section id={`${tabsId}-harness`} role="tabpanel" aria-labelledby={`${tabsId}-harness-tab`} hidden={tab !== 'harness'}><HarnessView snapshot={current} /></section>
        <section id={`${tabsId}-memory`} className="rules-memory-panel" role="tabpanel" aria-labelledby={`${tabsId}-memory-tab`} hidden={tab !== 'memory'}>
          {memoryVisited && <Suspense fallback={<p role="status">Loading memory layer…</p>}><MemoryLayer snapshot={current} onClose={onClose} /></Suspense>}
        </section>
        {listTab && visibleCount > limit && <button type="button" className="rules-more" onClick={() => setLimit(value => value + PAGE_SIZE)}>Show {Math.min(PAGE_SIZE, visibleCount - limit)} more</button>}
        {listTab && <section className="rules-commands" aria-label="Verification commands">
          <h2>Verification commands</h2><p>Copy a command, then run it from the selected project's directory. RulesBoard does not run commands or edit policy.</p>
          {!current.commands.length && <p>No verification commands are available.</p>}
          {current.commands.map((item, index) => <div key={`${item.label}:${index}`}><strong>{item.label}</strong><pre tabIndex={0}><code>{item.command}</code></pre><button type="button" aria-label={`Copy ${item.label} command`} onClick={() => void copy(item.command)}><Copy size={12} aria-hidden="true" /> Copy</button></div>)}
          <p role="status" className="rules-copy-status">{copied}</p>
        </section>}
      </>}
      {!loading && !current && !error && <p>No rules snapshot is available.</p>}
    </div>
  </>;
  return embedded
    ? <section className="rules-board rules-embedded" aria-labelledby={titleId} aria-describedby={scopeId} data-testid="rules-board" data-project-id={projectId} onKeyDown={handleKey}>{body}</section>
    : <dialog ref={dialog} className="rules-board" aria-labelledby={titleId} aria-describedby={scopeId}
      data-testid="rules-board" data-project-id={projectId} data-devlab-id="rules.board" data-devlab-source="plugins/ui-rules/src/view.tsx"
      onCancel={event => { event.preventDefault(); onClose?.(); }} onKeyDown={handleKey}>{body}</dialog>;
}
