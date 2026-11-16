import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const vendor = new URL('vendor/previous-ui/', root);
const provenance = JSON.parse(await readFile(new URL('provenance.json', vendor), 'utf8'));
const catalog = JSON.parse(await readFile(new URL('catalog.json', vendor), 'utf8'));
const fullUI = new URL('vendor/full-ui/', root);
const refreshed = JSON.parse(await readFile(new URL('catalog.json', fullUI), 'utf8'));
const overrides = new Map([...refreshed.packages, ...(refreshed.localPackages ?? [])].map(pkg => [pkg.name, pkg]));
const host = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
for (const pkg of provenance.packages) {
  if (sha(await readFile(new URL(pkg.archive, vendor))) !== pkg.sha256) throw new Error('Archive drift: ' + pkg.name);
}
let checked = 0;
for (const [path, expected] of Object.entries(provenance.implementationFiles)) {
  const pkg = catalog.packages.find(p => path.startsWith(p.source + '/'));
  if (!host.dependencies[pkg.name] || overrides.has(pkg.name)) continue;
  const installed = new URL('node_modules/' + pkg.name + '/source/' + path.slice(pkg.source.length + 1), root);
  if (sha(await readFile(installed)) !== expected) throw new Error('Installed implementation drift: ' + path);
  checked++;
}
for (const pkg of refreshed.localPackages ?? []) {
  const installed = new URL('node_modules/' + pkg.name + '/package.json', root);
  const local = new URL(pkg.source + '/package.json', root);
  if (sha(await readFile(installed)) !== sha(await readFile(local))) throw new Error('Local capability installation drift: ' + pkg.name);
}
let refreshedFiles = 0;
for (const pkg of refreshed.packages) {
  if ((refreshed.localPackages ?? []).some(local => local.name === pkg.name)) continue;
  if (sha(await readFile(new URL(pkg.archive, fullUI))) !== pkg.sha256) throw new Error('Full UI archive drift: ' + pkg.name);
  for (const [path, expected] of Object.entries(pkg.files)) {
    if (sha(await readFile(new URL('node_modules/' + pkg.name + '/' + path, root))) !== expected)
      throw new Error('Full UI implementation drift: ' + pkg.name + '/' + path);
    refreshedFiles++;
  }
}
for (const [path, expected] of Object.entries(refreshed.presentationFiles)) {
  if (sha(await readFile(new URL(path, root))) !== expected.sha256) throw new Error('Original presentation drift: ' + path);
}
console.log(`Verified ${provenance.packages.length} original archives, ${checked} reused sources, ${refreshedFiles} refreshed source/dist files and reviewed host presentation.`);
