import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createCodex } from '../plugins/agentic/src/codex.mjs';

test('installed-Codex interface uses account/read and exposes only safe account/model state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentic-codex-'));
  const codex = createCodex({ root, command: [process.execPath, fileURLToPath(new URL('./fixtures/agentic-browser/codex.mjs', import.meta.url))] });
  try {
    const status = await codex.status();
    assert.equal(status.authenticated, true); assert.equal(status.accountType, 'chatgpt');
    assert.equal(status.models[0].id, 'fixture-model');
    assert(!JSON.stringify(status).includes('private@example.test'));
  } finally { await codex.close(); await rm(root, { recursive: true, force: true }); }
});

test('a Codex thread streams a reply and executes its bound browser tool through the public interface', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentic-codex-'));
  const codex = createCodex({ root, command: [process.execPath, fileURLToPath(new URL('./fixtures/agentic-browser/codex.mjs', import.meta.url))] });
  const events = [], session = { id: 'session-a' };
  try {
    const result = await codex.run({ session, task: 'Inspect this page', tools: { observe: async () => ({ version: 2, targets: [], partial: false }) },
      signal: new AbortController().signal, onThread: async id => { session.threadId = id; }, onEvent: event => events.push(event) });
    assert.equal(session.threadId, 'thread-1'); assert.equal(result.message, 'Inspected the page.');
    assert(events.some(event => event.kind === 'text' && event.text === 'Inspected '));
    assert(events.some(event => event.kind === 'tool' && event.text.includes('browser_observe')));
  } finally { await codex.close(); await rm(root, { recursive: true, force: true }); }
});
