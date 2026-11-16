import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('standalone launch/reopen, Browser-only, scale two and missing-memory readiness', { timeout: 90000 }, async () => {
  for (const name of ['AUTOMATION_ELECTRON', 'AUTOMATION_PUPPETEER', 'MEMORY_NODE_ROOT']) assert(process.env[name], `${name} is required`);
  const root = await mkdtemp(join(tmpdir(), 'agentic-standalone-'));
  async function run(folder, args = [], env = {}) {
    const child = spawn(process.execPath, ['apps/automation-desktop/launch.mjs', `--data=${join(root, folder)}`, '--smoke', ...args], {
      env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
    const timer = setTimeout(() => child.kill('SIGTERM'), 20000);
    try {
      const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
      return { code, output };
    } finally { clearTimeout(timer); }
  }
  try {
    const fresh = await run('main'); assert.equal(fresh.code, 0, fresh.output); assert.match(fresh.output, /AUTOMATION_STANDALONE_PASS/);
    const initial = JSON.parse(await readFile(join(root, 'main/agentic/sessions.json'), 'utf8'));
    const reopened = await run('main'); assert.equal(reopened.code, 0, reopened.output); assert.match(reopened.output, /AUTOMATION_STANDALONE_PASS/);
    const restored = JSON.parse(await readFile(join(root, 'main/agentic/sessions.json'), 'utf8'));
    assert.deepEqual(restored.sessions.map(session => [session.id, session.profile, session.contextId]), initial.sessions.map(session => [session.id, session.profile, session.contextId]));
    const manual = await run('manual', ['--browser-only'], { MEMORY_NODE_ROOT: '' });
    assert.equal(manual.code, 0, manual.output); assert.match(manual.output, /"plugins":\["browser"\]/);
    const scaled = await run('scaled', ['--scale=2']); assert.equal(scaled.code, 0, scaled.output); assert.match(scaled.output, /"scale":2/);
    const missing = await run('missing', [], { MEMORY_NODE_ROOT: join(root, 'not-installed') });
    assert.equal(missing.code, 1, missing.output); assert.match(missing.output, /startup failed/); assert.doesNotMatch(missing.output, /automation-ready/);
    console.log('Four successful launches, stable reopened identities, and one expected readiness refusal; all used disposable roots.');
  } finally { await rm(root, { recursive: true, force: true }); }
});
