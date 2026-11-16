import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';

// This owner supervises only its two children. Installed kernels own plugin lifetimes.
const root = fileURLToPath(new URL('../', import.meta.url));
const options = new Map<string, string>();
let harness = true;
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i]!;
  if (key === '--without-harness') { harness = false; continue; }
  if (!['--port', '--harness-port', '--data', '--release', '--source'].includes(key) || !process.argv[i + 1] || process.argv[i + 1]!.startsWith('--'))
    throw new Error(`Unknown or incomplete runtime argument: ${key}`);
  if (options.has(key)) throw new Error(`Repeated runtime argument: ${key}`);
  options.set(key, process.argv[++i]!);
}
const port = (key: string, fallback: string) => {
  const value = Number(options.get(key) ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`Invalid ${key}`);
  return String(value);
};
const appPort = port('--port', '4322'), harnessPort = port('--harness-port', '4340');
if (harness && appPort === harnessPort) throw new Error('Runtime listeners need different ports');
const data = resolve(options.get('--data') ?? join(root, '.data'));
const children: ChildProcess[] = [];
let stopping: Promise<void> | undefined;
const live = (child: ChildProcess) => child.exitCode === null && child.signalCode === null;
async function stopChild(child: ChildProcess) {
  if (!child.pid || !live(child)) return;
  await new Promise<void>(done => {
    const timer = setTimeout(() => { if (live(child)) child.kill('SIGKILL'); }, 14000);
    child.once('exit', () => { clearTimeout(timer); done(); });
    child.kill('SIGTERM');
  });
}
function close() {
  return stopping ??= (async () => {
    for (const child of [...children].reverse()) await stopChild(child);
    if (process.connected) process.disconnect();
  })();
}
async function start(file: string, args: string[], env: NodeJS.ProcessEnv): Promise<string | null> {
  if (stopping) throw new Error('Runtime is stopping');
  const child = fork(new URL(file, import.meta.url), args, { env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  children.push(child);
  child.once('exit', code => {
    if (!stopping) { process.exitCode = code || 1; void close(); }
  });
  return new Promise((accept, reject) => {
    const timer = setTimeout(() => finish(new Error(`Startup timed out: ${file}`)), 30000);
    const exited = () => finish(new Error(`Runtime child exited before readiness: ${file}`));
    const failed = (error: Error) => finish(error);
    const message = (value: any) => {
      if (value?.type !== 'ready') return;
      if (value.origin !== null && (typeof value.origin !== 'string' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(value.origin)))
        return finish(new Error(`Invalid child readiness: ${file}`));
      finish(undefined, value.origin);
    };
    function finish(error?: Error, origin: string | null = null) {
      clearTimeout(timer); child.off('exit', exited); child.off('error', failed); child.off('message', message);
      if (error) reject(error); else accept(origin);
    }
    child.once('exit', exited); child.once('error', failed); child.on('message', message);
  });
}
process.once('SIGINT', () => { void close(); });
process.once('SIGTERM', () => { void close(); });
if (process.send) process.once('disconnect', () => { void close(); });
try {
  let upstream: string | null = null;
  if (harness) {
    const args = ['--root', root, '--port', harnessPort, '--directory', join(data, 'deepseek-runtime/instances/default')];
    for (const name of ['--release', '--source']) if (options.has(name)) args.push(name, resolve(options.get(name)!));
    upstream = await start('./deepseek/host.ts', args, { ...process.env, DSH_HOME: join(data, 'deepseek-runtime/home') });
    if (!upstream) throw new Error('Harness did not publish a listener');
  }
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: appPort, DEVLAB_DATA_DIR: data };
  delete env.DEVLAB_DEEPSEEK_ORIGIN;
  if (upstream) env.DEVLAB_DEEPSEEK_ORIGIN = upstream;
  const origin = await start('./server.ts', [], env);
  const ready = { type: 'ready', origin, upstream, pids: children.map(child => child.pid) };
  console.log(JSON.stringify({ runtime: ready }));
  if (process.send) process.send(ready);
} catch (error) { console.error(error); process.exitCode = 1; await close(); }
