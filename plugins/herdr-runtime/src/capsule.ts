import { execFile } from 'node:child_process';
import { constants, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { ApplicationError } from '@devlab/contracts';

const execute = promisify(execFile);
export const HERDR_VERSION = '0.9.3';
export const HERDR_PROTOCOL = 22;
export const HERDR_SHA256 = 'ba0e6d2485b0db8f982ae8aa2ace666c084222f90ee1068af6037e26c17d8992';
export const POLICY_REVISION = 'herdr-bwrap-project-offline-v1';
export const herdrLauncher = () => existsSync('/usr/local/libexec/devlab-herdr-bwrap') ? '/usr/local/libexec/devlab-herdr-bwrap' : '/usr/bin/bwrap';
export const socketDirectory = (state: string) => join(tmpdir(), `devlab-herdr-${process.getuid?.()}`, createHash('sha256').update(state).digest('hex').slice(0, 20));
const base = ['--unshare-all', '--unshare-user', '--disable-userns', '--cap-drop', 'ALL', '--clearenv',
  '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin',
  '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64',
  '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp'];

export async function availability(binary: string, bwrap: string): Promise<string | null> {
  try {
    if (process.platform !== 'linux') throw new Error('Contained Herdr requires Linux Bubblewrap.');
    const hash = createHash('sha256').update(await readFile(binary)).digest('hex');
    if (hash !== HERDR_SHA256) throw new Error('Herdr binary differs from the reviewed 0.9.3 distribution.');
    const schema = JSON.parse((await execute(binary, ['api', 'schema', '--json'], { timeout: 5000, maxBuffer: 2 * 1024 * 1024 })).stdout);
    if (schema.protocol !== HERDR_PROTOCOL) throw new Error('Herdr API protocol does not match the reviewed schema.');
    await execute(bwrap, [...base, '--', '/usr/bin/true'], { timeout: 5000, maxBuffer: 4096 });
    return null;
  } catch (error) {
    const e = error as Error & { stderr?: string };
    return 'Contained runtime unavailable: ' + (e.stderr?.trim() || e.message).slice(0, 600);
  }
}

export async function privateDirectory(path: string, create = true) {
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || await realpath(path) !== path)
    throw new ApplicationError('PATH_DENIED', 'Herdr state must be a private, unaliased host directory.');
  if (create) await chmod(path, 0o700);
}

/** The same root/mount policy surrounds the server and its TUI client. No host HOME,
 * host /run, display socket, credential environment or ordinary-shell fallback. */
export async function capsule(state: string, projectRoot: string, binary: string, bwrap: string, initialize = true) {
  await privateDirectory(state, initialize);
  const runRoot = join(tmpdir(), `devlab-herdr-${process.getuid?.()}`);
  await privateDirectory(runRoot, initialize);
  const home = join(state, 'home'), run = socketDirectory(state);
  await privateDirectory(home, initialize); await privateDirectory(run, initialize);
  const config = join(home, '.config', 'herdr');
  await privateDirectory(config, initialize);
  const pinned = join(state, 'herdr');
  let exists = false;
  try {
    const info = await lstat(pinned);
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.()) throw new Error('Herdr binary ownership is invalid');
    exists = true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (initialize && !exists) { await copyFile(binary, pinned, constants.COPYFILE_EXCL); await chmod(pinned, 0o500); }
  if (createHash('sha256').update(await readFile(pinned)).digest('hex') !== HERDR_SHA256)
    throw new ApplicationError('CONFLICT', 'Herdr changed during runtime preparation.');
  if (initialize) await writeFile(join(config, 'config.toml'), `onboarding = false\n[terminal]\ndefault_shell = "/bin/bash"\nshell_mode = "non_login"\nnew_cwd = "/workspace"\n[update]\nversion_check = false\nmanifest_check = false\n[session]\nresume_agents_on_restore = false\n`, { mode: 0o600 });
  const args = [...base, '--bind', home, '/home/devlab', '--bind', run, '/run/devlab',
    '--ro-bind', pinned, '/opt/herdr', '--bind', projectRoot, '/workspace'];
  // The host's binding records and other DevLab project data are never project mounts.
  const stateTail = relative(projectRoot, state);
  if (stateTail && !isAbsolute(stateTail) && !stateTail.startsWith('..'))
    args.push('--tmpfs', '/workspace/' + stateTail.split('/')[0]);
  for (const [key, value] of Object.entries({ HOME: '/home/devlab', PATH: '/opt:/usr/bin:/bin',
    SHELL: '/bin/bash', TERM: 'xterm-256color', LANG: 'C.UTF-8',
    XDG_CONFIG_HOME: '/home/devlab/.config', XDG_RUNTIME_DIR: '/run/devlab',
    HERDR_CONFIG_PATH: '/home/devlab/.config/herdr/config.toml', HERDR_SOCKET_PATH: '/run/devlab/herdr.sock', HERDR_CLIENT_SOCKET_PATH: '/run/devlab/herdr-client.sock' }))
    args.push('--setenv', key, value);
  args.push('--chdir', '/workspace', '--', '/opt/herdr');
  const clientArgs = [...args, 'client'];
  // A TUI may connect to existing sockets, but cannot unlink/rebind them or start
  // a replacement server when its connection disappears.
  // Server spawn already owns a detached session; another setsid would let its
  // namespace init escape that process group. The PTY client dies with its owner.
  clientArgs.splice(clientArgs.indexOf('--'), 0, '--new-session', '--die-with-parent', '--remount-ro', '/run/devlab');
  return { executable: bwrap, args, clientArgs, cwd: projectRoot, env: { PATH: '/usr/bin:/bin' }, socket: join(run, 'herdr.sock') };
}
