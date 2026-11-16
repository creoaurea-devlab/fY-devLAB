import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, open, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApplicationError } from '@devlab/contracts';
import { catalogue, UPSTREAM_REVISION } from './catalogue.ts';
import { DeepSeekRuntime } from './adapter.ts';
import { routeDeepSeekRegistry } from './registry-router.ts';
import { installPinned, buildUnpublished } from './install.ts';

const argument = (name: string, fallback: string) => { const index = process.argv.indexOf(name); return index === -1 ? fallback : process.argv[index + 1] ?? fallback; };
const root = resolve(argument('--root', fileURLToPath(new URL('../../', import.meta.url))));
const source = resolve(argument('--source', join(root, '_LAB/deepseek-harness')));
const release = resolve(argument('--release', join(root, '.data/deepseek-runtime/releases', UPSTREAM_REVISION)));
const directory = resolve(argument('--directory', join(root, '.data/deepseek-runtime/instances/default')));
if (process.argv.includes('--install')) { await installPinned(source, release); process.exit(0); }
if (process.argv.includes('--build-unpublished')) { console.log(JSON.stringify(await buildUnpublished(source, release))); process.exit(0); }
const port = Number(argument('--port', '4340'));
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
await mkdir(directory, { recursive: true });
const packages = await catalogue(source, release);
const lockPath = join(directory, 'host.lock'), lock = await open(lockPath, 'wx', 0o600);
await lock.writeFile(String(process.pid));
const runtime = new DeepSeekRuntime({ packages, release, directory });
let closing = false, audit: Promise<void> | undefined;
const progress = { running: false, total: runtime.packages.length, completed: 0 };
let origin = '';
const server = createServer((request, response) => { void (async () => {
  const json = (status: number, value: unknown) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(JSON.stringify(value)); };
  try {
    if (request.headers.host !== origin.slice('http://'.length) || request.headers.origin && request.headers.origin !== origin) throw new ApplicationError('ORIGIN_DENIED', 'Runtime accepts its own loopback origin only');
    const url = new URL(request.url ?? '/', origin);
    if (request.method === 'GET' && url.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
        'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'" });
      response.end(await readFile(new URL('./panel.html', import.meta.url), 'utf8')); return;
    }
    if (request.method === 'GET' && url.pathname === '/api/inventory') { json(200, { ...await runtime.inventory(), audit: progress }); return; }
    if (request.method === 'GET' && url.pathname === '/api/registry') { json(200, routeDeepSeekRegistry(await runtime.inventory())); return; }
    if (request.method !== 'POST' || !request.headers['content-type']?.startsWith('application/json')) { json(404, { code: 'NOT_FOUND', message: 'Runtime route not found' }); return; }
    let bytes = 0; const chunks = [];
    for await (const chunk of request) { bytes += chunk.length; if (bytes > 65536) throw new ApplicationError('INVALID_INPUT', 'Request exceeds 64 KiB'); chunks.push(chunk); }
    const input = JSON.parse(Buffer.concat(chunks).toString());
    if (url.pathname === '/api/selection') {
      if (typeof input.revision !== 'string' || typeof input.id !== 'string' || typeof input.enabled !== 'boolean' || !Object.hasOwn(input, 'config')) throw new ApplicationError('INVALID_INPUT', 'Expected revision, package ID, enabled and JSON configuration');
      json(200, await runtime.configure(input.revision, input.id, input.enabled, input.config)); return;
    }
    if (url.pathname === '/api/rewind') { json(200, await runtime.rewind(input.revision)); return; }
    if (url.pathname === '/api/probe') { if (typeof input.id !== 'string') throw new ApplicationError('INVALID_INPUT', 'Expected package ID'); json(200, await runtime.probe(input.id, Object.hasOwn(input, 'config') ? input.config : {})); return; }
    if (url.pathname === '/api/test-all') {
      if (progress.running) throw new ApplicationError('CONFLICT', 'Package audit already running');
      progress.running = true; progress.completed = 0;
      let cursor = 0;
      audit = Promise.all(Array.from({ length: 2 }, async () => { while (!closing && cursor < runtime.packages.length) {
        const item = runtime.packages[cursor++];
        try { await runtime.probe(item!.id); } finally { progress.completed++; }
      } })).then(() => { progress.running = false; }, error => { progress.running = false; console.error('Package audit stopped:', String(error)); });
      json(202, { started: true, total: progress.total }); return;
    }
    json(404, { code: 'NOT_FOUND', message: 'Runtime route not found' });
  } catch (error) {
    const code = (error as ApplicationError).code ?? 'UPSTREAM_FAILURE';
    json(code === 'CONFLICT' ? 409 : code === 'ORIGIN_DENIED' ? 403 : code === 'INVALID_INPUT' ? 400 : 503, { code, message: (error as Error).message });
  }
})().catch(error => { response.destroy(error); }); });
async function close() {
  if (closing) return; closing = true;
  server.close(); await runtime.close(); await audit;
  await lock.close(); await unlink(lockPath);
  if (process.connected) process.disconnect();
}
if (process.send) process.once('disconnect', () => { void close(); });
process.once('SIGINT', () => { void close(); }); process.once('SIGTERM', () => { void close(); });
try {
  await runtime.start();
  await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', accept); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No listener address');
  origin = 'http://127.0.0.1:' + address.port;
  await writeFile(join(directory, 'host.json'), JSON.stringify({ pid: process.pid, origin, revision: UPSTREAM_REVISION, source: 'DeepSeek Harness Runtime' }) + '\n', { mode: 0o600 });
  if (process.send) process.send({ type: 'ready', origin });
  console.log(JSON.stringify({ name: 'DeepSeek Harness Runtime', origin, packages: runtime.packages.length, directory }));
} catch (error) { await close(); throw error; }
