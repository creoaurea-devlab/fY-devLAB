import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAgentic } from '../plugins/agentic/src/index.mjs';

test('session admission, stop isolation, deadline, durable identity and explicit crash recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentic-sessions-'));
  const config = { root, installation: 'fixture', owner: 'local', project: 'test' };
  const calls = [];
  let runtime;
  try {
    runtime = await createAgentic({ ...config, browser: { release: async context => calls.push(context) }, provider: async () => new Promise(() => {}) });
    const a = await runtime.ensure(randomUUID()), b = await runtime.ensure(randomUUID());
    const start = runtime.start(a.id, { task: 'keep full user text', durationMs: 30000 });
    await assert.rejects(runtime.start(a.id, { task: 'concurrent duplicate' }), /already running/); await start;
    await runtime.start(b.id, { task: 'separate owner', durationMs: 30000 });
    await runtime.stop(a.id);
    assert.equal(runtime.list().find(session => session.id === a.id).run.status, 'stopped');
    assert.equal(runtime.list().find(session => session.id === b.id).run.status, 'running');
    assert(!calls.includes(b.contextId));
    await runtime.stop(b.id);
    await runtime.start(a.id, { task: 'deadline', durationMs: 100 });
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(runtime.list().find(session => session.id === a.id).run.status, 'stopped');
    await runtime.start(b.id, { task: 'dispose while active', durationMs: 30000 });
    const closing = runtime.close();
    await assert.rejects(runtime.start(a.id, { task: 'must not enter during disposal' }), /closed/);
    await closing;
    const saved = JSON.parse(await readFile(join(root, 'sessions.json'), 'utf8'));
    saved.sessions[0].run.status = 'running';
    await writeFile(join(root, 'sessions.json'), JSON.stringify(saved));
    runtime = await createAgentic(config);
    const restored = await runtime.ensure(a.contextId);
    assert.equal(restored.id, a.id); assert.equal(restored.profile, a.profile); assert.equal(restored.run.status, 'interrupted');
    assert.equal(restored.messages[0].text, 'keep full user text');
    await assert.rejects(runtime.start(a.id, { task: 'too long', durationMs: 1800001 }), /30 minutes/);
  } finally { await runtime?.close(); await rm(root, { recursive: true, force: true }); }
});
