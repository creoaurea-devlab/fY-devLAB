import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function loopbackOrigin(input) {
  let url;
  try { if (typeof input !== 'string') throw new Error(); url = new URL(input); }
  catch { throw new Error('Preview backend/server URL must be a loopback HTTP origin'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('Preview backend/server URL must be a credential-free loopback HTTP origin');
  return url;
}

/** Ask the existing resource owner to start the selected checkout's managed preview. */
export async function requestPrototype(root = fileURLToPath(new URL('../', import.meta.url))) {
  const canonicalRoot = await realpath(root);
  const file = await open(join(canonicalRoot, 'devlab.preview.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let descriptor;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 65536) throw new Error('Preview descriptor must be a regular JSON file within 64 KiB');
    descriptor = JSON.parse(await file.readFile('utf8'));
  } finally { await file.close(); }
  const argv = descriptor?.start;
  if (!Array.isArray(argv) || !argv.every(value => typeof value === 'string') || argv.filter(value => value === '--backend').length !== 1)
    throw new Error('Preview descriptor must select exactly one --backend origin');
  const backend = loopbackOrigin(argv[argv.indexOf('--backend') + 1]);
  backend.hostname = '127.0.0.1';
  const view = descriptor.views?.[0]?.path;
  if (typeof view !== 'string' || !view.startsWith('/') || new URL(view, backend).origin !== backend.origin)
    throw new Error('Preview descriptor needs a first view confined to the frontend origin');
  const signal = AbortSignal.timeout(35000);
  const request = async (path, init = {}) => {
    const response = await fetch(new URL(path, backend), { ...init, redirect: 'error', signal });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Preview API returned HTTP ' + response.status); }
    const chunks = []; let size = 0;
    for await (const chunk of response.body ?? []) {
      size += chunk.byteLength;
      if (size > 1024 * 1024) throw new Error('Preview API JSON exceeds 1 MiB');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  };
  const projects = await request('/api/projects');
  const defaults = Array.isArray(projects) ? projects.filter(project => project?.id === 'default') : [];
  const workspaceId = createHash('sha256').update(canonicalRoot).digest('hex');
  if (defaults.length !== 1 || defaults[0].workspaceId !== workspaceId || defaults[0].available === false)
    throw new Error('Selected backend does not serve this physical workspace; open its matching app before starting Prototyping');
  let state;
  try {
    state = await request('/api/servers/default/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  } catch (error) {
    throw new Error('Managed preview start response unavailable; outcome is unknown. Inspect preview state before retrying.', { cause: error });
  }
  if (state?.projectId !== 'default' || state.status !== 'ready')
    throw new Error('Managed preview is not ready: ' + String(state?.error ?? state?.status ?? 'missing state').slice(0, 500));
  const frontend = loopbackOrigin(state.url), target = new URL(view, frontend);
  if (target.origin !== frontend.origin) throw new Error('Preview view escapes its managed frontend origin');
  return target.href;
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => null) === fileURLToPath(import.meta.url)) {
  try { console.log(await requestPrototype()); }
  catch (error) { console.error('prototype: ' + String(error?.message ?? error).slice(0, 600)); process.exitCode = 1; }
}
