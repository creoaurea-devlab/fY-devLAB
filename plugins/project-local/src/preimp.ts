import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, rm } from 'node:fs/promises';
import { dirname, join, matchesGlob } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ApplicationError, PreimpCommandSchema, PreimpTaskSchema, canonicalJson,
  type PreimpCommand, type PreimpSnapshot, type PreimpEntry, type ProjectText, type RegistryItem, type RegistryEdge,
  type WriteProjectFile } from '@devlab/contracts';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const conflict = (message: string) => new ApplicationError('CONFLICT', message);
const denied = (message: string) => new ApplicationError('PATH_DENIED', message);
const execute = promisify(execFile);
const OwnerSchema = z.object({ id: z.string(), purpose: z.string(), paths: z.array(z.string()) });
const MergeSchema = z.object({ status: z.enum(['merging', 'merged']), contentHash: z.string(), evidence: z.string(),
  startedAt: z.string(), completedAt: z.string().optional() }).strict();
const taskPaths = (task: PreimpEntry) => ['task.json', 'PLAN.md', 'prototype.html',
  ...(task.status === 'staged' ? [] : ['merge.json']), ...task.files.map(f => 'files/' + f.path)];

/** Internal metadata is never writable through the generic source editor. */
async function metadataPath(root: string, path: string, create = false) {
  if (!path.startsWith('_preimp/') || path.split('/').some(p => !p || p === '.' || p === '..' || p.includes('\\') || p.includes('\0')))
    throw denied('Invalid staging path');
  if (await realpath(root) !== root) throw denied('Project root changed');
  let cursor = root;
  for (const part of path.split('/').slice(0, -1)) {
    cursor = join(cursor, part);
    if (create) await mkdir(cursor).catch(e => { if (e.code !== 'EEXIST') throw e; });
    if (await realpath(cursor) !== cursor || !(await lstat(cursor)).isDirectory()) throw denied('Staging directories must not be links');
  }
  const file = join(root, path);
  const info = await lstat(file).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (info && (!info.isFile() || info.isSymbolicLink())) throw denied('Staging metadata must be a regular file');
  return file;
}
async function readMetadata(root: string, path: string) {
  const file = await metadataPath(root, path);
  const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!(await fd.stat()).isFile() || (await fd.stat()).size > 131072) throw denied('Staging metadata exceeds 128 KiB');
    const text = await fd.readFile('utf8');
    if (Buffer.byteLength(text) > 131072) throw denied('Staging metadata exceeds 128 KiB');
    return text;
  } finally { await fd.close(); }
}
async function writeMetadata(root: string, path: string, text: string) {
  const file = await metadataPath(root, path, true), temporary = join(dirname(file), '.write-' + randomUUID());
  const fd = await open(temporary, 'wx', 0o600);
  try {
    await fd.writeFile(text); await fd.sync(); await fd.close();
    await metadataPath(root, path); await rename(temporary, file);
  } finally { await fd.close().catch(() => {}); await rm(temporary, { force: true }); }
}
const optional = async <T>(read: () => Promise<T>): Promise<T | null> => {
  try { return await read(); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
};

/** One manifest per task; this derived catalog is never an executable plugin list. */
export async function preimpTasks(root: string): Promise<PreimpEntry[]> {
  if (!await optional(() => lstat(join(root, '_preimp')))) return [];
  await metadataPath(root, '_preimp/catalog');
  const entries = await readdir(join(root, '_preimp'), { withFileTypes: true });
  const folders = entries.filter(e => /^[a-z][a-z0-9-]{0,63}$/.test(e.name));
  if (folders.length > 100) throw denied('Staged task limit reached (100)');
  const tasks: PreimpEntry[] = [];
  for (const folder of folders.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!folder.isDirectory()) throw denied('Task folders must be regular directories');
    const task = PreimpTaskSchema.parse(JSON.parse(await readMetadata(root, `_preimp/${folder.name}/task.json`)));
    if (task.id !== folder.name) throw denied('Task identity does not match its folder');
    const merge = await optional(() => readMetadata(root, `_preimp/${folder.name}/merge.json`));
    tasks.push({ ...task, status: merge === null ? 'staged' : MergeSchema.parse(JSON.parse(merge)).status });
  }
  return tasks;
}

/** Bounded source snapshot for the existing registry builder, never an import loader. */
export async function preimpSources(root: string) {
  const tasks = await preimpTasks(root), sources: Record<string, string> = {};
  let bytes = 0;
  for (const task of tasks) for (const path of taskPaths(task)) {
    const file = `_preimp/${task.id}/${path}`, text = await readMetadata(root, file);
    bytes += Buffer.byteLength(text);
    if (bytes > 16 * 1024 * 1024) throw denied('Preimplementation registry source exceeds 16 MiB; archive completed tasks outside _preimp');
    sources[file] = text;
  }
  return { tasks, sources };
}

