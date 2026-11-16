import { parseArgs } from 'node:util';
import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import { realpath, stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

function selectedBackend(backend, port) {
  let target;
  try { if (typeof backend !== 'string') throw new Error(); target = new URL(backend); }
  catch { throw new Error('Select a credential-free loopback HTTP backend origin with --backend'); }
  if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(target.hostname) ||
      target.username || target.password || target.pathname !== '/' || target.search || target.hash)
    throw new Error('Backend must be a credential-free loopback HTTP origin without a path, query or fragment');
  target.hostname = '127.0.0.1';
  if (!((typeof port === 'string' && /^\d+$/.test(port)) || typeof port === 'number') ||
      !Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535)
    throw new Error('Select an explicit frontend port from 1 to 65535 with --port');
  const webPort = Number(port);
  if (webPort === Number(target.port || 80)) throw new Error('Frontend and backend must use different ports');
  return { backendUrl: target.origin, webPort };
}

/** Explicit attachment inputs; no backend selection or mutation through environment variables. */
export function developmentOptions(args = process.argv.slice(2)) {
  const { values, tokens } = parseArgs({ args, tokens: true, options: {
    backend: { type: 'string' }, port: { type: 'string' },
  } });
  for (const name of ['backend', 'port']) {
    if (tokens.filter(token => token.kind === 'option' && token.name === name).length > 1)
      throw new Error('Supply --' + name + ' exactly once');
  }
  return selectedBackend(values.backend, values.port);
}

async function healthBody(response) {
  if (!response.body) throw new Error('Backend health response has no body');
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 65536) { await reader.cancel(); throw new Error('Backend health response exceeds 64 KiB'); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { reader.releaseLock(); }
}

async function readyBackend(backendUrl, webUrl, signal) {
  const deadline = Date.now() + 15000;
  let reason = 'not reachable';
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    try {
      const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(1000)]) : AbortSignal.timeout(1000);
      const response = await fetch(backendUrl + '/api/health', { headers: { Origin: webUrl }, redirect: 'error', signal: requestSignal });
      if (response.status === 403) {
        await response.body?.cancel();
        throw new Error(`Origin denied: explicitly permit ${webUrl} in the selected backend before attaching`);
      }
      const health = await healthBody(response);
      if (response.ok && health?.phase === 'ready' && Array.isArray(health.plugins) &&
          health.plugins.some(plugin => plugin?.id === 'transport-http' && plugin.state === 'active')) return;
      reason = 'health is not a ready host with active transport-http';
    } catch (error) {
      signal?.throwIfAborted();
      if (error.message.startsWith('Origin denied:')) throw error;
      reason = String(error.message).slice(0, 300);
    }
    if (Date.now() + 100 >= deadline) break;
    await delay(100, undefined, { signal });
  }
  throw new Error(`Backend ${backendUrl} is not ready (${reason})`);
}

/** Owns only Vite, its watcher and the frontend HTTP/HMR listener. */
export async function startFrontend({ backendUrl: backend, webPort: port, root = process.cwd(), signal }) {
  const { backendUrl, webPort } = selectedBackend(backend, port);
  signal?.throwIfAborted();
  const directory = await realpath(root);
  if (!(await stat(directory)).isDirectory()) throw new Error('Frontend root must be a directory');
  const webUrl = `http://127.0.0.1:${webPort}`;
  console.log(JSON.stringify({ event: 'frontend-connecting', backendUrl, webUrl }));
  await readyBackend(backendUrl, webUrl, signal);
  const { createServer } = await import('vite');
  signal?.throwIfAborted();
  let vite, closing;
  const sockets = new Set();
  const http = createHttpServer((request, response) => {
    if (!vite) { response.writeHead(503); response.end('Starting frontend'); return; }
    vite.middlewares(request, response, () => { response.writeHead(404); response.end('Not found'); });
  });
  http.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  const onAbort = () => { void close().catch(error => console.error('dev:ui cleanup: ' + String(error.message).slice(0, 500))); };
  const close = () => closing ??= (async () => {
    signal?.removeEventListener('abort', onAbort);
    const results = await Promise.allSettled([
      Promise.resolve().then(() => vite?.close()),
      new Promise((resolve, reject) => {
        if (http.listening) http.close(error => error ? reject(error) : resolve()); else resolve();
        // Node closeAllConnections excludes upgrades; these sockets also belong to this listener.
        http.closeAllConnections();
        for (const socket of sockets) socket.destroy();
      }),
    ]);
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Frontend cleanup failed');
  })();
  try {
    vite = await createServer({ root: directory, logLevel: 'warn', clearScreen: false,
      define: { 'import.meta.env.DEVLAB_BACKEND_ORIGIN': JSON.stringify(backendUrl) },
      server: { middlewareMode: true, host: '127.0.0.1', port: webPort, strictPort: true,
        hmr: { server: http }, proxy: { '/api': { target: backendUrl, changeOrigin: true } } },
    });
    // Register lifetime cancellation after creation: aborting an unfinished createServer
    // must not complete cleanup before Vite's newly created resources become available.
    signal?.throwIfAborted();
    const listening = once(http, 'listening');
    http.listen(webPort, '127.0.0.1');
    await listening;
    signal?.throwIfAborted();
    signal?.addEventListener('abort', onAbort, { once: true });
    signal?.throwIfAborted();
  } catch (error) {
    try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Frontend startup and cleanup failed'); }
    throw error;
  }
  console.log(JSON.stringify({ event: 'frontend-ready', mode: 'attach', webUrl, backendUrl, backendOwnership: 'external' }));
  return { close };
}

async function main() {
  let startup, server, stopping;
  const controller = new AbortController();
  const report = error => { console.error('dev:ui: ' + String(error.message).slice(0, 500)); process.exitCode = 1; };
  const stop = () => {
    controller.abort();
    return stopping ??= (async () => {
      const deadline = setTimeout(() => { console.error('dev:ui: frontend shutdown exceeded 8 seconds'); process.exit(1); }, 8000);
      deadline.unref();
      try { const running = server ?? await startup?.catch(() => null); await running?.close(); }
      finally { clearTimeout(deadline); }
    })();
  };
  process.once('SIGINT', () => { void stop().catch(report); });
  process.once('SIGTERM', () => { void stop().catch(report); });
  try {
    startup = startFrontend({ ...developmentOptions(), signal: controller.signal });
    server = await startup;
    if (controller.signal.aborted) await server.close();
  } catch (error) {
    if (!controller.signal.aborted || error instanceof AggregateError) report(error);
    await stop().catch(report);
  }
}

// Realpath also supports launching the physical project through its workspace shortcut.
if (process.argv[1] && await realpath(process.argv[1]).catch(() => null) === fileURLToPath(import.meta.url)) await main();
