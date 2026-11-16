import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

type Selection = { backendUrl: string; webPort: number };
type Frontend = { close(): Promise<void> };
const launcherUrl = new URL('./dev-ui.mjs', import.meta.url);
const { developmentOptions, startFrontend } = await import(launcherUrl.href) as {
  developmentOptions(args: string[]): Selection;
  startFrontend(options: Selection & { root?: string; signal?: AbortSignal }): Promise<Frontend>;
};

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

async function until(check: () => boolean | Promise<boolean>, message: string, milliseconds = 6000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) { if (await check()) return; await delay(20); }
  assert.fail(message);
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'devtest-dev-ui-'));
  await writeFile(join(root, 'package.json'), '{"name":"private-dev-ui-fixture","private":true,"type":"module"}');
  await writeFile(join(root, 'index.html'), '<div id="app">PRIVATE_UI</div><script type="module" src="/main.js"></script>');
  await writeFile(join(root, 'main.js'), 'export const backend = import.meta.env.DEVLAB_BACKEND_ORIGIN;');
  return { root, dispose: () => rm(root, { recursive: true, force: true }) };
}

async function backend(webPort: number, ready = true) {
  const webUrl = 'http://127.0.0.1:' + webPort;
  const requests: { path: string; origin: string | undefined; host: string | undefined; method: string | undefined }[] = [];
  let streams = 0;
  const server = createServer((request, response) => {
    requests.push({ path: request.url!, origin: request.headers.origin, host: request.headers.host, method: request.method });
    if (request.headers.origin && request.headers.origin !== webUrl) {
      response.writeHead(403, { 'content-type': 'application/json' }); response.end('{"code":"ORIGIN_DENIED"}'); return;
    }
    if (request.url === '/api/events') {
      streams++; response.on('close', () => streams--);
      response.writeHead(200, { 'content-type': 'text/event-stream' }); response.write('data: ready\n\n'); return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(request.url === '/api/health'
      ? { phase: ready ? 'ready' : 'starting', plugins: [{ id: 'transport-http', state: 'active' }] }
      : { origin: request.headers.origin, host: request.headers.host }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  return {
    url: 'http://127.0.0.1:' + address.port, webUrl, requests, get streams() { return streams; },
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
    }),
  };
}

test('frontend requires explicit distinct safe origins and ports at both CLI and programmatic boundaries', async () => {
  assert.deepEqual(developmentOptions(['--backend', 'http://localhost:4311/', '--port=4312']), { backendUrl: 'http://127.0.0.1:4311', webPort: 4312 });
  for (const args of [[], ['--port', '4312'], ['--backend', 'http://127.0.0.1:4311'],
    ['--backend', 'http://127.0.0.1:4311', '--port', '4312', '--port', '4313'],
    ['--backend', 'http://127.0.0.1:4311', '--port', '4312', '--unknown'],
    ['--backend', 'http://127.0.0.1:4311', '--port', '4312', 'unexpected']])
    assert.throws(() => developmentOptions(args));
  for (const url of ['https://127.0.0.1:4311', 'http://example.com:4311', 'http://user:secret@127.0.0.1:4311',
    'http://127.0.0.1:4311/path', 'http://127.0.0.1:4311?query=1', 'http://127.0.0.1:4311#fragment', 'http://0.0.0.0:4311']) {
    assert.throws(() => developmentOptions(['--backend', url, '--port', '4312']));
    await assert.rejects(startFrontend({ backendUrl: url, webPort: 4312 }), /loopback|credential/);
  }
  for (const port of ['0', '-1', '1.5', '1e4', '65536', '4311', 'NaN'])
    assert.throws(() => developmentOptions(['--backend', 'http://127.0.0.1:4311', '--port', port]));
});

test('frontend refuses a backend denied Origin and cancels unready attachment without opening a listener', { timeout: 10000 }, async () => {
  const f = await fixture(), port = await freePort(), host = await backend(port + (port === 65535 ? -1 : 1));
  try {
    await assert.rejects(startFrontend({ root: f.root, backendUrl: host.url, webPort: port }), /Origin denied/);
    assert.equal(host.requests.length, 1);
    assert.equal(host.requests[0]!.origin, 'http://127.0.0.1:' + port);
    const probe = createServer(); probe.listen(port, '127.0.0.1'); await once(probe, 'listening');
    await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  } finally { await host.close(); await f.dispose(); }
  const pending = await fixture(), pendingPort = await freePort(), starting = await backend(pendingPort, false);
  const controller = new AbortController();
  const reason = new Error('private startup cancellation');
  try {
    const launch = startFrontend({ root: pending.root, backendUrl: starting.url, webPort: pendingPort, signal: controller.signal });
    const rejection = assert.rejects(launch, error => error === reason ||
      error instanceof Error && error.name === 'AbortError' && error.cause === reason);
    await until(() => starting.requests.length > 0, 'Health probe did not arrive'); controller.abort(reason); await rejection;
    assert(starting.requests.every(request => request.path === '/api/health' && request.method === 'GET'));
  } finally { controller.abort(); await starting.close(); await pending.dispose(); }
});

test('managed Vite serves actual modules, keeps API Origin, and closes owned HTTP/HMR/SSE while backend stays ready', { timeout: 15000 }, async () => {
  const f = await fixture(), port = await freePort(), host = await backend(port);
  const selectedEnvironment = [process.env.DEVLAB_BACKEND_URL, process.env.DEVLAB_WEB_PORT, process.env.DEVLAB_BACKEND_ORIGIN];
  let frontend: Frontend | undefined, socket: WebSocket | undefined;
  try {
    frontend = await startFrontend({ root: f.root, backendUrl: host.url, webPort: port });
    assert((await (await fetch(host.webUrl)).text()).includes('PRIVATE_UI'));
    assert((await (await fetch(host.webUrl + '/main.js')).text()).includes(host.url), 'Vite must inject this instance backend identity');
    const echoed = await (await fetch(host.webUrl + '/api/echo', { headers: { Origin: host.webUrl } })).json();
    assert.equal(echoed.origin, host.webUrl); assert.equal(echoed.host, new URL(host.url).host);
    assert.equal((await fetch(host.webUrl + '/api/echo', { headers: { Origin: 'http://untrusted.invalid' } })).status, 403);
    assert.equal(host.requests.at(-1)!.origin, 'http://untrusted.invalid', 'Proxy must never rewrite browser Origin to bypass host checks');
    const response = await fetch(host.webUrl + '/api/events', { headers: { Origin: host.webUrl } });
    const stream = response.body!.getReader(); assert((await stream.read()).value);
    const ended = stream.read().catch(() => ({ done: true }));
    socket = new WebSocket(host.webUrl.replace('http:', 'ws:'), 'vite-hmr');
    await new Promise<void>((resolve, reject) => {
      socket!.addEventListener('open', () => resolve(), { once: true });
      socket!.addEventListener('error', () => reject(new Error('Owned HMR socket failed')), { once: true });
    });
    const socketClosed = new Promise<void>(resolve => socket!.addEventListener('close', () => resolve(), { once: true }));
    const closing = frontend.close(); assert.equal(frontend.close(), closing, 'close returns one shared completion promise');
    await closing; await ended; stream.releaseLock(); await socketClosed;
    await until(() => host.streams === 0, 'Owned proxy stream did not detach from backend');
    const reuse = createServer(); reuse.listen(port, '127.0.0.1'); await once(reuse, 'listening');
    await new Promise<void>((resolve, reject) => reuse.close(error => error ? reject(error) : resolve()));
    assert.equal((await fetch(host.url + '/api/health')).status, 200, 'Attached backend must remain running');
    assert.deepEqual([process.env.DEVLAB_BACKEND_URL, process.env.DEVLAB_WEB_PORT, process.env.DEVLAB_BACKEND_ORIGIN], selectedEnvironment);
    assert(host.requests.every(request => request.method === 'GET'), 'Frontend lifecycle must not send host mutation commands');
  } finally { socket?.close(); await frontend?.close(); await host.close(); await f.dispose(); }
});

test('frontend port collision cleans Vite resources and lifetime abort closes a successful launch', { timeout: 15000 }, async () => {
  const f = await fixture(), port = await freePort(), host = await backend(port);
  const occupied = createServer((_request, response) => response.end('original listener'));
  occupied.listen(port, '127.0.0.1'); await once(occupied, 'listening');
  const controller = new AbortController(); let frontend: Frontend | undefined;
  try {
    await assert.rejects(startFrontend({ root: f.root, backendUrl: host.url, webPort: port }), { code: 'EADDRINUSE' });
    assert.equal(await (await fetch(host.webUrl)).text(), 'original listener');
    await new Promise<void>((resolve, reject) => occupied.close(error => error ? reject(error) : resolve()));
    frontend = await startFrontend({ root: f.root, backendUrl: host.url, webPort: port, signal: controller.signal });
    controller.abort(); await frontend.close();
    assert.equal((await fetch(host.url + '/api/health')).status, 200);
  } finally {
    controller.abort(); await frontend?.close();
    if (occupied.listening) await new Promise<void>(resolve => occupied.close(() => resolve()));
    await host.close(); await f.dispose();
  }
});

test('frontend CLI through a source shortcut awaits SIGTERM cleanup and leaves selected backend intact', { timeout: 15000 }, async () => {
  const f = await fixture(), port = await freePort(), host = await backend(port);
  const shortcut = join(f.root, 'dev-ui-shortcut.mjs');
  await symlink(fileURLToPath(launcherUrl), shortcut);
  const child = spawn(process.execPath, [shortcut, '--backend', host.url, '--port', String(port)], { cwd: f.root, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'close'); let output = '', error = '';
  child.stdout.on('data', data => { output += String(data); }); child.stderr.on('data', data => { error += String(data); });
  try {
    await until(() => output.includes('frontend-ready'), 'Managed CLI did not become ready: ' + error);
    child.kill('SIGTERM');
    const [code, signal] = await exited;
    assert.equal(signal, null); assert.equal(code, 0, error);
    assert.equal((await fetch(host.url + '/api/health')).status, 200);
    const reuse = createServer(); reuse.listen(port, '127.0.0.1'); await once(reuse, 'listening');
    await new Promise<void>((resolve, reject) => reuse.close(error => error ? reject(error) : resolve()));
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited; await host.close(); await f.dispose();
  }
});
