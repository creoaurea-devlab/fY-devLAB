import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Kernel } from '@devlab/kernel';
import { TerminalReplaySchema, TerminalSessionSchema, type TerminalSession } from '@devlab/contracts';
import { httpTransport } from '@devlab/transport-http';
import { terminalPty } from '@devlab/terminal-pty';
import { fileURLToPath } from 'node:url';
import { execFile, spawn as spawnProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { createInterface } from 'node:readline';
import { grants, profile } from '../src/profile.ts';
import { TerminalPersistence } from '../plugins/terminal-pty/src/persistence.ts';

const tmuxPath = fileURLToPath(new URL('../.tools/tmux/bin/tmux', import.meta.url));
async function fixture(preserveOnDispose = false, persistent = true) {
  const root = await mkdtemp(join(tmpdir(), 'devtest-terminal-'));
  let kernel = new Kernel([...grants, 'terminal:local']);
  let url = '';
  const boot = async () => {
    kernel = new Kernel([...grants, 'terminal:local']);
    await kernel.start([
      ...profile(kernel, root, 0, join(root, '.data')).filter(plugin => !['terminal-pty', 'transport-http', 'registry-map'].includes(plugin.manifest.id)),
      terminalPty(persistent ? { stateDirectory: join(root, '.data/terminals'), tmuxPath, preserveOnDispose } : {}),
      httpTransport({ port: 0, terminals: true, diagnostics: () => ({ phase: kernel.phase, plugins: kernel.health() }) }),
    ]);
    url = kernel.service('http').url;
  };
  try {
    await mkdir(join(root, 'module'));
    await mkdir(join(root, '.context/modules'), { recursive: true });
    await writeFile(join(root, 'module/owned.txt'), 'owned-before');
    await writeFile(join(root, 'module/sibling.txt'), 'sibling-before');
    await writeFile(join(root, '.context/modules/registry.yaml'),
      'schema_version: 1\nmodules:\n  first:\n    paths:\n    - module/owned.txt\n  second:\n    paths:\n    - module/sibling.txt\n');
    await boot();
  } catch (error) {
    await kernel.close();
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  return {
    get kernel() { return kernel; }, root, get url() { return url; },
    async restart() { await kernel.close(); await boot(); },
    post: (path: string, body: unknown) => fetch(kernel.service('http').url + path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }),
    async dispose() {
      const terminal = kernel.phase === 'ready' ? kernel.service('terminals') : undefined;
      if (terminal) for (const session of terminal.list('default')) await terminal.close(session.id);
      await kernel.close(); await rm(root, { recursive: true, force: true });
    },
  };
}

async function until(check: () => boolean | Promise<boolean>) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await check()) return;
    await delay(20);
  }
  assert.fail('Terminal fixture condition timed out');
}

function gone(pid: number) {
  try { process.kill(pid, 0); return false; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true; throw error; }
}

for (const persistent of [false, true]) test(`project bootstrap preserves project cwd and rules (${persistent ? 'tmux' : 'direct PTY'})`, async () => {
  const f = await fixture(false, persistent);
  const terminal = f.kernel.service('terminals');
  const projects = f.kernel.service('projects');
  const output = (id: string) => terminal.read(id, 0).chunks.map(chunk => chunk.data).join('');
  try {
    const project = await projects.create({ id: 'bootstrap-project', label: 'Bootstrap project' });
    const root = await projects.root(project.id);
    assert.match(await readFile(join(root, 'AGENTS.md'), 'utf8'), /\.agents\/DEVLAB.md/);
    assert.match(await readFile(join(root, '.agents/DEVLAB.md'), 'utf8'), /DevLab.*local workspace/);
    for (const shell of ['bash', 'sh'] as const) {
      const session = await terminal.create({ projectId: project.id, nodeId: shell, cwd: '.', shell, cols: 100, rows: 24 });
      assert.equal(session.cwd, root);
      assert.match(output(session.id), /Agent bootstrap: read the project-root AGENTS.md/);
      terminal.write(session.id, "printf '\\nROOT:%s\\n' \"$PWD\"\r");
      await until(() => output(session.id).includes('ROOT:' + root));
      const same = await terminal.create({ projectId: project.id, nodeId: shell, cwd: '.', shell, cols: 100, rows: 24 });
      assert.equal(same.pid, session.pid);
      assert.equal(output(session.id).split('[Agent bootstrap:').length - 1, 1);
      await terminal.close(session.id);
    }
    const nested = await terminal.create({ projectId: project.id, nodeId: 'nested', cwd: 'src', shell: 'sh', cols: 80, rows: 24 });
    assert.equal(nested.cwd, join(root, 'src'));
    await terminal.close(nested.id);
    const original = '# Existing project rules\n';
    await writeFile(join(root, 'AGENTS.md'), original);
    await rm(join(root, '.agents'), { recursive: true });
    await projects.open({ path: root });
    assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), original);
    assert.match(await readFile(join(root, '.agents/DEVLAB.md'), 'utf8'), /DevLab project bootstrap/);
    const absent = await terminal.create({ projectId: 'default', nodeId: 'missing-entry', cwd: '.', shell: 'sh', cols: 80, rows: 24 });
    assert.match(output(absent.id), /AGENTS.md is missing/);
  } finally { await f.dispose(); }
});

