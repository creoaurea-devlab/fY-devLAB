import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { TerminalPersistence, type SavedTerminal } from '../plugins/terminal-pty/src/persistence.ts';

type Reply = { kind: string; pid?: number; message?: string };
async function controller(directory: string) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./terminal-lease-fixture.ts', import.meta.url)), directory],
    { stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = createInterface({ input: child.stdout });
  const replies = lines[Symbol.asyncIterator]();
  let stderr = '';
  child.stderr.on('data', data => { stderr += String(data); });
  const exited = once(child, 'close');
  let closing: Promise<void> | undefined;
  const next = async (): Promise<Reply> => {
    const value = await replies.next();
    assert(!value.done, 'Controller exited before replying: ' + stderr);
    return JSON.parse(value.value) as Reply;
  };
  assert.equal((await next()).kind, 'ready');
  return {
    pid: child.pid!,
    async command(command: string) { child.stdin.write(command + '\n'); return next(); },
    close(crash = false) {
      return closing ??= (async () => {
        if (crash) child.kill('SIGKILL'); else child.stdin.end();
        const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
        try {
          const [code] = await exited;
          assert.equal(stderr, '', 'Controller cleanup must not fail');
          if (!crash) assert.equal(code, 0, 'Controller must exit cleanly after releasing its lock');
        } finally { clearTimeout(timer); lines.close(); }
      })();
    },
  };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'devtest-terminal-lease-'));
  const persistence = new TerminalPersistence(directory, '/unused-tmux');
  const children: Awaited<ReturnType<typeof controller>>[] = [];
  return {
    directory, persistence,
    async child() { const child = await controller(directory); children.push(child); return child; },
    async dispose() {
      const results = await Promise.allSettled(children.map(child => child.close()));
      try { await rm(directory, { recursive: true, force: true }); }
      finally { await rm(persistence.sockets, { recursive: true, force: true }); }
      const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (errors.length) throw new AggregateError(errors.map(result => result.reason), 'Owned lease fixture cleanup failed');
    },
  };
}

test('terminal controllers hold one OS lock across simultaneous stale takeover and metadata loss', { timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.directory, 'owner.json'), JSON.stringify({ pid: 2147483647, identity: 'stale', lease: 'stale' }));
    const contenders = await Promise.all(Array.from({ length: 6 }, () => f.child()));
    const results = await Promise.all(contenders.map(child => child.command('init')));
    assert.equal(results.filter(result => result.kind === 'init').length, 1, 'Exactly one real controller may take over');
    const winner = contenders[results.findIndex(result => result.kind === 'init')]!;
    const original = await readFile(join(f.directory, 'owner.json'), 'utf8');
    assert.equal(JSON.parse(original).pid, winner.pid);
    assert.equal((await stat(join(f.directory, 'owner.json'))).mode & 0o777, 0o600);
    const inode = (await stat(join(f.directory, 'owner.lock'))).ino;
    // The held OS lock remains authoritative even after its Python acquisition helper exits
    // and diagnostic metadata disappears. No stale read can delete another controller's lock.
    await rm(join(f.directory, 'owner.json'));
    const contender = contenders.find(child => child !== winner)!;
    assert.equal((await contender.command('init')).kind, 'error');
    const legacy = { pid: winner.pid, identity: 'invalidated', lease: 'tampered' };
    await writeFile(join(f.directory, 'owner.json'), JSON.stringify(legacy));
    assert.equal((await contender.command('init')).kind, 'error');
    await writeFile(join(f.directory, 'owner.json'), original);
    await winner.close(true);
    assert.equal((await contender.command('init')).kind, 'init', 'SIGKILL must release the inherited file description');
    assert.equal((await stat(join(f.directory, 'owner.lock'))).ino, inode, 'The stable lock inode must never be unlinked');
    assert.equal((await contender.command('release')).kind, 'release');
    await assert.rejects(readFile(join(f.directory, 'owner.json')), { code: 'ENOENT' });
    assert.equal((await contender.command('init')).kind, 'init', 'Explicit release permits a fresh controller');
    assert.equal((await contender.command('release')).kind, 'release');
    assert.deepEqual((await readdir(f.directory)).filter(name => name.endsWith('.tmp')), []);
  } finally { await f.dispose(); }
});

