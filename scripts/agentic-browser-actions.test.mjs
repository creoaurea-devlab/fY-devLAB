import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

async function fixture(slice, scale = 1) {
  assert(process.env.AUTOMATION_ELECTRON, 'Set AUTOMATION_ELECTRON to the installed Electron executable');
  assert(process.env.AUTOMATION_PUPPETEER, 'Set AUTOMATION_PUPPETEER to the installed Puppeteer module entry');
  const root = await mkdtemp(join(tmpdir(), 'browser-actions-'));
  let output = '';
  const env = { ...process.env, AUTOMATION_TEST_ROOT: root, AUTOMATION_BROWSER_SLICE: slice };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(process.env.AUTOMATION_ELECTRON, [
    '--use-mock-keychain', '--site-per-process', '--disable-gpu', `--force-device-scale-factor=${scale}`,
    fileURLToPath(new URL('./fixtures/agentic-browser/native.mjs', import.meta.url)),
  ], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 45000);
  try {
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    assert.equal(code, 0, output.slice(-12000));
    assert.match(output, new RegExp(`BROWSER_${slice.toUpperCase()}_PASS`));
  } finally { clearTimeout(timer); child.kill(); await rm(root, { recursive: true, force: true }); }
}

test('Browser observation returns readable bounded untrusted content and omits secrets', { timeout: 60000 }, () => fixture('content'));

test('Browser typing uses observed nodes once, requires approval and fails closed after changes', { timeout: 60000 }, () => fixture('type'));

test('Browser scrolling is bounded movement with one dispatch and independent views', { timeout: 60000 }, () => fixture('scroll'));

test('Browser screenshots redact sensitive pixels in main and transformed OOPIFs without DOM mutation', { timeout: 60000 }, () => fixture('screenshot'));

test('Browser screenshot masking respects device scale 2', { timeout: 60000 }, () => fixture('screenshot', 2));

test('Browser refuses screenshots without complete safe geometry or a native redactor', { timeout: 60000 }, () => fixture('screenshot-refusal'));
