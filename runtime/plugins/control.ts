import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApplicationError, canonicalJson, RuntimeConfigureSchema, RuntimeRewindSchema, RuntimeSelectionSchema,
  RuntimeDiagnosticSchema, RuntimeInventorySchema, type PluginDefinition, type PluginManifest, type PluginHealth,
  type RuntimeDiagnostic } from '@devlab/contracts';

const StateSchema = z.object({ selection: RuntimeSelectionSchema, previous: RuntimeSelectionSchema.nullable() }).strict();
type State = z.infer<typeof StateSchema>;
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const fail = (code: string, message: string) => new ApplicationError(code, message);

async function ordinaryParents(file: string) {
  let cursor = dirname(resolve(file));
  while (true) {
    try { if (await realpath(cursor) !== cursor) throw fail('PATH_DENIED', 'Runtime settings must not use symbolic directories'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const parent = dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
}
async function readState(file: string): Promise<State> {
  await ordinaryParents(file);
  let fd;
  try { fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { selection: {}, previous: null };
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') throw fail('PATH_DENIED', 'Runtime settings must not be symbolic links');
    throw error; }
  try {
    const info = await fd.stat();
    if (!info.isFile() || info.size > 65536) throw fail('INVALID_INPUT', 'Runtime settings must be a bounded ordinary file');
    const text = await fd.readFile('utf8');
    if (Buffer.byteLength(text) > 65536) throw fail('INVALID_INPUT', 'Runtime settings exceed 64 KiB');
    return StateSchema.parse(JSON.parse(text));
  } finally { await fd.close(); }
}
/** Startup reads only; no source-file edits or dependency installation. */
export async function readRuntimeSelection(file: string) { return (await readState(file)).selection; }

export function validateRuntimeSelection(catalog: readonly PluginManifest[], selection: Readonly<Record<string, boolean>>) {
  const flags = RuntimeSelectionSchema.parse(selection), known = new Set(catalog.map(item => item.id));
  for (const id of Object.keys(flags)) if (!known.has(id)) throw fail('INVALID_PLUGIN_SELECTION', `Unknown plugin: ${id}`);
  const selected = catalog.filter(item => flags[item.id] !== false);
  const providers = new Set(selected.flatMap(item => [...item.provides]));
  for (const item of selected) for (const key of [...item.requires, ...(item.live ?? [])])
    if (!providers.has(key)) throw fail('MISSING_DEPENDENCY', `${item.id} requires ${key}; enable its provider or disable its consumers`);
  return flags;
}

export function runtimeControl(options: {
  file: string; defaults: Readonly<Record<string, boolean>>; catalog: (selection?: Readonly<Record<string, boolean>>) => readonly PluginManifest[];
  running: () => readonly PluginManifest[]; health: () => PluginHealth[];
}): PluginDefinition {
  return { manifest: { id: 'runtime-control', version: '1.0.0', apiVersion: 1, provides: ['runtimeControl'], requires: [],
    capabilities: ['storage:local'], reload: 'restart' }, activate(scope) {
    let alive = true, queue: Promise<unknown> = Promise.resolve();
    const diagnostics: RuntimeDiagnostic[] = [];
    const active = () => { if (!alive) throw fail('NOT_READY', 'Runtime controls are disposed'); };
    const protectedIds = new Set(['runtime-control', 'transport-http']);
    const revision = (state: State) => hash({ state, defaults: options.defaults, catalog: options.catalog() });
    const inspect = async () => {
      active(); const state = await readState(options.file); active();
      const enabled = { ...options.defaults, ...state.selection }, running = new Set(options.running().map(item => item.id));
      const health = new Map(options.health().map(item => [item.id, item]));
      return RuntimeInventorySchema.parse({ revision: revision(state), canRewind: state.previous !== null,
        restartRequired: options.catalog().some(item => (enabled[item.id] !== false) !== running.has(item.id)),
        plugins: options.catalog().map(item => ({ ...item, live: [...(item.live ?? [])], enabled: enabled[item.id] !== false,
          running: running.has(item.id), state: health.get(item.id)?.state ?? (running.has(item.id) ? 'not-started' : 'disabled'),
          generation: health.get(item.id)?.generation ?? 0, protected: protectedIds.has(item.id) })), diagnostics });
    };
    const mutate = (expectedRevision: string, update: (state: State) => State) => {
      const operation = queue.then(async () => {
        active(); await ordinaryParents(options.file); await mkdir(dirname(options.file), { recursive: true });
        const lockPath = options.file + '.lock';
        let lock;
        try { lock = await open(lockPath, 'wx', 0o600); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw fail('CONFLICT', 'Runtime settings have another writer; retry after it finishes'); throw error; }
        const temporary = options.file + '.' + randomUUID() + '.tmp';
        try {
          const state = await readState(options.file); active();
          if (revision(state) !== expectedRevision) throw fail('CONFLICT', 'Runtime selection changed; refresh before saving');
          const next = update(state), effective = { ...options.defaults, ...next.selection };
          const flags = validateRuntimeSelection(options.catalog(effective), effective);
          for (const id of protectedIds) if (flags[id] === false) throw fail('INVALID_PLUGIN_SELECTION', `${id} is required for runtime management`);
          // Refuse special finals before atomic publication; cooperating writers hold this lock.
          const info = await lstat(options.file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
          if (info && (!info.isFile() || info.isSymbolicLink())) throw fail('PATH_DENIED', 'Runtime settings must be an ordinary file');
          const fd = await open(temporary, 'wx', 0o600);
          try { await fd.writeFile(JSON.stringify(next) + '\n'); await fd.sync(); } finally { await fd.close(); }
          active(); await rename(temporary, options.file);
        } finally {
          try { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
          finally { try { await lock.close(); } finally { await unlink(lockPath); } }
        }
        return inspect();
      });
      queue = operation.catch(() => {}); return operation;
    };
    scope.provide('runtimeControl', {
      inspect,
      configure(input) { const command = RuntimeConfigureSchema.parse(input); return mutate(command.expectedRevision,
        state => ({ selection: { ...state.selection, ...command.changes }, previous: state.selection })); },
      rewind(input) { const command = RuntimeRewindSchema.parse(input); return mutate(command.expectedRevision, state => {
        if (state.previous === null) throw fail('CONFLICT', 'No saved runtime selection to rewind');
        return { selection: state.previous, previous: null };
      }); },
      record(event) { active(); diagnostics.push(RuntimeDiagnosticSchema.parse(event)); if (diagnostics.length > 100) diagnostics.shift(); },
    });
    scope.onDispose(async () => { alive = false; await queue; diagnostics.length = 0; });
  } };
}
