/** Disposable controller process: never opens a shell or touches the running app. */
import { basename, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { TerminalPersistence } from '../plugins/terminal-pty/src/persistence.ts';

const directory = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !basename(directory).startsWith('devtest-terminal-lease-'))
  throw new Error('Lease fixture requires its explicitly owned temporary directory');
const persistence = new TerminalPersistence(directory, '/unused-tmux');
let held = false;
const input = createInterface({ input: process.stdin });
console.log(JSON.stringify({ kind: 'ready', pid: process.pid }));
try {
  for await (const command of input) {
    try {
      if (command === 'init') { await persistence.init(); held = true; }
      else if (command === 'release') { try { await persistence.release(); } finally { held = false; } }
      else throw new Error('Unknown lease fixture command');
      console.log(JSON.stringify({ kind: command, pid: process.pid }));
    } catch (error) {
      console.log(JSON.stringify({ kind: 'error', message: String(error) }));
    }
  }
} finally { if (held) await persistence.release(); }
