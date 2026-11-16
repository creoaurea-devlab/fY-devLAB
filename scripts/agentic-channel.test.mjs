import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { channel } from '../apps/automation-desktop/channel.mjs';

test('private channel rejects forged/versioned requests, bounds messages and cancels on disconnect', async () => {
  const a = new EventEmitter(), b = new EventEmitter(); a.connected = b.connected = true;
  a.send = message => queueMicrotask(() => b.emit('message', message));
  b.send = message => queueMicrotask(() => a.emit('message', message));
  let calls = 0;
  const left = channel({ peer: a, token: 'host-secret', handle: async () => true, timeoutMs: 100 });
  const right = channel({ peer: b, token: 'host-secret', handle: async (_method, args) => { calls++; return args; }, timeoutMs: 100 });
  try {
    a.send({ version: 1, token: 'forged', id: 'attack', type: 'request', method: 'run' });
    a.send({ version: 2, token: 'host-secret', id: 'attack', type: 'request', method: 'run' });
    assert.deepEqual(await left.call('roundtrip', { value: 1 }), { value: 1 });
    assert.equal(calls, 1);
    await assert.rejects(left.call('large', { value: 'x'.repeat(8 * 1024 * 1024) }), /8 MiB/);
    const unknown = left.call('pending'); a.connected = false; a.emit('disconnect');
    await assert.rejects(unknown, /outcome may be unknown/);
    assert.equal(a.listenerCount('message'), 0);
  } finally { left.close(); right.close(); }
});