test('terminal lease recovery repairs malformed metadata but preserves active legacy process identities', { timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    const child = await f.child();
    for (const text of ['', '{"pid":', 'null', '{"pid":false,"identity":7}']) {
      await writeFile(join(f.directory, 'owner.json'), text);
      assert.equal((await child.command('init')).kind, 'init', 'Recover incomplete metadata: ' + JSON.stringify(text));
      const owner = JSON.parse(await readFile(join(f.directory, 'owner.json'), 'utf8'));
      assert.equal(owner.pid, child.pid); assert.equal(typeof owner.identity, 'string');
      assert.equal((await child.command('release')).kind, 'release');
    }
    const ownStat = await readFile(`/proc/${process.pid}/stat`, 'utf8');
    const identity = ownStat.slice(ownStat.lastIndexOf(')') + 2).split(' ')[19];
    const legacy = JSON.stringify({ pid: process.pid, identity, lease: 'old-version-without-flock' });
    await writeFile(join(f.directory, 'owner.json'), legacy);
    const denied = await child.command('init');
    assert.equal(denied.kind, 'error'); assert.match(denied.message!, /running backend/);
    assert.equal(await readFile(join(f.directory, 'owner.json'), 'utf8'), legacy, 'Active old-version metadata must remain untouched');
    await writeFile(join(f.directory, 'owner.json'), JSON.stringify({ pid: process.pid, identity: identity + '-different-start', lease: 'reused-pid' }));
    assert.equal((await child.command('init')).kind, 'init', 'A recycled PID is not an active owner');
    assert.equal((await child.command('release')).kind, 'release');
  } finally { await f.dispose(); }
});

test('terminal lease failed initialization and failed release always close the owned OS lock', { timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    const child = await f.child(), successor = await f.child();
    const outside = join(f.directory, 'untouched.txt');
    await writeFile(outside, 'untouched'); await symlink(outside, join(f.directory, 'owner.json'));
    assert.equal((await child.command('init')).kind, 'error', 'Unsafe metadata paths must fail closed');
    assert.equal(await readFile(outside, 'utf8'), 'untouched');
    await rm(join(f.directory, 'owner.json'));
    assert.equal((await successor.command('init')).kind, 'init', 'Failed init must not leak a lock');
    await writeFile(join(f.directory, 'owner.json'), '{');
    assert.equal((await successor.command('release')).kind, 'error', 'Unexpected metadata mutation must be reported');
    assert.equal((await child.command('init')).kind, 'init', 'Failed release still relinquishes its OS lock');
    assert.equal((await child.command('release')).kind, 'release');
  } finally { await f.dispose(); }
});

test('terminal history keeps generation order across resaves and restart, with explicit legacy mtime fallback', async () => {
  const f = await fixture();
  let persistence = f.persistence;
  const older = 'ffffffff-ffff-4fff-bfff-ffffffffffff', newer = '11111111-1111-4111-b111-111111111111';
  const third = '99999999-9999-4999-b999-999999999999', fourth = '22222222-2222-4222-b222-222222222222';
  const record = (id: string, exitCode: number): SavedTerminal => ({ version: 1,
    session: { id, nodeId: 'same-node', projectId: 'default', cwd: f.directory, shell: 'bash',
      cols: 80, rows: 24, pid: process.pid, status: 'exited', exitCode, cursor: 0 },
    chunks: [], root: f.directory, socket: persistence.socket(id), processIdentity: null });
  const path = (id: string) => join(f.directory, id + '.json');
  const restart = async () => {
    await persistence.release(); persistence = new TerminalPersistence(f.directory, '/unused-tmux');
    await persistence.init(); return persistence.load();
  };
  try {
    await persistence.init();
    await persistence.save(record(older, 0)); await persistence.save(record(newer, 17));
    const firstOrder = JSON.parse(await readFile(path(older), 'utf8')).order;
    await persistence.save(record(older, 0));
    assert.equal(JSON.parse(await readFile(path(older), 'utf8')).order, firstOrder, 'Output/state saves retain their original order');
    await utimes(path(older), new Date(), new Date(Date.now() + 60000));
    let loaded = await restart();
    assert.deepEqual(loaded.map(item => item.session.id), [older, newer]);
    assert.equal(loaded.at(-1)!.session.exitCode, 17, 'Latest failed generation must not be hidden by an older clean exit');
    await persistence.save(record(third, 2)); await persistence.save(record(older, 0));
    await persistence.save(record(fourth, 3)); await persistence.save(record(newer, 17));
    loaded = await restart();
    assert.deepEqual(loaded.map(item => item.session.id), [older, newer, third, fourth]);

    // Older editions have no proven creation order. Their actual file mtime is only a fallback.
    for (const [index, id] of [older, newer].entries()) {
      const legacy = JSON.parse(await readFile(path(id), 'utf8')); delete legacy.order;
      await writeFile(path(id), JSON.stringify(legacy));
      await utimes(path(id), new Date(10000 + index * 1000), new Date(10000 + index * 1000));
    }
    loaded = await restart();
    assert.deepEqual(loaded.map(item => item.session.id), [older, newer, third, fourth]);
    const legacyOrder = loaded[0]!.order;
    await persistence.save(record(older, 0));
    loaded = await restart();
    assert.equal(loaded[0]!.order, legacyOrder, 'Resaving a legacy record retains its observed fallback order');
    assert.deepEqual(loaded.map(item => item.session.id), [older, newer, third, fourth]);
    const invalid = { ...JSON.parse(await readFile(path(older), 'utf8')), order: 'invalid' };
    await writeFile(path(older), JSON.stringify(invalid));
    await assert.rejects(persistence.load(), /persistent terminal/);
  } finally { try { await persistence.release(); } finally { await f.dispose(); } }
});
