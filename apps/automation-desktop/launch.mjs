import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';

const options = new Set(['--browser-only', '--allow-loopback', '--smoke']);
const arguments_ = process.argv.slice(2);
for (const arg of arguments_) if (!options.has(arg) && !arg.startsWith('--data=') && !/^--scale=[12]$/.test(arg)) throw new Error(`Unknown option ${arg}`);
if (arguments_.includes('--smoke') && !arguments_.some(arg => arg.startsWith('--data='))) throw new Error('--smoke requires an explicit disposable --data root');
const executable = process.env.AUTOMATION_ELECTRON;
if (!executable || !process.env.AUTOMATION_PUPPETEER) throw new Error('Set AUTOMATION_ELECTRON and AUTOMATION_PUPPETEER to installed runtimes (see README)');
await Promise.all([access(executable), access(process.env.AUTOMATION_PUPPETEER)]);
if (!arguments_.includes('--browser-only') && !process.env.MEMORY_NODE_ROOT) throw new Error('Set MEMORY_NODE_ROOT or choose --browser-only');
const dataRoot = resolve(arguments_.find(arg => arg.startsWith('--data='))?.slice(7) || join(homedir(), '.local/share/devlab-automation'));
const env = { ...process.env, AUTOMATION_NODE: process.execPath, AUTOMATION_DATA_ROOT: dataRoot };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, [
  '--use-mock-keychain', '--site-per-process', fileURLToPath(new URL('./main.mjs', import.meta.url)),
  ...arguments_.filter(arg => !arg.startsWith('--data=') && !arg.startsWith('--scale=')),
  ...(arguments_.find(arg => arg.startsWith('--scale=')) ? ['--force-device-scale-factor=' + arguments_.find(arg => arg.startsWith('--scale=')).slice(8)] : []),
], { env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
