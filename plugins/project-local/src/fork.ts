import { readdir, lstat, realpath, readFile, writeFile, mkdir, copyFile, cp, readlink, symlink, rm, rename } from 'node:fs/promises';
import { resolve, relative, sep, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ApplicationError, ForkProjectSchema, ProjectDevelopmentSchema } from '@devlab/contracts';

const execute = promisify(execFile);
const excluded = new Set(['_LAB', '_BACKUP', '.git', '.data', '.cache', '.recovery', 'node_modules', 'dist', 'build-output', 'coverage', '__pycache__', '.venv', 'venv']);
const denied = (message: string) => new ApplicationError('PATH_DENIED', message);

async function regular(root: string, path: string): Promise<string> {
  const file = resolve(root, path);
  if (isAbsolute(path) || path.split(/[\\/]/).some(p => !p || p === '..' || p === '.' || p === '_BACKUP') ||
    !file.startsWith(root + sep) || await realpath(file).catch(() => '') !== file || !(await lstat(file)).isFile())
    throw denied('Development source must be a regular project file');
  return file;
}

/** Resolve the selected plugin from canonical ownership and its real package identity. */
async function pluginSource(root: string, pluginId: string) {
  const reader = fileURLToPath(new URL('../../../.agents/data/definitions.py', import.meta.url));
  const python = process.env.DEVLAB_PYTHON ?? (process.platform === 'linux' ? '/usr/bin/python3' : 'python3');
  if (process.env.DEVLAB_PYTHON && !isAbsolute(python)) throw denied('DEVLAB_PYTHON must name an absolute trusted host interpreter');
  let data: unknown;
  try {
    const { stdout } = await execute(python, ['-I', '-B', reader, 'ownership', '--root', root],
      { timeout: 10000, maxBuffer: 1024 * 1024 });
    data = JSON.parse(stdout);
  } catch {
    throw denied(`Canonical ownership could not be read with ${python}; the trusted host interpreter requires PyYAML and valid project definitions`);
  }
  if (!Array.isArray(data)) throw denied('Canonical ownership registry is unavailable');
  const matches: { ownerId: string; sourcePath: string }[] = [];
  for (const value of data) {
    if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !Array.isArray(value.paths))
      throw denied('Canonical ownership registry is unavailable');
    const ownerId: string = value.id;
    for (const path of value.paths) {
      if (typeof path !== 'string' || !path.startsWith('plugins/') || !path.endsWith('/package.json')) continue;
      const file = await regular(root, path);
      const pkg = JSON.parse(await readFile(file, 'utf8')) as { name?: unknown };
      if (typeof pkg.name === 'string' && pkg.name.startsWith('@devlab/') && pkg.name.slice('@devlab/'.length) === pluginId)
        matches.push({ ownerId, sourcePath: dirname(path) });
    }
  }
  if (matches.length !== 1) throw denied('Select one locally owned plugin to develop');
  return { ...matches[0]!, ownershipSnapshot: JSON.stringify(data) };
}

/** Physical source copy; live data, secrets, links and operational DB state never cross threads. */
async function copySource(source: string, destination: string, projectsRoot: string) {
  let files = 0;
  async function walk(from: string, to: string) {
    await mkdir(to, { recursive: true, mode: 0o700 });
    for (const item of await readdir(from, { withFileTypes: true })) {
      if (excluded.has(item.name) || item.name === '.env' || item.name.startsWith('.env.') ||
        /\.(?:sqlite|db)(?:-wal|-shm)?$/.test(item.name) || /\.(?:pem|key|crt)$/.test(item.name)) continue;
      const input = resolve(from, item.name), output = resolve(to, item.name);
      if (input === projectsRoot || input.startsWith(projectsRoot + sep)) continue;
      if (relative(source, input).split(sep).join('/') === '.agents/state') continue;
      const info = await lstat(input);
      if (info.isSymbolicLink()) continue;
      if (await realpath(input) !== input) throw denied('Development source changed while copying');
      if (info.isDirectory()) await walk(input, output);
      else if (info.isFile()) {
        if (++files > 50000) throw denied('Development source file budget exceeded');
        await copyFile(input, output);
      }
    }
  }
  await walk(source, destination);
}

