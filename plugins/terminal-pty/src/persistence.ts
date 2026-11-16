import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, readdir, rename, rm, writeFile, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { TerminalSessionSchema, type TerminalReplay, type TerminalSession } from '@devlab/contracts';

const execute = promisify(execFile);
const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/;

async function processIdentity(pid: number) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? null;
  } catch { return null; }
}

export async function lockController(file: FileHandle) {
  // Linux flock belongs to the shared open-file description. Python only acquires it;
  // the retained Node descriptor holds it after the helper exits and across metadata writes.
  const helper = spawn('python3', ['-c', 'import fcntl,sys\ntry: fcntl.flock(3,fcntl.LOCK_EX|fcntl.LOCK_NB)\nexcept BlockingIOError: sys.exit(73)\nprint("locked",flush=True)'],
    { stdio: ['ignore', 'pipe', 'ignore', file.fd], timeout: 3000, killSignal: 'SIGKILL' });
  await new Promise<void>((ready, reject) => {
    let output = '';
    helper.once('error', reject);
    helper.stdout!.on('data', data => { output += String(data); if (output.length > 128) helper.kill('SIGKILL'); });
    helper.once('close', code => {
      if (code === 0 && output === 'locked\n') ready();
      else reject(new Error(code === 73 ? 'Terminal state is already controlled by a running backend' : 'Terminal controller lock helper failed'));
    });
  });
}

export type SavedTerminal = {
  version: 1;
  session: TerminalSession;
  chunks: TerminalReplay['chunks'];
  root: string;
  socket: string;
  scratch?: string;
  processIdentity: string | null;
  /** Stable private history key; legacy records fall back to observed file mtime. */
  order?: number;
};

/** Private mappings are app state; tmux remains the independent process owner. */
export class TerminalPersistence {
  readonly directory: string;
  readonly sockets: string;
  readonly tmux: string;
  private queue: Promise<void> = Promise.resolve();
  private readonly lease = randomUUID();
  private lock?: FileHandle;
  private readonly orders = new Map<string, number>();
  private lastOrder = 0;
  private orderReady = false;

  constructor(directory: string, tmux: string) {
    this.directory = resolve(directory);
    this.tmux = tmux;
    const key = createHash('sha256').update(this.directory).digest('hex').slice(0, 16);
    this.sockets = join(tmpdir(), `devlab-term-${process.getuid?.() ?? 'user'}-${key}`);
  }