test('lost tmux attachment reconnects to the same shell and preserves its environment', { timeout: 15000 }, async () => {
  const f = await fixture();
  const terminal = f.kernel.service('terminals');
  const output = (id: string) => terminal.read(id, 0).chunks.map(chunk => chunk.data).join('');
  try {
    const session = await terminal.create({ projectId: 'default', nodeId: 'detach', cwd: '.', shell: 'bash', cols: 80, rows: 24 });
    terminal.write(session.id, "export ATTACH_VALUE=retained; printf '\\nBEFORE_%s\\n' DETACH\r");
    await until(() => output(session.id).includes('BEFORE_DETACH'));
    const saved = JSON.parse(await readFile(join(f.root, '.data/terminals', session.id + '.json'), 'utf8'));
    await promisify(execFile)(tmuxPath, ['-S', saved.socket, 'detach-client', '-s', 'devlab']);
    await delay(500);
    await until(() => {
      try { terminal.write(session.id, "printf '\\nAFTER:%s\\n' \"$ATTACH_VALUE\"\r"); return true; }
      catch { return false; }
    });
    await until(() => output(session.id).includes('AFTER:retained'));
    assert.equal(terminal.inspect(session.id).pid, session.pid);
    assert.equal(terminal.list('default').length, 1);
  } finally { await f.dispose(); }
});

test('temporary owner inspection failure preserves the live shell during polling and restart', { timeout: 15000 }, async t => {
  const f = await fixture(true);
  const original = TerminalPersistence.prototype.inspect;
  let failures = 0, socket = '';
  t.mock.method(TerminalPersistence.prototype, 'inspect', async function (this: TerminalPersistence, value: string) {
    if (value === socket && failures > 0) { failures--; throw new Error('Fixture owner probe interrupted'); }
    return original.call(this, value);
  });
  try {
    const terminal = f.kernel.service('terminals');
    const session = await terminal.create({ projectId: 'default', nodeId: 'probe', cwd: '.', shell: 'bash', cols: 80, rows: 24 });
    socket = JSON.parse(await readFile(join(f.root, '.data/terminals', session.id + '.json'), 'utf8')).socket;
    failures = 1;
    await until(() => failures === 0);
    await delay(100);
    assert.equal(terminal.inspect(session.id).status, 'running', 'A failed probe is not proof of shell exit');
    failures = 1;
    await f.restart();
    const restored = f.kernel.service('terminals');
    assert.equal(restored.inspect(session.id).status, 'running');
    assert.equal(restored.inspect(session.id).pid, session.pid);
    await until(() => {
      try { restored.write(session.id, "printf '\\nRECOVERED_%s\\n' OWNER\r"); return true; }
      catch (error) { if ((error as { code: string }).code === 'NOT_READY') return false; throw error; }
    });
    await until(() => restored.read(session.id, 0).chunks.some(chunk => chunk.data.includes('RECOVERED_OWNER')));
  } finally { failures = 0; await f.dispose(); }
});

test('reattaching an assigned shell uses its immutable policy after ownership files change', { timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    const terminal = f.kernel.service('terminals');
    const command = { projectId: 'default', nodeId: 'policy', cwd: '.', shell: 'bash' as const, cols: 80, rows: 24, ownership: { mode: 'guided' as const, ownerId: 'first' } };
    const session = await terminal.create(command);
    await rm(join(f.root, 'module/owned.txt'));
    assert.deepEqual(await terminal.create(command), terminal.inspect(session.id));
    await assert.rejects(terminal.create({ ...command, ownership: { mode: 'strict', ownerId: 'first' } }), { code: 'CONFLICT' });
    await terminal.close(session.id);
    const successor = await terminal.create(command);
    assert.equal(successor.ownership?.mode, 'guided', 'Advisory policy must not require every owned path to exist');
    await assert.rejects(terminal.create({ ...command, nodeId: 'strict-missing', ownership: { mode: 'strict', ownerId: 'first' } }), { code: 'INVALID_INPUT' });
  } finally { await f.dispose(); }
});

test('failed Stop can be retried without leaving the terminal locked in closing', { timeout: 15000 }, async t => {
  const f = await fixture();
  const original = TerminalPersistence.prototype.stop;
  let fail = true;
  t.mock.method(TerminalPersistence.prototype, 'stop', async function (this: TerminalPersistence, socket: string) {
    if (fail) { fail = false; throw new Error('Fixture stop interrupted'); }
    return original.call(this, socket);
  });
  try {
    const terminal = f.kernel.service('terminals');
    const session = await terminal.create({ projectId: 'default', nodeId: 'stop-retry', cwd: '.', shell: 'bash', cols: 80, rows: 24 });
    await assert.rejects(terminal.close(session.id), /Fixture stop interrupted/);
    assert.equal((await terminal.close(session.id)).status, 'exited');
    await until(() => gone(session.pid));
  } finally { fail = false; await f.dispose(); }
});

