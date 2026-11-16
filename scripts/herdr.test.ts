import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { inspect } from 'node:util';
import { Kernel } from '@devlab/kernel';
import { ApplicationError, HerdrCommandSchema, HerdrSnapshotSchema, type HerdrSnapshot, type PluginDefinition } from '@devlab/contracts';
import { terminalPty } from '@devlab/terminal-pty';
import { httpTransport } from '@devlab/transport-http';
import { herdrRuntime, herdrAvailability, herdrRequest, herdrLauncher } from '../plugins/herdr-runtime/src/index.ts';

const grants = ['process:local', 'storage:local', 'terminal:local', 'network:loopback'];
function roots(root: string): PluginDefinition {
  return { manifest: { id: 'fixture-roots', version: '1', apiVersion: 1, provides: ['workspace'], requires: [], capabilities: [], reload: 'restart' },
    activate(scope) { scope.provide('workspace', { async resolve(id) {
      if (id !== 'test') throw new ApplicationError('PATH_DENIED', 'Unknown project');
      return root;
    } }); } };
}

test('Herdr commands refuse authority fields, paths, arbitrary IDs and unbounded input', () => {
  for (const value of [{ type: 'start', socket: '/run/foreign.sock' }, { type: 'start', mode: 'off' },
    { type: 'split', paneId: 'w1:p1', direction: 'right', cwd: '/home' },
    { type: 'input', paneId: '../foreign', text: 'x' }, { type: 'input', paneId: 'w1:p1', text: 'x'.repeat(16385) },
    { type: 'resize', paneId: 'w1:p1', direction: 'left', amount: 99 }, { type: 'rename', paneId: 'w1:p1', label: '\u001b[2J' }])
    assert.equal(HerdrCommandSchema.safeParse(value).success, false, JSON.stringify(value).slice(0, 100));
  assert.equal(HerdrCommandSchema.parse({ type: 'split', paneId: 'w1:p1', direction: 'down' }).type, 'split');
});

test('Herdr protocol uses request IDs, refuses foreign responses, and never retries mutations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'herdr-rpc-')), path = join(directory, 'api.sock');
  let requests = 0, wrongId = false;
  const server = createServer(socket => {
    let buffer = ''; socket.setEncoding('utf8'); socket.on('error', () => {});
    socket.on('data', chunk => {
      buffer += chunk; if (!buffer.includes('\n')) return;
      requests++; const message = JSON.parse(buffer);
      assert.equal(message.method, 'pane.focus');
      socket.end(JSON.stringify({ id: wrongId ? 'other' : message.id, result: { type: 'ok' } }) + '\n');
    });
  });
  await new Promise<void>(done => server.listen(path, done));
  try {
    assert.deepEqual(await herdrRequest(path, 'pane.focus', { pane_id: 'w1:p1' }), { type: 'ok' });
    wrongId = true; await assert.rejects(herdrRequest(path, 'pane.focus', { pane_id: 'w1:p1' }), /identity mismatch/);
    assert.equal(requests, 2);
  } finally { await new Promise<void>(done => server.close(() => done())); await rm(directory, { recursive: true, force: true }); }
});

test('unsupported containment is visible through HTTP; startup and forged modes cannot launch a shell', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'herdr-unavailable-')), kernel = new Kernel(grants);
  try {
    await kernel.start([roots(directory), terminalPty(), herdrRuntime({ stateDirectory: join(directory, 'state'), binary: join(directory, 'missing-herdr') }),
      httpTransport({ port: 0, herdr: true, terminals: true, diagnostics: () => ({ phase: kernel.phase, plugins: kernel.health() }) })]);
    const origin = kernel.service('http').url;
    const value = HerdrSnapshotSchema.parse(await (await fetch(origin + '/api/herdr?projectId=test')).json());
    assert.equal(value.state, 'unavailable'); assert.equal(value.attachment, null); assert.equal(value.policy.network, 'offline');
    assert.match(value.message, /unavailable/);
    const command = (value: unknown, id = 'test') => fetch(origin + '/api/herdr/' + id, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
    assert.equal((await command({ type: 'start', mode: 'off' })).status, 400);
    assert.equal((await (await command({ type: 'start' })).json()).code, 'HERDR_UNAVAILABLE');
    assert.equal((await (await command({ type: 'start' }, 'foreign')).json()).code, 'PATH_DENIED');
    assert.deepEqual(kernel.service('terminals').list('test'), []);
    assert.equal((await fetch(origin + '/api/herdr?projectId=test', { headers: { origin: 'https://foreign.invalid' } })).status, 403);
  } finally { await kernel.close(); await rm(directory, { recursive: true, force: true }); }
});