  async init() {
    if (this.lock) throw new Error('Terminal controller is already initialized');
    for (const path of [this.directory, this.sockets]) {
      await mkdir(path, { recursive: true, mode: 0o700 });
      const stat = await lstat(path);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid()))
        throw new Error('Terminal state directory must be privately owned');
      await chmod(path, 0o700);
    }
    // Never unlink this inode: otherwise two controllers could lock different files.
    const file = await open(join(this.directory, 'owner.lock'), constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    const path = join(this.directory, 'owner.json'), temporary = path + '.' + randomUUID() + '.tmp';
    let published = false;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || (process.getuid && stat.uid !== process.getuid()))
        throw new Error('Unsafe terminal controller lock');
      await file.chmod(0o600);
      await lockController(file);
      const prior = await this.owner();
      // Older backends have no flock. Preserve their active PID + start-time identity.
      if (prior && Number.isSafeInteger(prior.pid) && Number(prior.pid) > 0 && typeof prior.identity === 'string' &&
          await processIdentity(Number(prior.pid)) === prior.identity)
        throw new Error('Terminal state is already controlled by a running backend');
      const identity = await processIdentity(process.pid);
      if (!identity) throw new Error('Terminal controller process identity is unavailable');
      const metadata = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try { await metadata.writeFile(JSON.stringify({ pid: process.pid, identity, lease: this.lease })); await metadata.sync(); }
      finally { await metadata.close(); }
      await rename(temporary, path); published = true;
      await this.syncDirectory();
      this.lock = file;
    } finally {
      if (this.lock !== file) {
        try {
          await rm(temporary, { force: true });
          if (published && (await this.owner())?.lease === this.lease) await rm(path);
        } finally { await file.close(); }
      }
    }
  }

  private async owner(): Promise<Record<string, unknown> | null> {
    let file: FileHandle;
    try { file = await open(join(this.directory, 'owner.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096 || (process.getuid && stat.uid !== process.getuid()))
        throw new Error('Unsafe terminal controller metadata');
      let value: unknown;
      try { value = JSON.parse(await file.readFile('utf8')); }
      catch (error) { if (error instanceof SyntaxError) return null; throw error; }
      return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
    } finally { await file.close(); }
  }

  private async syncDirectory() {
    const directory = await open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY);
    try { await directory.sync(); } finally { await directory.close(); }
  }

  socket(id: string) {
    if (!uuid.test(id)) throw new Error('Invalid persistent terminal ID');
    return join(this.sockets, id + '.sock');
  }

  async command(socket: string, args: string[], env?: Record<string, string>, independentLifetime = false) {
    if (resolve(socket) !== this.socket(basename(socket, '.sock')))
      throw new Error('Persistent terminal socket is outside its private owner');
    const argv = ['-S', socket, '-f', '/dev/null', ...args];
    const scoped = independentLifetime && process.platform === 'linux';
    // A detached daemon still inherits the backend's cgroup. Give preserved owners
    // a user scope; connect using host credentials, then restore the shell's exact
    // allowlisted environment (including Strict's private HOME/runtime directory).
    const result = await execute(scoped ? '/usr/bin/systemd-run' : this.tmux, scoped
      ? ['--user', '--scope', '--quiet', '--collect', '--unit=devlab-terminal-' + basename(socket, '.sock'), '--',
        '/usr/bin/env', '-i', ...Object.entries(env ?? {}).map(([key, value]) => key + '=' + value), this.tmux, ...argv]
      : argv, {
      env: scoped ? process.env : env, timeout: 5000, maxBuffer: 8 * 1024 * 1024,
    });
    return result.stdout;
  }

  async start(saved: SavedTerminal, launch: { executable: string; args: string[]; cwd: string; env: Record<string, string> }, independentLifetime = false) {
    // Multiple argv entries are executed directly by tmux, never interpolated into shell text.
    await this.command(saved.socket, ['new-session', '-d', '-s', 'devlab', '-x', String(saved.session.cols),
      '-y', String(saved.session.rows), '-c', launch.cwd, launch.executable, ...launch.args], launch.env, independentLifetime);
    await this.command(saved.socket, ['set-option', '-t', 'devlab', 'remain-on-exit', 'on']);
    await this.command(saved.socket, ['set-option', '-t', 'devlab', 'status', 'off']);
    await this.command(saved.socket, ['set-option', '-t', 'devlab', 'history-limit', '2000']);
    const state = await this.inspect(saved.socket);
    if (!state.pid) throw new Error('tmux did not expose its owned shell PID');
    return state;
  }

  async inspect(socket: string) {
    const value = (await this.command(socket, ['display-message', '-p', '-t', 'devlab:0.0',
      '#{pane_pid}|#{pane_dead}|#{pane_dead_status}|#{pane_width}|#{pane_height}|#{pane_dead_signal}'])).trim().split('|');
    return { pid: Number(value[0]), dead: value[1] === '1', exitCode: value[2] ? Number(value[2]) : null,
      cols: Number(value[3]), rows: Number(value[4]) };
  }

  async capture(socket: string) {
    return this.command(socket, ['capture-pane', '-p', '-e', '-t', 'devlab:0.0', '-S', '-2000']);
  }

  async stop(socket: string) {
    try { await this.command(socket, ['kill-server']); }
    catch (error) {
      const message = String((error as { stderr?: string }).stderr ?? error);
      if (!/no server running|error connecting|failed to connect|No such file/.test(message)) throw error;
    }
    await rm(socket, { force: true });
  }

  save(saved: SavedTerminal) {
    // Snapshot before queueing: callers continue to append output independently.
    const snapshot = structuredClone(saved);
    const output = join(this.directory, saved.session.id + '.json');
    const pending = this.queue.then(async () => {
      if (!this.orderReady) await this.load();
      let order = this.orders.get(snapshot.session.id);
      if (order === undefined) {
        order = Math.max(Date.now(), Math.floor(this.lastOrder) + 1);
        if (!Number.isSafeInteger(order)) throw new Error('Persistent terminal history order is exhausted');
        this.orders.set(snapshot.session.id, order); this.lastOrder = order;
      }
      const text = JSON.stringify({ ...snapshot, order });
      const temporary = output + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(temporary, text, { mode: 0o600 });
        await rename(temporary, output);
      } finally { await rm(temporary, { force: true }); }
    });
    this.queue = pending.catch(() => {});
    return pending;
  }

  async load() {
    const records: SavedTerminal[] = [];
    for (const name of (await readdir(this.directory)).sort()) {
      if (!name.endsWith('.json') || !uuid.test(name.slice(0, -5))) continue;
      const path = join(this.directory, name);
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 20 * 1024 * 1024)
        throw new Error('Invalid persistent terminal record');
      const saved: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (!saved || typeof saved !== 'object') throw new Error('Invalid persistent terminal record');
      const record = saved as SavedTerminal;
      record.session = TerminalSessionSchema.parse(record.session);
      if (record.version !== 1 || record.session.id + '.json' !== name ||
          record.socket !== this.socket(record.session.id) || typeof record.root !== 'string' ||
          (record.order !== undefined && (typeof record.order !== 'number' || !Number.isFinite(record.order) || Math.abs(record.order) > Number.MAX_SAFE_INTEGER)) ||
          !Array.isArray(record.chunks) || !record.chunks.every(chunk =>
            Number.isSafeInteger(chunk.seq) && chunk.seq > 0 && typeof chunk.data === 'string'))
        throw new Error('Invalid persistent terminal identity');
      // Old editions did not record creation order. Mtime is a deterministic fallback,
      // not a proven creation timestamp; retain it if that record is saved again.
      record.order = this.orders.get(record.session.id) ?? record.order ?? stat.mtimeMs;
      this.orders.set(record.session.id, record.order);
      this.lastOrder = Math.max(this.lastOrder, record.order);
      records.push(record);
    }
    this.orderReady = true;
    return records.sort((a, b) => a.order! - b.order! || a.session.id.localeCompare(b.session.id));
  }

  async remove(id: string) {
    await this.queue;
    await rm(join(this.directory, id + '.json'), { force: true });
    this.orders.delete(id);
  }

  async flush() { await this.queue; }

  async release() {
    const file = this.lock;
    if (!file) return;
    this.lock = undefined;
    try {
      await this.flush();
      if ((await this.owner())?.lease !== this.lease) throw new Error('Terminal controller lease changed unexpectedly');
      await rm(join(this.directory, 'owner.json'));
      await this.syncDirectory();
    } finally { await file.close(); }
  }
}
