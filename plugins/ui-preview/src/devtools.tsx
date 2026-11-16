import { useEffect, useRef, useState } from 'react';
import type { ApplicationClient } from '@devlab/ui-contracts';
export function DevToolsControls({
  client,
  projectId,
  semanticPrefix = '',
  paneId,
  viewId,
}: {
  client: ApplicationClient;
  projectId: string;
  semanticPrefix?: string;
  paneId?: string;
  viewId?: string;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const epoch = useRef(0);
  useEffect(() => {
    epoch.current++;
    setBusy(false);
    setMessage('');
    return () => {
      epoch.current++;
    };
  }, [projectId, paneId, viewId, client.previewInspector]);
  const params = new URLSearchParams(location.search),
    session = params.get('nativeSession');
  const target = paneId && viewId ? { paneId, viewId } : undefined;
  const legacySession = !params.has('nativePane') && !params.has('previewView');
  const own =
    session &&
    params.get('projectId') === projectId &&
    (legacySession ||
      (target &&
        params.get('nativePane') === target.paneId &&
        params.get('previewView') === target.viewId));
  if (!client.previewInspector) return null;
  async function open() {
    const version = epoch.current;
    setBusy(true);
    setMessage('');
    try {
      if (own) await client.previewInspector!.openDevTools(session!, projectId);
      else {
        await client.previewInspector!.openWorkspace(projectId, target);
        if (version === epoch.current)
          setMessage('Inspectable workspace opened.');
      }
    } catch (e) {
      if (version === epoch.current) setMessage(String(e));
    } finally {
      if (version === epoch.current) setBusy(false);
    }
  }
  return (
    <div className="preview-inspector">
      <button
        data-devlab-source="plugins/ui-preview/src/devtools.tsx"
        data-devlab-id={semanticPrefix + 'preview.devtools'}
        disabled={busy}
        onClick={() => void open()}
      >
        {busy
          ? 'Opening…'
          : own
            ? 'Chrome DevTools'
            : 'Open inspectable workspace'}
      </button>
      <small>
        {message ||
          (own
            ? 'DevTools inspects this workspace and its preview frame.'
            : 'Native inspection opens a separate workspace window.')}
      </small>
    </div>
  );
}
