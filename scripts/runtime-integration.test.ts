import test from 'node:test';
import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const source = process.env.DEVLAB_DEEPSEEK_SOURCE, release = process.env.DEVLAB_DEEPSEEK_RELEASE;
if (!source || !release) throw new Error('Set DEVLAB_DEEPSEEK_SOURCE and DEVLAB_DEEPSEEK_RELEASE for native integration');
async function freePort() {
  const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  await new Promise<void>(resolve => server.close(() => resolve())); return String(address.port);
}
async function fixture() {
  const data = await mkdtemp(join(tmpdir(), 'runtime-integrated-'));
  await writeFile(join(data, 'runtime-plugins.json'), JSON.stringify({ selection: {
    'herdr-runtime': false, 'terminal-pty': false, 'rules-local': false, 'project-server': false, 'preview-inspector': false,
  }, previous: null }));
  return { data, app: await freePort(), upstream: await freePort() };
}
function launch(f: Awaited<ReturnType<typeof fixture>>, args: string[] = []) {
  const child = fork(new URL('../runtime/launch.ts', import.meta.url), [
    '--port', f.app, '--harness-port', f.upstream, '--data', f.data,
    '--source', source!, '--release', release!, ...args,
  ], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, DEVLAB_DEEPSEEK_ORIGIN: 'http://127.0.0.1:1' } });
  let logs = ''; child.stdout?.on('data', data => { logs += data; }); child.stderr?.on('data', data => { logs += data; });
  const exited = new Promise<number | null>(resolve => child.once('exit', resolve));
  const ready = new Promise<{ origin: string; upstream: string | null; pids: number[] }>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Launcher readiness timed out: ' + logs)), 40000);
    child.on('message', (message: any) => { if (message?.type === 'ready') { clearTimeout(timer); resolve(message); } });
    child.once('exit', code => { clearTimeout(timer); reject(Error('Launcher failed: ' + code + '\n' + logs)); });
  });
  return { child, ready, exited };
}
async function stop(child: ChildProcess, exited: Promise<unknown>) {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await exited;
}
async function json(origin: string, path: string, body?: unknown) {
  const response = await fetch(origin + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 200, await response.clone().text()); return response.json();
}

test('single runtime launcher federates both layers, preserves independent toggles/rewind and closes owned children', { timeout: 60000 }, async () => {
  const f = await fixture(), run = launch(f); let pids: number[] = [];
  try {
    const ready = await run.ready; pids = ready.pids; assert.equal(pids.length, 2); assert(ready.upstream);
    const inventory = await json(ready.origin, '/api/runtime');
    assert.equal(inventory.plugins.length, 11);
    assert(inventory.plugins.find((p: any) => p.id === 'workspace-search').running);
    const graph = await json(ready.origin, '/api/architecture');
    assert.equal(graph.catalog.graph.items.filter((i: any) => i.id.startsWith('deepseek:package:')).length, 403);
    const off = await json(ready.origin, '/api/runtime/selection', { expectedRevision: inventory.revision, changes: { 'workspace-search': false } });
    assert.equal(off.restartRequired, true);
    await json(ready.origin, '/api/runtime/rewind', { expectedRevision: off.revision });
    const native = await json(ready.upstream, '/api/inventory');
    const disabled = await json(ready.upstream, '/api/selection', { revision: native.revision, id: '@deepseek-ai/dsh-tools', enabled: false, config: {} });
    assert.equal(disabled.entries.find((e: any) => e.module === '@deepseek-ai/dsh-tools').state, 'disabled');
    const restored = await json(ready.upstream, '/api/rewind', { revision: disabled.revision });
    assert.equal(restored.entries.find((e: any) => e.module === '@deepseek-ai/dsh-tools').state, 'active');
    assert.equal((await json(ready.origin, '/api/runtime')).revision, inventory.revision);
  } finally { await stop(run.child, run.exited); await rm(f.data, { recursive: true, force: true }); }
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  await assert.rejects(fetch('http://127.0.0.1:' + f.app)); await assert.rejects(fetch('http://127.0.0.1:' + f.upstream));
});

test('without-harness ignores inherited federation and owns only the DevLab child', { timeout: 60000 }, async () => {
  const f = await fixture(), run = launch(f, ['--without-harness']);
  try {
    const ready = await run.ready; assert.equal(ready.upstream, null); assert.equal(ready.pids.length, 1);
    const graph = await json(ready.origin, '/api/architecture');
    assert.equal(graph.catalog.graph.items.filter((i: any) => i.id.startsWith('deepseek:')).length, 0);
    assert.equal(graph.observation?.status === 'stale', false);
  } finally { await stop(run.child, run.exited); await rm(f.data, { recursive: true, force: true }); }
});

test('occupied app port refuses startup and cleans the newly owned upstream without touching the listener', { timeout: 60000 }, async () => {
  const f = await fixture(), occupied = createServer();
  await new Promise<void>(resolve => occupied.listen(Number(f.app), '127.0.0.1', resolve));
  const run = launch(f);
  try {
    await assert.rejects(run.ready, /Launcher failed/); assert.notEqual(await run.exited, 0);
    assert.equal(occupied.listening, true);
    const host = JSON.parse(await readFile(join(f.data, 'deepseek-runtime/instances/default/host.json'), 'utf8'));
    assert.throws(() => process.kill(host.pid, 0), { code: 'ESRCH' });
    await assert.rejects(readFile(join(f.data, 'deepseek-runtime/instances/default/host.lock')), { code: 'ENOENT' });
  } finally { await stop(run.child, run.exited); await new Promise<void>(resolve => occupied.close(() => resolve())); await rm(f.data, { recursive: true, force: true }); }
});