test('restart retains a live owner older than 64 history records', { timeout: 20000 }, async () => {
  const f = await fixture(true);
  try {
    const terminal = f.kernel.service('terminals');
    const session = await terminal.create({ projectId: 'default', nodeId: 'old-live', cwd: '.', shell: 'bash', cols: 80, rows: 24 });
    const persistence = new TerminalPersistence(join(f.root, '.data/terminals'), tmuxPath);
    const saved = JSON.parse(await readFile(join(persistence.directory, session.id + '.json'), 'utf8'));
    // Real live shell behind inert history: no extra process owners are created.
    for (let index = 0; index < 65; index++) {
      const id = crypto.randomUUID();
      await persistence.save({ ...saved, session: { ...session, id, nodeId: 'history-' + index, status: 'exited', exitCode: 0 }, socket: persistence.socket(id) });
    }
    await f.restart();
    const restored = f.kernel.service('terminals');
    assert.equal(restored.list('default').length, 66);
    assert.equal(restored.inspect(session.id).pid, session.pid);
    assert.equal(restored.inspect(session.id).status, 'running');
  } finally { await f.dispose(); }
});

test('selected host owns real isolated PTYs, HTTP/SSE reconnect, resize and explicit/natural exit', { timeout: 20000 }, async () => {
  const f = await fixture();
  const terminal = f.kernel.service('terminals');
  const output = (id: string) => terminal.read(id, 0).chunks.map(chunk => chunk.data).join('');
  const create = async (nodeId: string) => {
    const response = await f.post('/api/terminals', { projectId: 'default', nodeId, cwd: 'module', shell: 'bash', cols: 80, rows: 24 });
    assert.equal(response.status, 200);
    return TerminalSessionSchema.parse(await response.json());
  };
  const abort = new AbortController();
  try {
    const health = await (await fetch(f.url + '/api/health')).json();
    assert(health.plugins.some((plugin: { id: string; state: string }) => plugin.id === 'terminal-pty' && plugin.state === 'active'));
    const [a, duplicate, b] = await Promise.all([create('a'), create('a'), create('b')]);
    assert.equal(a.id, duplicate.id, 'concurrent duplicate start must keep one process');
    assert.notEqual(a.id, b.id);
    assert.equal(a.cwd, join(f.root, 'module'));
    const initial = output(a.id);
    assert(!initial.includes('\x1b[c') && !initial.includes('\x1b[>c') && !initial.includes('\x1b[>q'),
      'tmux outer-host probes must be answered locally, never replayed into browser observers');
    const prefix = '/api/terminals/' + a.id;
    const stream = await fetch(f.url + prefix + '/events', { signal: abort.signal });
    assert.equal(stream.status, 200);
    const received: string[] = [];
    const reader = stream.body!.getReader();
    const consume = (async () => {
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) return;
          received.push(new TextDecoder().decode(part.value));
        }
      } catch (error) { if (!abort.signal.aborted) throw error; }
    })();
    assert.equal((await f.post(prefix + '/input', { data: "printf '\\nFIRST_%s\\n' SESSION\r" })).status, 200);
    await until(() => received.join('').includes('FIRST_SESSION'));
    assert(!output(b.id).includes('FIRST_SESSION'), 'sessions must not share output');
    abort.abort();
    await consume;
    assert.equal(terminal.inspect(a.id).status, 'running', 'detaching view must retain backend PTY');
    const cursor = terminal.inspect(a.id).cursor;
    assert.equal((await f.post(prefix + '/resize', { cols: 103, rows: 35 })).status, 200);
    assert.equal((await f.post(prefix + '/input', { data: "stty size; printf '\\nDETACHED_%s\\n' OUTPUT\r" })).status, 200);
    await until(() => output(a.id).includes('DETACHED_OUTPUT'));
    assert(output(a.id).includes('35 103'), 'resize must reach the actual terminal');
    const replay = TerminalReplaySchema.parse(await (await fetch(f.url + prefix + '?after=' + cursor)).json());
    assert(replay.chunks.map(chunk => chunk.data).join('').includes('DETACHED_OUTPUT'));
    const latest = terminal.inspect(a.id).cursor;
    const reconnect = await fetch(f.url + prefix + '/events?after=0', { headers: { 'last-event-id': String(latest) } });
    const reconnectReader = reconnect.body!.getReader();
    try {
      const first = new TextDecoder().decode((await reconnectReader.read()).value);
      assert(first.includes('"chunks":[]'), 'Last-Event-ID must take precedence over stale query cursor');
    } finally { await reconnectReader.cancel(); }
    assert.equal((await f.post(prefix + '/input', { data: 'exit 7\r' })).status, 200);
    await until(() => terminal.inspect(a.id).status === 'exited');
    assert.equal(terminal.inspect(a.id).exitCode, 7, output(a.id));
    assert.equal((await f.post(prefix + '/input', { data: 'x' })).status, 409);
    const stopped = TerminalSessionSchema.parse(await (await f.post('/api/terminals/' + b.id + '/close', {})).json());
    assert.equal(stopped.status, 'exited');
    await until(() => gone(a.pid) && gone(b.pid));
  } finally { abort.abort(); await f.dispose(); }
});

