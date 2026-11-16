import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  PreviewSelectionSchema,
  PreviewBridgeMessageSchema,
  ProjectRelativePathSchema,
  type PreviewSelection,
} from '@devlab/contracts';
export function ElementInspector({
  frame,
  projectId,
  generation,
  url,
  targetKey,
  onSourceSelect,
  tokenFiles = [],
  active = true,
  onRefreshState,
  semanticPrefix = '',
}: {
  frame: RefObject<HTMLIFrameElement>;
  projectId: string;
  generation: string;
  url: string;
  targetKey: string;
  onSourceSelect?: (path: string) => void;
  tokenFiles?: string[];
  active?: boolean;
  onRefreshState?: (state: 'unknown' | 'connected' | 'disconnected') => void;
  semanticPrefix?: string;
}) {
  const [ready, setReady] = useState(false),
    [picking, setPicking] = useState(false),
    [selection, setSelection] = useState<PreviewSelection | null>(null);
  const session = useRef({ nonce: '', origin: new URL(url).origin, epoch: -1 });
  const refreshCallback = useRef(onRefreshState);
  refreshCallback.current = onRefreshState;
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (!active) {
      setPicking(false);
      frame.current?.contentWindow?.postMessage(
        {
          channel: 'devlab-preview-v1',
          type: 'cancel',
          projectId,
          generation,
          nonce: session.current.nonce,
        },
        session.current.origin,
      );
    }
  }, [active, frame, projectId, generation]);
  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setInterval>;
    const init = () => {
      session.current = {
        nonce: crypto.randomUUID(),
        origin: new URL(url).origin,
        epoch: -1,
      };
      refreshCallback.current?.('unknown');
      setReady(false);
      setPicking(false);
      setSelection(null);
      frame.current?.contentWindow?.postMessage(
        {
          channel: 'devlab-preview-v1',
          type: 'init',
          projectId,
          generation,
          nonce: session.current.nonce,
        },
        session.current.origin,
      );
    };
    const receive = (event: MessageEvent) => {
      if (
        closed ||
        event.source !== frame.current?.contentWindow ||
        event.origin !== session.current.origin
      )
        return;
      const parsed = PreviewBridgeMessageSchema.safeParse(event.data);
      if (!parsed.success) return;
      const d = parsed.data;
      if (
        !d ||
        d.channel !== 'devlab-preview-v1' ||
        d.projectId !== projectId ||
        d.generation !== generation ||
        d.nonce !== session.current.nonce
      )
        return;
      if (d.epoch < session.current.epoch) return;
      if (d.type === 'selection' && d.epoch !== session.current.epoch) return;
      session.current.epoch = d.epoch;
      if (d.refresh) refreshCallback.current?.(d.refresh);
      if (d.type === 'ready') setReady(true);
      if (d.type === 'cancelled' || d.type === 'selection') setPicking(false);
      if (d.type === 'reset') {
        init();
        return;
      }
      if (d.type === 'invalidated') {
        setSelection(null);
        setPicking(false);
      }
      if (d.type === 'selection' && activeRef.current) {
        try {
          if (JSON.stringify(d.selection).length > 65536) return;
          const value = PreviewSelectionSchema.safeParse(d.selection);
          if (value.success) setSelection(value.data);
        } catch {
          /* malformed project message */
        }
      }
    };
    window.addEventListener('message', receive);
    init();
    // Retry the same nonce until the bridge is loaded; ready acknowledgements are idempotent.
    timer = setInterval(
      () =>
        frame.current?.contentWindow?.postMessage(
          {
            channel: 'devlab-preview-v1',
            type: 'init',
            projectId,
            generation,
            nonce: session.current.nonce,
          },
          session.current.origin,
        ),
      1500,
    );
    return () => {
      closed = true;
      clearInterval(timer);
      window.removeEventListener('message', receive);
      frame.current?.contentWindow?.postMessage(
        {
          channel: 'devlab-preview-v1',
          type: 'cancel',
          projectId,
          generation,
          nonce: session.current.nonce,
        },
        session.current.origin,
      );
    };
  }, [frame, projectId, generation, url, targetKey]);
  const source =
    selection?.source.status === 'annotated'
      ? selection.source.value.split(':')[0]
      : undefined;
  const validSource =
    source && ProjectRelativePathSchema.safeParse(source).success
      ? source
      : undefined;
  return (
    <div className="preview-inspector" aria-label="Element inspector">
      <button
        data-devlab-source="plugins/ui-preview/src/inspector.tsx"
        data-devlab-id={semanticPrefix + 'preview.pick'}
        disabled={!ready || !active}
        aria-pressed={picking}
        onClick={() => {
          if (!active) return;
          const next = !picking;
          setPicking(next);
          frame.current?.contentWindow?.postMessage(
            {
              channel: 'devlab-preview-v1',
              type: next ? 'pick' : 'cancel',
              projectId,
              generation,
              nonce: session.current.nonce,
            },
            session.current.origin,
          );
        }}
      >
        {picking ? 'Cancel selection' : 'Select element'}
      </button>
      <small>
        {ready
          ? 'Select an element in the preview.'
          : 'Element selection requires the project preview bridge.'}
      </small>
      {selection && (
        <details open>
          <summary>
            {selection.tag} · {selection.stableId ?? 'Missing element ID'}
          </summary>
          <p>
            {selection.role ?? 'Element'} · {selection.name} ·{' '}
            {selection.identityStatus}
          </p>
          {validSource ? (
            <button
              data-devlab-source="plugins/ui-preview/src/inspector.tsx"
              data-devlab-id={semanticPrefix + 'preview.source'}
              onClick={() => onSourceSelect?.(validSource)}
            >
              Open{' '}
              {selection.source.status === 'annotated'
                ? selection.source.value
                : validSource}{' '}
              · annotated
            </button>
          ) : (
            <p>Source location is unknown.</p>
          )}
          {tokenFiles.map(
            (path, index) =>
              ProjectRelativePathSchema.safeParse(path).success && (
                <button
                  key={path}
                  data-devlab-source="plugins/ui-preview/src/inspector.tsx"
                  data-devlab-id={`preview.tokens.${index}`}
                  onClick={() => onSourceSelect?.(path)}
                >
                  Edit tokens · {path}
                </button>
              ),
          )}
          <dl>
            {selection.tokens.references.map((token) => (
              <div key={token.token}>
                <dt>{token.token}</dt>
                <dd>
                  {token.computedValue} · {token.properties.join(', ')}
                </dd>
              </div>
            ))}
          </dl>
          <small>{selection.tokens.coverage}</small>
        </details>
      )}
    </div>
  );
}
