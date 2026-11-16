import { execFile } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const launcher = fileURLToPath(new URL('../native/ownership-sandbox', import.meta.url));

/** An actual kernel/filter probe. A failed probe never authorizes an ordinary shell. */
export async function strictAvailability(binary = launcher): Promise<{ available: boolean; reason?: string }> {
  if (process.platform !== 'linux') return { available: false, reason: 'Strict ownership requires Linux Landlock.' };
  try {
    const result = await execute(binary, ['--check'], { timeout: 5000, maxBuffer: 4096 });
    if (!/^strict-ready landlock-abi=\d+ offline=1\s*$/.test(result.stdout))
      return { available: false, reason: 'Strict ownership launcher did not verify its boundary.' };
    return { available: true };
  } catch (error) {
    const detail = error as Error & { stderr?: string };
    return { available: false, reason: detail.stderr?.trim() || detail.message };
  }
}

export interface ConfinementOptions {
  root: string;
  /** Exact canonical ownership files resolved by the trusted service, never browser globs. */
  ownershipFiles: readonly string[];
  scratchRoot: string;
  executable: string;
  args: readonly string[];
  cwd: string;
  env: Record<string, string>;
  /** A server-controlled binary path, useful for isolated build/test fixtures. */
  launcher?: string;
}

export interface ConfinedLaunch {
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  dispose(): Promise<void>;
}

function inside(root: string, path: string) {
  const tail = relative(root, path);
  return tail !== '..' && !tail.startsWith('..' + sep) && !isAbsolute(tail);
}

/** Offline file-content write confinement; reads remain available at local-user authority.
 * Owned existing files allow in-place writes. Sibling creation/rename, metadata changes,
 * network and host-control sockets are deliberately unavailable in Strict mode.
 * Cleanup belongs to the process owner, not a renderer or observer. */
export async function prepareConfinement(options: ConfinementOptions): Promise<ConfinedLaunch> {
  const binary = options.launcher ?? launcher;
  const available = await strictAvailability(binary);
  if (!available.available) throw new Error(available.reason || 'Strict ownership is unavailable.');
  const root = await realpath(options.root);
  if (!(await lstat(root)).isDirectory()) throw new Error('Strict ownership requires a project directory.');
  if (!isAbsolute(options.executable)) throw new Error('Confined executable must be an absolute server-selected path.');
  const cwd = await realpath(resolve(root, options.cwd));
  if (!inside(root, cwd) || !(await lstat(cwd)).isDirectory())
    throw new Error('Confined working directory must stay inside the project.');
  if (!options.ownershipFiles.length) throw new Error('Strict ownership has no writable files.');
  const files = new Set<string>();
  for (const raw of options.ownershipFiles) {
    const path = resolve(root, raw);
    if (!inside(root, path) || path === root) throw new Error('Ownership file escapes the project.');
    if (await realpath(path) !== path) throw new Error('Strict ownership rejects symbolic-link aliases.');
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
      throw new Error('Strict ownership requires unaliased regular files.');
    files.add(path);
  }
  await mkdir(options.scratchRoot, { recursive: true, mode: 0o700 });
  const privateRoot = await realpath(options.scratchRoot);
  const scratch = await mkdtemp(resolve(privateRoot, 'strict-'));
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    await rm(scratch, { recursive: true, force: true });
  };
  try {
    await chmod(scratch, 0o700);
    const home = resolve(scratch, 'home'), temporary = resolve(scratch, 'tmp');
    await mkdir(home, { mode: 0o700 });
    await mkdir(temporary, { mode: 0o700 });
    const env = Object.fromEntries(Object.entries(options.env).filter(([key]) =>
      !/^(?:LD_|DYLD_)/.test(key) && ![
        'TMUX', 'TMUX_PANE', 'BASH_ENV', 'ENV', 'PROMPT_COMMAND',
        'GCONV_PATH', 'GLIBC_TUNABLES', 'NODE_OPTIONS',
      ].includes(key)));
    Object.assign(env, {
      HOME: home, TMPDIR: temporary, TMP: temporary, TEMP: temporary,
      XDG_CONFIG_HOME: resolve(home, '.config'), XDG_CACHE_HOME: resolve(home, '.cache'),
      XDG_DATA_HOME: resolve(home, '.local/share'), XDG_RUNTIME_DIR: temporary,
      DEVLAB_OWNERSHIP_MODE: 'strict', DEVLAB_STRICT_OFFLINE: '1',
    });
    return {
      executable: binary,
      args: ['--scratch', scratch, ...[...files].flatMap(path => ['--file', path]),
        '--', options.executable, ...options.args],
      cwd, env, dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