test('terminal input/path/origin guards and host disposal clean up owned processes', { timeout: 20000 }, async () => {
  const f = await fixture();
  const terminal = f.kernel.service('terminals');
  try {
    assert.equal((await fetch(f.url + '/api/terminals?projectId=default', { headers: { Origin: 'https://untrusted.invalid' } })).status, 403);
    assert.equal((await f.post('/api/terminals', { projectId: 'default', nodeId: 'bad', cwd: '..', cols: 80, rows: 24 })).status, 403);
    assert.equal((await f.post('/api/terminals', { projectId: 'default', nodeId: 'bad', cols: 0, rows: 24 })).status, 400);
    const session = TerminalSessionSchema.parse(await (await f.post('/api/terminals', {
      projectId: 'default', nodeId: 'cleanup', cwd: '.', cols: 80, rows: 24,
    })).json());
    const prefix = '/api/terminals/' + session.id;
    assert.equal((await f.post(prefix + '/input', { data: 'x'.repeat(65537) })).status, 400);
    assert.equal((await f.post(prefix + '/resize', { cols: 0, rows: 24 })).status, 400);
    assert.equal((await fetch(f.url + prefix + '/events?after=-1')).status, 400);
    terminal.write(session.id, "sleep 1000 & printf '\\nCHILD:%s\\n' $!; wait\r");
    let child = 0;
    await until(() => {
      const match = /CHILD:(\d+)/.exec(terminal.read(session.id, 0).chunks.map(chunk => chunk.data).join(''));
      child = Number(match?.[1] ?? 0);
      return child > 0;
    });
    await f.kernel.close();
    await until(() => gone(session.pid) && gone(child));
    assert.throws(() => terminal.inspect(session.id), { code: 'NOT_READY' });
    await assert.rejects(fetch(f.url + '/api/health'));
  } finally { await f.dispose(); }
});

test('Off terminals work with unrelated project memory while assigned policies fail closed', { timeout: 15000 }, async () => {
  const f = await fixture(false, false);
  try {
    await rm(join(f.root, '.context/modules/registry.yaml'));
    await mkdir(join(f.root, '.wisdohm'));
    const db = new DatabaseSync(join(f.root, '.wisdohm/memory.sqlite'));
    try { db.exec('CREATE TABLE project_notes (note TEXT)'); } finally { db.close(); }
    const terminal = f.kernel.service('terminals');
    const session = await terminal.create({ projectId: 'default', nodeId: 'ordinary', cwd: '.', shell: 'bash', cols: 80, rows: 20, ownership: { mode: 'off' } });
    terminal.write(session.id, "printf '\\nOWNERSHIP_OPTIONAL_OK\\n'\r");
    await until(() => terminal.read(session.id, 0).chunks.map(chunk => chunk.data).join('').includes('\r\nOWNERSHIP_OPTIONAL_OK\r\n'));
    assert.equal(terminal.inspect(session.id).status, 'running');
    await assert.rejects(terminal.ownerships('default'), error => {
      assert.match((error as Error).message, /missing definition source/);
      assert.doesNotMatch((error as Error).message, /PyYAML|Command failed|\/usr\/bin\/python/);
      return true;
    });
    for (const mode of ['off', 'guided', 'strict'] as const)
      await assert.rejects(terminal.create({ projectId: 'default', nodeId: 'assigned-' + mode, cwd: '.', shell: 'bash', cols: 80, rows: 20, ownership: { mode, ownerId: 'first' } }), { code: 'SERVICE_UNAVAILABLE' });
    assert.equal(terminal.list('default').length, 1);
  } finally { await f.dispose(); }
});

