import { resolve, join } from 'node:path';
import { readRuntimeSelection } from './plugins/control.ts';
import { fileURLToPath } from 'node:url';
import { Kernel } from '@devlab/kernel';
import { grants, profile } from './index.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT ?? 4322);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');
const data = resolve(process.env.DEVLAB_DATA_DIR ?? join(root, '.data'));
const kernel = new Kernel(grants);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => { console.error('Shutdown timed out'); process.exit(1); }, 12000);
  try { await kernel.close(); } catch (error) { console.error(error); process.exitCode = 1; }
  finally { clearTimeout(deadline); if (process.connected) process.disconnect(); }
}
process.once('SIGINT', close);
process.once('SIGTERM', close);
if (process.send) process.once('disconnect', close);
try {
  const definitions = profile(kernel, root, port, data, undefined,
    await readRuntimeSelection(join(data, 'runtime-plugins.json')));
  await kernel.start(definitions);
  const hasService = (key: 'rules' | 'http') => definitions.some(plugin => plugin.manifest.provides.includes(key));
  const rules = hasService('rules') ? await kernel.service('rules').snapshot('default') : undefined;
  if (rules?.edition === 'wisdohm-2.6' && rules.authority.status === 'ready') console.log('** CA_WISDOHM - ON **');
  console.log('+--------------------------------------------+');
  console.log(`| DevLab · ${rules?.edition ?? 'rules disabled'}`);
  if (rules) console.log(`| Rules: ${rules.authority.status} · Memory: ${rules.memory.status} (${rules.memory.records} records)`);
  console.log('| Inspection is read-only; agent guards remain explicit.');
  console.log('+--------------------------------------------+');
  console.log(`Project: ${root}`);
  if (process.send) process.send({ type: 'ready', origin: hasService('http') ? kernel.service('http').url : null });
  console.log(hasService('http') ? `DevLab: ${kernel.service('http').url}` : 'DevLab HTTP transport disabled');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  await close();
}
