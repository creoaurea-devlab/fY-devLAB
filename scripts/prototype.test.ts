import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { requestPrototype } = await import(new URL('./prototype.mjs', import.meta.url).href) as {
  requestPrototype(root: string): Promise<string>;
};

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'devtest-prototype-cli-'));
  const root = await realpath(directory);
  const expected = createHash('sha256').update(root).digest('hex');
  const paths: string[] = [], bodies: string[] = [];
  let catalog: unknown = [{ id: 'default', workspaceId: expected }];
  let outcome: 'ready' | 'failed' | 'reset' = 'ready';
  const frontendURL = 'http://127.0.0.1:49876';
  const server = createServer((request, response) => {
    paths.push(request.method + ' ' + request.url);
    if (request.method === 'POST') {
      let body = ''; request.on('data', chunk => { body += String(chunk); });
      request.on('end', () => {
        bodies.push(body);
        if (outcome === 'reset') { request.socket.destroy(); return; }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ projectId: 'default', status: outcome, url: frontendURL,
          ...(outcome === 'failed' ? { error: 'Private fixture failed to start' } : {}) }));
      });
    } else {
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(catalog));
    }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const backendURL = 'http://127.0.0.1:' + address.port;
  const view = '/?view=element&element=kanban&variant=A&projectId=default';
  const descriptor = { schemaVersion: 1, start: ['node', 'scripts/dev-ui.mjs', '--backend', backendURL, '--port', '{port}'], views: [{ path: view }] };
  await writeFile(join(root, 'devlab.preview.json'), JSON.stringify(descriptor));
  return { root, directory, paths, bodies, descriptor, frontendURL, view,
    catalog(value: unknown) { catalog = value; }, outcome(value: typeof outcome) { outcome = value; },
    async dispose() {
      const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections(); await closed; await rm(directory, { recursive: true, force: true });
    } };
}

test('prototype command verifies canonical workspace then requests exactly one managed start and returns actual view URL', async () => {
  const f = await fixture();
  const shortcut = f.root + '-shortcut';
  try {
    await symlink(f.root, shortcut);
    assert.equal(await requestPrototype(shortcut), new URL(f.view, f.frontendURL).href);
    assert.deepEqual(f.paths, ['GET /api/projects', 'POST /api/servers/default/start']);
    assert.deepEqual(f.bodies, ['{}']);
  } finally { await rm(shortcut, { force: true }); await f.dispose(); }
});

test('prototype refuses wrong/missing workspace and unsafe descriptor before any start mutation', async () => {
  const f = await fixture();
  try {
    for (const catalog of [[], [{ id: 'default' }], [{ id: 'default', workspaceId: '0'.repeat(64) }]]) {
      f.catalog(catalog); await assert.rejects(requestPrototype(f.root), /physical workspace/);
    }
    assert(f.paths.every(path => path === 'GET /api/projects'));
    for (const backend of ['http://example.com', 'http://user:secret@127.0.0.1:4311', 'http://127.0.0.1:4311/path']) {
      await writeFile(join(f.root, 'devlab.preview.json'), JSON.stringify({ ...f.descriptor,
        start: ['node', 'dev-ui.mjs', '--backend', backend] }));
      await assert.rejects(requestPrototype(f.root), /loopback|credential/);
    }
    await writeFile(join(f.root, 'devlab.preview.json'), JSON.stringify({ ...f.descriptor, views: [{ path: '//outside.invalid/' }] }));
    await assert.rejects(requestPrototype(f.root), /confined/);
    assert.equal(f.paths.length, 3);
  } finally { await f.dispose(); }
});

test('prototype reports failed managed state and never retries an ambiguous POST response', async () => {
  const f = await fixture();
  try {
    f.outcome('failed'); await assert.rejects(requestPrototype(f.root), /Private fixture failed to start/);
    assert.equal(f.bodies.length, 1);
    f.outcome('reset'); await assert.rejects(requestPrototype(f.root), /outcome is unknown/);
    assert.equal(f.bodies.length, 2, 'Each invocation makes at most one start request');
    assert.deepEqual(f.paths, ['GET /api/projects', 'POST /api/servers/default/start', 'GET /api/projects', 'POST /api/servers/default/start']);
  } finally { await f.dispose(); }
});