test('effective ownership is canonical and immutable; Strict shell and inherited fork enforce actual writes', { timeout: 30000 }, async () => {
  const f = await fixture();
  const terminal = f.kernel.service('terminals');
  const output = (id: string) => terminal.read(id, 0).chunks.map(chunk => chunk.data).join('');
  try {
    const catalogue = await terminal.ownerships('default');
    assert.equal(catalogue.strict.available, true, catalogue.strict.reason);
    assert.deepEqual(catalogue.owners.map(owner => owner.id), ['first', 'second']);
    const base = { projectId: 'default', cwd: '.', shell: 'bash' as const, cols: 80, rows: 24 };
    const strict = await terminal.create({ ...base, nodeId: 'locked', ownership: { mode: 'strict', ownerId: 'first' } });
    assert.equal(strict.ownership?.mode, 'strict');
    assert.equal(strict.ownership?.ownerId, 'first');
    assert.match(strict.ownership?.revision ?? '', /^[a-f0-9]{64}$/);
    terminal.write(strict.id, "printf OWNED_OK > module/owned.txt; if printf ESCAPED > module/sibling.txt; then printf '\nBAD_%s\n' SIBLING; else printf '\nDENIED_%s\n' SIBLING; fi\r");
    await until(() => output(strict.id).includes('DENIED_SIBLING'));
    assert.equal(await readFile(join(f.root, 'module/owned.txt'), 'utf8'), 'OWNED_OK');
    assert.equal(await readFile(join(f.root, 'module/sibling.txt'), 'utf8'), 'sibling-before');
    terminal.write(strict.id, "(printf CHILD_BAD > module/sibling.txt) 2>/dev/null; /usr/bin/python3 -c 'import socket; socket.socket()' 2>/dev/null; printf '\nCHILD_%s\n' DONE\r");
    await until(() => output(strict.id).includes('CHILD_DONE'));
    assert.equal(await readFile(join(f.root, 'module/sibling.txt'), 'utf8'), 'sibling-before');
    await assert.rejects(terminal.create({ ...base, nodeId: 'locked', ownership: { mode: 'off' } }), { code: 'CONFLICT' });
    await assert.rejects(terminal.create({ ...base, nodeId: 'bad', ownership: { mode: 'strict', ownerId: 'not-declared' } }), { code: 'INVALID_INPUT' });
    const child = await terminal.create({ ...base, nodeId: 'fork', parentSessionId: strict.id });
    assert.notEqual(child.id, strict.id);
    assert.notEqual(child.pid, strict.pid);
    assert.deepEqual(child.ownership, strict.ownership);
    assert.equal(child.parentSessionId, strict.id);
    await assert.rejects(terminal.create({ ...base, nodeId: 'badfork', parentSessionId: strict.id, ownership: { mode: 'off' } }), { code: 'CONFLICT' });
    terminal.write(child.id, "printf FORK_OK > module/owned.txt; (printf BAD > module/sibling.txt) 2>/dev/null; printf '\nFORK_%s\n' DONE\r");
    await until(() => output(child.id).includes('FORK_DONE'));
    assert.equal(await readFile(join(f.root, 'module/owned.txt'), 'utf8'), 'FORK_OK');
    assert.equal(await readFile(join(f.root, 'module/sibling.txt'), 'utf8'), 'sibling-before');
    const assigned = await terminal.create({ ...base, nodeId: 'assigned', ownership: { mode: 'off', ownerId: 'first' } });
    assert.equal(assigned.ownership?.ownerId, 'first');
    terminal.write(assigned.id, "printf OFF_OK > module/sibling.txt; printf '\nOFF_%s\n' DONE\r");
    await until(() => output(assigned.id).includes('OFF_DONE'));
    assert.equal(await readFile(join(f.root, 'module/sibling.txt'), 'utf8'), 'OFF_OK');
    await writeFile(join(f.root, '.context/modules/registry.yaml'), 'modules:\n  first:\n    paths:\n    - module/sibling.txt\n');
    await assert.rejects(terminal.create({ ...base, nodeId: 'stale', parentSessionId: strict.id }), { code: 'CONFLICT' });
  } finally { await f.dispose(); }
});

test('independent tmux owner preserves shell state, PID, ownership and output across backend restarts', { timeout: 30000 }, async () => {
  const f = await fixture(true);
  try {
    const original = f.kernel.service('terminals');
    const session = await original.create({ projectId: 'default', nodeId: 'persistent', cwd: '.', shell: 'bash', cols: 80, rows: 24,
      ownership: { mode: 'strict', ownerId: 'first' } });
    original.write(session.id, "export DEVTEST_RETAINED=value42; printf '\nBEFORE_%s\n' RESTART\r");
    await until(() => original.read(session.id, 0).chunks.some(chunk => chunk.data.includes('BEFORE_RESTART')));
    await f.restart();
    assert.throws(() => original.inspect(session.id), { code: 'NOT_READY' });
    const resumed = f.kernel.service('terminals');
    const current = resumed.inspect(session.id);
    assert.equal(current.status, 'running');
    assert.equal(current.pid, session.pid);
    assert.deepEqual(current.ownership, session.ownership);
    assert(resumed.read(session.id, 0).chunks.map(chunk => chunk.data).join('').includes('BEFORE_RESTART'));
    resumed.write(session.id, "printf '\nPERSISTED:%s\n' \"$DEVTEST_RETAINED\"; (printf ESCAPE > module/sibling.txt) 2>/dev/null; printf '\nAFTER_%s\n' RESTART\r");
    await until(() => resumed.read(session.id, 0).chunks.map(chunk => chunk.data).join('').includes('AFTER_RESTART'));
    assert(resumed.read(session.id, 0).chunks.map(chunk => chunk.data).join('').includes('PERSISTED:value42'));
    assert.equal(await readFile(join(f.root, 'module/sibling.txt'), 'utf8'), 'sibling-before');
    await resumed.close(session.id);
    await until(() => gone(session.pid));
    await f.restart();
    assert.equal(f.kernel.service('terminals').inspect(session.id).status, 'exited');
  } finally { await f.dispose(); }
});