/** Same source-backed links in the built registry and each project's Build graph. */
export function appendPreimpGraph(graph: { items: RegistryItem[]; edges: RegistryEdge[] }, tasks: PreimpEntry[]) {
  if (!tasks.length) return;
  const add = (item: RegistryItem) => {
    const existing = graph.items.find(i => i.id === item.id);
    if (existing) Object.assign(existing, item); else graph.items.push(item);
  };
  add({ id: 'layer:preimp', parentId: null, kind: 'group', label: 'Preimplementation', detail: 'Staged proposals; not installed plugins or permission grants.' });
  for (const task of tasks) {
    const folder = `_preimp/${task.id}`, id = `dir:${folder}`, owner = `owner:${task.ownerId}`;
    add({ id, parentId: 'layer:preimp', kind: 'group', label: task.title, path: folder + '/task.json', detail: `${task.status} · proposed owner: ${task.ownerId}` });
    if (!graph.items.some(i => i.id === owner)) add({ id: owner, parentId: null, kind: 'group', label: task.ownerId, detail: 'Referenced canonical owner; proposal does not grant writes.' });
    const edge = (source: string, target: string, label: string) => graph.edges.push({ id: `preimp:${source}:${target}`, source, target,
      kind: 'requires', label, evidence: [{ path: folder + '/task.json', line: 1, text: `${task.id}: ${label}` }] });
    edge(id, owner, 'proposed owner');
    for (const path of taskPaths(task)) {
      const file = folder + '/' + path;
      add({ id: 'file:' + file, parentId: id, kind: 'file', label: path, path: file, detail: 'Task record; excluded from runtime composition' });
    }
    for (const file of task.files) {
      if (!graph.items.some(i => i.id === 'file:' + file.path)) add({ id: 'file:' + file.path, parentId: owner, kind: 'file', label: file.path, path: file.path, detail: 'Proposed destination; may not exist yet' });
      edge('file:' + folder + '/files/' + file.path, 'file:' + file.path, 'proposes change to');
    }
  }
}

