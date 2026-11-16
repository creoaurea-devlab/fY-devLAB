import { useId, useRef, useEffect, useState } from 'react';
import type { RulesSnapshot } from '@devlab/contracts';

export function HarnessView({ snapshot }: { snapshot: RulesSnapshot }) {
  const gates = snapshot.harness?.gates ?? [];
  const [selected, setSelected] = useState('BOOT');
  const scope = useRef(snapshot.projectId);
  const headingId = useId();
  useEffect(() => {
    if (scope.current !== snapshot.projectId) {
      scope.current = snapshot.projectId;
      setSelected('BOOT');
    }
  }, [snapshot.projectId]);
  const selectedId = scope.current === snapshot.projectId ? selected : 'BOOT';
  const index = Math.max(0, gates.findIndex(gate => gate.id === selectedId));
  const gate = gates[index];
  const previous = gates[index - 1], next = gates[index + 1];
  const source = snapshot.sources.find(item => item.path === gate?.sourcePath);
  if (!snapshot.harness || !gate) return <section className="wisdohm-harness" data-testid="wisdohm-harness">
    <h2>WISDOHM harness</h2><p>Harness steps are unavailable from this project's current observation. Refresh after the inspection service is available.</p>
    <p className="rules-notice">The installed sources and recorded evidence remain available in the other views.</p>
  </section>;
  const inputs = snapshot.sources.filter(item => item.path.startsWith('.wisdohm/') || item.path.startsWith('.agents/') || item.path === '.context/modules/registry.yaml');
  return <section className="wisdohm-harness" data-testid="wisdohm-harness" aria-label="WISDOHM harness walkthrough">
    <h2>WISDOHM harness</h2>
    <p className="rules-notice">Explore the installed instructions one step at a time. Selecting a step does not advance an agent task or run commands.</p>
    <ol className="wisdohm-gates" aria-label="Harness steps">
      {gates.map((item, position) => <li key={item.id}><button type="button" aria-current={index === position ? 'step' : undefined}
        aria-label={`Step ${position + 1}: ${item.label}`} onClick={() => setSelected(item.id)}>
        <span>{position + 1}</span><strong>{item.label}</strong>
      </button></li>)}
    </ol>
    <article className="wisdohm-gate-detail" aria-labelledby={headingId}>
      <p className="wisdohm-step-position" role="status">Step {index + 1} of {gates.length} · Instruction walkthrough</p>
      <h3 id={headingId}>{gate.label}</h3><p className="rules-full-text">{gate.instruction}</p>
      <p>Source: <code>{gate.sourcePath}</code> · Rule {gate.number}</p>
      <details className="wisdohm-gate-source"><summary>Open step source</summary>
        {source ? <><p>Source validity: {source.status}</p>{source.truncated && <p>Displayed source is truncated. Read the full file before acting.</p>}
          <pre tabIndex={0}>{source.text || 'No source text is available.'}</pre></> : <p>Step source text is unavailable in this snapshot.</p>}
      </details>
      <nav className="wisdohm-step-actions" aria-label="Step navigation">
        <button type="button" disabled={!previous} onClick={() => { if (previous) setSelected(previous.id); }}>Previous step</button>
        <button type="button" disabled={!next} onClick={() => { if (next) setSelected(next.id); }}>Next step</button>
      </nav>
    </article>
    <section className="wisdohm-routing" aria-label="Owner routing observation">
      <h3>Owner routing</h3>
      <p>{snapshot.harness.routing.status} · {snapshot.harness.routing.owners} owners · {snapshot.harness.routing.profiles} profiles · {snapshot.harness.routing.skills} skills</p>
      <p className="rules-notice">A routing profile describes an executor. It does not show that a worker was launched.</p>
    </section>
    <details className="wisdohm-harness-inputs"><summary>Open harness inputs ({inputs.length})</summary>
      {inputs.map(item => <details key={item.id}><summary>{item.label} <span>· {item.status}</span></summary>
        <code>{item.path}</code>{item.truncated && <p>Displayed source is truncated.</p>}
        <pre tabIndex={0}>{item.text || 'Source text unavailable.'}</pre>
      </details>)}
    </details>
  </section>;
}