test('HTTP close completes with duplicate live surface observers and leaves independent fork running', { timeout: 20000 }, async () => {
  const f = await fixture();
  const terminal = f.kernel.service('terminals');
  const controllers: AbortController[] = [];
  try {
    const base = { projectId: 'default', cwd: '.', shell: 'bash' as const, cols: 80, rows: 24 };
    const parent = await terminal.create({ ...base, nodeId: 'parent', ownership: { mode: 'guided', ownerId: 'first' } });
    const other = await terminal.create({ ...base, nodeId: 'other' });
    const fork = await terminal.create({ ...base, nodeId: 'fork', parentSessionId: parent.id });
    for (const session of [parent, other, fork]) for (let index = 0; index < 2; index++) {
      const controller = new AbortController(); controllers.push(controller);
      const stream = await fetch(f.url + '/api/terminals/' + session.id + '/events', { signal: controller.signal });
      assert.equal(stream.status, 200);
      // Initial SSE snapshot proves the observer is installed before close.
      const reader = stream.body!.getReader();
      const initial = await reader.read();
      assert(new TextDecoder().decode(initial.value).includes('event: terminal'));
    }
    const response = await fetch(f.url + '/api/terminals/' + parent.id + '/close', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(3000),
    });
    assert.equal(response.status, 200);
    assert.equal(TerminalSessionSchema.parse(await response.json()).status, 'exited');
    assert.equal(terminal.inspect(fork.id).status, 'running');
    assert.equal(terminal.inspect(other.id).status, 'running');
  } finally { for (const controller of controllers) controller.abort(); await f.dispose(); }
});

test('one multiplexed SSE carries eight sessions, isolates missing IDs and keeps command requests available', { timeout: 30000 }, async () => {
  const f = await fixture();
  const terminal = f.kernel.service('terminals');
  const abort = new AbortController();
  let consume: Promise<void> | undefined;
  const frames: { event: string; value: any }[] = [];
  try {
    const sessions: TerminalSession[] = [];
    for (let index = 0; index < 8; index++) sessions.push(await terminal.create({
      projectId: 'default', nodeId: 'mux-' + index, cwd: '.', shell: 'bash', cols: 80, rows: 24,
    }));
    const missing = '11111111-1111-4111-8111-111111111111';
    const entries = [...sessions.map(session => ({ id: session.id, after: 0 })), { id: missing, after: 0 }];
    const endpoint = (selected: unknown) => f.url + '/api/terminals/events?streams=' + encodeURIComponent(JSON.stringify(selected));
    assert.equal((await fetch(endpoint([{ id: missing, after: -1 }]))).status, 400);
    assert.equal((await fetch(endpoint([{ id: missing, after: 0 }, { id: missing, after: 1 }]))).status, 400);
    assert.equal((await fetch(f.url + '/api/terminals/events?streams=' + 'a'.repeat(8193))).status, 400);
    const stream = await fetch(endpoint(entries), { signal: abort.signal });
    assert.equal(stream.status, 200);
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    consume = (async () => {
      let text = '';
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) return;
          text += decoder.decode(result.value, { stream: true });
          let boundary: number;
          while ((boundary = text.indexOf('\n\n')) !== -1) {
            const frame = text.slice(0, boundary); text = text.slice(boundary + 2);
            const event = /^event: (.+)$/m.exec(frame)?.[1];
            const data = /^data: (.+)$/m.exec(frame)?.[1];
            if (event && data) frames.push({ event, value: JSON.parse(data) });
          }
        }
      } catch (error) { if (!abort.signal.aborted) throw error; }
    })();
    await until(() => sessions.every(session => frames.some(frame => frame.event === 'terminal' && frame.value.session.id === session.id)));
    assert(frames.some(frame => frame.event === 'terminal-error' && frame.value.id === missing && frame.value.code === 'TERMINAL_NOT_FOUND'));
    for (let index = 0; index < sessions.length; index++) terminal.write(sessions[index]!.id,
      `printf '\\nMUX_${index}_%s\\n' READY\r`);
    await until(() => sessions.every((session, index) => frames.some(frame => frame.event === 'terminal' &&
      frame.value.session.id === session.id && frame.value.chunks.some((chunk: { data: string }) => chunk.data.includes(`MUX_${index}_READY`)))));
    const a = sessions[0]!;
    assert.equal((await f.post('/api/terminals/' + a.id + '/resize', { cols: 101, rows: 31 })).status, 200);
    await until(() => frames.some(frame => frame.event === 'terminal' && frame.value.session.id === a.id &&
      frame.value.session.cols === 101 && frame.value.session.rows === 31));
    const close = await fetch(f.url + '/api/terminals/' + a.id + '/close', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(3000),
    });
    assert.equal(close.status, 200);
    await until(() => frames.some(frame => frame.event === 'terminal' && frame.value.session.id === a.id && frame.value.session.status === 'exited'));
    assert(sessions.slice(1).every(session => terminal.inspect(session.id).status === 'running'));
  } finally {
    abort.abort(); await consume; await f.dispose();
  }
});