type IO = { root: string; read(path: string): Promise<ProjectText>; write(command: Omit<WriteProjectFile, 'projectId'>): Promise<ProjectText> };
/** Caller holds the project catalog writer queue for the entire command. No shell commands from task data. */
export async function preimpCommand(io: IO, input: PreimpCommand): Promise<PreimpSnapshot> {
  const command = PreimpCommandSchema.parse(input);
  const reader = fileURLToPath(new URL('../../../.agents/data/definitions.py', import.meta.url));
  const { stdout } = await execute('/usr/bin/python3', ['-I', '-B', reader, 'ownership', '--root', io.root], { timeout: 10000, maxBuffer: 1024 * 1024 })
    .catch(() => { throw denied('This project needs valid canonical ownership definitions before creating staged tasks'); });
  const owners = OwnerSchema.array().parse(JSON.parse(stdout)).map(({ id, purpose, paths }) => ({ id, purpose, paths }));
  const tasks = await preimpTasks(io.root);
  if (command.action === 'list') return { tasks, owners };
  const folder = `_preimp/${command.id}`;
  const allowed = (ownerId: string, paths: string[]) => {
    const owner = owners.find(o => o.id === ownerId);
    if (!owner || new Set(paths).size !== paths.length || paths.some(path =>
      path.split('/').some(p => !p || p.startsWith('.') || p.startsWith('_') || ['AGENTS.md', 'CLAUDE.md', 'SKILL.md', 'node_modules', 'dist', 'vendor', 'secrets'].includes(p)) ||
      path.includes('\\') || path.includes(':') || path.includes('\0') ||
      !owner.paths.some(pattern => matchesGlob(path, pattern)) ||
      owners.filter(candidate => candidate.paths.some(pattern => matchesGlob(path, pattern))).length !== 1)) throw denied('Every destination must belong to exactly one selected canonical owner; protected paths cannot be promoted');
  };
  if (command.action === 'create') {
    allowed(command.ownerId, command.paths);
    if (tasks.length >= 100 || tasks.some(t => t.id === command.id)) throw conflict('Task already exists or task limit reached');
    // Read all source first, before publishing a task. Missing files are valid additions.
    const source = await Promise.all(command.paths.map(path => optional(() => io.read(path))));
    const task = PreimpTaskSchema.parse({ schemaVersion: 1, id: command.id, title: command.title, ownerId: command.ownerId,
      createdAt: new Date().toISOString(), files: command.paths.map((path, i) => ({ path, baseHash: source[i]?.sha256 ?? null })) });
    await metadataPath(io.root, '_preimp/reservation', true);
    if (await optional(() => lstat(join(io.root, folder)))) throw conflict('Task folder already exists');
    const staging = '_preimp/_creating-' + randomUUID();
    await mkdir(join(io.root, staging), { mode: 0o700 });
    try {
      for (const [i, file] of task.files.entries()) {
        await io.write({ path: `${staging}/files/${file.path}`, text: source[i]?.text ?? '', expectedHash: null });
        if (source[i]) await writeMetadata(io.root, `${staging}/.base/${file.path}`, source[i]!.text);
      }
      await io.write({ path: staging + '/PLAN.md', expectedHash: null, text: `# ${task.title}\n\nOwner: ${task.ownerId}\n\n## Outcome\nDescribe the intended behavior.\n\n## Scope and boundaries\n${task.files.map(f => '- ' + f.path).join('\n')}\n\n## Acceptance and checks\nRecord success, refusal, cleanup and retained-state checks.\n\n## Decision\nRecord the selected prototype and remaining limitations.\n` });
      await io.write({ path: staging + '/prototype.html', expectedHash: null, text: '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>body{font:14px system-ui;margin:24px;background:#18191d;color:#eee}button{font:inherit;padding:6px 10px}</style><h1>Feature prototype</h1><p>Edit this HTML to explore the feature with simulated data.</p><button onclick="this.textContent=\'Selected\'">Try interaction</button></html>\n' });
      await writeMetadata(io.root, staging + '/task.json', JSON.stringify(task, null, 2) + '\n');
      if (await optional(() => lstat(join(io.root, folder)))) throw conflict('Task folder already exists');
      await rename(join(io.root, staging), join(io.root, folder));
      tasks.push({ ...task, status: 'staged' });
    } catch (error) {
      // Preserve partial work without poisoning discovery of unrelated valid tasks.
      const recovery = `_preimp/.incomplete-${command.id}-${randomUUID()}`;
      await rename(join(io.root, staging), join(io.root, recovery));
      throw new Error(`Task creation incomplete; preserved at ${recovery}`, { cause: error });
    }
  }
  const entry = tasks.find(t => t.id === command.id);
  if (!entry) throw new ApplicationError('NOT_FOUND', 'Staged task not found');
  const { status: _status, ...task } = entry;
  allowed(task.ownerId, task.files.map(f => f.path));
  const [plan, prototype, mergeText] = await Promise.all([io.read(folder + '/PLAN.md'), io.read(folder + '/prototype.html'), optional(() => readMetadata(io.root, folder + '/merge.json'))]);
  const merge = mergeText === null ? null : MergeSchema.parse(JSON.parse(mergeText));
  const selected: NonNullable<PreimpSnapshot['selected']> = { task, status: merge?.status ?? 'staged', plan, prototype };
  if (command.action === 'review' || command.action === 'promote') {
    if (merge?.status === 'merged') throw conflict('Task is already merged; create a new task for further changes');
    const staged = await Promise.all(task.files.map(f => io.read(`${folder}/files/${f.path}`)));
    const current = await Promise.all(task.files.map(f => optional(() => io.read(f.path))));
    const contentHash = sha(canonicalJson({ task, plan: plan.sha256, prototype: prototype.sha256, staged: staged.map(f => f.sha256), owners }));
    const conflicts: string[] = [];
    if (merge && merge.contentHash !== contentHash) conflicts.push('Interrupted merge: staged content or ownership changed. Restore the reviewed snapshot before resuming.');
    for (const [i, file] of task.files.entries()) {
      const actual = current[i]?.sha256 ?? null;
      if (actual !== file.baseHash && !(merge && actual === staged[i]!.sha256)) conflicts.push(file.path + ': source changed since staging');
      if (file.baseHash !== null && sha(await readMetadata(io.root, `${folder}/.base/${file.path}`)) !== file.baseHash) conflicts.push(file.path + ': recovery copy changed');
    }
    selected.review = { revision: sha(canonicalJson({ contentHash, current: current.map(f => f?.sha256 ?? null), merge })), conflicts,
      files: task.files.map((f, i) => ({ path: f.path, before: current[i]?.text ?? null, after: staged[i]!.text, changed: (current[i]?.sha256 ?? null) !== staged[i]!.sha256 })) };
    if (command.action === 'promote') {
      if (conflicts.length || command.revision !== selected.review.revision) throw conflict(conflicts.join('\n') || 'Review is stale; review the task again');
      const journal = merge ?? { status: 'merging' as const, contentHash, evidence: command.evidence, startedAt: new Date().toISOString() };
      await writeMetadata(io.root, folder + '/merge.json', JSON.stringify(journal, null, 2) + '\n');
      for (const [i, file] of task.files.entries()) {
        if (current[i]?.sha256 === staged[i]!.sha256) continue;
        await io.write({ path: file.path, text: staged[i]!.text, expectedHash: current[i]?.sha256 ?? null });
      }
      await writeMetadata(io.root, folder + '/merge.json', JSON.stringify({ ...journal, status: 'merged', completedAt: new Date().toISOString() }, null, 2) + '\n');
      selected.status = 'merged'; delete selected.review;
      entry.status = 'merged';
    }
  }
  return { tasks, owners, selected };
}
