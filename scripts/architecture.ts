import { cp, glob, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Kernel } from '@devlab/kernel';
import { analyzeProject } from '@creoaurea/pop-the-hood/analyzer';
import { canonicalJson, RegistryArtifactSchema } from '@creoaurea/pop-the-hood/contracts';
import { preimpSources, appendPreimpGraph } from '@devlab/project-local';
import { grants, profile } from '../src/profile.ts';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const output = process.env.DEVLAB_BUILD_DIR ?? join(root, 'dist');
type Package = { name: string; source: string };
const original = JSON.parse(await readFile(join(root, 'vendor/previous-ui/catalog.json'), 'utf8')) as { packages: Package[] };
const refreshed = JSON.parse(await readFile(join(root, 'vendor/full-ui/catalog.json'), 'utf8')) as { packages: Package[] };
const local = (refreshed as unknown as { localPackages?: Package[] }).localPackages ?? [];
const packages = [...new Map([...original.packages, ...refreshed.packages, ...local].map(pkg => [pkg.name, pkg])).values()];
const host = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
const staging = await mkdtemp(join(tmpdir(), 'devlab-architecture-'));
try {
  for (const path of ['src', 'runtime', 'scripts', 'package.json', 'tsconfig.json', 'vite.config.ts', 'devlab.preview.json']) {
    await cp(join(root, path), join(staging, path), { recursive: true });
  }
  // Index only installed host dependencies, never the old application's shell composition.
  for (const pkg of packages.filter(p => host.dependencies[p.name] && /^(packages|plugins)\//.test(p.source))) {
    await mkdir(join(staging, pkg.source), { recursive: true });
    const source = host.dependencies[pkg.name]?.startsWith('file:plugins/') || host.dependencies[pkg.name]?.startsWith('file:packages/') ? join(root, pkg.source) : join(root, 'node_modules', pkg.name, 'source');
    await cp(source, join(staging, pkg.source), { recursive: true, filter: path => !path.endsWith('/ownership-sandbox') && !path.endsWith('.sha256') });
  }
  // The editable client already has one canonical source path under packages/client.
  // Archived clients retain their original flat-source layout only when selected.
  if (!local.some(pkg => pkg.name === '@devlab/client')) {
    await mkdir(join(staging, 'apps/web/src'), { recursive: true });
    await cp(join(root, 'node_modules/@devlab/client/source/client.ts'), join(staging, 'apps/web/src/client.ts'));
  }
  const value = await analyzeProject(staging, { ignore: ['_LAB'] });
  // Ownership YAML is the authority; the UI reads this generated hierarchy.
  const registryPath = '.agents/ownership/README.md';
  const registryText = await readFile(join(root, registryPath), 'utf8');
  const selected = JSON.parse(execFileSync('/usr/bin/python3', ['-I', '-B',
    join(root, '.agents/data/definitions.py'), 'ownership', '--root', root], { encoding: 'utf8' })) as {
    id: string; group: string; paths: string[]; purpose: string; uses: string[]; public: string[];
  }[];
  const ownership = { modules: {} as Record<string, { group: string; paths: string[]; purpose: string; depends_on: string[]; public_surfaces: string[]; source: string }> };
  for (const owner of selected) {
    const paths: string[] = [];
    for (const pattern of owner.paths) for await (const path of glob(pattern, { cwd: root })) {
      if (!path.split('/').includes('_LAB') && (await stat(join(root, path))).isFile()) paths.push(path);
    }
    ownership.modules[owner.id] = { group: owner.group, paths: [...new Set(paths)], purpose: owner.purpose, depends_on: owner.uses,
      public_surfaces: owner.public, source: `.agents/ownership/${owner.group}/${owner.id}.yaml` };
  }
  const items = value.catalog.graph.items;
  const layerLabels: Record<string, [string, string]> = {
    browser: ['Browser workspace', 'Presentation and retained workspace owners. Browser code consumes public contracts.'],
    backend: ['Backend services', 'Loopback server, files and terminal processes. Runtime permissions are enforced by their services.'],
    contracts: ['Public contracts', 'Shared service and UI interfaces. Contracts carry no process or filesystem authority.'],
    coordination: ['Project guidance', 'Ownership, rules and planning documents. Historical definitions do not register an executor.'],
    delivery: ['Build & packaging', 'Dependency composition, source artifacts and development tooling.'],
    verification: ['Verification', 'Disposable fixtures and checks. Test coverage is separate from runtime isolation.'],
  };
  for (const group of new Set(selected.map(owner => owner.group))) {
    const [label, detail] = layerLabels[group] ?? [group, 'Selected ownership group.'];
    items.push({ id: 'layer:' + group, parentId: null, kind: 'group', label, detail });
  }
  const owners = new Map<string, string>();
  for (const [name, module] of Object.entries(ownership.modules)) {
    const id = 'owner:' + name;
    items.push({ id, parentId: 'layer:' + module.group, kind: 'group', label: name,
      path: module.source, detail: `${module.purpose}\nPublic surfaces: ${module.public_surfaces.join(', ')}\nDepends on: ${module.depends_on.join(', ') || 'none'}` });
    for (const path of module.paths) {
      if (owners.has(path)) throw new Error('Overlapping ownership: ' + path);
      owners.set(path, id);
      const text = await readFile(join(root, path), 'utf8');
      const snapshotAvailable = RegistryArtifactSchema.shape.sources.safeParse({ [path]: text }).success;
      if (snapshotAvailable) value.sources[path] = text;
      else delete value.sources[path];
      let file = items.find(item => item.kind === 'file' && item.path === path);
      if (!file) {
        file = { id: 'file:' + path, parentId: id, kind: 'file', label: path.split('/').at(-1)!, path,
          detail: 'Source with a selected ownership definition', sha256: createHash('sha256').update(text).digest('hex') };
        items.push(file);
      }
      file.parentId = id;
      if (!snapshotAvailable) file.detail = 'Owned source; text snapshot omitted because it exceeds the bounded artifact contract. Open the original through the project file service.';
    }
    for (const dependency of module.depends_on) {
      if (!ownership.modules[dependency]) throw new Error('Unknown owner dependency: ' + dependency);
      value.catalog.graph.edges.push({ id: `owner:${name}:${dependency}`, source: id, target: 'owner:' + dependency,
        kind: 'requires', label: 'depends on', evidence: [{ path: module.source,
          line: 1,
          text: `${name} depends on ${dependency}` }] });
    }
  }
  value.sources[registryPath] = registryText;
  if (!items.some(item => item.kind === 'file' && item.path === registryPath)) items.push({ id: 'file:' + registryPath, parentId: 'group:project', kind: 'file', label: 'Ownership registry',
      path: registryPath, detail: 'Selected agent-home ownership navigation',
    sha256: createHash('sha256').update(registryText).digest('hex') });
  // Generic src/scripts folders become empty after reparenting their files.
  for (const id of ['group:src', 'group:scripts']) {
    const index = items.findIndex(item => item.id === id);
    if (index >= 0 && !items.some(item => item.parentId === id)) items.splice(index, 1);
  }
  const labels: Record<string, string> = { 'group:project': 'Shared configuration', 'group:packages': 'Reusable contracts & core',
    'group:plugins': 'Capability implementations', 'group:apps': 'Browser client', 'group:external': 'External dependencies' };
  for (const item of items) if (labels[item.id]) item.label = labels[item.id]!;
  // The public analyzer excludes HTML; keep its source available in Hood.
  for (const path of ['index.html']) {
    const text = await readFile(join(root, path), 'utf8');
    value.sources[path] = text;
    if (!items.some(item => item.kind === 'file' && item.path === path))
      items.push({ id: 'file:' + path, parentId: null, kind: 'file', label: path,
        path, detail: 'Explicit host contract', sha256: createHash('sha256').update(text).digest('hex') });
  }
  // Keep installed kernel/third-party source visible without inventing local owners.
  const ungrouped = items.filter(item => item.parentId === null && !item.id.startsWith('layer:'));
  if (ungrouped.length) {
    items.push({ id: 'layer:installed', parentId: null, kind: 'group', label: 'Installed & unassigned source',
      detail: 'Installed kernel and reusable packages, external dependencies, plus source without a selected local owner. Expand for the exact inventory.' });
    for (const item of ungrouped) item.parentId = 'layer:installed';
  }
  const preimp = await preimpSources(root);
  appendPreimpGraph(value.catalog.graph, preimp.tasks);
  Object.assign(value.sources, preimp.sources);
  for (const [path, text] of Object.entries(preimp.sources)) {
    const file = items.find(item => item.id === 'file:' + path)!;
    file.sha256 = createHash('sha256').update(text).digest('hex');
  }
  value.catalog.snapshotId = createHash('sha256').update(canonicalJson({
    graph: value.catalog.graph, channels: value.catalog.channels, sources: value.sources,
  })).digest('hex');
  const artifact = RegistryArtifactSchema.parse(value);
  const manifests = profile(new Kernel(grants), root, 0).map(plugin => plugin.manifest);
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'architecture.json'), JSON.stringify(artifact));
  console.log(`Hood: ${manifests.length} actual backend manifests; ${Object.keys(artifact.sources).length} source records from the actual full UI.`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