test('terminal counts do not cap active PTYs, history, observers or SSE connections', { timeout: 45000 }, async () => {
  const f = await fixture(false, false);
  const terminal = f.kernel.service('terminals');
  const sessions: TerminalSession[] = [];
  const controllers: AbortController[] = [];
  const unsubscribe: (() => void)[] = [];
  const base = { projectId: 'default', cwd: '.', shell: 'sh' as const, cols: 80, rows: 24 };
  try {
    for (let index = 0; index < 65; index++) sessions.push(await terminal.create({ ...base, nodeId: 'uncapped-' + index }));
    assert.equal(terminal.list('default').filter(session => session.status === 'running').length, 65);
    assert.equal(new Set(sessions.map(session => session.pid)).size, 65, 'Every active terminal owns its own PTY');
    const first = sessions[0]!;
    const notifications = Array.from({ length: 17 }, () => 0);
    for (let index = 0; index < notifications.length; index++) unsubscribe.push(terminal.subscribe(first.id, () => { notifications[index]!++; }));
    terminal.write(first.id, "printf '\\nUNLIMITED_%s\\n' OBSERVERS\r");
    await until(() => notifications.every(count => count > 0));
    for (const stop of unsubscribe.splice(0)) stop();

    const streams = sessions.map(session => ({ id: session.id, after: 0 }));
    const multiplex = '/api/terminals/events?streams=' + encodeURIComponent(JSON.stringify(streams));
    assert(JSON.stringify(streams).length < 8192, 'The count regression stays within the existing request byte budget');
    const multiplexAbort = new AbortController(); controllers.push(multiplexAbort);
    const multiplexResponse = await fetch(f.url + multiplex, { signal: multiplexAbort.signal });
    assert.equal(multiplexResponse.status, 200, 'More than 64 selected terminals must be accepted');
    const reader = multiplexResponse.body!.getReader();
    let initial = '';
    while (!sessions.every(session => initial.includes(session.id))) {
      const frame = await reader.read(); assert(!frame.done, 'Multiplex output ended before every terminal was observed');
      initial += new TextDecoder().decode(frame.value);
    }
    multiplexAbort.abort(); await reader.cancel().catch(() => {});

    // Keep more than 64 real HTTP responses open, alternating both supported routes.
    const one = '/api/terminals/' + first.id + '/events';
    const selected = '/api/terminals/events?streams=' + encodeURIComponent(JSON.stringify([{ id: first.id, after: 0 }]));
    for (let index = 0; index < 65; index++) {
      const controller = new AbortController(); controllers.push(controller);
      const response = await fetch(f.url + (index % 2 ? selected : one), { signal: controller.signal });
      assert.equal(response.status, 200, 'Observer stream ' + index + ' must not be count-limited');
      const frame = await response.body!.getReader().read();
      assert(new TextDecoder().decode(frame.value).includes(first.id));
    }
    for (const controller of controllers) controller.abort();
    await Promise.all(sessions.map(session => terminal.close(session.id)));
    await until(() => sessions.every(session => gone(session.pid)));
    const next = await terminal.create({ ...base, nodeId: 'after-65-history-records' });
    const history = terminal.list('default');
    assert.equal(history.length, 66, 'Starting another terminal must not prune retained history');
    assert(sessions.every(session => history.some(item => item.id === session.id && item.status === 'exited')));
    assert.equal(terminal.inspect(next.id).status, 'running');
  } finally {
    for (const controller of controllers) controller.abort();
    for (const stop of unsubscribe) stop();
    await f.dispose();
  }
});

