import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, Wrench } from 'lucide-react';
import type { UIPluginProps } from '@devlab/ui-contracts';
import { PluginPanel } from './plugins.tsx';
import { AnatomyView } from './anatomy.tsx';
import { HoodView as PortableHood } from '@creoaurea/pop-the-hood/react';
import './hood.css';

type Layer = 'anatomy' | 'plugins' | 'architecture' | 'harness' | 'memory';
const layers: readonly { id: Layer; label: string }[] = [
  { id: 'anatomy', label: 'App anatomy' },
  { id: 'plugins', label: 'PLUGINS' },
  { id: 'architecture', label: 'Source graph' },
  { id: 'harness', label: 'WISDOHM harness' },
  { id: 'memory', label: 'Memory' },
];

/** Presentation composition only; project/editor/preview/terminal owners stay outside this dialog. */
export function HoodView({ client, hoodOptions, projectWorkspace }: UIPluginProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const scope = useId();
  const [layer, setLayer] = useState<Layer>('anatomy');
  const [visited, setVisited] = useState<ReadonlySet<Layer>>(() => new Set(['anatomy']));
  const selectLayer = (next: Layer) => {
    setVisited(current => current.has(next) ? current : new Set([...current, next]));
    setLayer(next);
  };
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    return () => { if (element.open) element.close(); };
  }, []);
  const project = projectWorkspace?.snapshot().projectId;
  return <dialog ref={dialog} className="wisdohm-hood-shell" aria-label="Pop the Hood" aria-labelledby={title}
    data-testid="hood-root" onCancel={event => {
      if (hoodOptions?.onClose) { event.preventDefault(); hoodOptions.onClose(); }
    }}>
    <header className="wisdohm-hood-toolbar">
      {hoodOptions?.onClose && <button type="button" className="wisdohm-hood-back" onClick={hoodOptions.onClose}><ArrowLeft size={13} aria-hidden="true" /> Back to canvas</button>}
      <h1 id={title}><Wrench size={13} aria-hidden="true" /> Pop the Hood</h1>
      <div role="tablist" aria-label="Hood layers" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const available = layers.filter(item => item.id === 'anatomy' || item.id === 'architecture' || item.id === 'plugins' || hoodOptions?.renderWisdohm);
        const index = available.findIndex(item => item.id === layer);
        const next = event.key === 'Home' ? available[0] : event.key === 'End' ? available.at(-1)
          : available[(index + (event.key === 'ArrowRight' ? 1 : available.length - 1)) % available.length];
        if (!next) return;
        event.preventDefault(); selectLayer(next.id);
        event.currentTarget.querySelector<HTMLButtonElement>(`[data-hood-layer="${next.id}"]`)?.focus();
      }}>
        {layers.map(item => <button key={item.id} type="button" role="tab" id={`${scope}-${item.id}-tab`}
          aria-controls={`${scope}-${item.id}`} aria-selected={layer === item.id} tabIndex={layer === item.id ? 0 : -1}
        data-hood-layer={item.id} disabled={item.id !== 'anatomy' && item.id !== 'architecture' && item.id !== 'plugins' && !hoodOptions?.renderWisdohm}
        title={item.id !== 'anatomy' && item.id !== 'architecture' && item.id !== 'plugins' && !hoodOptions?.renderWisdohm ? 'WISDOHM inspection capability is unavailable.' : undefined}
          onClick={() => selectLayer(item.id)}>{item.label}</button>)}
      </div>
    </header>
    <section className="wisdohm-hood-content" role="tabpanel" id={`${scope}-anatomy`}
      aria-labelledby={`${scope}-anatomy-tab`} hidden={layer !== 'anatomy'}>
      <AnatomyView api={project && project !== 'default' ? projectWorkspace?.sourceClient() : client.registry}
        projectId={project && project !== 'default' ? 'workspace' : hoodOptions?.projectId}
        onSourceGraph={() => selectLayer('architecture')} />
    </section>
    {visited.has('architecture') &&     <section className="wisdohm-hood-content wisdohm-hood-architecture" role="tabpanel" id={`${scope}-architecture`}
      aria-labelledby={`${scope}-architecture-tab`} hidden={layer !== 'architecture'}>
      <PortableHood client={project && project !== 'default' ? projectWorkspace?.sourceClient() : client.registry}
        initialProjectId={project && project !== 'default' ? 'workspace' : hoodOptions?.projectId}
        onClose={hoodOptions?.onClose} uiContributions={hoodOptions?.uiContributions} theme="inherit" presentation="embedded" />
    </section>}
    {visited.has('plugins') && <section className="wisdohm-hood-content wisdohm-hood-plugins" role="tabpanel"
      id={`${scope}-plugins`} aria-labelledby={`${scope}-plugins-tab`} hidden={layer !== 'plugins'}>
      <PluginPanel api={project && project !== 'default' ? projectWorkspace?.sourceClient() : client.registry}
        projectId={project && project !== 'default' ? 'workspace' : hoodOptions?.projectId}
        runtime={client.runtime} searchProjectId={project ?? 'default'}
        contributions={hoodOptions?.uiContributions ?? []} onDevelop={hoodOptions?.onDevelopPlugin} />
    </section>}
    {(['harness', 'memory'] as const).map(tab => visited.has(tab) && <section key={tab}
      className="wisdohm-hood-content wisdohm-hood-wisdohm" role="tabpanel" id={`${scope}-${tab}`}
      aria-labelledby={`${scope}-${tab}-tab`} hidden={layer !== tab}>
      {hoodOptions?.renderWisdohm?.(tab)}
    </section>)}
  </dialog>;
}

