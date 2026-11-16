import {
  readFile,
  readdir,
  mkdir,
  realpath,
  lstat,
  open,
  rename,
  link,
  unlink,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import {
  resolve,
  dirname,
  extname,
  basename,
  sep,
  isAbsolute,
} from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  ApplicationError,
  CreateProjectSchema,
  OpenProjectSchema,
  ForkProjectSchema,
  ProjectDevelopmentSchema,
  ProjectSlugSchema,
  WriteProjectFileSchema,
  ProjectTreeSchema,
  type PluginDefinition,
  type Project,
  type ProjectCatalog,
  type ProjectTree,
  type RegistryItem,
} from '@devlab/contracts';
import { ensureAgentProjectFiles, moduleFiles, webProjectFiles } from './template.ts';
import { forkProject } from './fork.ts';
import { preimpCommand, preimpTasks, appendPreimpGraph } from './preimp.ts';
export { preimpTasks, preimpSources, appendPreimpGraph } from './preimp.ts';
const omitted = new Set([
  '_LAB',
  '_BACKUP',
  'node_modules',
  'dist',
  'vendor',
  'build',
  'build-output',
  'coverage',
  'secrets',
  'out',
  'release',
  '__pycache__',
]);
const textExtensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.json',
  '.md',
  '.css',
  '.html',
  '.svg',
  '.txt',
  '.yaml',
  '.yml',
]);
const hash = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
const denied = (message = 'Path is outside the selected project') =>
  new ApplicationError('PATH_DENIED', message);
function assertProjectRoot(path: string) {
  if (path.split(/[\\/]/).includes('_BACKUP')) throw denied('Backup folders are unavailable');
}
const conflict = (message: string) => new ApplicationError('CONFLICT', message);