export async function forkProject(options: {
  sourceRoot: string; projectsRoot: string; command: { sourceProjectId: string; pluginId: string; label?: string };
}): Promise<string> {
  const command = ForkProjectSchema.parse(options.command);
  const sourceRoot = await realpath(options.sourceRoot);
  const projectsRoot = resolve(options.projectsRoot);
  if (await realpath(projectsRoot) !== projectsRoot) throw denied('Development directory cannot be a link');
  const selected = await pluginSource(sourceRoot, command.pluginId);
  const id = `dev-${command.pluginId.replace(/[^a-z0-9-]/g, '-').slice(0, 35)}-${randomUUID().slice(0, 8)}`;
  const staging = resolve(projectsRoot, '.fork-' + randomUUID());
  const destination = resolve(projectsRoot, id);
  const development = ProjectDevelopmentSchema.parse({ ownerId: selected.ownerId, sourcePath: selected.sourcePath, sourceProjectId: command.sourceProjectId,
    pluginId: command.pluginId, createdAt: new Date().toISOString() });
  await mkdir(staging, { mode: 0o700 });
  try {
    await copySource(sourceRoot, staging, projectsRoot);
    // Reuse the verified installed graph physically; an offline cache may be incomplete.
    const sourceModules = resolve(sourceRoot, 'node_modules');
    if (await realpath(sourceModules) !== sourceModules) throw denied('Installed dependencies must be local');
    await cp(sourceModules, resolve(staging, 'node_modules'), { recursive: true, verbatimSymlinks: true });
    const manifest = JSON.parse(await readFile(await regular(staging, 'package.json'), 'utf8'));
    for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
      if (typeof spec !== 'string' || !spec.startsWith('file:') || /\.(?:tgz|tar\.gz)$/.test(spec)) continue;
      const packageFile = await regular(staging, spec.slice(5) + '/package.json');
      const installed = resolve(staging, 'node_modules', name);
      if (!installed.startsWith(resolve(staging, 'node_modules') + sep)) throw denied('Invalid dependency name');
      await rm(installed, { recursive: true, force: true });
      await mkdir(dirname(installed), { recursive: true });
      await symlink(relative(dirname(installed), dirname(packageFile)), installed);
    }
    async function checkLinks(folder: string): Promise<void> {
      for (const item of await readdir(folder, { withFileTypes: true })) {
        const path = resolve(folder, item.name);
        if (item.isSymbolicLink()) {
          const link = await readlink(path);
          const resolved = await realpath(path);
          if (isAbsolute(link) || !resolved.startsWith(staging + sep))
            throw denied('Installed dependency link escaped development copy');
        } else if (item.isDirectory()) await checkLinks(path);
      }
    }
    await checkLinks(resolve(staging, 'node_modules'));
    const descriptorPath = await regular(staging, 'devlab.preview.json');
    const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8'));
    descriptor.port = 14000 + (parseInt(randomUUID().slice(0, 6), 16) % 40000);
    descriptor.autoStart = false;
    if (!Array.isArray(descriptor.start)) throw denied('Development preview command is unavailable');
    const backendIndex = descriptor.start.indexOf('--backend');
    const previous = backendIndex < 0
      ? JSON.parse(await readFile(await regular(staging, 'hood.project.json'), 'utf8')) : null;
    const backend = new URL(backendIndex >= 0 ? descriptor.start[backendIndex + 1] : previous?.developmentBackendOrigin);
    if (backend.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(backend.hostname) ||
      backend.username || backend.password || backend.pathname !== '/' || backend.search || backend.hash)
      throw denied('Development preview needs a credential-free loopback backend');
    backend.hostname = '127.0.0.1';
    await regular(staging, 'vite.config.ts');
    const proxy = { target: backend.origin, changeOrigin: true, headers: { origin: backend.origin } };
    await writeFile(resolve(staging, 'devlab.fork.vite.mjs'),
      "import { mergeConfig } from 'vite';\nimport base from './vite.config.ts';\n" +
      'export default mergeConfig(base, ' + JSON.stringify({ server: { proxy: { '/api': proxy } } }) + ');\n',
      { mode: 0o600 });
    descriptor.start = ['node', 'node_modules/vite/bin/vite.js', '--config', 'devlab.fork.vite.mjs',
      '--host', '127.0.0.1', '--port', '{port}', '--strictPort'];
    if (Array.isArray(descriptor.views)) {
      for (const view of descriptor.views) {
        if (typeof view.path !== 'string' || !view.path.startsWith('/') || view.path.startsWith('//'))
          throw denied('Development preview requires project-local view paths');
        const url = new URL(view.path, 'http://localhost');
        url.searchParams.set('projectId', id);
        view.path = url.pathname + url.search + url.hash;
      }
    }
    await writeFile(descriptorPath, JSON.stringify(descriptor, null, 2) + '\n', { mode: 0o600 });
    await writeFile(resolve(staging, 'hood.project.json'), JSON.stringify({ id,
      label: command.label ?? `${command.pluginId} development`, development, developmentBackendOrigin: backend.origin }, null, 2) + '\n', { mode: 0o600 });
    // Verify installed local capability links resolve into the new physical tree, never its origin.
    const pkg = JSON.parse(await readFile(await regular(staging, 'package.json'), 'utf8'));
    for (const [name, spec] of Object.entries(pkg.dependencies ?? {})) {
      if (typeof spec !== 'string' || !spec.startsWith('file:') || /\.(?:tgz|tar\.gz)$/.test(spec)) continue;
      const installed = await realpath(resolve(staging, 'node_modules', name));
      if (!installed.startsWith(staging + sep)) throw denied('Installed capability escaped development copy');
    }
    if ((await pluginSource(sourceRoot, command.pluginId)).ownershipSnapshot !== selected.ownershipSnapshot)
      throw denied('Canonical ownership changed while preparing development copy');
    await rename(staging, destination);
    return id;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError('NOT_READY', 'Development copy could not be prepared from local source and installed dependencies');
  }
}
