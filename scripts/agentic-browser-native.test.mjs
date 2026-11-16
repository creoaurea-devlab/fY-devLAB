import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('AB0: two native views, Puppeteer OOPIFs, seen-node dispatch, stop and cleanup', { timeout: 60000 }, async () => {
  assert(process.env.AUTOMATION_ELECTRON, 'Set AUTOMATION_ELECTRON to the installed Electron executable');
  assert(process.env.AUTOMATION_PUPPETEER, 'Set AUTOMATION_PUPPETEER to the installed Puppeteer module entry');
  const root = await mkdtemp(join(tmpdir(), 'agentic-native-'));
  let output = '';
  const env = { ...process.env, AUTOMATION_TEST_ROOT: root };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(process.env.AUTOMATION_ELECTRON, [
    '--use-mock-keychain', '--site-per-process', '--disable-gpu',
    fileURLToPath(new URL('./fixtures/agentic-browser/native.mjs', import.meta.url)),
  ], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 45000);
  try {
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    assert.equal(code, 0, output.slice(-12000));
    assert.match(output, /AB0_NATIVE_PASS/);
    console.log(output.split('\n').filter(line => /AB0_|versions/.test(line)).join('\n'));
  } finally { clearTimeout(timer); child.kill(); await rm(root, { recursive: true, force: true }); }
});
