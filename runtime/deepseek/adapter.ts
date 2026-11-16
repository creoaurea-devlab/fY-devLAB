import { fork, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ApplicationError, canonicalJson, type DeepSeekPackage,
  type DeepSeekSelection, type DeepSeekProbe, type DeepSeekInventory } from '@devlab/contracts';
import { UPSTREAM_REVISION } from './catalogue.ts';

const sha = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
export const CORE_PACKAGES = ['session', 'llm', 'system-prompt', 'tools', 'session-projection', 'agent', 'tool-executor-native', 'agent-loop'].map(name => '@deepseek-ai/dsh-' + name);
const failure = (code: string, message: string) => new ApplicationError(code, message);
const safeEnvironment = (home: string, allowed: string[]) => ({ PATH: process.env.PATH ?? '/usr/bin:/bin',
  LANG: 'C.UTF-8', DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DEVLAB_DEEPSEEK_ALLOWED: JSON.stringify(allowed) });
export class NativeHarness {
  child: ChildProcess | undefined;
  private serial = 0;
  private pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private options: { release: string; home: string; packages: DeepSeekPackage[] };
  private closed = false;
  constructor(options: { release: string; home: string; packages: DeepSeekPackage[] }) { this.options = options; }
  async start() {
    if (this.closed) throw failure('NOT_READY', 'Harness process is closed');
    if (this.child) return;
    await mkdir(this.options.home, { recursive: true });
    if (this.closed) throw failure('NOT_READY', 'Harness was closed during startup');
    const child = this.child = fork(fileURLToPath(new URL('./worker.ts', import.meta.url)), [resolve(this.options.release)], {
      cwd: this.options.home, env: safeEnvironment(this.options.home, this.options.packages.filter(p => p.installed && p.platform && !p.private).map(p => p.id)),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], detached: process.platform !== 'win32', execArgv: [],
    });
    child.stdout?.resume(); child.stderr?.resume();
    child.on('message', (message: any) => {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      message.error ? pending.reject(failure('UPSTREAM_FAILURE', message.error)) : pending.resolve(message.result);
    });
    child.once('exit', () => { for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(failure('UPSTREAM_EXIT', 'Upstream child exited')); } this.pending.clear(); });
    await new Promise<void>((accept, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(failure('TIMEOUT', 'Harness startup timed out')); }, 10000);
      const message = (event: any) => { if (event.ready) { cleanup(); accept(); } };
      const exited = () => { cleanup(); reject(failure('UPSTREAM_EXIT', 'Harness exited before readiness')); };
      const cleanup = () => { clearTimeout(timer); child.off('message', message); child.off('exit', exited); };
      child.on('message', message); child.once('exit', exited); child.once('error', reject);
    }).catch(async error => { await this.close(); throw error; });
  }
  request(method: string, payload: Record<string, unknown> = {}, timeout = 12000): Promise<any> {
    if (!this.child?.connected || this.closed) return Promise.reject(failure('NOT_READY', 'Harness is not running'));
    const id = ++this.serial;
    return new Promise((accept, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(failure('TIMEOUT', 'Upstream operation timed out; stop or restart the child before retrying')); }, timeout);
      this.pending.set(id, { resolve: accept, reject, timer });
      this.child!.send({ id, method, ...payload }, error => { if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); } });
    });
  }
  async close() {
    if (this.closed) return;
    const child = this.child;
    if (!child) { this.closed = true; return; }
    if (child.connected) { try { await this.request('close', {}, 2000); } catch { /* Fallback below proves exit and reaps the owned process group. */ } }
    this.closed = true;
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>(accept => child.once('exit', () => accept()));
    try { process.kill(process.platform === 'win32' ? child.pid! : -child.pid!, 'SIGTERM'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    const force = setTimeout(() => { try { process.kill(process.platform === 'win32' ? child.pid! : -child.pid!, 'SIGKILL'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; } }, 2000);
    try { await exited; } finally { clearTimeout(force); }
  }
}
export class DeepSeekRuntime {
  packages: DeepSeekPackage[];
  private directory: string;
  private release: string;
  private native: NativeHarness;
  private selection: DeepSeekSelection[] = [];
  private previous: DeepSeekSelection[] | null = null;
  private tests = new Map<string, DeepSeekProbe>();
  private queue: Promise<unknown> = Promise.resolve();
  private testWrites: Promise<unknown> = Promise.resolve();
  private probes = new Set<NativeHarness>();
  private closing = false;
  constructor(options: { packages: DeepSeekPackage[]; release: string; directory: string }) {
    this.packages = options.packages; this.directory = options.directory; this.release = options.release;
    this.native = new NativeHarness({ release: this.release, home: join(this.directory, 'workspace'), packages: this.packages });
  }
  async start() {
    await mkdir(this.directory, { recursive: true });
    try { const state = JSON.parse(await readFile(join(this.directory, 'selection.json'), 'utf8')); this.selection = this.validate(state.selection); this.previous = state.previous === null ? null : this.validate(state.previous); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.selection = CORE_PACKAGES.map(id => ({ id, enabled: true, config: {} })); }
    try { const tests = JSON.parse(await readFile(join(this.directory, 'tests.json'), 'utf8')); for (const row of tests) this.tests.set(row.id, row); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await this.native.start(); await this.native.request('apply', { rows: this.selection });
  }
  private validate(rows: unknown): DeepSeekSelection[] {
    if (!Array.isArray(rows) || rows.length > 500 || Buffer.byteLength(JSON.stringify(rows)) > 131072) throw failure('INVALID_INPUT', 'Invalid selection');
    const seen = new Set<string>();
    for (const row of rows) {
      const item = this.packages.find(item => item.id === row?.id);
      if (!item || !item.installed || !item.platform || item.private || seen.has(row.id) || typeof row.enabled !== 'boolean' || row.config === undefined) throw failure('INVALID_INPUT', 'Package is unavailable, repeated or invalid');
      if (JSON.stringify(row.config).includes('"__jsExpr"')) throw failure('INVALID_INPUT', 'Use plain JSON configuration; executable expressions are reserved for trusted upstream bundles');
      seen.add(row.id);
    }
    return rows;
  }
  private revision() { return sha({ selection: this.selection, previous: this.previous }); }
  async inventory(): Promise<DeepSeekInventory> {
    return { name: 'DeepSeek Harness Runtime', revision: this.revision(), packages: this.packages,
      entries: await this.native.request('snapshot'), tests: [...this.tests.values()], running: true, upstreamRevision: UPSTREAM_REVISION };
  }
  configure(expected: string, id: string, enabled: boolean, config: unknown) {
    const operation = this.queue.then(async () => {
      if (expected !== this.revision()) throw failure('CONFLICT', 'Selection changed; refresh first');
      const next = this.validate([...this.selection.filter(row => row.id !== id), { id, enabled, config }]);
      const old = this.selection;
      try { await this.native.request('apply', { rows: next }); await this.save(next, old); this.previous = old; this.selection = next; }
      catch (error) { try { await this.native.request('apply', { rows: old }); } catch (rollback) { throw new AggregateError([error, rollback], 'Configuration and rollback failed; restart the owned runtime'); } throw error; }
      return this.inventory();
    });
    this.queue = operation.catch(() => {}); return operation;
  }
  rewind(expected: string) {
    const operation = this.queue.then(async () => {
      if (expected !== this.revision() || !this.previous) throw failure('CONFLICT', 'No current selection checkpoint; refresh first');
      const previous = this.validate(this.previous), old = this.selection;
      try { await this.native.request('apply', { rows: previous }); await this.save(previous, null); this.selection = previous; this.previous = null; }
      catch (error) { await this.native.request('apply', { rows: old }); throw error; }
      return this.inventory();
    }); this.queue = operation.catch(() => {}); return operation;
  }
  private async save(selection: DeepSeekSelection[], previous: DeepSeekSelection[] | null) {
    const temporary = join(this.directory, '.selection-' + randomUUID());
    const fd = await open(temporary, 'wx', 0o600);
    try { await fd.writeFile(JSON.stringify({ selection, previous }) + '\n'); await fd.sync(); }
    finally { await fd.close(); }
    try { await rename(temporary, join(this.directory, 'selection.json')); } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  async probe(id: string, config: unknown = {}): Promise<DeepSeekProbe> {
    if (this.closing) throw failure('NOT_READY', 'Runtime is closing');
    if (this.probes.size >= 4) throw failure('NOT_READY', 'Four isolated probes already running');
    const item = this.packages.find(item => item.id === id);
    if (!item) throw failure('INVALID_INPUT', 'Unknown package');
    const started = performance.now();
    let result: DeepSeekProbe;
    if (!item.installed || !item.platform || item.private) result = { id, outcome: 'unavailable', off: false, on: false, cleanup: true,
      reason: item.private ? 'Private workspace package; not an installable plugin' : !item.platform ? 'Requires another OS or architecture' : 'Exact package is not installed', durationMs: 0 };
    else {
      const isolated = new NativeHarness({ release: this.release, home: join(this.directory, 'probes', randomUUID()), packages: this.packages });
      this.probes.add(isolated);
      try { await isolated.start();
        const rows = this.validate([...(item.kind === 'bundle' ? [] : CORE_PACKAGES.filter(name => name !== id).map(id => ({ id, enabled: true, config: {} }))), { id, enabled: true, config }]);
        const measured = await isolated.request('probe', { name: id, rows }, 5000);
        result = { id, ...measured, durationMs: performance.now() - started }; }
      catch (error) { result = { id, outcome: (error as ApplicationError).code === 'TIMEOUT' ? 'timeout' : 'failed', off: false, on: false, cleanup: false, reason: String(error).slice(0, 1500), durationMs: performance.now() - started }; }
      finally { await isolated.close(); this.probes.delete(isolated); }
      result.cleanup = true;
    }
    this.tests.set(id, result);
    const save = this.testWrites.then(async () => {
      const temporary = join(this.directory, '.tests-' + randomUUID());
      await writeFile(temporary, JSON.stringify([...this.tests.values()]) + '\n', { mode: 0o600 });
      await rename(temporary, join(this.directory, 'tests.json'));
    });
    this.testWrites = save.catch(() => {}); await save;
    return result;
  }
  async close() { this.closing = true; await Promise.all([...this.probes].map(probe => probe.close())); await this.queue; await this.native.close(); await this.testWrites; }
}