test('managed TUI transport retains one PTY, refuses ordinary create/fork, and detaches cleanly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'herdr-pty-')), kernel = new Kernel(grants);
  try {
    await kernel.start([roots(directory), terminalPty()]);
    const terminals = kernel.service('terminals');
    const command = { projectId: 'test', nodeId: 'herdr:test', executable: '/bin/sh', args: ['-c', 'printf managed-ready; exec sleep 60'], cwd: directory, env: { PATH: '/usr/bin:/bin' }, cols: 100, rows: 30 };
    const [a, b] = await Promise.all([terminals.attachManaged!(command), terminals.attachManaged!(command)]);
    assert.equal(a.id, b.id); assert.equal(a.pid, b.pid); assert.equal(a.kind, 'herdr');
    for (let i = 0; i < 50 && !terminals.read(a.id, 0).chunks.length; i++) await delay(20);
    assert.match(terminals.read(a.id, 0).chunks.map(c => c.data).join(''), /managed-ready/);
    assert.deepEqual(terminals.list('test'), [], 'ordinary terminal dock must not adopt Herdr attachments');
    assert.throws(() => terminals.create({ projectId: 'test', nodeId: 'herdr:test', cwd: '.', shell: 'bash', cols: 80, rows: 24 }), { code: 'PATH_DENIED' });
    await assert.rejects(terminals.create({ projectId: 'test', nodeId: 'other', parentSessionId: a.id, cwd: '.', shell: 'bash', cols: 80, rows: 24 }), { code: 'PATH_DENIED' });
    assert.equal((await terminals.close(a.id)).status, 'exited');
    assert.throws(() => process.kill(a.pid, 0), { code: 'ESRCH' });
  } finally { await kernel.close(); await rm(directory, { recursive: true, force: true }); }
});

test('only one backend controls a Herdr store; releasing its OS lock permits the next owner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'herdr-lease-'));
  const a = new Kernel(grants), b = new Kernel(grants);
  try {
    for (const kernel of [a, b]) await kernel.start([roots(directory), terminalPty(),
      herdrRuntime({ stateDirectory: join(directory, 'state'), binary: join(directory, 'missing') })]);
    await assert.rejects(a.service('herdr').command('test', { type: 'start' }), { code: 'HERDR_UNAVAILABLE' });
    await assert.rejects(b.service('herdr').command('test', { type: 'start' }), { code: 'CONFLICT' });
    await a.close();
    await assert.rejects(b.service('herdr').command('test', { type: 'start' }), { code: 'HERDR_UNAVAILABLE' });
  } finally { await a.close(); await b.close(); await rm(directory, { recursive: true, force: true }); }
});

test('stale owned sockets recover; live unverified endpoints and changed roots are preserved', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'herdr-stale-')), kernel = new Kernel(grants);
  const state = join(directory, 'state'), projectState = join(state, createHash('sha256').update('test').digest('hex').slice(0, 20));
  const run = join(tmpdir(), `devlab-herdr-${process.getuid?.()}`, createHash('sha256').update(projectState).digest('hex').slice(0, 20));
  const path = join(run, 'herdr.sock'), file = join(projectState, 'binding.json');
  const server = createServer(socket => socket.destroy());
  try {
    await kernel.start([roots(directory), terminalPty(), herdrRuntime({ stateDirectory: state, binary: join(directory, 'missing') })]);
    const api = kernel.service('herdr'), revision = (await api.snapshot('test')).policy.revision;
    await mkdir(projectState, { recursive: true, mode: 0o700 }); await mkdir(run, { recursive: true, mode: 0o700 });
    const binding = { root: directory, pid: 2147483647, identity: '0', namespacePid: 2147483647, namespaceIdentity: '0', revision };
    await writeFile(file, JSON.stringify(binding));
    await new Promise<void>(done => server.listen(path, done));
    await assert.rejects(api.command('test', { type: 'stop' }), /live unverified owner/);
    assert((await lstat(path)).isSocket()); assert((await lstat(file)).isFile());
    await new Promise<void>(done => server.close(() => done()));
    execFileSync('python3', ['-c', 'import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1]); s.close()', path]);
    await writeFile(file, JSON.stringify({ ...binding, root: '/foreign' }));
    await assert.rejects(api.command('test', { type: 'stop' }), /root changed/);
    assert((await lstat(path)).isSocket());
    await writeFile(file, JSON.stringify(binding));
    await api.command('test', { type: 'stop' });
    await assert.rejects(lstat(path), { code: 'ENOENT' }); await assert.rejects(lstat(file), { code: 'ENOENT' });
    await api.command('test', { type: 'stop' }); // Idempotent after crash cleanup.
  } finally {
    if (server.listening) await new Promise<void>(done => server.close(() => done()));
    await kernel.close(); await rm(directory, { recursive: true, force: true }); await rm(run, { recursive: true, force: true });
  }
});