/** App-level path scope only. Interactive shells still have the local user's privileges. */
export function localProjects(options: {
  root: string;
  projectsRoot: string;
  terminalRoot?: string;
  registryFile?: string;
}): PluginDefinition {
  return {
    manifest: {
      id: 'project-local',
      version: '1.0.0',
      apiVersion: 1,
      provides: ['projects', 'workspace'],
      requires: [],
      capabilities: ['workspace:local'],
      reload: 'restart',
    },
    async activate(scope) {
      const root = await realpath(resolve(options.root));
      assertProjectRoot(root);
      const optionsRoot = root;
      const projectsRoot = resolve(options.projectsRoot);
      assertProjectRoot(projectsRoot);
      await mkdir(projectsRoot, { recursive: true });
      if ((await realpath(projectsRoot)) !== projectsRoot)
        throw denied('Project directory cannot be a symlink');
      const registryFile = resolve(options.registryFile ?? resolve(projectsRoot, '.devlab-roots.json'));
      type Registration = { id: string; root: string; label: string };
      let registrations: Registration[] = [];
      try {
        const info = await lstat(registryFile);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 131072) throw denied('Invalid project root registry');
        const parsed: unknown = JSON.parse(await readFile(registryFile, 'utf8'));
        if (!Array.isArray(parsed) || parsed.length > 100 || parsed.some(v =>
          !v || typeof v !== 'object' || Object.keys(v).sort().join(',') !== 'id,label,root' ||
          !/^folder-[a-f0-9]{24}$/.test(v.id) || !isAbsolute(v.root) || resolve(v.root) !== v.root ||
          typeof v.label !== 'string' || !v.label.length || v.label.length > 120 ||
          v.id !== 'folder-' + hash(v.root).slice(0, 24)) ||
          new Set(parsed.map(v => v.id)).size !== parsed.length) throw denied('Invalid project root registry');
        registrations = parsed;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      async function saveRegistrations(next: Registration[]) {
        await mkdir(dirname(registryFile), { recursive: true });
        const temporary = registryFile + '.' + randomUUID() + '.tmp';
        const fd = await open(temporary, 'wx', 0o600);
        try {
          await fd.writeFile(JSON.stringify(next, null, 2) + '\n');
          await fd.sync();
          await fd.close();
          await rename(temporary, registryFile);
          registrations = next;
        } finally {
          await fd.close().catch(() => {});
          await unlink(temporary).catch(() => {});
        }
      }
      let alive = true;
      const pending = new Map<string, Promise<unknown>>();
      const deletedIds = new Set<string>();
      const active = () => {
        if (!alive)
          throw new ApplicationError(
            'NOT_READY',
            'Project adapter is disposed',
          );
      };
      const base: Project = {
        id: 'default',
        label: 'devLAB',
        base: true,
        location: '.',
        workspaceId: hash(root),
      };
      async function project(
        id: string,
      ): Promise<{ root: string; value: Project }> {
        active();
        if (deletedIds.has(id)) throw denied('Development thread was deleted');
        if (id === 'default') return { root, value: base };
        const registered = registrations.find(p => p.id === id);
        if (registered) {
          assertProjectRoot(registered.root);
          if ((await realpath(registered.root).catch(() => '')) !== registered.root ||
            !(await lstat(registered.root)).isDirectory()) throw denied('Registered folder is unavailable');
          return { root: registered.root, value: { id, label: registered.label, base: false, location: registered.root, available: true } };
        }
        ProjectSlugSchema.parse(id);
        const target = resolve(projectsRoot, id);
        if (
          (await realpath(projectsRoot)) !== projectsRoot ||
          (await realpath(target).catch(() => '')) !== target ||
          !(await lstat(target)).isDirectory()
        )
          throw denied('Project is unavailable');
        let label = id;
        let development: Project['development'];
        try {
          const config = JSON.parse(
            await safeRead(target, 'hood.project.json'),
          );
          if (config.development) development = ProjectDevelopmentSchema.parse(config.development);
          if (typeof config.label === 'string')
            label = config.label.slice(0, 120) || id;
        } catch {
          /* Externally created directories need no metadata. */
        }
        return {
          root: target,
          value: { id, label, base: false, location: 'projects/' + id, ...(development ? { development } : {}) },
        };
      }
      function parts(path: string): string[] {
        const values = path.split('/');
        if (
          !path ||
          path.length > 512 ||
          isAbsolute(path) ||
          path.includes('\\') ||
          path.includes('\0') ||
          values.some(
            (p) =>
              !p ||
              p === '.' ||
              p === '..' ||
              p.startsWith('.') ||
              p.includes(':') ||
              omitted.has(p),
          )
        )
          throw denied();
        return values;
      }
      async function target(
        root: string,
        path: string,
        parents = false,
      ): Promise<string> {
        const values = parts(path);
        const absolute = resolve(root, ...values);
        if (
          root === optionsRoot &&
          (absolute === projectsRoot || absolute.startsWith(projectsRoot + sep))
        )
          throw denied();
        let cursor = root;
        if ((await realpath(root)) !== root) throw denied();
        for (const value of values.slice(0, -1)) {
          cursor = resolve(cursor, value);
          if (parents)
            await mkdir(cursor).catch((error) => {
              if (error.code !== 'EEXIST') throw error;
            });
          if (
            (await realpath(cursor)) !== cursor ||
            !(await lstat(cursor)).isDirectory()
          )
            throw denied();
        }
        const result = resolve(root, ...values);
        const info = await lstat(result).catch((error) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (info?.isSymbolicLink()) throw denied();
        return result;
      }
      async function safeRead(root: string, path: string): Promise<string> {
        const file = await target(root, path);
        const fd = await open(
          file,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        try {
          const stat = await fd.stat();
          if (!stat.isFile() || stat.size > 131072)
            throw denied('Text preview exceeds 128 KiB or is unavailable');
          if (
            process.platform === 'linux' &&
            (await realpath('/proc/self/fd/' + fd.fd)) !== file
          )
            throw denied();
          const data = await fd.readFile();
          if (data.length > 131072 || data.includes(0))
            throw denied('Binary or oversized file has no text preview');
          return data.toString('utf8');
        } finally {
          await fd.close();
        }
      }
      async function serial<T>(
        key: string,
        operation: () => Promise<T>,
      ): Promise<T> {
        active();
        const previous = pending.get(key) ?? Promise.resolve();
        const result = previous
          .catch(() => {})
          .then(() => {
            active();
            return operation();
          });
        pending.set(key, result);
        try {
          return await result;
        } finally {
          if (pending.get(key) === result) pending.delete(key);
        }
      }
      async function writeProject(input: Parameters<ProjectCatalog['write']>[0], internal = false) {
        const command = WriteProjectFileSchema.parse(input);
        if (
          Buffer.byteLength(command.text) > 131072 ||
          command.text.includes('\0')
        )
          throw denied('Text must be at most 128 KiB');
        if (
          !textExtensions.has(extname(command.path)) ||
          ['AGENTS.md', 'CLAUDE.md', 'SKILL.md'].includes(
            basename(command.path),
          )
        )
          throw denied('This file is not editable');
        parts(command.path);
        if (command.path.startsWith('_preimp/')) {
          const [, taskId, kind] = command.path.split('/');
          if (!['PLAN.md', 'prototype.html', 'files'].includes(kind ?? '')) throw denied('Task metadata is read-only');
          if (!internal) {
            const tasks = await preimpTasks((await project(command.projectId)).root);
            const task = tasks.find(t => t.id === taskId);
            if (!task || kind === 'files' && !task.files.some(f => command.path === `_preimp/${taskId}/files/${f.path}`)) throw denied('File is not registered in this task');
            if (await lstat(resolve((await project(command.projectId)).root, `_preimp/${taskId}/merge.json`)).catch(e => { if (e.code === 'ENOENT') return null; throw e; })) throw conflict('Reviewed merge content is locked; create a new task for further changes');
          }
        }
        const selected = await project(command.projectId);
        const file = await target(selected.root, command.path, true);
        const exists = await lstat(file).catch((error) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (exists && command.expectedHash === null)
          throw conflict('File already exists; open it before editing');
        if (!exists && command.expectedHash !== null)
          throw conflict('File was removed; reopen before saving');
        if (
          exists &&
          hash(await safeRead(selected.root, command.path)) !==
            command.expectedHash
        )
          throw conflict('File changed on disk; reopen before saving');
        const temporary = resolve(
          dirname(file),
          '.devlab-' + randomUUID() + '.tmp',
        );
        const fd = await open(temporary, 'wx', exists?.mode ?? 0o600);
        try {
          await fd.writeFile(command.text);
          await fd.sync();
          await fd.close();
          await target(selected.root, command.path);
          if (command.expectedHash === null)
            await link(temporary, file).catch((error) => {
              if (error.code === 'EEXIST')
                throw conflict('File already exists');
              throw error;
            });
          else {
            if (
              hash(await safeRead(selected.root, command.path)) !==
              command.expectedHash
            )
              throw conflict('File changed on disk');
            await rename(temporary, file);
          }
          return {
            path: command.path,
            text: command.text,
            sha256: hash(command.text),
          };
        } finally {
          await fd.close().catch(() => {});
          await unlink(temporary).catch(() => {});
        }
      }
      const service: ProjectCatalog = {
        preimp(id, command) {
          return serial('project-create', async () => {
            const selected = await project(id);
            return preimpCommand({ root: selected.root, read: path => service.read(id, path),
              write: value => writeProject({ ...value, projectId: id }, true) }, command);
          });
        },
        async list() {
          active();
          const list: Project[] = [base];
          if ((await realpath(projectsRoot)) !== projectsRoot) throw denied();
          for (const dir of (
            await readdir(projectsRoot, { withFileTypes: true })
          ).sort((a, b) => a.name.localeCompare(b.name))) {
            if (list.length >= 101) break;
            if (
              !dir.isDirectory() ||
              !ProjectSlugSchema.safeParse(dir.name).success
            )
              continue;
            try {
              list.push((await project(dir.name)).value);
            } catch {
              /* Ignore links/racing removal. */
            }
          }
          for (const registered of registrations) {
            try { list.push((await project(registered.id)).value); }
            catch { list.push({ id: registered.id, label: registered.label, base: false, location: registered.root, available: false }); }
          }
          return list;
        },
        async root(id) { return (await project(id)).root; },
        async open(input) {
          const command = OpenProjectSchema.parse(input);
          return serial('project-create', async () => {
            if (!isAbsolute(command.path) || command.path.includes('\0')) throw denied('Open Folder requires an absolute directory');
            assertProjectRoot(command.path);
            const path = await realpath(command.path).catch(() => { throw denied('Folder is unavailable'); });
            assertProjectRoot(path);
            if (!(await lstat(path)).isDirectory()) throw denied('Open Folder requires a directory');
            await ensureAgentProjectFiles(path);
            if (path === root) return base;
            // Preserve child-project IDs even when opened through a symlink alias.
            if (dirname(path) === projectsRoot && ProjectSlugSchema.safeParse(basename(path)).success)
              return (await project(basename(path))).value;
            const existing = registrations.find(p => p.root === path);
            if (existing) return (await project(existing.id)).value;
            if (registrations.length >= 100) throw conflict('Registered folder limit reached (100)');
            const id = 'folder-' + hash(path).slice(0, 24);
            if (await lstat(resolve(projectsRoot, id)).catch(() => null)) throw conflict('Project identity collision');
            const value = { id, root: path, label: command.label ?? (basename(path).slice(0, 120) || path) };
            await saveRegistrations([...registrations, value]);
            return (await project(id)).value;
          });
        },
        async forget(id) {
          return serial('project-create', async () => {
            if (!registrations.some(p => p.id === id)) throw denied('Only registered folders can be removed from the catalog');
            await saveRegistrations(registrations.filter(p => p.id !== id));
          });
        },
        async deleteThread(id) {
          // Share the catalog queue with writes and forks: queued operations must
          // resolve their identity after the move, never write through an old root.
          return serial('project-create', async () => {
            if (id === 'default' || registrations.some(p => p.id === id))
              throw denied('Only catalog-owned development threads can be deleted');
            const selected = await project(id);
            if (!selected.value.development || dirname(selected.root) !== projectsRoot || selected.root === root)
              throw denied('Only catalog-owned development threads can be deleted');
            const metadata = JSON.parse(await safeRead(selected.root, 'hood.project.json'));
            if (metadata.id !== id || !ProjectDevelopmentSchema.safeParse(metadata.development).success)
              throw denied('Development thread identity is invalid');
            const archiveRoot = resolve(dirname(projectsRoot), 'deleted-projects');
            if (archiveRoot === root || archiveRoot === projectsRoot || archiveRoot.startsWith(projectsRoot + sep))
              throw denied('Development archive must be outside the project catalog');
            await mkdir(archiveRoot, { mode: 0o700 }).catch(error => {
              if (error.code !== 'EEXIST') throw error;
            });
            const archiveInfo = await lstat(archiveRoot);
            if (!archiveInfo.isDirectory() || archiveInfo.isSymbolicLink() ||
              (archiveInfo.mode & 0o077) !== 0 || await realpath(archiveRoot) !== archiveRoot)
              throw denied('Development archive must be a private canonical directory');
            const destination = resolve(archiveRoot, id + '-' + randomUUID());
            if (dirname(destination) !== archiveRoot || await lstat(destination).catch(error => {
              if (error.code === 'ENOENT') return null;
              throw error;
            })) throw denied('Development archive destination is unavailable');
            // External filesystem writers are outside this in-process queue.
            // Revalidate before the atomic move; no recursive removal occurs.
            if (await realpath(projectsRoot) !== projectsRoot ||
              await realpath(selected.root) !== selected.root ||
              await realpath(archiveRoot) !== archiveRoot)
              throw denied('Development archive paths changed');
            await rename(selected.root, destination);
            deletedIds.add(id);
          });
        },
        async create(input) {
          const command = CreateProjectSchema.parse(input);
          return serial('project-create', async () => {
            if (deletedIds.has(command.id)) throw conflict('Deleted development identities cannot be reused');
            if (registrations.some(p => p.id === command.id)) throw conflict('Project identity already registered');
            if ((await service.list()).length >= 101)
              throw conflict('Project limit reached (100 child projects)');
            if ((await realpath(projectsRoot)) !== projectsRoot) throw denied();
            const folder = resolve(projectsRoot, command.id);
            try {
              await mkdir(folder);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'EEXIST')
                throw conflict('Project already exists');
              throw error;
            }
            await mkdir(resolve(folder, 'src'));
            await mkdir(resolve(folder, '.agents'));
            const port=14000+(parseInt(hash(folder).slice(0,6),16)%40000);
            const files = webProjectFiles(command.id,command.label,port);
            for (const [path, text] of Object.entries(files)) {
              const fd = await open(resolve(folder, path), 'wx', 0o600);
              try {
                await fd.writeFile(text);
              } finally {
                await fd.close();
              }
            }
            return (await project(command.id)).value;
          });
        },
        async fork(input) {
          const command = ForkProjectSchema.parse(input);
          return serial('project-create', async () => {
            const selected = await project(command.sourceProjectId);
            if ((await service.list()).length >= 101) throw conflict('Project limit reached (100 child projects)');
            const id = await forkProject({ sourceRoot: selected.root, projectsRoot, command });
            return (await project(id)).value;
          });
        },
        async inspect(id) {
          const selected = await project(id),
            entries: ProjectTree['entries'] = [],
            stamp: unknown[] = [];
          let directories = 0;
          async function walk(folder: string) {
            if (++directories > 2048)
              throw denied('Project directory budget exceeded');
            const directory = folder
              ? await target(selected.root, folder)
              : selected.root;
            if (
              (await realpath(directory)) !== directory ||
              !(await lstat(directory)).isDirectory()
            )
              throw denied();
            for (const child of (
              await readdir(directory, { withFileTypes: true })
            ).sort((a, b) => a.name.localeCompare(b.name))) {
              if (
                child.name.startsWith('.') ||
                folder === '_preimp' && child.name.startsWith('_creating-') ||
                omitted.has(child.name) ||
                child.isSymbolicLink()
              )
                continue;
              const path = folder ? folder + '/' + child.name : child.name;
              if (
                selected.root === root &&
                resolve(root, path) === projectsRoot
              )
                continue;
              if (!child.isDirectory() && !child.isFile()) continue;
              if (entries.length >= 5000)
                throw denied('Project file budget exceeded');
              const info = await lstat(resolve(selected.root, path));
              if (info.isSymbolicLink()) continue;
              const directory = info.isDirectory();
              entries.push({
                path,
                kind: directory ? 'directory' : 'file',
                bytes: directory ? 0 : info.size,
                editable:
                  !directory &&
                  info.size <= 131072 &&
                  textExtensions.has(extname(path)) &&
                  !(path.startsWith('_preimp/') && ['task.json', 'merge.json'].includes(basename(path))) &&
                  !['AGENTS.md', 'CLAUDE.md', 'SKILL.md'].includes(
                    basename(path),
                  ),
              });
              stamp.push([path, info.size, info.mtimeMs, info.ino]);
              if (directory) await walk(path);
            }
          }
          await walk('');
          const items: RegistryItem[] = [
            {
              id: 'project:root',
              label: selected.value.label,
              kind: 'group',
              parentId: null,
              detail: selected.value.base
                ? 'Base devLAB project'
                : 'Project-scoped workspace',
            },
          ];
          const ids = new Map<string, string>([['', 'project:root']]);
          for (const entry of entries) {
            const parent =
              dirname(entry.path) === '.' ? '' : dirname(entry.path);
            const module =
              entry.kind === 'directory' &&
              ['plugins', 'packages', 'apps', 'modules', 'features'].includes(
                basename(parent),
              );
            const id =
              (entry.kind === 'file' ? 'file:' : module ? 'module:' : 'dir:') +
              entry.path;
            ids.set(entry.path, id);
            items.push({
              id,
              label: basename(entry.path),
              kind:
                entry.kind === 'file'
                  ? 'file'
                  : module
                    ? 'module'
                    : 'directory',
              parentId: ids.get(parent)!,
              path: entry.path,
              bytes: entry.bytes,
              detail:
                entry.kind === 'directory'
                  ? module
                    ? 'Contract / adapter / plugin module'
                    : 'Directory'
                  : entry.editable
                    ? 'Editable text file'
                    : `${entry.bytes} bytes · metadata only`,
            });
          }
          const graph = { items, edges: [] as import('@devlab/contracts').RegistryEdge[] };
          appendPreimpGraph(graph, await preimpTasks(selected.root));
          return ProjectTreeSchema.parse({
            project: selected.value,
            revision: hash(JSON.stringify(stamp)),
            scannedAt: new Date().toISOString(),
            entries,
            graph,
          });
        },
        async read(id, path) {
          const selected = await project(id),
            text = await safeRead(selected.root, path);
          return { path, text, sha256: hash(text) };
        },
        async write(input) { return serial('project-create', () => writeProject(input)); },
        async createModule(id, path) {
          parts(path);
          return serial('project-create', async () => {
            const selected = await project(id),
              folder = await target(selected.root, path, true);
            try {
              await mkdir(folder);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'EEXIST')
                throw conflict('Module already exists');
              throw error;
            }
            const paths: string[] = [];
            for (const [name, text] of Object.entries(
              moduleFiles(basename(path)),
            )) {
              const file = path + '/' + name;
              const fd = await open(
                await target(selected.root, file),
                'wx',
                0o600,
              );
              try {
                await fd.writeFile(text);
              } finally {
                await fd.close();
              }
              paths.push(file);
            }
            return { paths };
          });
        },
      };
      scope.onDispose(async () => {
        alive = false;
        await Promise.allSettled([...pending.values()]);
      });
      scope.provide('projects', service);
      scope.provide('workspace', {
        async resolve(id, cwd) {
          const selected = await project(id);
          const actualRoot =
            id === 'default' && options.terminalRoot
              ? await realpath(resolve(options.terminalRoot))
              : selected.root;
          if (isAbsolute(cwd) || cwd.includes('\0')) throw denied();
          const result = await realpath(resolve(actualRoot, cwd)).catch(() => {
            throw denied();
          });
          if (result !== actualRoot && !result.startsWith(actualRoot + sep))
            throw denied();
          if (!(await lstat(result)).isDirectory()) throw denied();
          return result;
        },
      });
    },
  };
}
