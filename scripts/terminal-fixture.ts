/** Private data, project, shells and preview; never reuses the user's app state. */
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Kernel } from '@devlab/kernel';
import { grants, profile } from '../src/profile.ts';

const source = fileURLToPath(new URL('../', import.meta.url));
const data = await mkdtemp(join(tmpdir(), 'devtest-terminal-browser-'));
const root = join(data, 'project');
const kernel = new Kernel(grants);
let projectId = '';
const running = async (pid: number) => {
  try {
    const stat = await readFile('/proc/' + pid + '/stat', 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] !== 'Z';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
};
try {
  await mkdir(join(root, '.context/modules'), { recursive: true });
  await writeFile(join(root, 'owned.txt'), 'owned original\n');
  await writeFile(join(root, 'sibling.txt'), 'sibling original\n');
  await writeFile(join(root, '.context/modules/registry.yaml'),
    'schema_version: 1\nmodules:\n  fixture-owner:\n    paths:\n      - owned.txt\n    purpose: Private terminal fixture ownership\n    depends_on: []\n    public_surfaces: []\n');
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Terminal fixture preview</title><h1>Retained preview</h1><label>Preview input <input aria-label="Preview input"></label>');
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
  const address = reservation.address();
  assert(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  await writeFile(join(root, 'server.mjs'),
    'import {createServer} from "node:http"; import {readFile} from "node:fs/promises"; createServer(async (_q,r)=>{r.writeHead(200,{"content-type":"text/html"});r.end(await readFile(new URL("./index.html",import.meta.url)));}).listen(Number(process.argv[2]),"127.0.0.1");');
  await writeFile(join(root, 'devlab.preview.json'), JSON.stringify({ schemaVersion: 1, adapter: 'static',
    start: [process.execPath, 'server.mjs', '{port}'], port, autoStart: false, inspection: 'manual' }));
  await kernel.start(profile(kernel, source, 0, data));
  const project = await kernel.service('projects').open({ path: root, label: 'Terminal fixture' });
  projectId = project.id;
  const preview = await kernel.service('servers').start(projectId);
  assert.equal(preview.status, 'ready', preview.error);
  console.log(JSON.stringify({ url: kernel.service('http').url, projectId, root, previewUrl: preview.url }));
  await new Promise<void>(resolve => {
    process.stdin.once('data', () => resolve()); process.stdin.once('end', resolve);
    process.once('SIGTERM', resolve); process.once('SIGINT', resolve); process.stdin.resume();
  });
} finally {
  const pids = projectId ? kernel.service('terminals').list(projectId).filter(session => session.status === 'running').map(session => session.pid) : [];
  await kernel.close();
  for (let attempt = 0; attempt < 100 && (await Promise.all(pids.map(running))).some(Boolean); attempt++) await delay(20);
  const active = await Promise.all(pids.map(running));
  await rm(data, { recursive: true, force: true });
  assert(!active.some(Boolean), 'Fixture left a terminal process running: ' + pids.filter((_pid, index) => active[index]).join(','));
  console.log(JSON.stringify({ closed: true, terminalPids: pids, processesGone: true }));
}
