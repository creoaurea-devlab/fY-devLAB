import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Kernel } from '@devlab/kernel';
import { grants, profile } from '../src/profile.ts';

// Disposable apps and private host state exercise the real four-preview pipeline.
const root = fileURLToPath(new URL('../', import.meta.url));
const data = await mkdtemp(join(tmpdir(), 'devlab-browser-'));
const kernel = new Kernel(grants);
try {
  await kernel.start(profile(kernel, root, 0, data));
  const projects = [];
  for (let index = 1; index <= 4; index++) {
    const folder = join(data, 'app-' + index);
    await mkdir(folder);
    const html = `<!doctype html><html><head><title>Preview ${index}</title></head><body style="font:16px system-ui;padding:24px;background:hsl(${index * 65} 35% 92%)"><h1>Preview ${index}</h1><label>Preview input <input aria-label="Preview input" /></label></body></html>`;
    await writeFile(join(folder, 'index.html'), html);
    await writeFile(join(folder, 'server.mjs'), `import { createServer } from 'node:http'; import { readFile } from 'node:fs/promises'; createServer(async (_q, r) => { r.writeHead(200, {'content-type':'text/html'}); r.end(await readFile(new URL('./index.html',import.meta.url))); }).listen(Number(process.argv[2]), '127.0.0.1');`);
    await writeFile(join(folder, 'devlab.preview.json'), JSON.stringify({ schemaVersion: 1, adapter: 'static', start: [process.execPath, 'server.mjs', '{port}'], port: 48100 + index, autoStart: false, inspection: 'manual' }));
    const project = await kernel.service('projects').open({ path: folder, label: 'Preview app ' + index });
    const server = await kernel.service('servers').start(project.id);
    if (server.status !== 'ready') throw new Error(server.error ?? 'Fixture server did not start');
    projects.push({ id: project.id, label: project.label, url: server.url });
  }
  console.log(JSON.stringify({ url: kernel.service('http').url, projects }));
  await new Promise<void>(resolve => { process.stdin.once('data', () => resolve()); process.stdin.once('end', resolve); process.once('SIGTERM', resolve); process.once('SIGINT', resolve); process.stdin.resume(); });
} finally {
  await kernel.close();
  await rm(data, { recursive: true, force: true });
}