test('HTTP prevents project deletion and forgetting while Herdr is running or uncertain', async () => {
  const kernel = new Kernel(grants); let removed = 0;
  let status: HerdrSnapshot['state'] = 'running';
  const unsupported = async (): Promise<never> => { throw new Error('Unexpected fixture call'); };
  const fixture: PluginDefinition = {
    manifest: { id: 'fixture-projects-herdr', version: '1', apiVersion: 1, provides: ['projects', 'herdr'], requires: [], capabilities: [], reload: 'restart' },
    activate(scope) {
      scope.provide('projects', { list: async () => [{ id: 'test', label: 'Test', base: false, location: '/fixture', development: { sourceProjectId: 'base', pluginId: 'test', ownerId: 'test', sourcePath: 'test', createdAt: new Date().toISOString() } }],
        deleteThread: async () => { removed++; }, forget: async () => { removed++; }, root: unsupported, open: unsupported, create: unsupported, inspect: unsupported, read: unsupported, write: unsupported, createModule: unsupported });
      scope.provide('herdr', { command: unsupported, snapshot: async projectId => ({ projectId, state: status, message: '', version: '0.9.3', protocol: 22,
        policy: { mode: 'contained-project', network: 'offline', revision: 'fixture', projectPath: '/workspace' }, workspaces: [], panes: [], attachment: null }) });
    },
  };
  try {
    await kernel.start([fixture, httpTransport({ port: 0, projects: true, herdr: true, diagnostics: () => ({ phase: kernel.phase, plugins: kernel.health() }) })]);
    const origin = kernel.service('http').url;
    const remove = (action: string) => fetch(origin + '/api/projects/test/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    for (const state of ['running', 'error'] as const) {
      status = state;
      for (const action of ['delete-thread', 'forget']) assert.equal((await remove(action)).status, 409);
    }
    assert.equal(removed, 0); status = 'stopped';
    assert.equal((await remove('forget')).status, 200);
    assert.equal((await remove('delete-thread')).status, 200); assert.equal(removed, 2);
  } finally { await kernel.close(); }
});

