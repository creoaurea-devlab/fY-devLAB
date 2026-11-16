/** Owned subprocess for crash-recovery acceptance. All state/project writes are private. */
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Kernel } from '@devlab/kernel';
import { terminalPty } from '@devlab/terminal-pty';
import { grants, profile } from '../src/profile.ts';

const source = fileURLToPath(new URL('../', import.meta.url));
const data = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !basename(data).startsWith('devtest-terminal-process-'))
  throw new Error('Crash fixture requires its explicitly owned temporary directory');
const kernel = new Kernel(grants);
try {
  const definitions = profile(kernel, source, 0, data).map(plugin => plugin.manifest.id === 'terminal-pty'
    ? terminalPty({ stateDirectory: join(data, 'terminals'),
      tmuxPath: join(source, '.tools/tmux/bin/tmux'), preserveOnDispose: true }) : plugin);
  await kernel.start(definitions);
  const project = await kernel.service('projects').open({ path: join(data, 'project'), label: 'Process crash fixture' });
  console.log(JSON.stringify({ ready: true, url: kernel.service('http').url, projectId: project.id, backendPid: process.pid }));
  await new Promise<void>(ready => {
    process.stdin.once('end', ready);
    process.stdin.once('data', ready);
    process.once('SIGTERM', ready);
    process.once('SIGINT', ready);
    process.stdin.resume();
  });
} finally {
  // Intentional detach: tmux lifetime is independent. The test closes its shell explicitly.
  await kernel.close();
}
