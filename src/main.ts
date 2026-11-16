import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { client as api } from '@devlab/client';
import { createRuntime } from './workspace.ts';
import { Shell } from './shell.tsx';
import { catalog } from './contributions.ts';
import { previewServers } from './preview-client.ts';
import '@devlab/ui-shell/style.css';
import '@devlab/ui-canvas/style.css';
import '@devlab/ui-projects/style.css';
import '@devlab/ui-preview/style.css';
import '@devlab/ui-terminal/style.css';
import '@devlab/ui-browser/style.css';
import '@creoaurea/pop-the-hood/style.css';
import './style.css';

interface Session { runtime: ReturnType<typeof createRuntime>; root: Root; bookmark?: () => void; }
const params = new URLSearchParams(location.search);
const kernel = params.get('view') === 'kernel';
const elementId = params.get('view') === 'element' ? params.get('element') : null;
const client = { ...api, backendOrigin: import.meta.env.DEVLAB_BACKEND_ORIGIN || location.origin,
  servers: api.servers ? previewServers(api.servers) : undefined,
  browsers: undefined, previewInspector: undefined };
const session: Session = import.meta.hot?.data.session ?? (() => {
  const mode = params.get('mode'), output = params.get('output');
  const runtime = createRuntime(client, { kernel, projectId: params.get('projectId') ?? undefined,
    initialMode: mode === 'flow' || mode === 'build' ? mode : undefined,
    initialOutput: output === 'terminal' || output === 'servers' || output === 'herdr' ? output : undefined });
  const root = createRoot(document.getElementById('root')!);
  void runtime.ready.catch(error => console.error('Workspace load failed', error));
  function beforeUnload(event: BeforeUnloadEvent) {
    if (runtime.projectWorkspace?.hasUnsavedDrafts?.() || [...runtime.owners.values()].some(owner => {
      const state = owner.snapshot(); return state.dirty || state.saving;
    })) event.preventDefault();
  }
  function pageHide(event: PageTransitionEvent) {
    if (event.persisted) return;
    window.removeEventListener('beforeunload', beforeUnload);
    window.removeEventListener('pagehide', pageHide);
    session.bookmark?.();
    try { root.unmount(); } finally { runtime.dispose(); }
  }
  window.addEventListener('beforeunload', beforeUnload);
  window.addEventListener('pagehide', pageHide);
  return { runtime, root };
})();
const runtime = session.runtime;
// The tab URL remembers presentation only. Shells, leases and input stay with their owners.
function rememberView() {
  const state = runtime.projectWorkspace?.snapshot();
  if (!state) return;
  if (!state.projects.some(project => project.id === state.projectId && project.available !== false)) return;
  const url = new URL(location.href);
  url.searchParams.set('projectId', state.projectId);
  url.searchParams.set('mode', state.mode);
  if (state.output) url.searchParams.set('output', state.output); else url.searchParams.delete('output');
  if (url.href !== location.href) {
    try { history.replaceState(history.state, '', url); } catch { /* The current view remains usable if history is unavailable. */ }
  }
}
session.bookmark?.();
if (params.get('view') !== 'element') {
  session.bookmark = runtime.projectWorkspace?.subscribe(rememberView);
  rememberView();
}
document.documentElement.classList.toggle('devlab-mode', !kernel);
function render() {
  if (params.get('view') === 'element') {
    const matches = runtime.registry.snapshot().flatMap(plugin => plugin.elements ?? []).filter(item => item.id === elementId);
    const element = matches.length === 1 ? matches[0] : undefined;
    session.root.render(element
      ? createElement('div', { className: `devlab${params.get('theme') === 'light' ? '' : ' dark'} devlab-element` },
          createElement(element.Component, { client: runtime.client, draft: '', setDraft: () => {},
            projectWorkspace: runtime.projectWorkspace, workspace: runtime.workspace }))
      : createElement('section', { role: 'alert', className: 'planner-empty' }, 'This UI element is not registered.'));
    return;
  }
  session.root.render(createElement(Shell, { registry: runtime.registry, catalog: runtime.registry.catalog(),
    toggle: plugin => runtime.registry.toggle(plugin.id), client: runtime.client, workspace: runtime.workspace,
    projectWorkspace: runtime.projectWorkspace, previewWorkspace: runtime.previewWorkspace }));
}
function acceptCatalog(candidate: typeof catalog) {
  try { runtime.registry.reconcile(candidate); render(); }
  catch (error) { console.error('UI update rejected; previous catalog retained.', error); }
}
acceptCatalog(catalog);
if (import.meta.hot) {
  import.meta.hot.data.session = session;
  import.meta.hot.accept();
  import.meta.hot.accept('./contributions.ts', module => { if (module) acceptCatalog(module.catalog); });
  // New owner implementations apply only after an explicit reload/checkpoint.
  import.meta.hot.accept(['./workspace.ts', './preview-client.ts', '@devlab/client'], () => {
    window.dispatchEvent(new CustomEvent('devlab:reload-required', { detail: { scope: 'ui-owner' } }));
    console.warn('UI owner changed; reload deliberately after saving drafts.');
  });
}