test('real contained Herdr: start, pane controls, detach, host-file refusal and cleanup', async t => {
  const binary = join(homedir(), '.local/bin/herdr');
  const reason = await herdrAvailability(binary, herdrLauncher());
  if (reason) { t.skip(reason); return; }
  const directory = await mkdtemp(join(tmpdir(), 'herdr-real-')); let kernel = new Kernel(grants);
  const outside = join(tmpdir(), 'herdr-private-' + process.pid);
  await writeFile(outside, 'HOST-SECRET');
  const foreignSocket = join(tmpdir(), 'herdr-foreign-' + process.pid + '.sock');
  let connections = 0;
  const hostTCP = createServer(socket => { connections++; socket.destroy(); }), hostUnix = createServer(socket => { connections++; socket.destroy(); });
  await new Promise<void>(done => hostTCP.listen(0, '127.0.0.1', done));
  await new Promise<void>(done => hostUnix.listen(foreignSocket, done));
  const port = (hostTCP.address() as import('node:net').AddressInfo).port;
  const priorEnv = process.env.HERDR_BOUNDARY_TEST; process.env.HERDR_BOUNDARY_TEST = 'not-inherited';
  const definitions = () => [roots(directory), terminalPty(), herdrRuntime({ stateDirectory: join(directory, 'state'), preserveOnDispose: true })];
  try {
    await kernel.start(definitions());
    const api = kernel.service('herdr');
    assert.equal((await api.command('test', { type: 'start' })).state, 'running');
    const created = await api.command('test', { type: 'create', label: 'Integration' });
    const pane = created.panes.find(p => p.focused)!; assert(pane);
    const attached = await api.command('test', { type: 'attach' }); assert(attached.attachment);
    const again = await api.command('test', { type: 'attach' }); assert.equal(again.attachment!.id, attached.attachment.id);
    let events = 0; const unsubscribe = api.subscribe!('test', () => { events++; });
    for (let i = 0; i < 100 && !events; i++) await delay(20);
    assert(events > 0, 'subscription acknowledges initial authoritative state'); const beforeSplit = events;
    await api.command('test', { type: 'rename', paneId: pane.id, label: 'Shell' });
    const split = await api.command('test', { type: 'split', paneId: pane.id, direction: 'right' }); assert(split.panes.length > created.panes.length);
    for (let i = 0; i < 100 && events === beforeSplit; i++) await delay(20);
    assert(events > beforeSplit, 'native layout/pane event invalidates the snapshot');
    await api.command('test', { type: 'resize', paneId: pane.id, direction: 'right', amount: 0.1 });
    await api.command('test', { type: 'focus', paneId: pane.id });
    assert((await api.command('test', { type: 'zoom', paneId: pane.id, mode: 'on' })).panes.find(p => p.id === pane.id)?.zoomed);
    assert.equal((await api.command('test', { type: 'zoom', paneId: pane.id, mode: 'off' })).panes.find(p => p.id === pane.id)?.zoomed, false);
    await api.command('test', { type: 'input', paneId: pane.id, text: `test ! -r '${outside}' && printf contained > /workspace/probe-result\n` });
    await api.command('test', { type: 'key', paneId: pane.id, key: 'enter' });
    for (let i = 0; i < 100; i++) { if (await readFile(join(directory, 'probe-result'), 'utf8').catch(() => '') === 'contained') break; await delay(50); }
    assert.equal(await readFile(join(directory, 'probe-result'), 'utf8'), 'contained');
    const probe = `import os,socket,pathlib,subprocess
assert subprocess.check_output(['herdr','--version'],text=True).strip() == 'herdr 0.9.3'
assert 'HERDR_BOUNDARY_TEST' not in os.environ
assert not pathlib.Path(${JSON.stringify(outside)}).exists()
assert not pathlib.Path('/workspace/state/host.lock').exists()
for family,address in [(socket.AF_INET,('127.0.0.1',${port})),(socket.AF_UNIX,${JSON.stringify(foreignSocket)})]:
 s=socket.socket(family);s.settimeout(.5)
 try:s.connect(address)
 except OSError:pass
 else:raise AssertionError('host socket reachable')
 finally:s.close()
pathlib.Path('/workspace/boundary-result').write_text('isolated')`;
    const quoted = "'" + probe.replaceAll("'", "'\\''") + "'";
    await api.command('test', { type: 'input', paneId: pane.id, text: 'python3 -c ' + quoted });
    await api.command('test', { type: 'key', paneId: pane.id, key: 'enter' });
    for (let i = 0; i < 100 && await readFile(join(directory, 'boundary-result'), 'utf8').catch(() => '') !== 'isolated'; i++) await delay(50);
    assert.equal(await readFile(join(directory, 'boundary-result'), 'utf8'), 'isolated'); assert.equal(connections, 0);
    assert.equal((await api.command('test', { type: 'detach' })).state, 'running');
    unsubscribe(); const afterUnsubscribe = events;
    const state = join(directory, 'state', createHash('sha256').update('test').digest('hex').slice(0, 20));
    const binding = JSON.parse(await readFile(join(state, 'binding.json'), 'utf8'));
    await kernel.close(); kernel = new Kernel(grants); await kernel.start(definitions());
    const recovered = await kernel.service('herdr').snapshot('test');
    assert.equal(recovered.state, 'running'); assert.equal(recovered.attachment, null); assert(recovered.panes.some(p => p.id === pane.id && p.label === 'Shell'));
    const reattached = await kernel.service('herdr').command('test', { type: 'attach' }); assert(reattached.attachment);
    assert.notEqual(reattached.attachment.id, attached.attachment.id);
    assert.equal(JSON.parse(await readFile(join(state, 'binding.json'), 'utf8')).namespacePid, binding.namespacePid);
    assert.equal((await kernel.service('herdr').command('test', { type: 'stop' })).state, 'stopped');
    // /proc may briefly retain a reaped namespace init as a zombie; it must not be alive.
    const stat = await readFile(`/proc/${binding.namespacePid}/stat`, 'utf8').catch(() => '');
    assert(!stat || stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z '));
    assert.equal((await kernel.service('herdr').command('test', { type: 'start' })).state, 'running');
    assert.notEqual(JSON.parse(await readFile(join(state, 'binding.json'), 'utf8')).namespacePid, binding.namespacePid);
    await kernel.service('herdr').command('test', { type: 'stop' });
    assert.equal(events, afterUnsubscribe, 'disposed observer receives no later runtime events');
  } catch (error) { t.diagnostic(inspect(error, { depth: 10 })); throw error; }
  finally {
    if (priorEnv === undefined) delete process.env.HERDR_BOUNDARY_TEST; else process.env.HERDR_BOUNDARY_TEST = priorEnv;
    await new Promise<void>(done => hostTCP.close(() => done())); await new Promise<void>(done => hostUnix.close(() => done()));
    await kernel.service('herdr').command('test', { type: 'stop' }).catch(() => {});
    await kernel.close().catch(error => { t.diagnostic(inspect(error, { depth: 10 })); throw error; });
    await rm(directory, { recursive: true, force: true }); await rm(outside, { force: true });
  }
});

test('a killed backend reconnects to the same independent Herdr namespace and pane', async t => {
  const reason = await herdrAvailability(join(homedir(), '.local/bin/herdr'), herdrLauncher());
  if (reason) { t.skip(reason); return; }
  const directory = await mkdtemp(join(tmpdir(), 'herdr-crash-')), stateDirectory = join(directory, 'state'), kernel = new Kernel(grants);
  const source = `import { Kernel } from '@devlab/kernel'; import { terminalPty } from '@devlab/terminal-pty';
    import { herdrRuntime } from ${JSON.stringify(new URL('../plugins/herdr-runtime/src/index.ts', import.meta.url).href)};
    const kernel = new Kernel(${JSON.stringify(grants)});
    await kernel.start([{manifest:{id:'roots',version:'1',apiVersion:1,provides:['workspace'],requires:[],capabilities:[],reload:'restart'},activate(s){s.provide('workspace',{async resolve(){return ${JSON.stringify(directory)}}})}},terminalPty(),herdrRuntime({stateDirectory:${JSON.stringify(stateDirectory)},preserveOnDispose:true})]);
    await kernel.service('herdr').command('test',{type:'start'});
    console.log(JSON.stringify(await kernel.service('herdr').command('test',{type:'create',label:'Survives backend'})));
    setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostic = ''; child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-2000); });
  try {
    const original = await new Promise<HerdrSnapshot>((done, fail) => {
      let buffer = ''; const timer = setTimeout(() => fail(new Error('Crash fixture startup timed out. ' + diagnostic)), 12000);
      child.once('error', fail); child.once('exit', () => { clearTimeout(timer); fail(new Error('Crash fixture exited. ' + diagnostic)); });
      child.stdout.on('data', chunk => { buffer += chunk; const end = buffer.indexOf('\n'); if (end >= 0) { clearTimeout(timer); try { done(HerdrSnapshotSchema.parse(JSON.parse(buffer.slice(0, end)))); } catch (error) { fail(error); } } });
    });
    const bindingFile = join(stateDirectory, createHash('sha256').update('test').digest('hex').slice(0, 20), 'binding.json');
    const binding = JSON.parse(await readFile(bindingFile, 'utf8'));
    child.kill('SIGKILL'); await new Promise<void>(done => child.once('exit', () => done()));
    await kernel.start([roots(directory), terminalPty(), herdrRuntime({ stateDirectory })]);
    const recovered = await kernel.service('herdr').snapshot('test');
    assert.equal(recovered.state, 'running'); assert.deepEqual(recovered.panes.map(p => p.id), original.panes.map(p => p.id));
    assert.equal(JSON.parse(await readFile(bindingFile, 'utf8')).namespacePid, binding.namespacePid);
    assert((await kernel.service('herdr').command('test', { type: 'attach' })).attachment);
    await kernel.service('herdr').command('test', { type: 'stop' });
    const stat = await readFile(`/proc/${binding.namespacePid}/stat`, 'utf8').catch(() => '');
    assert(!stat || stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z '));
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await kernel.close(); await rm(directory, { recursive: true, force: true });
  }
});
