import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function bindMemory({ python = 'python3', moduleRoot, database, binding, timeoutMs = 10000 }) {
  const child = spawn(python, ['-I', '-B', fileURLToPath(new URL('./worker.py', import.meta.url))], {
    stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  const pending = new Map();
  let buffer = '', closed = false;
  const fail = error => {
    if (closed) return;
    closed = true;
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
    child.stdin.destroy();
    child.kill();
  };
  const wait = id => new Promise((resolve, reject) => {
    const timer = setTimeout(() => fail(new Error('Memory worker timed out; mutation outcome may be unknown')), timeoutMs);
    pending.set(id, { resolve, reject, timer });
  });
  const ready = wait('ready');
  ready.catch(() => {}); // Closing a never-used binding still has a handled readiness rejection.
  child.stdout.on('data', chunk => {
    buffer += chunk.toString();
    if (Buffer.byteLength(buffer) > 131072) return fail(new Error('Memory response exceeds limit'));
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      try {
        if (Buffer.byteLength(line) > 65536) throw new Error('Memory response exceeds limit');
        const message = JSON.parse(line), item = pending.get(message.id);
        if (!item) continue;
        clearTimeout(item.timer); pending.delete(message.id);
        if (message.error) item.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
        else item.resolve(message.id === 'ready' ? message : message.result);
      } catch (error) { fail(error); }
    }
  });
  child.stderr.on('data', () => {}); // Never forward private records or Python tracebacks to UI logs.
  child.on('error', fail);
  child.on('exit', () => fail(new Error('Memory worker disconnected; retry mutations with the same request_id')));
  child.stdin.on('error', fail);
  child.stdin.write(JSON.stringify({ version: 1, moduleRoot, database, binding }) + '\n');
  return {
    ready,
    async call(operation, args) {
      await ready;
      if (closed) throw new Error('Memory worker closed');
      if (pending.size >= 16) throw new Error('Memory queue full');
      const id = randomUUID(), line = JSON.stringify({ id, operation, arguments: args }) + '\n';
      if (Buffer.byteLength(line) > 65536) throw new Error('Memory request exceeds 64 KiB');
      const response = wait(id);
      child.stdin.write(line);
      return response;
    },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const ended = new Promise(resolve => child.once('exit', resolve));
      fail(new Error('Memory binding closed'));
      const timer = setTimeout(() => child.kill('SIGKILL'), 1000);
      await ended; clearTimeout(timer);
    },
  };
}
