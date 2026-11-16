export interface PreviewFullscreenState {
  paneId: string | null;
  mode: 'native' | 'maximized' | null;
  error: string;
}
export interface FullscreenElement {
  isConnected?: boolean;
  requestFullscreen?: () => Promise<void>;
}
export interface FullscreenDocument {
  fullscreenElement: FullscreenElement | null;
  exitFullscreen?: () => Promise<void>;
  addEventListener(type: 'fullscreenchange', listener: () => void): void;
  removeEventListener(type: 'fullscreenchange', listener: () => void): void;
}
export interface PreviewFullscreen {
  snapshot(): PreviewFullscreenState;
  subscribe(listener: () => void): () => void;
  enter(
    paneId: string,
    opener?: { isConnected: boolean; focus(): void },
  ): Promise<boolean>;
  maximize(
    paneId: string,
    opener?: { isConnected: boolean; focus(): void },
  ): void;
  exit(): Promise<void>;
  dispose(): void;
}
/** Uses the existing pane element. No portal/reparent/duplicate iframe is created. */
export function createPreviewFullscreen(options: {
  document: FullscreenDocument;
  getElement: (paneId: string) => FullscreenElement | null;
  onChange?: (state: PreviewFullscreenState) => void;
  timeoutMs?: number;
}): PreviewFullscreen {
  const timeoutMs = options.timeoutMs ?? 4000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid fullscreen timeout');
  let state: PreviewFullscreenState = Object.freeze({ paneId: null, mode: null, error: '' });
  let closed = false, epoch = 0;
  let pending: { paneId: string; element: FullscreenElement; promise: Promise<boolean>; finish(value: boolean, error?: string): void } | undefined;
  let opener: { isConnected: boolean; focus(): void } | undefined;
  const listeners = new Set<() => void>();
  const abandoned = new WeakSet<FullscreenElement>();
  const emit = (next: PreviewFullscreenState) => {
    if (closed) return;
    state = Object.freeze(next);
    options.onChange?.(state);
    for (const listener of listeners) listener();
  };
  const restore = () => {
    if (opener?.isConnected) opener.focus();
    opener = undefined;
  };
  const owns = (element: FullscreenElement) => !closed && state.mode === 'native' &&
    options.getElement(state.paneId!) === element;
  // A late browser reply belongs to its original request, never a newer owner.
  const discardLate = (element: FullscreenElement) => {
    if (options.document.fullscreenElement === element && !owns(element) && pending?.element !== element)
      void options.document.exitFullscreen?.().catch(() => {});
  };
  function changed() {
    if (pending && options.document.fullscreenElement === pending.element) pending.finish(true);
    const actual = options.document.fullscreenElement;
    if (actual && abandoned.has(actual)) discardLate(actual);
    if (state.mode === 'native' && options.document.fullscreenElement !== options.getElement(state.paneId!)) {
      epoch++;
      emit({ paneId: null, mode: null, error: '' });
      restore();
    }
  }
  options.document.addEventListener('fullscreenchange', changed);
  const api: PreviewFullscreen = {
    snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    enter(paneId, trigger) {
      if (closed) return Promise.resolve(false);
      if (pending) return pending.paneId === paneId ? pending.promise : Promise.resolve(false);
      if (state.paneId === paneId && state.mode === 'native') return Promise.resolve(true);
      if (state.paneId) {
        emit({ ...state, error: 'Exit the current fullscreen pane first.' });
        return Promise.resolve(false);
      }
      const element = options.getElement(paneId);
      if (!element?.requestFullscreen || element.isConnected === false) {
        emit({ paneId: null, mode: null, error: 'Fullscreen is unavailable. Choose Maximize in app to enlarge this pane.' });
        return Promise.resolve(false);
      }
      if (options.document.fullscreenElement && options.document.fullscreenElement !== element) {
        emit({ paneId: null, mode: null, error: 'Another element is fullscreen. Exit it before enlarging this preview.' });
        return Promise.resolve(false);
      }
      const token = ++epoch;
      opener = trigger;
      let resolve!: (value: boolean) => void;
      const promise = new Promise<boolean>(done => { resolve = done; });
      let settled = false;
      const timer = setTimeout(() => finish(options.document.fullscreenElement === element,
        'Fullscreen did not respond. Try again or choose Maximize in app.'), timeoutMs);
      function finish(value: boolean, error = '') {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (pending?.promise === promise) pending = undefined;
        const accepted = value && !closed && token === epoch && element!.isConnected !== false;
        if (!closed && token === epoch) {
          emit(accepted ? { paneId, mode: 'native', error: '' } : { paneId: null, mode: null, error });
          if (!accepted && error) opener = undefined;
        }
        if (!accepted) abandoned.add(element!);
        resolve(accepted);
      }
      pending = { paneId, element, promise, finish };
      try {
        const native = element.requestFullscreen();
        void Promise.resolve(native).then(() => {
          if (settled) { discardLate(element); return; }
          finish(options.document.fullscreenElement === element,
            'The browser did not enter fullscreen. Choose Maximize in app to enlarge this pane.');
        }, () => finish(false, 'Fullscreen was denied. Choose Maximize in app to enlarge this pane.'));
        if (options.document.fullscreenElement === element) finish(true);
      } catch {
        finish(false, 'Fullscreen was denied. Choose Maximize in app to enlarge this pane.');
      }
      return promise;
    },
    maximize(paneId, trigger) {
      if (closed) return;
      if (state.mode) {
        emit({ ...state, error: 'Exit the current enlarged pane first.' });
        return;
      }
      if (!options.getElement(paneId)) {
        emit({ paneId: null, mode: null, error: 'The preview pane is no longer available.' });
        return;
      }
      epoch++;
      pending?.finish(false);
      opener = trigger;
      emit({ paneId, mode: 'maximized', error: '' });
    },
    async exit() {
      if (closed) return;
      const token = ++epoch;
      const element = state.paneId ? options.getElement(state.paneId) : pending?.element;
      pending?.finish(false);
      if (element && options.document.fullscreenElement === element) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            Promise.resolve(options.document.exitFullscreen?.()),
            new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); }),
          ]);
        } catch { /* Actual document state below decides whether exit succeeded. */ }
        finally { clearTimeout(timer); }
        if (closed || token !== epoch) return;
        if (options.document.fullscreenElement === element) {
          emit({ ...state, error: 'Use the browser Escape control to exit fullscreen.' });
          return;
        }
      }
      if (closed || token !== epoch) return;
      emit({ paneId: null, mode: null, error: '' });
      restore();
    },
    dispose() {
      if (closed) return;
      const element = state.paneId ? options.getElement(state.paneId) : pending?.element;
      epoch++;
      pending?.finish(false);
      options.document.removeEventListener('fullscreenchange', changed);
      if (element && options.document.fullscreenElement === element)
        void options.document.exitFullscreen?.().catch(() => {});
      closed = true;
      opener = undefined;
      listeners.clear();
    },
  };
  return api;
}
