import { useEffect, useRef, useState } from 'react';

const fullscreenTimeoutMs = 4000;

/** Presentation only: the shell element and its domain owners never move. */
export function useWorkspaceFocus() {
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const alive = useRef(true), epoch = useRef(0);
  const requesting: { current: boolean; complete?: ((entered: boolean) => void) | null } = useRef(false);
  const current = useRef<'native' | 'maximized' | null>(null);
  const [mode, setMode] = useState<typeof current.current>(null);
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const apply = (next: typeof current.current) => { current.current = next; setMode(next); };
  const restore = () => requestAnimationFrame(() => { if (opener.current?.isConnected) opener.current.focus(); });
  const cancel = () => {
    ++epoch.current; requesting.complete?.(false); requesting.current = false; setPending(false);
  };
  useEffect(() => {
    alive.current = true;
    requesting.current = false; setPending(false);
    const changed = () => {
      if (document.fullscreenElement === root.current) {
        if (requesting.current || current.current === 'native') { apply('native'); requesting.complete?.(true); }
        else void document.exitFullscreen().catch(() => {});
      } else if (current.current === 'native') { apply(null); restore(); }
    };
    document.addEventListener('fullscreenchange', changed);
    return () => {
      alive.current = false; ++epoch.current; requesting.complete?.(false); requesting.current = false;
      document.removeEventListener('fullscreenchange', changed);
    };
  }, []);
  const enter = async (trigger: HTMLElement): Promise<boolean> => {
    const element = root.current;
    if (!element || requesting.current) return false;
    if (document.fullscreenElement === element) { apply('native'); return true; }
    if (document.fullscreenElement) { setError('Exit the current fullscreen element first.'); return false; }
    opener.current = trigger;
    const token = ++epoch.current;
    requesting.current = true; setPending(true); setError('');
    let timer: ReturnType<typeof setTimeout>;
    const result = new Promise<boolean>(resolve => {
      const finish = (entered: boolean) => {
        if (requesting.complete !== finish) return;
        clearTimeout(timer); requesting.complete = null; resolve(entered);
      };
      requesting.complete = finish;
      // Browser/desktop integrations can leave the native promise unresolved.
      timer = setTimeout(() => finish(false), fullscreenTimeoutMs);
    });
    try {
      if (!element.requestFullscreen) throw new Error('Unavailable');
      void element.requestFullscreen().then(() => {
        if (token === epoch.current) requesting.complete?.(document.fullscreenElement === element);
        else if (!requesting.current && current.current !== 'native' && document.fullscreenElement === element)
          void document.exitFullscreen().catch(() => {});
      }, () => { if (token === epoch.current) requesting.complete?.(false); });
    } catch { requesting.complete?.(false); }
    const entered = await result;
    if (!alive.current || token !== epoch.current) return false;
    requesting.current = false; setPending(false);
    if (entered && document.fullscreenElement === element) { apply('native'); return true; }
    ++epoch.current;
    setError('Fullscreen unavailable. Use Focus previews instead.');
    return false;
  };
  const maximize = (trigger: HTMLElement) => {
    if (current.current === 'native') return;
    if (document.fullscreenElement && document.fullscreenElement !== root.current) {
      setError('Exit the current fullscreen element first.'); return;
    }
    cancel(); opener.current = trigger; setError(''); apply('maximized');
  };
  const exit = async () => {
    cancel();
    if (document.fullscreenElement === root.current) {
      try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([document.exitFullscreen(), new Promise<void>(resolve => { timer = setTimeout(resolve, fullscreenTimeoutMs); })]); }
        finally { clearTimeout(timer); }
        if (document.fullscreenElement === root.current) throw new Error('Still fullscreen');
      }
      catch { setError('Fullscreen could not exit. Press Escape to leave fullscreen.'); return; }
    }
    if (alive.current) { apply(null); setError(''); restore(); }
  };
  return { root, mode, pending, error, enter, maximize, exit };
}
