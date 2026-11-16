/** Native upstream Cordis lives only in this owned child. No DevLab kernel replacement. */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { DeepSeekEntry, DeepSeekSelection } from '@devlab/contracts';

const release = resolve(process.argv[2] ?? '');
const runtimeRequire = createRequire(resolve(release, 'package.json'));
const { Context } = runtimeRequire('@deepseek-ai/cordis');
const Loader = runtimeRequire('@deepseek-ai/cordis-plugin-loader').default;
const ctx = new Context(); ctx.baseUrl = pathToFileURL(release + '/').href;
const phases = ['pending', 'loading', 'active', 'failed', 'disposed', 'unloading'] as const;
const allowed = new Set<string>(JSON.parse(process.env.DEVLAB_DEEPSEEK_ALLOWED ?? '[]'));
const errors: string[] = [];
const bundleNames = new Map<string, string>();
ctx.logger.exporter({ levels: { default: 0 }, export(event: { type: string; args: unknown[] }) {
  if (event.type === 'error' || event.type === 'warn') { errors.push(event.args.map(String).join(' ').slice(0, 1000)); if (errors.length > 20) errors.shift(); }
} });
await ctx.plugin(Loader);
const homePaths = runtimeRequire('@deepseek-ai/dsh-home-paths');
for (const name of ['dshHomePath', 'dshPath']) if (homePaths[name]) ctx.provide(name, homePaths[name]);
let sequence: Promise<unknown> = Promise.resolve();
const checkRows = (rows: DeepSeekSelection[]) => {
  if (!Array.isArray(rows) || rows.length > 500) throw new Error('Invalid selection size');
  for (const row of rows) if (!allowed.has(row.id) || typeof row.enabled !== 'boolean' || row.config === undefined) throw new Error('Unknown package or invalid selection');
};
const snapshot = (): DeepSeekEntry[] => [...ctx.loader.entries()].map((entry: any) => ({ id: entry.id, module: bundleNames.get(entry.id) ?? entry.options.name,
  enabled: !entry.options.disabled, state: entry.options.disabled ? 'disabled' : phases[entry.fiber?.state ?? 0]!,
  requires: [], ...(entry.fiber?.state === 3 ? { error: errors.at(-1) ?? 'Upstream activation failed' } : {}) }));
async function apply(rows: DeepSeekSelection[]) {
  checkRows(rows); errors.length = 0;
  const nativeRows = []; bundleNames.clear();
  for (const row of rows) {
    const id = row.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const manifestFile = runtimeRequire.resolve(row.id + '/package.json');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    if (manifest.dsh?.bundle && row.enabled) {
      const { loadOverlayPatches, composeEntries } = runtimeRequire('@deepseek-ai/dsh-app-boot');
      const declared = manifest.dsh.bundle.patch;
      const files = Array.isArray(declared) ? declared : [declared];
      const patches = [];
      for (const file of files) {
        const path = resolve(dirname(manifestFile), file);
        if (!path.startsWith(dirname(manifestFile) + '/')) throw new Error('Bundle patch escaped its package');
        patches.push(loadOverlayPatches('devlab-deepseek', path));
      }
      bundleNames.set(id, row.id);
      nativeRows.push({ id, name: '@deepseek-ai/cordis-plugin-group', config: composeEntries(patches), group: true });
    } else nativeRows.push({ id, name: row.id, disabled: !row.enabled, config: row.config });
  }
  await ctx.loader.root.update(nativeRows);
  await ctx.loader.await();
  return snapshot();
}
const pluginShape = (value: any) => typeof value === 'function' || value && typeof value.apply === 'function';
process.on('message', (message: any) => {
  sequence = sequence.then(async () => {
    try {
      let result: unknown;
      if (message.method === 'snapshot') result = snapshot();
      else if (message.method === 'apply') result = await apply(message.rows);
      else if (message.method === 'probe') {
        const name = message.name;
        if (!allowed.has(name)) throw new Error('Unknown package');
        if (name === '@deepseek-ai/cordis-plugin-loader') {
          await ctx.loader.ctx.fiber.dispose(); const off = ctx.get('loader') === undefined;
          await ctx.plugin(Loader); const on = ctx.get('loader') !== undefined;
          result = { outcome: on ? 'active' : 'failed', off, on, cleanup: true };
        }
        // Disabled rows must not import a module. Check that before probing its export shape.
        if (result === undefined) await apply([{ id: name, enabled: false, config: {} }]);
        const off = snapshot().every(entry => entry.state === 'disabled');
        let module;
        try { if (result === undefined) module = runtimeRequire(name); }
        catch (error) {
          const text = String(error), code = (error as NodeJS.ErrnoException).code;
          result = { outcome: code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' || code === 'MODULE_NOT_FOUND' && /node-addon-system/.test(name) ? 'library'
            : /\.css|window is not defined|document is not defined/.test(text) ? 'pending' : 'failed', off, on: false, cleanup: true, reason: text.slice(0, 1000) };
        }
        if (result === undefined) {
          const plugin = module.default ?? module;
          const isBundle = JSON.parse(await readFile(runtimeRequire.resolve(name + '/package.json'), 'utf8')).dsh?.bundle;
          const manifest = JSON.parse(await readFile(runtimeRequire.resolve(name + '/package.json'), 'utf8'));
          const frameworkPeer = manifest.peerDependencies?.['@deepseek-ai/cordis'] || manifest.dependencies?.['@deepseek-ai/cordis'];
          if ((!pluginShape(plugin) || !frameworkPeer && !module.apply) && !isBundle) result = { outcome: 'library', off, on: false, cleanup: true, reason: 'Package has no root Cordis plugin entry; use its bundle/client/library API' };
          else {
            await apply(message.rows ?? [{ id: name, enabled: true, config: {} }]);
            const settled = snapshot(), entry = settled.find(entry => entry.module === name);
            const failed = settled.find(item => item.enabled && item.state === 'failed');
            const pending = settled.filter(item => item.enabled && ['pending', 'loading'].includes(item.state));
            const state = failed ? 'failed' : pending.length ? 'pending' : entry?.state;
            const requires = Array.isArray(plugin.inject) ? plugin.inject : plugin.inject && typeof plugin.inject === 'object' ? Object.keys(plugin.inject) : [];
            result = { outcome: state === 'active' ? 'active' : state === 'pending' || /invalid config|needs a|fixture.*required|abstract.*seam|already.*registered|not iterable|extension.*not supported/.test(failed?.error ?? entry?.error ?? '') ? 'pending' : 'failed', off, on: state === 'active',
              reason: state === 'active' ? undefined : failed?.error ?? entry?.error ?? `Upstream ${state ?? 'unavailable'}; ${pending.length ? 'waiting entries: ' + pending.slice(0, 8).map(item => item.module).join(', ') : 'declared services:'} ${requires.join(', ') || 'configuration/host context required'}` };
            await apply([]); (result as any).cleanup = snapshot().length === 0;
          }
        }
      } else if (message.method === 'close') { await ctx.fiber.dispose(); result = { disposed: true }; }
      else throw new Error('Unknown worker method');
      process.send?.({ id: message.id, result }, () => { if (message.method === 'close') process.disconnect?.(); });
    } catch (error) { process.send?.({ id: message.id, error: String(error).slice(0, 1500) }); }
  });
});
let closing = false;
async function close() { if (closing) return; closing = true; await ctx.fiber.dispose(); process.exitCode = 0; }
process.once('disconnect', () => { void close(); });
process.once('SIGTERM', () => { void close().then(() => process.exit()); });
process.send?.({ ready: true });
