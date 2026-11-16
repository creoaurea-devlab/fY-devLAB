import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir, userInfo } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { IPty } from 'node-pty';
import { ApplicationError, canonicalJson, OwnershipSegmentSchema, ownershipMatchesPath, TerminalCreateSchema, TerminalInputSchema, TerminalSizeSchema,
  type PluginDefinition, type TerminalOwnership, type TerminalOwnerships, type TerminalReplay, type TerminalSession } from '@devlab/contracts';
import { prepareConfinement, strictAvailability } from './confinement.ts';
import { TerminalPersistence, type SavedTerminal } from './persistence.ts';
export { lockController } from './persistence.ts';

const execute = promisify(execFile);
const definitionsReader = fileURLToPath(new URL('../../../.agents/data/definitions.py', import.meta.url));
type RecordState = {
  session: TerminalSession; root: string; pty: IPty | null; chunks: TerminalReplay['chunks']; bytes: number;
  listeners: Set<() => void>; exited: Promise<void>; resolveExit: () => void; identity: string | null;
  socket?: string; scratch?: string; disposeConfinement?: () => Promise<void>;
  poll?: ReturnType<typeof setTimeout>; dirty?: ReturnType<typeof setTimeout>; closing?: Promise<TerminalSession>;
  checking?: Promise<void>;
  deadSince?: number; ownerFailures?: number;
};
type Owner = { id: string; label: string; files: string[] };

async function processIdentity(pid: number): Promise<string | null> {
  try { const stat = await readFile(`/proc/${pid}/stat`, 'utf8'); return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? null; }
  catch { return null; }
}
async function sameLiveProcess(pid: number, identity: string | null): Promise<boolean> {
  if (!identity) return false;
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return fields[19] === identity && fields[0] !== 'Z' && fields[0] !== 'X';
  } catch { return false; }
}
async function observedExitStatus(pid: number, identity: string | null): Promise<number | null> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    if (fields[0] !== 'Z' || fields[19] !== identity) return null;
    const status = Number(fields[49]);
    if (!Number.isInteger(status) || status < 0) return null;
    return (status & 0x7f) === 0 ? (status >>> 8) & 0xff : 128 + (status & 0x7f);
  } catch { return null; }
}
async function descendants(pid: number): Promise<Map<number, string>> {
  const found = new Map<number, string>();
  async function visit(parent: number) {
    let children: string;
    try { children = await readFile(`/proc/${parent}/task/${parent}/children`, 'utf8'); } catch { return; }
    for (const value of children.trim().split(/\s+/)) {
      const child = Number(value); if (!child || found.has(child)) continue;
      const identity = await processIdentity(child); if (!identity) continue;
      found.set(child, identity); await visit(child);
    }
  }
  await visit(pid); return found;
}
async function signalChildren(children: Map<number, string>, signal: NodeJS.Signals) {
  for (const [pid, identity] of [...children].reverse()) {
    if ((await processIdentity(pid)) !== identity) continue;
    try { process.kill(pid, signal); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  }
}
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const contained = (root: string, file: string) => { const path = relative(root, file); return !isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep); };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

/** The attached tmux client negotiates with its immediate host, not replay observers.
 * Answer only these outer-client probes. All other ANSI/application output is unchanged. */
function tmuxHostOutput(write: (data: string) => void, emit: (data: string) => void) {
  const probes: [string, string][] = [
    ['\x1b[c', '\x1b[?1;2c'], ['\x1b[>c', '\x1b[>0;276;0c'],
    ['\x1b[>q', '\x1bP>|XTerm(276)\x1b\\'],
    ['\x1b]10;?\x1b\\', '\x1b]10;rgb:dddd/dddd/dddd\x1b\\'],
    ['\x1b]11;?\x1b\\', '\x1b]11;rgb:1111/1111/1111\x1b\\'],
    ['\x1b]10;?\x07', '\x1b]10;rgb:dddd/dddd/dddd\x1b\\'],
    ['\x1b]11;?\x07', '\x1b]11;rgb:1111/1111/1111\x1b\\'],
  ];
  let pending = '';
  return (data: string) => {
    pending += data;
    let output = '';
    while (pending) {
      const escape = pending.indexOf('\x1b');
      if (escape === -1) { output += pending; pending = ''; break; }
      if (escape > 0) { output += pending.slice(0, escape); pending = pending.slice(escape); }
      const complete = probes.find(([query]) => pending.startsWith(query));
      if (complete) { write(complete[1]); pending = pending.slice(complete[0].length); continue; }
      if (probes.some(([query]) => query.startsWith(pending))) break;
      output += pending[0]; pending = pending.slice(1);
    }
    if (output) emit(output);
  };
}