for (const systemd of [false, true]) test(`${systemd ? 'Systemd service stop' : 'SIGKILL backend crash'} recovers a Strict shell without duplicating its PID or losing policy`, { timeout: 30000 }, async () => {
  const data = await mkdtemp(join(tmpdir(), 'devtest-terminal-process-'));
  const unit = 'devlab-' + basename(data);
  const execute = promisify(execFile);
  const root = join(data, 'project');
  await mkdir(join(root, '.context/modules'), { recursive: true });
  await writeFile(join(root, 'owned.txt'), 'owned-before');
  await writeFile(join(root, 'sibling.txt'), 'sibling-before');
  await writeFile(join(root, '.context/modules/registry.yaml'),
    'modules:\n  fixture-owner:\n    paths:\n    - owned.txt\n');
  const children: ChildProcessWithoutNullStreams[] = [];
  let current: { child: ChildProcessWithoutNullStreams; url: string; projectId: string; backendPid: number } | undefined;
  const boot = async () => {
    const args = [fileURLToPath(new URL('./terminal-process-fixture.ts', import.meta.url)), data];
    const child = spawnProcess(systemd ? '/usr/bin/systemd-run' : process.execPath,
      systemd ? ['--user', '--pipe', '--quiet', '--collect', '--property=TimeoutStopSec=5', '--unit=' + unit, '--', process.execPath, ...args] : args,
      { cwd: fileURLToPath(new URL('../', import.meta.url)), env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    children.push(child);
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-32768); });
    const lines = createInterface({ input: child.stdout });
    const ready = await new Promise<{ url: string; projectId: string; backendPid: number }>((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error('Process fixture did not become ready: ' + stderr)), 10000);
      const fail = (code: number | null, signal: NodeJS.Signals | null) => {
        clearTimeout(timer); reject(new Error(`Process fixture exited before readiness: ${code}/${signal}: ${stderr}`));
      };
      child.once('exit', fail);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      lines.on('line', line => {
        try {
          const value = JSON.parse(line);
          if (!value.ready) return;
          clearTimeout(timer); child.removeListener('exit', fail);
          resolveReady(value);
        } catch { /* Non-receipt process output is retained by the stream, not interpreted. */ }
      });
    });
    return { child, ...ready };
  };
  const post = (path: string, body: unknown) => fetch(current!.url + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const output = async (id: string) => {
    const response = await fetch(current!.url + '/api/terminals/' + id + '?after=0', { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    return TerminalReplaySchema.parse(await response.json()).chunks.map(chunk => chunk.data).join('');
  };
  try {
    current = await boot();
    assert.notEqual(current.projectId, 'default', 'Crash fixture must use its private registered project');
    const firstBackendPid = current.backendPid;
    const created = await post('/api/terminals', { projectId: current.projectId, nodeId: 'crash-owned',
      cwd: '.', shell: 'bash', cols: 80, rows: 24, ownership: { mode: 'strict', ownerId: 'fixture-owner' } });
    assert.equal(created.status, 200);
    const session = TerminalSessionSchema.parse(await created.json());
    await post('/api/terminals/' + session.id + '/input', {
      data: "export DEVTEST_CRASH_VALUE=retained43; printf '\\nCRASH_%s\\n' BEFORE\r",
    });
    await until(async () => (await output(session.id)).includes('CRASH_BEFORE'));
    const firstExit = once(current.child, 'exit');
    if (systemd) {
      current.child.stdin.end();
      await execute('/usr/bin/systemctl', ['--user', 'stop', unit], { timeout: 10000 });
      await firstExit;
    } else {
      assert(current.child.kill('SIGKILL'));
      const [, signal] = await firstExit;
      assert.equal(signal, 'SIGKILL');
    }
    assert(!gone(session.pid), 'Independent tmux shell must survive the killed backend');
    current = await boot();
    assert.notEqual(current.backendPid, firstBackendPid);
    const listResponse = await fetch(current.url + '/api/terminals?projectId=' + current.projectId);
    const sessions = (await listResponse.json()).map((value: unknown) => TerminalSessionSchema.parse(value));
    assert.equal(sessions.filter((value: TerminalSession) => value.status === 'running').length, 1);
    const restored = sessions.find((value: TerminalSession) => value.id === session.id);
    assert(restored);
    assert.equal(restored.pid, session.pid);
    assert.deepEqual(restored.ownership, session.ownership);
    const duplicate = await post('/api/terminals', { projectId: current.projectId, nodeId: 'crash-owned',
      cwd: '.', shell: 'bash', cols: 80, rows: 24, ownership: { mode: 'strict', ownerId: 'fixture-owner' } });
    assert.equal(duplicate.status, 200);
    assert.equal(TerminalSessionSchema.parse(await duplicate.json()).pid, session.pid);
    await post('/api/terminals/' + session.id + '/input', {
      data: "printf '\\nVALUE:%s\\n' \"$DEVTEST_CRASH_VALUE\"; printf CRASH_OWNED > owned.txt; if printf BAD > sibling.txt; then printf '\\nSCOPE_%s\\n' ESCAPED; else printf '\\nSCOPE_%s\\n' DENIED; fi\r",
    });
    await until(async () => (await output(session.id)).includes('SCOPE_DENIED'));
    assert((await output(session.id)).includes('VALUE:retained43'));
    assert.equal(await readFile(join(root, 'owned.txt'), 'utf8'), 'CRASH_OWNED');
    assert.equal(await readFile(join(root, 'sibling.txt'), 'utf8'), 'sibling-before');
    const closed = await post('/api/terminals/' + session.id + '/close', {});
    assert.equal(closed.status, 200);
    assert.equal(TerminalSessionSchema.parse(await closed.json()).status, 'exited');
    await until(() => gone(session.pid));
  } finally {
    // On assertion failure, recover only this private state and stop its independently owned shells.
    if (!current || current.child.exitCode !== null || current.child.signalCode !== null)
      current = await boot().catch(() => undefined);
    if (current && current.child.exitCode === null && current.child.signalCode === null) {
      try {
        const list = await (await fetch(current.url + '/api/terminals?projectId=' + current.projectId)).json();
        for (const item of list) await post('/api/terminals/' + item.id + '/close', {});
      } finally {
        const exit = once(current.child, 'exit');
        current.child.stdin.end();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([exit, new Promise<never>((_ready, reject) => {
            timeout = setTimeout(() => reject(new Error('Owned process fixture did not close')), 5000);
          })]);
        } finally { clearTimeout(timeout); }
      }
    }
    for (const child of children) if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit;
    }
    if (systemd) await execute('/usr/bin/systemctl', ['--user', 'stop', unit]).catch(() => {});
    await rm(data, { recursive: true, force: true });
  }
});
