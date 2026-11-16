import { useEffect, useId, useRef, useState } from 'react';
import { ProjectTextSchema, type PreviewElement, type ProjectServerState } from '@devlab/contracts';
import type { ApplicationClient } from '@devlab/ui-contracts';
import { acceptsPreviewSource, type PreviewServerOwner, type PreviewSourceFence } from './server-state.ts';
import type { PreviewWorkspace } from './workspace.ts';
import { previewURL } from './preferences.ts';
import { buildUIElementBrief, UI_ELEMENT_REQUEST_LIMIT } from './element-brief.ts';

export function ElementSourceTools({ client, element, target, viewId, viewLabel, url, theme, workspace, servers, onSourceSelect, active, semanticPrefix = '' }: {
  client: ApplicationClient;
  element: PreviewElement;
  target: PreviewSourceFence;
  viewId: string;
  viewLabel: string;
  url: string;
  theme?: 'light' | 'dark';
  workspace: PreviewWorkspace;
  servers: PreviewServerOwner;
  onSourceSelect?: (path: string) => void;
  active: boolean;
  semanticPrefix?: string;
}) {
  const requestId = useId();
  const [designRequest, setDesignRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const operation = useRef(0);
  const elementKey = JSON.stringify(element);
  const scope = JSON.stringify([target, viewId, viewLabel, url, elementKey, client.backendOrigin]);
  const latest = useRef({ scope, active, designRequest });
  latest.current = { scope, active, designRequest };
  useEffect(() => {
    operation.current++;
    setDesignRequest(''); setStatus(''); setError(''); setBusy(false);
    return () => { operation.current++; };
  }, [scope]);

  const matchesServer = (server: ProjectServerState | null) => {
    const view = server?.descriptor?.views.find(item => item.id === viewId);
    return server?.projectId === target.projectId && server.status === 'ready' &&
      server.instanceId === target.instanceId && server.generation === target.generation &&
      view?.label === viewLabel && JSON.stringify(view.element) === elementKey && previewURL(server.url, view.path, theme) === url;
  };
  const current = () => latest.current.scope === scope && latest.current.active &&
    acceptsPreviewSource(workspace, servers, target, element.designGuide) && matchesServer(servers.snapshot(target.projectId).state);

  const copyBrief = async () => {
    const version = ++operation.current;
    const request = designRequest.trim();
    const assertCurrent = () => {
      if (!current() || latest.current.designRequest.trim() !== request) throw new Error('Preview target or design request changed. Copy the brief again.');
    };
    setBusy(true); setError(''); setStatus('Reading saved source hashes…');
    try {
      if (!client.projects || !client.servers || !client.backendOrigin) throw new Error('Project files, server inspection and backend identity are required to copy a brief.');
      assertCurrent();
      const files = [];
      for (const path of new Set([...element.sources, element.designGuide])) {
        const file = ProjectTextSchema.parse(await client.projects.read(target.projectId, path));
        assertCurrent();
        if (file.path !== path) throw new Error('Source read returned a different file path.');
        files.push({ path, sha256: file.sha256 });
      }
      const inspected = await client.servers.inspect(target.projectId);
      assertCurrent();
      if (!matchesServer(inspected)) throw new Error('The project server or element view changed while source hashes were read.');
      const brief = buildUIElementBrief({ projectId: target.projectId, backendOrigin: client.backendOrigin,
        previewURL: url, paneId: target.paneId, viewId, viewLabel, instanceId: target.instanceId,
        generation: target.generation!, element, files, request });
      assertCurrent();
      await navigator.clipboard.writeText(brief);
      assertCurrent();
      if (version === operation.current) setStatus('UI-agent brief copied. No provider was invoked and no project data was written.');
    } catch (cause) {
      if (version === operation.current && latest.current.scope === scope) {
        setStatus(''); setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (version === operation.current) setBusy(false);
    }
  };
  const source = (path: string) => {
    if (current() && acceptsPreviewSource(workspace, servers, target, path)) onSourceSelect?.(path);
  };
  return <section className="preview-element-tools" aria-label="Element source tools" data-element-owner={element.owner} data-feature-id="PROTOTYPING"
    data-element-view={viewId} data-devlab-id={`${semanticPrefix}preview.element.tools`} data-devlab-source="plugins/ui-preview/src/elements.tsx">
    <div className="preview-element-heading"><strong>PROTOTYPING</strong><small>{viewLabel} · Declared owner: <code>{element.owner}</code></small></div>
    <div className="preview-element-files">
      {[...new Set(element.sources)].map(path => {
        const kind = /\.(?:css|scss|sass|less)$/i.test(path) ? 'style' : 'source';
        return <button type="button" key={path} title={path} aria-label={`Open element ${kind} ${path}`} disabled={!active || !onSourceSelect}
          onClick={() => source(path)}>{kind === 'style' ? 'Style' : 'Source'}: {path.split('/').at(-1)}</button>;
      })}
      <button type="button" title={element.designGuide} aria-label="Open UI design guide" disabled={!active || !onSourceSelect} onClick={() => source(element.designGuide)}>Design guide</button>
    </div>
    <label htmlFor={requestId}>Prototype UI changes</label>
    <textarea id={requestId} aria-label="Prototype UI changes" rows={2} maxLength={UI_ELEMENT_REQUEST_LIMIT} value={designRequest}
      data-devlab-id={`${semanticPrefix}preview.element.request`} data-devlab-source="plugins/ui-preview/src/elements.tsx"
      placeholder="Describe the change to this UI element" onChange={event => { setDesignRequest(event.target.value); setStatus(''); setError(''); }} />
    <div className="preview-element-copy"><button type="button" disabled={!active || busy || !designRequest.trim() || !client.projects || !client.servers || !client.backendOrigin}
      data-devlab-id={`${semanticPrefix}preview.element.copy`} data-devlab-source="plugins/ui-preview/src/elements.tsx" onClick={() => void copyBrief()}>{busy ? 'Reading source hashes…' : 'Copy UI-agent brief'}</button>
      <small>Copies saved-source hashes and your request. Unsaved drafts stay in the editor.</small></div>
    {!client.backendOrigin && <p className="preview-element-note">Backend identity is unavailable. A source-bound brief cannot be copied.</p>}
    {status && <p role="status" className="preview-element-note">{status}</p>}
    {error && <p role="alert" className="preview-element-error">{error}</p>}
  </section>;
}
