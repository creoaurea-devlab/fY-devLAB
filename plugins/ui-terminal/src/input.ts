import type { TerminalClient } from '@devlab/ui-contracts';

type Warning = (message: string) => void;
interface Queue {
  listeners: Set<Warning>;
  pending: string;
  inflight: number;
  error: string;
  closed: boolean;
  timer?: ReturnType<typeof setTimeout>;
  sending: boolean;
  tail: Promise<void>;
  flush(): Promise<void>;
  cleanup(): void;
}
const clients: WeakMap<TerminalClient, Map<string, Queue>> = import.meta.hot?.data.inputs ?? new WeakMap();
if (import.meta.hot) {
  import.meta.hot.data.inputs = clients;
  import.meta.hot.accept(() => console.warn('Terminal input owner updated; existing queues retained.'));
}

/** Exact-session, client-owned delivery outlives renderer effects. Failed batches are never retried. */
export function acquireTerminalInput(api: TerminalClient, id: string, warning: Warning) {
  let sessions = clients.get(api);
  if (!sessions) { sessions = new Map(); clients.set(api, sessions); }
  let queue = sessions.get(id);
  if (!queue) {
    const state: Queue = {
      listeners: new Set(), pending: '', inflight: 0, error: '', closed: false,
      sending: false, tail: Promise.resolve(),
      flush() {
        clearTimeout(state.timer); state.timer = undefined;
        if (state.sending || state.error || state.closed || !state.pending) return state.tail;
        state.sending = true;
        state.tail = (async () => {
          while (state.pending && !state.error && !state.closed) {
            const text = state.pending; state.pending = ''; state.inflight = text.length;
            try { await api.write(id, text); }
            catch {
              // The response may have been lost after execution. Never replay this text.
              if (!state.closed) {
                state.error = 'Input delivery uncertain. Check terminal output before continuing.';
                for (const notify of state.listeners) notify(state.error);
              }
            } finally { state.inflight = 0; }
          }
        })().finally(() => { state.sending = false; state.cleanup(); });
        return state.tail;
      },
      cleanup() {
        if (!state.listeners.size && !state.sending && !state.pending && !state.error) {
          clearTimeout(state.timer);
          events?.removeEventListener('beforeunload', beforeUnload);
          if (sessions!.get(id) === state) sessions!.delete(id);
        }
      },
    };
    const events = typeof window === 'undefined' ? undefined : window;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (state.pending || state.sending || state.error) { event.preventDefault(); event.returnValue = ''; }
    };
    events?.addEventListener('beforeunload', beforeUnload);
    queue = state; sessions.set(id, state);
  }
  const state = queue;
  state.listeners.add(warning);
  if (state.error) warning(state.error);
  let released = false;
  return {
    push(data: string) {
      if (released || state.closed) throw new Error('Terminal input attachment ended');
      if (state.error) throw new Error(state.error);
      if (state.pending.length + state.inflight + data.length > 65536)
        throw new Error('Input exceeds 64 KiB; wait or split the paste');
      state.pending += data;
      state.timer ??= setTimeout(() => { state.timer = undefined; void state.flush(); }, 16);
    },
    flush: () => state.flush(),
    blocked: () => Boolean(state.error),
    /** Explicit user acknowledgement discards only unsent text; ambiguous text is not replayed. */
    discardUnsent() {
      if (state.sending) throw new Error('Wait for current input delivery');
      state.pending = ''; state.error = '';
      for (const notify of state.listeners) notify('');
      state.cleanup();
    },
    release(ended = false) {
      if (ended) { state.closed = true; state.pending = ''; state.error = ''; }
      if (!released) {
        released = true;
        state.listeners.delete(warning);
        void state.flush();
      }
      state.cleanup();
    },
  };
}
