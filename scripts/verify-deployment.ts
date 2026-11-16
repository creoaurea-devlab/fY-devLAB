import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { RegistryArtifactSchema, RegistrySnapshotSchema } from '@devlab/contracts';

/** A static Hood snapshot is valid only for the build actually served beside it. */
export async function verifyDeployment(root: string, base: string, build = join(root, 'dist')) {
  const html = await readFile(join(build, 'index.html'), 'utf8');
  const artifact = RegistryArtifactSchema.parse(JSON.parse(await readFile(join(build, 'architecture.json'), 'utf8')));
  const response = await fetch(new URL('/', base), { signal: AbortSignal.timeout(10000) });
  if (!response.ok || await response.text() !== html) throw new Error('Served page differs from the selected build');
  for (const [, asset] of html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g)) {
    const actual = await fetch(new URL(asset!, base), { signal: AbortSignal.timeout(10000) });
    if (!actual.ok || !Buffer.from(await actual.arrayBuffer()).equals(await readFile(join(build, asset!))))
      throw new Error('Served asset differs from the selected build: ' + asset);
  }
  const snapshotResponse = await fetch(new URL('/api/architecture', base), { signal: AbortSignal.timeout(10000) });
  if (!snapshotResponse.ok) throw new Error('Live Hood snapshot is unavailable');
  const snapshot = RegistrySnapshotSchema.parse(await snapshotResponse.json());
  if (snapshot.catalog.snapshotId !== artifact.catalog.snapshotId)
    throw new Error('Live Hood snapshot is stale: refresh the backend safely before completing deployment');
  let checked = 0;
  for (const [path, text] of Object.entries(artifact.sources)) {
    let current: string;
    try { current = await readFile(join(root, path), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    if (current !== text) throw new Error('Hood artifact source is stale: ' + path);
    checked++;
  }
  return { snapshotId: snapshot.catalog.snapshotId, sourceFilesChecked: checked };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  try { console.log(JSON.stringify(await verifyDeployment(root, process.env.DEVLAB_URL ?? `http://127.0.0.1:${process.env.PORT ?? 4311}/`, process.env.DEVLAB_BUILD_DIR))); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
