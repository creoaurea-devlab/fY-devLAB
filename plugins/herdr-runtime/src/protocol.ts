import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';
import { ApplicationError } from '@devlab/contracts';

/** One bounded request; disconnect/timeout never retries an uncertain mutation. */
export function request(socketPath: string, method: string, params: object = {}): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const id = randomUUID(), socket = createConnection(socketPath);
    let buffer = '', settled = false;
    const finish = (error?: Error, value?: Record<string, unknown>) => {
      if (settled) return; settled = true; clearTimeout(timer); socket.destroy();
      if (error) reject(error); else resolve(value!);
    };
    const timer = setTimeout(() => finish(new ApplicationError('HERDR_TIMEOUT', 'Herdr response timed out; inspect state before retrying.')), 5000);
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.write(JSON.stringify({ id, method, params }) + '\n'));
    socket.on('data', (data: string) => {
      buffer += data;
      if (Buffer.byteLength(buffer) > 2 * 1024 * 1024) return finish(new Error('Herdr response exceeds 2 MiB.'));
      const end = buffer.indexOf('\n'); if (end < 0) return;
      try {
        const response = JSON.parse(buffer.slice(0, end));
        if (response.id !== id) throw new Error('Herdr response identity mismatch.');
        if (response.error) throw new ApplicationError('HERDR_COMMAND_FAILED', String(response.error.message).slice(0, 500));
        if (!response.result || typeof response.result !== 'object') throw new Error('Invalid Herdr response.');
        finish(undefined, response.result);
      } catch (error) { finish(error as Error); }
    });
    socket.once('error', error => finish(error));
    socket.once('close', () => finish(new Error('Herdr disconnected before replying; inspect state before retrying.')));
  });
}

/** A bounded event stream carries invalidations, never replayed control actions. */
export function subscribe(socketPath: string, paneIds: string[], changed: (event: string) => void, disconnected: () => void) {
  const id = randomUUID(), socket = createConnection(socketPath);
  let buffer = '', closed = false, acknowledged = false;
  const stop = () => { if (closed) return; closed = true; clearTimeout(timer); socket.destroy(); };
  const failed = () => { if (closed) return; stop(); disconnected(); };
  const timer = setTimeout(failed, 5000); timer.unref();
  const types = ['workspace.created', 'workspace.closed', 'workspace.renamed', 'workspace.focused', 'tab.created', 'tab.closed', 'tab.focused', 'tab.renamed', 'pane.created', 'pane.closed', 'pane.updated', 'pane.focused', 'pane.exited', 'pane.agent_detected', 'layout.updated'];
  socket.setEncoding('utf8'); socket.unref();
  socket.once('connect', () => socket.write(JSON.stringify({ id, method: 'events.subscribe', params: { subscriptions: [
    ...types.map(type => ({ type })), ...paneIds.map(pane_id => ({ type: 'pane.agent_status_changed', pane_id })),
  ] } }) + '\n'));
  socket.on('data', (chunk: string) => {
    buffer += chunk; if (Buffer.byteLength(buffer) > 2 * 1024 * 1024) return failed();
    for (let end; (end = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try {
        const value = JSON.parse(line);
        if (!acknowledged) {
          if (value.id !== id || value.result?.type !== 'subscription_started') return failed();
          acknowledged = true; clearTimeout(timer); changed('connected');
        } else if (typeof value.event === 'string') changed(value.event);
        else return failed();
      } catch { return failed(); }
    }
  });
  socket.once('error', failed); socket.once('close', failed);
  return stop;
}