export function terminalPty(options: {
  replayBytes?: number; stateDirectory?: string; registryPath?: string;
  tmuxPath?: string; preserveOnDispose?: boolean;
} = {}): PluginDefinition {
  const replayBytes = options.replayBytes ?? 1024 * 1024;
  if (replayBytes < 1024 || replayBytes > 4 * 1024 * 1024 ||
    (options.preserveOnDispose && (!options.stateDirectory || !options.tmuxPath))) throw new Error('Invalid terminal limits or persistence configuration');
  return {
    manifest: { id: 'terminal-pty', version: '1.1.0', apiVersion: 1, provides: ['terminals'], requires: ['workspace'], capabilities: ['terminal:local'], reload: 'restart' },
    async activate(scope) {
      const workspace = scope.get('workspace'), records = new Map<string, RecordState>();
      const persistence = options.stateDirectory && options.tmuxPath ? new TerminalPersistence(options.stateDirectory, options.tmuxPath) : null;
      if (persistence) await persistence.init();
      let alive = true, queue: Promise<unknown> = Promise.resolve();
      const active = () => { if (!alive) throw new ApplicationError('NOT_READY', 'Terminal host is closed'); };
      const record = (id: string) => { active(); const value = records.get(id); if (!value) throw new ApplicationError('TERMINAL_NOT_FOUND', 'Terminal session not found'); return value; };
      const snapshot = (r: RecordState): TerminalSession => ({ ...r.session, ...(r.session.ownership ? { ownership: { ...r.session.ownership } } : {}) });
      const notify = (r: RecordState) => { for (const listener of r.listeners) try { listener(); } catch { /* observer does not own process */ } };
      const saved = (r: RecordState): SavedTerminal => ({ version: 1, session: snapshot(r), root: r.root, socket: r.socket!, chunks: r.chunks.map(chunk => ({ ...chunk })), ...(r.scratch ? { scratch: r.scratch } : {}), processIdentity: r.identity });
      const save = (r: RecordState) => persistence && r.socket ? persistence.save(saved(r)) : Promise.resolve();
      const scheduleSave = (r: RecordState) => {
        if (!persistence || !r.socket || r.dirty) return;
        r.dirty = setTimeout(() => { r.dirty = undefined; void save(r).catch(error => append(r, '\r\n[Terminal state could not be saved: ' + errorText(error) + ']\r\n', false)); }, 150);
        r.dirty.unref();
      };
      function append(r: RecordState, data: string, persist = true) {
        for (let start = 0; start < data.length;) {
          let end = Math.min(data.length, start + Math.min(16384, Math.floor(replayBytes / 4)));
          if (end < data.length && data.charCodeAt(end - 1) >= 0xd800 && data.charCodeAt(end - 1) <= 0xdbff) end--;
          const text = data.slice(start, end); start = end;
          r.chunks.push({ seq: ++r.session.cursor, data: text }); r.bytes += Buffer.byteLength(text);
          while (r.bytes > replayBytes && r.chunks.length) r.bytes -= Buffer.byteLength(r.chunks.shift()!.data);
        }
        if (persist) scheduleSave(r); notify(r);
      }
      function makeRecord(session: TerminalSession, root: string): RecordState {
        let resolveExit!: () => void; const exited = new Promise<void>(resolve => { resolveExit = resolve; });
        return { session, root, pty: null, chunks: [], bytes: 0, listeners: new Set(), exited, resolveExit, identity: null };
      }
      async function cleanupScratch(r: RecordState) {
        if (r.disposeConfinement) { await r.disposeConfinement(); r.disposeConfinement = undefined; }
        if (r.scratch && ((options.stateDirectory && resolve(r.scratch) === resolve(options.stateDirectory, 'scratch', r.session.id)) ||
          r.scratch === join(tmpdir(), 'devlab-strict-' + r.session.id))) await rm(r.scratch, { recursive: true, force: true });
      }
      async function finishExit(r: RecordState, exitCode: number | null) {
        if (r.session.status === 'exited') return;
        r.session.status = 'exited'; r.session.exitCode = exitCode; clearTimeout(r.poll); r.poll = undefined;
        const attachment = r.pty; r.pty = null;
        if (r.socket) try { attachment?.kill('SIGHUP'); } catch { /* client already detached */ }
        r.resolveExit(); notify(r); await save(r); await cleanupScratch(r);
      }
      function observeTmux(r: RecordState) {
        if (!persistence || !r.socket || r.poll || r.checking || !alive || r.session.status !== 'running' || r.closing) return;
        const check = async () => {
          try {
            const current = await persistence.inspect(r.socket!);
            if (!alive || r.closing || r.session.status !== 'running') return;
            if (current.dead) {
              // tmux can observe PTY EOF before SIGCHLD supplies the exit status.
              r.deadSince ??= Date.now();
              const code = current.exitCode ?? await observedExitStatus(r.session.pid, r.identity);
              if (code !== null || Date.now() - r.deadSince >= 1000) {
                await finishExit(r, code); await persistence.stop(r.socket!);
              }
            } else {
              if (current.pid !== r.session.pid || await processIdentity(current.pid) !== r.identity)
                throw new Error('Persistent shell identity changed');
              r.deadSince = undefined;
              if (!r.pty) await attach(r, environment());
            }
            r.ownerFailures = 0;
          }
          catch (error) { if (alive && !r.closing && r.session.status === 'running') {
            // A failed control request does not establish process death. Keep the
            // exact PID/start-time owner and retry attachment without replacing it.
            const liveOwner = await sameLiveProcess(r.session.pid, r.identity);
            if (!alive || r.closing || r.session.status !== 'running') return;
            if (liveOwner) {
              if (!r.ownerFailures) append(r, '\r\n[Terminal connection interrupted; reconnecting to the existing shell.]\r\n');
              r.ownerFailures = (r.ownerFailures ?? 0) + 1;
            } else {
              append(r, '\r\n[Terminal process owner became unavailable: ' + errorText(error) + ']\r\n');
              await finishExit(r, await observedExitStatus(r.session.pid, r.identity));
            }
          } }
        };
        r.poll = setTimeout(() => {
          r.poll = undefined;
          r.checking = check().catch(error => {
            if (alive) append(r, '\r\n[Terminal recovery failed: ' + errorText(error) + ']\r\n', false);
          }).finally(() => { r.checking = undefined; observeTmux(r); });
        }, Math.min(5000, 250 * 2 ** Math.min(r.ownerFailures ?? 0, 5))); r.poll.unref();
      }
      async function attach(r: RecordState, env: Record<string, string>) {
        const { spawn } = await import('node-pty');
        if (!alive || r.closing || r.session.status !== 'running' || r.pty) return;
        const pty = spawn(options.tmuxPath!, ['-S', r.socket!, '-f', '/dev/null', 'attach-session', '-t', 'devlab'], { name: 'xterm-256color', cols: r.session.cols, rows: r.session.rows, cwd: r.root, env });
        r.pty = pty;
        const bridge = tmuxHostOutput(data => pty.write(data), data => { if (alive) append(r, data); });
        pty.onData(bridge);
        pty.onExit(() => { if (r.pty === pty) r.pty = null; if (alive && !r.closing && r.session.status === 'running') notify(r); });
      }
      const environment = (): Record<string, string> => {
        const env: Record<string, string> = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: homedir(), USER: userInfo().username, LANG: 'C.UTF-8', TERM: 'xterm-256color', COLORTERM: 'truecolor' };
        for (const key of ['XDG_RUNTIME_DIR', 'PULSE_SERVER', 'PULSE_SINK', 'PULSE_SOURCE', 'PIPEWIRE_REMOTE']) if (process.env[key]) env[key] = process.env[key]!;
        return env;
      };
      async function ownerCatalogue(projectId: string): Promise<{ root: string; owners: Owner[]; revision: string }> {
        const root = await realpath(await workspace.resolve(projectId, '.'));
        const python = process.env.DEVLAB_PYTHON ?? (process.platform === 'linux' ? '/usr/bin/python3' : 'python3');
        if (process.env.DEVLAB_PYTHON !== undefined && !isAbsolute(python)) throw new ApplicationError('SERVICE_UNAVAILABLE', 'DEVLAB_PYTHON must be an absolute trusted host executable with PyYAML');
        if (!options.registryPath || projectId !== 'default') {
          const markers = ['.agents/plans/authority.yaml', '.agents/state/memory.sqlite', '.wisdohm/memory.sqlite', '.context/modules/registry.yaml'];
          const present = await Promise.all(markers.map(async name => { try { await stat(join(root, name)); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }));
          if (!present.some(Boolean)) return { root, owners: [], revision: '' };
          try {
            const parsed = await execute(python, ['-I', '-B', definitionsReader, 'ownership', '--root', root], { timeout: 6000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' });
            const segments = OwnershipSegmentSchema.array().max(256).parse(JSON.parse(parsed.stdout));
            return { root, owners: segments.map(owner => ({ id: owner.id, label: owner.id, files: owner.paths })), revision: createHash('sha256').update(canonicalJson(segments)).digest('hex') };
          } catch (error) {
            let reason = String((error as { stderr?: string }).stderr || errorText(error)).trim();
            try {
              const value = JSON.parse(reason);
              if (typeof value.error === 'string') reason = value.error;
            } catch { /* Interpreter failures need their original diagnostic. */ }
            if (/No module named ['"]yaml/.test(reason))
              reason = 'The trusted host Python needs PyYAML. Configure DEVLAB_PYTHON with an installed interpreter.';
            throw new ApplicationError('SERVICE_UNAVAILABLE', 'Ownership definitions are unavailable: ' + reason.replace(/\s+/g, ' ').slice(0, 400));
          }
        }
        const registry = options.registryPath && projectId === 'default' ? resolve(options.registryPath) : join(root, '.context/modules/registry.yaml');
        if (!contained(root, registry)) throw new ApplicationError('INVALID_INPUT', 'Ownership registry is outside project');
        let text: string;
        try { text = await readFile(registry, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { root, owners: [], revision: '' }; throw error; }
        if (Buffer.byteLength(text) > 1024 * 1024) throw new ApplicationError('INVALID_INPUT', 'Ownership registry is too large');
        const parsed = await execute(python, ['-I', '-B', '-c', 'import json,sys,yaml; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))', registry], { timeout: 5000, maxBuffer: 2 * 1024 * 1024 });
        if (text !== await readFile(registry, 'utf8')) throw new ApplicationError('CONFLICT', 'Ownership registry changed while resolving policy');
        const document = JSON.parse(parsed.stdout) as { modules?: Record<string, { paths?: unknown }> };
        if (!document?.modules || typeof document.modules !== 'object' || Array.isArray(document.modules)) throw new ApplicationError('INVALID_INPUT', 'Ownership registry has no module declarations');
        const owners: Owner[] = [];
        for (const [id, value] of Object.entries(document.modules)) {
          if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !value || !Array.isArray(value.paths) || !value.paths.every(path => typeof path === 'string' && path.length > 0 && path.length <= 1024 && !path.includes('\0') && !isAbsolute(path) && contained(root, resolve(root, path)))) throw new ApplicationError('INVALID_INPUT', 'Invalid canonical ownership declaration');
          owners.push({ id, label: id, files: [...new Set(value.paths as string[])].sort() });
        }
        return { root, owners, revision: createHash('sha256').update(text).digest('hex') };
      }
      async function exactOwnerFiles(root: string, patterns: string[]): Promise<string[]> {
        const files = new Set<string>(); let visited = 0;
        for (const pattern of patterns) {
          if (!/[?*]/.test(pattern) && !pattern.endsWith('/')) { files.add(pattern); continue; }
          const wildcard = pattern.search(/[?*]/), prefix = wildcard < 0 ? pattern.slice(0, -1) : pattern.slice(0, pattern.lastIndexOf('/', wildcard) + 1);
          const start = resolve(root, prefix || '.');
          if (!contained(root, await realpath(start))) throw new ApplicationError('INVALID_INPUT', 'Owned pattern escapes project');
          const queue = [start];
          while (queue.length) {
            const directory = queue.pop()!;
            for (const entry of await readdir(directory, { withFileTypes: true })) {
              if (++visited > 10000) throw new ApplicationError('INVALID_INPUT', 'Owned pattern exceeds file discovery limit');
              const absolute = join(directory, entry.name), name = relative(root, absolute).split(sep).join('/');
              if (entry.isSymbolicLink()) continue;
              if (entry.isDirectory()) queue.push(absolute);
              else if (entry.isFile() && ownershipMatchesPath(name, pattern)) files.add(name);
            }
          }
        }
        if (files.size > 5000) throw new ApplicationError('INVALID_INPUT', 'Ownership grant exceeds file limit');
        return [...files].sort();
      }
      async function policy(projectId: string, input: TerminalOwnership): Promise<{effective: TerminalOwnership; root: string; files: string[]}> {
        if (input.mode !== 'off' && !input.ownerId) throw new ApplicationError('INVALID_INPUT', 'Select an ownership for Guided or Strict mode');
        if (!input.ownerId) return { effective: { mode: 'off' }, root: await realpath(await workspace.resolve(projectId, '.')), files: [] };
        const catalogue = await ownerCatalogue(projectId);
        const owner = catalogue.owners.find(item => item.id === input.ownerId);
        if (!owner) throw new ApplicationError('INVALID_INPUT', 'Ownership is not declared by this project');
        const files: string[] = [];
        // Guided/Off assignments are metadata. Only Strict grants filesystem access
        // and needs every declared path to resolve before a new shell can launch.
        for (const path of input.mode === 'strict' ? await exactOwnerFiles(catalogue.root, owner.files) : []) {
          const candidate = resolve(catalogue.root, path); let resolved: string;
          try { resolved = await realpath(candidate); } catch { throw new ApplicationError('INVALID_INPUT', 'An owned source path is unavailable: ' + path); }
          if (!contained(catalogue.root, resolved)) throw new ApplicationError('INVALID_INPUT', 'Owned path escapes project');
          files.push(candidate);
        }
        return { root: catalogue.root, files, effective: { mode: input.mode, ownerId: owner.id, revision: catalogue.revision } };
      }
      const running = (r: RecordState) => {
        if (r.session.status !== 'running' || r.closing) throw new ApplicationError('TERMINAL_EXITED', 'Terminal is stopped');
        if (!r.pty) throw new ApplicationError('NOT_READY', 'Terminal is reconnecting to its existing shell; try again shortly');
      };
      async function stop(r: RecordState): Promise<TerminalSession> {
        if (r.closing) return r.closing;
        if (r.session.status === 'exited') { if (r.socket && persistence) await persistence.stop(r.socket); await cleanupScratch(r); return snapshot(r); }
        r.closing = (async () => {
          clearTimeout(r.poll); r.poll = undefined; clearTimeout(r.dirty);
          const identity = await processIdentity(r.session.pid);
          const children = identity && identity === r.identity ? await descendants(r.session.pid) : new Map<number, string>();
          await signalChildren(children, 'SIGTERM');
          if (persistence && r.socket) { await persistence.stop(r.socket); try { r.pty?.kill('SIGTERM'); } catch { /* client already detached */ } await finishExit(r, 0); }
          else { try { r.pty?.kill('SIGTERM'); } catch (error) { if (r.session.status === 'running') throw error; } await Promise.race([r.exited, delay(750)]); }
          await signalChildren(children, 'SIGKILL');
          if (r.session.status === 'running') { r.pty?.kill('SIGKILL'); await Promise.race([r.exited, delay(1500)]); }
          if (r.session.status !== 'exited') throw new ApplicationError('TERMINAL_CLEANUP_FAILED', 'Terminal exit was not observed');
          await save(r); return snapshot(r);
        })().catch(error => { r.closing = undefined; observeTmux(r); throw error; }); return r.closing;
      }
      scope.onDispose(async () => {
        alive = false; await queue.catch(() => {});
        const results = await Promise.allSettled([...records.values()].map(async r => {
          clearTimeout(r.poll); clearTimeout(r.dirty);
          await r.checking;
          if (options.preserveOnDispose && persistence && r.socket) { await save(r); try { r.pty?.kill('SIGHUP'); } catch { /* attachment already ended */ } r.pty = null; }
          else await stop(r);
          r.listeners.clear();
        }));
        if (persistence) await persistence.release();
        const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'PTY cleanup failed');
      });
      if (persistence) for (const item of await persistence.load()) {
        const r = makeRecord(item.session, item.root); r.socket = item.socket; r.identity = item.processIdentity;
        r.chunks = item.chunks; r.bytes = item.chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.data), 0);
        if (item.scratch && options.stateDirectory && resolve(item.scratch) === resolve(options.stateDirectory, 'scratch', item.session.id)) r.scratch = item.scratch;
        records.set(r.session.id, r);
        if (r.session.status === 'running') {
          let projectVerified = false;
          try {
            const root = await realpath(await workspace.resolve(r.session.projectId, '.'));
            if (root !== r.root) throw new Error('Project root changed');
            projectVerified = true;
            const info = await persistence.inspect(r.socket);
            if (info.dead) { await finishExit(r, info.exitCode); await persistence.stop(r.socket); }
            else {
              if (info.pid !== r.session.pid || await processIdentity(info.pid) !== r.identity) throw new Error('Persistent shell identity changed');
              const capture = await persistence.capture(r.socket); r.chunks = []; r.bytes = 0;
              append(r, '\x1b[2J\x1b[H' + capture, false); await attach(r, environment()); await save(r);
            }
          } catch (error) {
            if (projectVerified && await sameLiveProcess(r.session.pid, r.identity)) {
              append(r, '\r\n[Terminal connection interrupted; reconnecting to the existing shell.]\r\n');
              r.ownerFailures = 1;
            } else {
              append(r, '\r\n[Persistent terminal could not be reattached: ' + errorText(error) + ']\r\n', false);
              await persistence.stop(r.socket).catch(() => {});
              await finishExit(r, null);
            }
          }
          observeTmux(r);
        } else r.resolveExit();
      }
      scope.provide('terminals', {
        attachManaged(command) {
          const pending = queue.then(async () => {
            active(); const release = scope.lease();
            try {
              TerminalSizeSchema.parse({ cols: command.cols, rows: command.rows });
              if (!command.nodeId.startsWith('herdr:') || !isAbsolute(command.executable))
                throw new ApplicationError('INVALID_INPUT', 'Invalid managed terminal identity.');
              const root = await workspace.resolve(command.projectId, '.');
              const existing = [...records.values()].find(r => r.session.projectId === command.projectId && r.session.nodeId === command.nodeId && r.session.status === 'running');
              if (existing) {
                if (existing.session.kind !== 'herdr') throw new ApplicationError('CONFLICT', 'Managed terminal identity is already owned.');
                return snapshot(existing);
              }
              const { spawn } = await import('node-pty');
              const pty = spawn(command.executable, command.args, { cwd: command.cwd, env: command.env, cols: command.cols, rows: command.rows, name: 'xterm-256color' });
              const r = makeRecord({ id: randomUUID(), projectId: command.projectId, nodeId: command.nodeId, kind: 'herdr', cwd: '/workspace', shell: 'bash', cols: command.cols, rows: command.rows, pid: pty.pid, status: 'running', exitCode: null, cursor: 0 }, root);
              r.pty = pty; r.identity = await processIdentity(pty.pid); records.set(r.session.id, r);
              pty.onData(data => append(r, data)); pty.onExit(({ exitCode }) => { void finishExit(r, exitCode); });
              return snapshot(r);
            } finally { release(); }
          }); queue = pending.catch(() => {}); return pending;
        },
        async ownerships(projectId): Promise<TerminalOwnerships> { active(); const value = await ownerCatalogue(projectId); return { owners: value.owners, strict: await strictAvailability() }; },
        create(input) {
          const command = TerminalCreateSchema.parse(input);
          if (command.nodeId.startsWith('herdr:')) throw new ApplicationError('PATH_DENIED', 'Herdr attachments are created by their runtime owner.');
          const pending = queue.then(async () => {
            active(); const release = scope.lease();
            let prepared: Awaited<ReturnType<typeof prepareConfinement>> | undefined; let created: RecordState | undefined;
            try {
              let requested: TerminalOwnership = command.ownership ?? { mode: 'off' }; let parent: RecordState | undefined;
              if (command.parentSessionId) {
                parent = record(command.parentSessionId);
                if (parent.session.kind === 'herdr') throw new ApplicationError('PATH_DENIED', 'Use Herdr pane controls for a managed runtime.');
                if (parent.session.projectId !== command.projectId || parent.session.nodeId === command.nodeId) throw new ApplicationError('INVALID_INPUT', 'Fork source must belong to this project and a different terminal');
                const inherited = parent.session.ownership ?? { mode: 'off' };
                if (command.ownership && (requested.mode !== inherited.mode || requested.ownerId !== inherited.ownerId)) throw new ApplicationError('CONFLICT', 'A fork must inherit its source ownership mode');
                requested = inherited;
              }
              const existing = [...records.values()].find(r => r.session.projectId === command.projectId && r.session.nodeId === command.nodeId && r.session.status === 'running' && !r.closing);
              if (existing) {
                const effective = existing.session.ownership ?? { mode: 'off' };
                if (requested.mode !== effective.mode || requested.ownerId !== effective.ownerId) throw new ApplicationError('CONFLICT', 'Running terminal ownership differs; stop it before changing policy');
                return snapshot(existing);
              }
              const resolved = await policy(command.projectId, requested);
              if (parent && requested.revision !== resolved.effective.revision) throw new ApplicationError('CONFLICT', 'Ownership changed since the source terminal started; review the new policy');
              const cwd = await workspace.resolve(command.projectId, command.cwd), shell = command.shell === 'bash' ? '/bin/bash' : '/bin/sh';
              // Discover instructions as data; never source a project's startup code.
              const agentEntry = await lstat(join(resolved.root, 'AGENTS.md')).then(
                info => info.isFile() ? 'present' : 'unavailable',
                error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unavailable');
              const args = command.shell === 'bash' ? ['--noprofile', '--norc', '-i'] : ['-i']; const id = randomUUID();
              let launch = { executable: shell, args, cwd, env: environment() };
              if (resolved.effective.mode === 'strict') {
                const availability = await strictAvailability();
                if (!availability.available) throw new ApplicationError('STRICT_UNAVAILABLE', availability.reason ?? 'Strict confinement is unavailable');
                const scratch = options.stateDirectory ? join(options.stateDirectory, 'scratch', id) : join(tmpdir(), 'devlab-strict-' + id);
                await mkdir(scratch, { recursive: true, mode: 0o700 });
                prepared = await prepareConfinement({ root: resolved.root, ownershipFiles: resolved.files, scratchRoot: scratch, executable: shell, args, cwd, env: launch.env });
                launch = { executable: prepared.executable, args: prepared.args, cwd: prepared.cwd, env: prepared.env };
              }
              const r = makeRecord({ ...command, id, cwd, ownership: resolved.effective, pid: 1, status: 'running', exitCode: null, cursor: 0 }, resolved.root); created = r;
              if (prepared) { r.scratch = options.stateDirectory ? join(options.stateDirectory, 'scratch', id) : join(tmpdir(), 'devlab-strict-' + id); r.disposeConfinement = prepared.dispose; }
              if (persistence) {
                r.socket = persistence.socket(id); const state = await persistence.start(saved(r), launch, options.preserveOnDispose);
                r.session.pid = state.pid; r.identity = await processIdentity(state.pid); await attach(r, environment());
              } else {
                const { spawn } = await import('node-pty');
                const pty = spawn(launch.executable, launch.args, { name: 'xterm-256color', cols: command.cols, rows: command.rows, cwd: launch.cwd, env: launch.env });
                r.pty = pty; r.session.pid = pty.pid; r.identity = await processIdentity(pty.pid);
                pty.onData(data => append(r, data)); pty.onExit(({ exitCode }) => { void finishExit(r, exitCode); });
              }
              records.set(id, r);
              observeTmux(r);
              append(r, agentEntry === 'present'
                ? '\r\n[Agent bootstrap: read the project-root AGENTS.md and .agents/DEVLAB.md (when present) before changes.]\r\n'
                : '\r\n[Agent bootstrap: project-root AGENTS.md is ' + agentEntry + '. Add project instructions before agent changes.]\r\n');
              if (resolved.effective.mode === 'guided') append(r, '\r\n[Guided ownership: ' + resolved.effective.ownerId + '. Advisory scope; filesystem writes are not restricted.]\r\n');
              if (resolved.effective.mode === 'strict') append(r, '\r\n[Strict ownership: ' + resolved.effective.ownerId + '. Only owned files and private scratch are writable; network and host IPC are disabled.]\r\n');
              await save(r); return snapshot(r);
            } catch (error) {
              if (created?.socket && persistence) await persistence.stop(created.socket).catch(() => {});
              try { created?.pty?.kill('SIGKILL'); } catch { /* failed launch already ended */ }
              if (prepared) await prepared.dispose(); throw error;
            } finally { release(); }
          }); queue = pending.catch(() => {}); return pending;
        },
        list(projectId) { active(); return [...records.values()].filter(r => r.session.projectId === projectId && r.session.kind !== 'herdr').map(snapshot); },
        inspect(id) { return snapshot(record(id)); },
        read(id, after) {
          if (!Number.isSafeInteger(after) || after < 0) throw new ApplicationError('INVALID_INPUT', 'Invalid output cursor');
          const r = record(id), earliest = r.chunks[0]?.seq ?? r.session.cursor + 1; const reset = after < earliest - 1 || after > r.session.cursor;
          return { session: snapshot(r), reset, chunks: r.chunks.filter(c => reset || c.seq > after).map(c => ({ ...c })) };
        },
        subscribe(id, listener) { const r = record(id); r.listeners.add(listener); return () => { r.listeners.delete(listener); }; },
        write(id, input) { const r = record(id); running(r); const { data } = TerminalInputSchema.parse({ data: input }); if (Buffer.byteLength(data) > 65536) throw new ApplicationError('INVALID_INPUT', 'Terminal input exceeds 64 KiB'); const release = scope.lease(); try { r.pty!.write(data); } finally { release(); } },
        resize(id, input) { const r = record(id); running(r); const size = TerminalSizeSchema.parse(input), release = scope.lease(); try { r.pty!.resize(size.cols, size.rows); Object.assign(r.session, size); } finally { release(); } scheduleSave(r); notify(r); },
        close(id) { return stop(record(id)); },
      });
    },
  };
}
