import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ApplicationError, type TerminalSession } from '@devlab/contracts';
import type { UIPluginProps } from '@devlab/ui-contracts';
import { acquireTerminalInput } from './input.ts';
import '@xterm/xterm/css/xterm.css';
import './terminal.css';

export function TerminalView({ client, terminalOptions }: UIPluginProps) {
  const host = useRef<HTMLDivElement>(null);
  const actions = useRef<{
    ensureReady(retry?: boolean): void;
    resize(): void;
    resumeInput(): void;
  } | null>(null);
  const [session, setSession] = useState<TerminalSession | null>(null);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState('Checking sessions');
  const [inputBlocked, setInputBlocked] = useState(false);
  const [retryable, setRetryable] = useState(false);
  const options = useRef(terminalOptions);
  options.current = terminalOptions;
  const api = client.terminals,
    projectId = terminalOptions?.projectId,
    nodeId = terminalOptions?.nodeId,
    sessionId = terminalOptions?.sessionId;
  const identity = `${projectId}/${nodeId}/${sessionId ?? '*'}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;

  useEffect(() => {
    if (!api || !projectId || !nodeId || !host.current) return;
    let alive = true,
      detach = () => {},
      current: TerminalSession | null = null,
      attachment = 0,
      observation = 0,
      operation = 0,
      pending = false,
      discoveryDone = false,
      autoFailed = false,
      automaticRecoveryUsed = false,
      recoveringExit: string | undefined,
      retryRequested = false,
      replayPending = 0,
      resizeTimer: ReturnType<typeof setTimeout> | undefined,
      recoveryTimer: ReturnType<typeof setTimeout> | undefined,
      readyTimer: ReturnType<typeof setTimeout> | undefined;
    let input: ReturnType<typeof acquireTerminalInput> | undefined;
    const live = () => alive && currentIdentity.current === identity;
    const mayLaunch = () => !sessionId && options.current?.autoStart !== false && options.current?.inputOwner !== false;
    const surface = getComputedStyle(host.current.parentElement!);
    const term = new Terminal({
      fontSize: 11,
      fontFamily: 'ui-monospace, monospace',
      cursorBlink: true,
      scrollback: 2000,
      theme: {
        background: surface.backgroundColor || '#10141c',
        foreground: surface.color || '#d9e1ee',
        cursor: surface.color || '#67e8f9',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    setSession(null);
    setError('');
    setRetryable(false);
    setInputBlocked(false);
    setConnection('Checking sessions');
    const failure = (e: unknown) => {
      if (live()) setError(e instanceof Error ? e.message : String(e));
    };
    const launchFailed = (e: unknown) => {
      autoFailed = true;
      setRetryable(true);
      setConnection('Connection failed');
      failure(e);
    };
    const endInput = () => {
      input?.release(true);
      input = undefined;
      setInputBlocked(false);
    };
    const matches = (s: TerminalSession) => s.projectId === projectId && s.nodeId === nodeId;
    const resize = () => {
      clearTimeout(resizeTimer);
      if (!live() || !host.current?.clientWidth || !host.current.clientHeight) return;
      fit.fit();
      if (options.current?.resizeOwner === false) return;
      const id = current?.id, generation = attachment;
      resizeTimer = setTimeout(() => {
        if (live() && options.current?.resizeOwner !== false && attachment === generation && id &&
          current?.id === id && current.status === 'running' && host.current?.clientWidth && host.current.clientHeight)
          void api.resize(id, term.cols, term.rows).catch(e => { if (attachment === generation) failure(e); });
      }, 100);
    };
    const scheduleReady = (retry = false) => {
      if (retry) retryRequested = true;
      clearTimeout(readyTimer);
      readyTimer = setTimeout(() => { void ensureReady(); }, 0);
    };
    const exited = (s: TerminalSession) => {
      endInput();
      clearTimeout(recoveryTimer);
      if (s.id === recoveringExit) return;
      setConnection(`Exited (${s.exitCode ?? 'unknown'})`);
      if (s.exitCode !== 0) {
        // An unavailable process owner has no shell exit status. Recover once;
        // repeated immediate failures remain visible instead of spawning forever.
        if (s.exitCode === null && mayLaunch() && !automaticRecoveryUsed) {
          automaticRecoveryUsed = true;
          recoveringExit = s.id;
          setConnection('Recovering terminal');
          setError('');
          scheduleReady(true);
          return;
        }
        if (!sessionId) launchFailed(new Error(`Shell exited (${s.exitCode ?? 'unknown'}). Retry to open a new shell.`));
      } else if (mayLaunch()) scheduleReady();
    };
    const attach = (s: TerminalSession, focus = false) => {
      if (!live() || !matches(s)) return;
      const generation = ++attachment;
      let initialReplay = true;
      replayPending = 0;
      detach();
      input?.release();
      clearTimeout(resizeTimer);
      term.reset();
      current = s;
      clearTimeout(recoveryTimer);
      if (s.status === 'running') recoveryTimer = setTimeout(() => {
        if (live() && current?.id === s.id && current.status === 'running') {
          automaticRecoveryUsed = false;
          recoveringExit = undefined;
        }
      }, 10000);
      setSession(s);
      setError('');
      setRetryable(false);
      setConnection('Connecting');
      const attached = () => live() && attachment === generation && current?.id === s.id;
      input = acquireTerminalInput(api, s.id, message => {
        if (attached()) { setError(message); setInputBlocked(Boolean(message)); }
      });
      setInputBlocked(input.blocked());
      detach = api.listen(s.id, 0, event => {
        if (!attached() || event.session.id !== s.id || !matches(event.session)) return;
        ++observation;
        const replay = initialReplay || event.reset;
        initialReplay = false;
        if (replay) {
          ++replayPending;
          term.options.disableStdin = true;
          setConnection('Replaying terminal state');
        }
        if (event.reset) {
          // Queue reset with historical bytes so parsing and response suppression stay ordered.
          term.write('\x1bc[Earlier output was truncated]\r\n');
        }
        for (const chunk of event.chunks) term.write(chunk.data);
        if (replay) term.write('', () => {
          if (!attached()) return;
          replayPending = Math.max(0, replayPending - 1);
          if (!replayPending) {
            term.options.disableStdin = false;
            if (!autoFailed) setConnection(current?.status === 'running' ? 'Connected' : `Exited (${current?.exitCode ?? 'unknown'})`);
          }
        });
        const wasRunning = current?.status === 'running';
        current = event.session;
        setSession(event.session);
        if (event.session.status === 'exited') {
          if (wasRunning || replay) exited(event.session);
        } else {
          if (!input?.blocked()) setError('');
          if (!replayPending) setConnection('Connected');
        }
      }, () => {
        if (!attached() || current?.status !== 'running') return;
        setConnection('Reconnecting');
        const observed = observation;
        void api.inspect(s.id).then(value => {
          if (!attached() || observation !== observed || value.id !== s.id || !matches(value)) return;
          ++observation;
          current = value;
          setSession(value);
          if (value.status === 'exited') exited(value);
        }).catch(e => {
          if (!attached() || observation !== observed) return;
          if (e instanceof ApplicationError && e.code === 'TERMINAL_NOT_FOUND') {
            detach();
            ++attachment;
            current = null;
            endInput();
            setSession(null);
            setConnection('Session unavailable');
            scheduleReady();
          } else failure(e);
        });
      });
      resize();
      if (focus && mayLaunch()) term.focus();
    };
    async function ensureReady() {
      const value = options.current;
      if (!live() || !value || !discoveryDone || !mayLaunch() || pending || current?.status === 'running') return;
      const retry = retryRequested;
      retryRequested = false;
      const request = ++operation;
      pending = true;
      try {
        // Adopt a running process before considering new settings. Never replace a live job.
        const sessions = await api!.list(projectId!);
        if (!live() || request !== operation || !mayLaunch()) return;
        const existing = sessions.findLast(s => matches(s) && s.status === 'running');
        const latest = sessions.findLast(matches);
        // Session history is the failure authority across presentations and reloads.
        // A running process always wins. Known failures require explicit Retry;
        // unknown owner loss gets the bounded recovery in exited().
        if (!existing && !retry) {
          if (latest?.status === 'exited' && latest.exitCode !== 0) {
            if (current?.id !== latest.id) attach(latest);
            exited(latest);
            return;
          }
          if (autoFailed) return;
        }
        autoFailed = false;
        setRetryable(false);
        setError('');
        setConnection('Connecting');
        // Saved fork provenance binds the exact source policy for the first launch.
        // Later generations use this node's settings, independently of its ancestor.
        const parentSessionId = sessions.some(matches) ? undefined : value.parentSessionId;
        const s = existing ?? await api!.create({
          projectId: projectId!, nodeId: nodeId!, cwd: value.cwd, shell: value.shell,
          ownership: value.ownership, parentSessionId,
          cols: term.cols, rows: term.rows,
        });
        if (!live() || request !== operation) return;
        if (!matches(s)) throw new Error('Terminal session identity changed');
        attach(s, !existing);
        value.onStarted?.(s);
      } catch (e) {
        if (live() && request === operation) launchFailed(e);
      } finally {
        if (live() && request === operation) {
          pending = false;
          if (retryRequested && mayLaunch()) scheduleReady();
        }
      }
    }
    const inputListener = term.onData(data => {
      if (!live() || replayPending || current?.status !== 'running' || options.current?.inputOwner === false) return;
      try { input?.push(data); } catch (e) { failure(e); }
    });
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    resize();
    const discovery = operation;
    const discovered = (s: TerminalSession | undefined) => {
      if (!live() || discovery !== operation) return;
      discoveryDone = true;
      if (s && matches(s)) {
        attach(s);
        if (s.status === 'running') options.current?.onStarted?.(s);
        else exited(s);
      } else {
        current = null;
        setSession(null);
        setConnection('Ready');
        scheduleReady();
      }
    };
    // Historical selections inspect their exact ID and never launch a replacement.
    void (sessionId ? api.inspect(sessionId).then(s => {
      if (s.id !== sessionId || !matches(s)) throw new Error('Terminal session identity changed');
      discovered(s);
    }) : api.list(projectId).then(sessions => discovered(sessions.findLast(s => matches(s) && s.status === 'running') ?? sessions.findLast(matches)))).catch(e => {
      if (!live() || discovery !== operation) return;
      discoveryDone = true;
      launchFailed(e);
    });
    actions.current = {
      ensureReady: scheduleReady,
      resize,
      resumeInput() {
        try { input?.discardUnsent(); setInputBlocked(false); setError(''); } catch (e) { failure(e); }
      },
    };
    return () => {
      alive = false;
      ++attachment;
      ++operation;
      detach();
      observer.disconnect();
      input?.release();
      clearTimeout(resizeTimer);
      clearTimeout(readyTimer);
      clearTimeout(recoveryTimer);
      inputListener.dispose();
      term.dispose();
      actions.current = null;
    };
  }, [api, projectId, nodeId, sessionId, identity]);
  useEffect(() => {
    actions.current?.resize();
    actions.current?.ensureReady();
  }, [terminalOptions?.resizeOwner, terminalOptions?.inputOwner, terminalOptions?.autoStart]);
  useEffect(() => {
    actions.current?.ensureReady();
  }, [terminalOptions?.cwd, terminalOptions?.shell, terminalOptions?.ownership?.mode,
    terminalOptions?.ownership?.ownerId, terminalOptions?.parentSessionId]);

  const instance = terminalOptions?.instanceId ?? `canvas.${projectId}.${nodeId}`;
  const source = 'plugins/ui-terminal/src/view.tsx';
  return (
    <div
      className="devlab-terminal"
      data-testid={terminalOptions?.instanceId ? `terminal-${terminalOptions.instanceId}` : `terminal-${nodeId}`}
      data-devlab-id={`terminal.${instance}`}
      data-devlab-source={source}
      data-terminal-session-id={session?.id ?? ''}
      data-terminal-connection={connection}
      data-resize-owner={terminalOptions?.resizeOwner !== false}
      data-input-owner={terminalOptions?.inputOwner !== false}
    >
      <span className="terminal-status" role="status" data-testid="terminal-status"
        data-devlab-id={`terminal.${instance}.status`} data-devlab-source={source}>{connection}</span>
      <div className="terminal-screen" ref={host} aria-label="Terminal screen"
        data-devlab-id={`terminal.${instance}.screen`} data-devlab-source={source} />
      {error && <div className="terminal-error" role="alert"
        data-devlab-id={`terminal.${instance}.error`} data-devlab-source={source}>
        <div className="terminal-error-message">{error}</div>
        <div className="terminal-error-actions">
        {inputBlocked && <button type="button" onClick={() => actions.current?.resumeInput()}
          data-devlab-id={`terminal.${instance}.resume-input`} data-devlab-source={source}
        >Discard unsent input and continue</button>}
        {retryable && !sessionId && terminalOptions?.inputOwner !== false && <button type="button"
          onClick={() => actions.current?.ensureReady(true)}
          data-devlab-id={`terminal.${instance}.retry`} data-devlab-source={source}
        >Retry connection</button>}
        </div>
      </div>}
    </div>
  );
}
