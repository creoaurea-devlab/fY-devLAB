import { TerminalReplaySchema, type TerminalReplay } from '@devlab/contracts';

type Observer = {
  id: string;
  after: number;
  receive(value: TerminalReplay): void;
  error(): void;
};

// One connection for all terminal presentations. HTTP/1 browsers otherwise exhaust
// their per-origin connection pool and queue ordinary input/stop requests behind SSE.
const observers = new Set<Observer>();
let source: EventSource | undefined;
let scheduled = false;

function rebuild() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    source?.close();
    source = undefined;
    if (!observers.size) return;
    const cursors = new Map<string, number>();
    for (const item of observers) cursors.set(item.id, Math.min(cursors.get(item.id) ?? item.after, item.after));
    const streams = [...cursors].map(([id, after]) => ({ id, after }));
    const stream = new EventSource('/api/terminals/events?streams=' + encodeURIComponent(JSON.stringify(streams)));
    source = stream;
    stream.addEventListener('terminal', event => {
      if (source !== stream) return;
      let replay: TerminalReplay;
      try { replay = TerminalReplaySchema.parse(JSON.parse((event as MessageEvent).data)); }
      catch { for (const observer of [...observers]) observer.error(); return; }
      const first = replay.chunks[0]?.seq ?? replay.session.cursor + 1;
      for (const observer of [...observers]) {
        if (observer.id !== replay.session.id || !observers.has(observer)) continue;
        // Each presentation has its own cursor. A newly opened canvas may need
        // history while a retained dock has already consumed those same bytes.
        const reset = observer.after < first - 1 || observer.after > replay.session.cursor;
        const chunks = replay.chunks.filter(chunk => reset || chunk.seq > observer.after);
        observer.after = replay.session.cursor;
        try { observer.receive({ session: replay.session, reset, chunks }); }
        catch { observer.error(); }
        if (replay.session.status === 'exited') observers.delete(observer);
      }
      if (replay.session.status === 'exited') rebuild();
    });
    stream.addEventListener('terminal-error', event => {
      if (source !== stream) return;
      try {
        const value: unknown = JSON.parse((event as MessageEvent).data);
        if (!value || typeof value !== 'object' || !('id' in value)) return;
        for (const observer of [...observers]) if (observer.id === value.id) {
          observers.delete(observer);
          observer.error();
        }
        rebuild();
      } catch { for (const observer of [...observers]) observer.error(); }
    });
    stream.onerror = () => {
      if (source === stream) for (const observer of [...observers]) observer.error();
    };
  });
}

export function listenTerminal(id: string, after: number, receive: Observer['receive'], error: Observer['error']): () => void {
  const observer = { id, after, receive, error };
  observers.add(observer);
  // A new reader may need earlier history even when its ID is already observed.
  rebuild();
  return () => {
    if (!observers.delete(observer)) return;
    if (![...observers].some(item => item.id === id)) rebuild();
  };
}
