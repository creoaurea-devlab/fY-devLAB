import test from 'node:test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { verifyDeployment } from './verify-deployment.ts';

const root = fileURLToPath(new URL('../', import.meta.url));

test('maintenance entry resolves its reviewed authority instead of dangling guidance', async () => {
  const entry = await readFile(join(root, 'AGENTS.md'), 'utf8');
  const active = await access(join(root, '.agents/BOOT.md')).then(() => '.agents', () =>
    access(join(root, '.wisdohm/BOOT.md')).then(() => '.wisdohm', () => '.context'));
  assert(entry.includes(active + '/protocols/maintenance.md'));
  const path = join(root, active, 'guides/MAINTENANCE-SOURCES.md');
  const protocol = await readFile(path, 'utf8');
  const sources = [...protocol.matchAll(/^\[([^\]]+)\]: (\S+) "sha256:([a-f0-9]{64})"$/gm)];
  assert(sources.length >= 8, 'Maintenance and all SOLID sources must be declared');
  for (const [, label, relative, digest] of sources) {
    const bytes = await readFile(resolve(dirname(path), relative!));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), digest, label + ': review changed source guidance before updating its pin');
  }
});

// Current source boundaries are checked in boundaries.test.ts; historical planner reports are not consulted.

test('deployment verification rejects frontend-only Hood drift and stale source/assets', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'devtest-deployment-'));
  const build = join(fixture, 'dist');
  const original = JSON.parse(await readFile(join(process.env.DEVLAB_BUILD_DIR ?? join(root, 'dist'), 'architecture.json'), 'utf8'));
  const artifact = { ...original, catalog: { ...original.catalog, snapshotId: '1'.repeat(64) }, sources: { 'src/fixture.ts': 'one' } };
  let servedSnapshot = { catalog: artifact.catalog, plugins: [], wiring: { items: [], edges: [] } };
  let servedAsset = 'one';
  const html = '<script type="module" src="/assets/test.js"></script>';
  const server = createServer((request, response) => {
    if (request.url === '/api/architecture') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(servedSnapshot)); }
    else if (request.url === '/assets/test.js') response.end(servedAsset);
    else response.end(html);
  });
  try {
    await mkdir(join(build, 'assets'), { recursive: true });
    await mkdir(join(fixture, 'src'));
    await writeFile(join(build, 'index.html'), html);
    await writeFile(join(build, 'assets/test.js'), 'one');
    await writeFile(join(build, 'architecture.json'), JSON.stringify(artifact));
    await writeFile(join(fixture, 'src/fixture.ts'), 'one');
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    assert.equal((await verifyDeployment(fixture, base)).sourceFilesChecked, 1);
    artifact.catalog = { ...artifact.catalog, snapshotId: '2'.repeat(64) };
    await writeFile(join(build, 'architecture.json'), JSON.stringify(artifact));
    await assert.rejects(verifyDeployment(fixture, base), /Live Hood snapshot is stale/);
    servedSnapshot = { ...servedSnapshot, catalog: artifact.catalog };
    assert.equal((await verifyDeployment(fixture, base)).snapshotId, artifact.catalog.snapshotId);
    await writeFile(join(fixture, 'src/fixture.ts'), 'changed');
    await assert.rejects(verifyDeployment(fixture, base), /artifact source is stale/);
    await writeFile(join(fixture, 'src/fixture.ts'), 'one');
    servedAsset = 'stale';
    await assert.rejects(verifyDeployment(fixture, base), /Served asset differs/);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(fixture, { recursive: true, force: true });
  }
});


test('compatibility ownership is derived from the trusted canonical reader', async () => {
  const projected = JSON.parse(execFileSync(process.env.DEVLAB_PYTHON ?? '/usr/bin/python3',
    ['-I', '-B', '.agents/data/definitions.py', 'ownership-projection', '--root', root], { cwd: root, encoding: 'utf8' }));
  assert.deepEqual(JSON.parse(await readFile(join(root, '.context/modules/registry.yaml'), 'utf8')), projected,
    'Run npm run ownership:sync after changing ownership definitions');
});
