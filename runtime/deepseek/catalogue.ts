import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import type { DeepSeekPackage } from '@devlab/contracts';

export const UPSTREAM_REVISION = '39163dd30f703a79079e2d2446545cff3c453738';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const available = (list: string[] | undefined, value: string) => !list ||
  (!list.includes('!' + value) && (!list.some(item => !item.startsWith('!')) || list.includes(value)));
/** Read pinned manifests as data; discovery never imports or activates code. */
export async function catalogue(source: string, release: string): Promise<DeepSeekPackage[]> {
  const paths: string[] = [];
  async function packages(folder: string, depth: number) {
    let entries;
    try { entries = await readdir(join(source, folder), { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    for (const entry of entries) if (entry.isDirectory() && !entry.isSymbolicLink()) {
      const name = join(folder, entry.name);
      if (depth > 1) await packages(name, depth - 1); else paths.push(join(name, 'package.json'));
    }
  }
  await packages('packages', 2); await packages('vendor', 1); await packages('apps', 1);
  paths.push('native/system/package.json'); await packages('native/system/packages', 1);
  const rows: DeepSeekPackage[] = [];
  for (const path of paths.sort()) {
    let text: string;
    try { text = await readFile(join(source, path), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    const manifest = JSON.parse(text);
    if (typeof manifest.name !== 'string' || !/^(?:@[a-z0-9-]+\/)?[a-z0-9._-]+$/.test(manifest.name)) throw new Error('Invalid upstream package identity');
    let installed = false;
    try { const saved = JSON.parse(await readFile(join(release, 'node_modules', manifest.name, 'package.json'), 'utf8'));
      installed = saved.version === manifest.version; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const dependencies = [...new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})])];
    rows.push({ id: manifest.name, version: manifest.version ?? 'unversioned', source: relative(source, join(source, path)).replaceAll('\\', '/'),
      description: manifest.description ?? '', license: typeof manifest.license === 'string' ? manifest.license : 'UNKNOWN', private: !!manifest.private,
      kind: manifest.dsh?.bundle ? 'bundle' : 'package', installed, platform: available(manifest.os, process.platform) && available(manifest.cpu, process.arch),
      dependencies, sourceHash: sha(text), distribution: dependencies.some(name => /claude|libreoffice/.test(name)) || !['MIT', 'Apache-2.0', 'ISC', 'BSD-3-Clause', 'BSD-2-Clause'].includes(manifest.license) ? 'review' : 'notice' });
  }
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Duplicate upstream package IDs');
  return rows;
}
