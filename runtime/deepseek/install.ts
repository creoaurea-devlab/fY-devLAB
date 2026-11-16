/** Exact upstream packages + reproducible builds for unpublished source, never in the root dependency tree. */
import { readFile, writeFile, mkdir, readdir, copyFile, symlink, lstat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { catalogue, UPSTREAM_REVISION } from './catalogue.ts';

export async function buildUnpublished(source: string, release: string) {
  const rows = await catalogue(source, release), provenance = [];
  const { build } = createRequire(import.meta.url)('esbuild');
  for (const row of rows.filter(row => !row.installed && row.platform && !row.private)) {
    const packageRoot = dirname(join(source, row.source)), manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    const target = join(release, 'source-builds', row.id.replaceAll('/', '--'));
    await mkdir(target, { recursive: true });
    const entries: Record<string, string> = {}, omitted: string[] = [];
    const outputs: string[] = [];
    function exports(value: unknown) {
      if (typeof value === 'string' && value.endsWith('.js') && value.startsWith('./lib/') && !value.includes('*')) outputs.push(value);
      else if (value && typeof value === 'object') for (const item of Object.values(value)) exports(item);
    }
    exports(manifest.exports);
    for (const output of new Set(outputs)) {
      const logical = output.slice('./lib/'.length, -3);
      const candidates = ['src/' + logical + '.ts', 'src/' + logical + '.tsx', 'src/' + logical + '/index.ts', 'src/' + logical + '/index.tsx'];
      let found;
      for (const path of candidates) { try { if ((await lstat(join(packageRoot, path))).isFile()) { found = join(packageRoot, path); break; } } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
      if (found) entries['lib/' + logical] = found; else omitted.push(output);
    }
    if (!Object.keys(entries).length) { provenance.push({ id: row.id, status: 'unavailable', omitted }); continue; }
    await build({ entryPoints: entries, outdir: target, bundle: true, splitting: true, format: 'esm', platform: 'node', target: 'es2023', packages: 'external', sourcemap: true,
      jsx: 'automatic', tsconfig: join(source, 'tsconfig.base.json'), logLevel: 'silent' });
    await writeFile(join(target, 'package.json'), JSON.stringify({ ...manifest, scripts: {}, dependencies: {}, peerDependencies: {}, devDependencies: {} }, null, 2) + '\n');
    for (const path of ['LICENSE', 'cordis.patch.yml']) {
      try { await copyFile(join(packageRoot, path), join(target, path)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; if (path === 'LICENSE') await copyFile(join(source, 'LICENSE'), join(target, 'LICENSE')); }
    }
    try { await readdir(join(packageRoot, 'locale')); await symlink(join(packageRoot, 'locale'), join(target, 'locale')); }
    catch (error) { if (!['ENOENT', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
    const link = join(release, 'node_modules', row.id); await mkdir(dirname(link), { recursive: true });
    try { await symlink(target, link); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    provenance.push({ id: row.id, status: 'source-built', originalManifestHash: row.sourceHash, omitted,
      sourceHashes: await sourceHashes(join(packageRoot, 'src')), compiler: createRequire(import.meta.url)('esbuild/package.json').version });
  }
  await writeFile(join(release, 'source-builds.json'), JSON.stringify({ upstream: UPSTREAM_REVISION, packages: provenance }, null, 2) + '\n');
  return provenance;
}
async function sourceHashes(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function walk(path: string) { for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name); if (entry.isDirectory() && !entry.isSymbolicLink()) await walk(file);
    else if (entry.isFile()) result[file.slice(root.length + 1)] = createHash('sha256').update(await readFile(file)).digest('hex');
  } }
  await walk(root); return result;
}
export async function installPinned(source: string, release: string) {
  await mkdir(release, { recursive: true });
  const rows = await catalogue(source, release), dependencies: Record<string, string> = {};
  const availability = [];
  for (const row of rows.filter(row => row.platform && !row.private)) {
    const response = await fetch('https://registry.npmjs.org/' + encodeURIComponent(row.id) + '/' + row.version, { signal: AbortSignal.timeout(15000) });
    if (response.ok) { const record = await response.json(); dependencies[row.id] = row.version; availability.push({ id: row.id, status: 'published', integrity: record.dist?.integrity, license: record.license }); }
    else if (response.status === 404) availability.push({ id: row.id, status: 'source-required' });
    else throw new Error(`Package registry refused ${row.id}: ${response.status}`);
  }
  // These browser/source-build runtime imports are pinned by the upstream lock but omitted from some published manifests.
  if (process.platform === 'linux' && process.arch === 'x64') dependencies['node-addon-require-builtin-linux-x64-gnu'] = '0.1.9';
  Object.assign(dependencies, { clsx: '2.1.1', immer: '10.2.0', fuzzysort: '4.0.2', '@modelcontextprotocol/server': '2.2.0' });
  await writeFile(join(release, 'package.json'), JSON.stringify({ name: 'devlab-deepseek-upstream-release', private: true, type: 'module', dependencies }, null, 2));
  await new Promise<void>((accept, reject) => {
    const child = spawn('npm', ['install', '--prefix', resolve(release), '--ignore-scripts', '--omit=dev', '--omit=optional', '--no-audit', '--no-fund'], { stdio: 'inherit' });
    child.once('error', reject); child.once('exit', code => code === 0 ? accept() : reject(new Error('Exact package installation failed: ' + code)));
  });
  await writeFile(join(release, 'availability.json'), JSON.stringify(availability, null, 2));
  return buildUnpublished(source, release);
}
