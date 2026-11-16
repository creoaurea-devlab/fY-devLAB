import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, link, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { after, before, test } from 'node:test';
import { prepareConfinement, strictAvailability } from '../plugins/terminal-pty/src/confinement.ts';

const execute = promisify(execFile);
let directory = '', binary = '';
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'devtest-confinement-'));
  binary = join(directory, 'ownership-sandbox');
  await execute('gcc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror',
    fileURLToPath(new URL('../plugins/terminal-pty/native/ownership-sandbox.c', import.meta.url)), '-o', binary]);
});
after(async () => { await rm(directory, { recursive: true, force: true }); });

async function fixture() {
  const root = await mkdtemp(join(directory, 'project-'));
  const owned = join(root, 'owned.txt'), sibling = join(root, 'sibling.txt');
  await writeFile(owned, 'owned original');
  await writeFile(sibling, 'sibling original');
  const scratchRoot = join(directory, 'scratch');
  const options = { root, ownershipFiles: ['owned.txt'], scratchRoot, executable: '/bin/bash',
    args: ['--noprofile', '--norc', '-c', 'true'], cwd: root,
    env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', TERM: 'xterm-256color' }, launcher: binary };
  const run = async (script: string, args: string[] = []) => {
    const launch = await prepareConfinement({ ...options,
      args: ['--noprofile', '--norc', '-c', script, 'fixture', ...args] });
    try {
      try {
        const result = await execute(launch.executable, launch.args,
          { cwd: launch.cwd, env: launch.env, timeout: 5000, maxBuffer: 65536 });
        return { status: 0, ...result };
      } catch (error) {
        const result = error as Error & { code?: number; stdout?: string; stderr?: string };
        return { status: result.code ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? result.message };
      }
    } finally { await launch.dispose(); }
  };
  return { root, owned, sibling, options, run };
}

test('real Landlock/filter probe works without privileged namespaces; missing launcher fails closed', async () => {
  assert.deepEqual(await strictAvailability(binary), { available: true });
  assert.equal((await strictAvailability(join(directory, 'missing'))).available, false);
  const f = await fixture();
  await assert.rejects(prepareConfinement({ ...f.options, launcher: join(directory, 'missing') }));
});

test('Strict permits owned content and private scratch, and retains ordinary child commands', async () => {
  const f = await fixture();
  const result = await f.run('printf changed > "$1"; cat "$1"; printf private > "$TMPDIR/test"; /bin/sh -c \'cat "$TMPDIR/test"\'', [f.owned]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'changedprivate');
  assert.equal(await readFile(f.owned, 'utf8'), 'changed');
  assert.equal(await readFile(f.sibling, 'utf8'), 'sibling original');
});

test('Strict rejects sibling, absolute, symlink, child, creation, metadata and atomic replacement writes', async () => {
  const f = await fixture();
  const outside = join(directory, 'outside.txt');
  await writeFile(outside, 'outside original');
  const alias = join(f.root, 'alias');
  await symlink(f.sibling, alias);
  const commands = [
    ['printf forbidden > "$1"', f.sibling],
    ['printf forbidden > "$1"', outside],
    ['printf forbidden > "$1"', alias],
    ['/bin/sh -c \'printf forbidden > "$1"\' child "$1"', f.sibling],
    ['printf forbidden > "$1"', join(f.root, 'new-file')],
    ['rm "$1"', f.sibling],
    ['chmod 777 "$1"', f.sibling],
    ['touch "$1"', f.sibling],
    ['printf replacement > "$TMPDIR/new"; mv "$TMPDIR/new" "$1"', f.owned],
  ];
  const before = await lstat(f.sibling);
  for (const [script, path] of commands) {
    const result = await f.run(script!, [path!]);
    assert.notEqual(result.status, 0, script + ': ' + result.stdout + result.stderr);
  }
  assert.equal(await readFile(f.owned, 'utf8'), 'owned original');
  assert.equal(await readFile(f.sibling, 'utf8'), 'sibling original');
  assert.equal(await readFile(outside, 'utf8'), 'outside original');
  assert.equal((await lstat(f.sibling)).mode, before.mode);
  assert.equal((await lstat(f.sibling)).mtimeMs, before.mtimeMs);
});

test('policy preparation rejects symlink/hardlink aliases and escaped working directories', async () => {
  const f = await fixture();
  const alias = join(f.root, 'link.txt');
  await symlink(f.owned, alias);
  await assert.rejects(prepareConfinement({ ...f.options, ownershipFiles: ['link.txt'] }), /symbolic-link/);
  await link(f.owned, join(f.root, 'hard.txt'));
  await assert.rejects(prepareConfinement(f.options), /unaliased regular/);
  await assert.rejects(prepareConfinement({ ...f.options, cwd: dirname(f.root) }), /working directory/);
  await assert.rejects(prepareConfinement({ ...f.options, ownershipFiles: [] }), /no writable/);
  await assert.rejects(prepareConfinement({ ...f.options, ownershipFiles: ['../outside.txt'] }), /escapes/);
});

test('Strict closes inherited descriptors and blocks TCP/Unix sockets and parent signals', async () => {
  const f = await fixture();
  const python = '/usr/bin/python3';
  for (const family of ['socket.AF_INET', 'socket.AF_UNIX']) {
    const result = await f.run('exec "$1" -c "$2"', [python,
      `import socket; socket.socket(${family}, socket.SOCK_STREAM)`]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Operation not permitted/);
  }
  const ipc = await f.run('exec "$1" -c "$2"', [python,
    'import ctypes,errno; c=ctypes.CDLL(None,use_errno=True); result=c.shmget(0,4096,0o1600); code=ctypes.get_errno(); c.shmctl(result,0,None) if result>=0 else None; assert result==-1 and code==errno.EPERM']);
  assert.equal(ipc.status, 0, 'System V IPC must be denied: ' + ipc.stderr);
  const victim = spawn('/bin/sleep', ['30'], { stdio: 'ignore' });
  const exited = new Promise<void>(resolve => victim.once('exit', () => resolve()));
  try {
    const result = await f.run('kill -TERM "$1"', [String(victim.pid)]);
    assert.notEqual(result.status, 0, 'Strict cannot signal a process outside its Landlock domain');
    assert.equal(victim.exitCode, null);
  } finally { victim.kill(); await exited; }
  const launch = await prepareConfinement({ ...f.options, args: ['--noprofile', '--norc', '-c', 'printf escaped >&3'] });
  const file = join(directory, 'inherited.txt');
  await writeFile(file, 'preserved');
  const { open } = await import('node:fs/promises');
  const handle = await open(file, 'r+');
  try {
    const child = spawn(launch.executable, launch.args,
      { cwd: launch.cwd, env: launch.env, stdio: ['ignore', 'ignore', 'ignore', handle.fd] });
    const status = await new Promise<number | null>(resolve => child.once('exit', resolve));
    assert.notEqual(status, 0);
    assert.equal(await readFile(file, 'utf8'), 'preserved');
  } finally { await handle.close(); await launch.dispose(); }
});

test('private HOME/environment and idempotent cleanup are process-owned', async () => {
  const f = await fixture();
  await mkdir(f.options.scratchRoot, { recursive: true });
  const launch = await prepareConfinement({ ...f.options,
    env: { ...f.options.env, LD_PRELOAD: 'untrusted.so', TMUX: '/host/socket', BASH_ENV: '/host/script' } });
  assert.equal(launch.env.LD_PRELOAD, undefined);
  assert.equal(launch.env.TMUX, undefined);
  assert.equal(launch.env.BASH_ENV, undefined);
  assert.equal(launch.env.DEVLAB_STRICT_OFFLINE, '1');
  const home = launch.env.HOME!;
  assert(home.startsWith(f.options.scratchRoot));
  assert.equal((await lstat(home)).mode & 0o777, 0o700);
  await chmod(join(f.root, 'owned.txt'), 0o600);
  await launch.dispose(); await launch.dispose();
  await assert.rejects(lstat(home), { code: 'ENOENT' });
});
