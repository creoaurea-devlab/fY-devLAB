import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

// The trusted renderer's public host interface is the fixture seam. No provider,
// native browser, memory store or private renderer implementation is replaced.
const initialState = {
  browserOnly: false,
  panes: [
    { paneId: 'pane-a', contextId: 'context-a', url: 'https://example.com', canGoBack: false, canGoForward: false },
    { paneId: 'pane-b', contextId: 'context-b', url: 'https://example.org', canGoBack: false, canGoForward: false },
  ],
  tree: { splitId: 'split-a', axis: 'right', ratio: .5, first: { paneId: 'pane-a' }, second: { paneId: 'pane-b' } },
  sessions: [
    { id: 'sessionA', contextId: 'context-a', profile: 'profile-a', run: null },
    { id: 'sessionB', contextId: 'context-b', profile: 'profile-b', run: null },
  ],
  codex: { authenticated: false, accountType: null, models: [], error: 'Sign in to the installed Codex to run a task.' },
};

async function withUI(run) {
  const files = new Map([['/', 'index.html'], ['/renderer.mjs', 'renderer.mjs'], ['/style.css', 'style.css']]);
  const server = createServer(async (request, response) => {
    const file = files.get(request.url);
    if (!file) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    response.end(await readFile(new URL(`../apps/automation-desktop/${file}`, import.meta.url)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/google/chrome/chrome', headless: true, args: ['--use-mock-keychain'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(3000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(state => {
      window.fixture = { state, calls: [], layouts: [] };
      const record = (method, args) => { window.fixture.calls.push({ method, args }); return Promise.resolve(); };
      window.automation = {
        state: async () => structuredClone(window.fixture.state),
        login: async () => { await record('login', {}); if (window.fixture.loginError) throw new Error(window.fixture.loginError); },
        start: async (paneId, input) => {
          await record('start', { paneId, input });
          while (window.fixture.holdStart) await new Promise(resolve => setTimeout(resolve, 10));
        },
        stop: paneId => record('stop', { paneId }),
        memory: async (paneId, operation, args) => {
          if (operation === 'recall') return { records: window.fixture.records?.[paneId] || [] };
          await record('memory', { paneId, operation, args });
          while (window.fixture.holdMemory === paneId) await new Promise(resolve => setTimeout(resolve, 10));
          (window.fixture.memoryFinished ||= []).push(paneId);
        },
        layout: rectangles => { window.fixture.layouts.push(rectangles); return Promise.resolve(); },
        navigate: (paneId, url) => record('navigate', { paneId, url }),
      };
    }, initialState);
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole('button', { name: 'Task & memory', exact: true }).click();
    await run(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

test('trusted UI gates real tasks on Codex login and submits the selected model and limits', async () => {
  await withUI(async page => {
    const login = page.getByRole('button', { name: 'Sign in to Codex', exact: true });
    await login.waitFor();
    assert.equal(await page.getByRole('button', { name: 'Run task', exact: true }).isDisabled(), true);
    await login.click();
    assert.deepEqual(await page.evaluate(() => window.fixture.calls), [{ method: 'login', args: {} }]);
    await page.evaluate(() => {
      window.fixture.state.codex = { authenticated: true, accountType: 'chatgpt', planType: 'plus', models: [
        { id: 'codex-model-a', displayName: 'First Codex model', inputModalities: ['text', 'image'] },
        { id: 'codex-model-b', displayName: 'Second Codex model', inputModalities: ['text'] },
      ] };
    });
    await page.getByRole('combobox', { name: 'Model', exact: true }).selectOption('codex-model-b');
    assert.equal(await login.isHidden(), true);
    await page.getByRole('textbox', { name: 'Task', exact: true }).fill('Inspect the current page');
    await page.getByRole('combobox', { name: 'Maximum duration', exact: true }).selectOption('1800000');
    await page.getByRole('spinbutton', { name: 'Maximum tool calls', exact: true }).fill('24');
    await page.evaluate(() => { window.fixture.holdStart = true; });
    await page.getByRole('button', { name: 'Run task', exact: true }).click();
    await page.waitForFunction(() => window.fixture.calls.some(call => call.method === 'start'));
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.find(call => call.method === 'start')), {
      method: 'start', args: { paneId: 'pane-a', input: { task: 'Inspect the current page', durationMs: 1800000, maxTools: 24, model: 'codex-model-b', provider: 'codex' } },
    });
    assert.equal(await page.getByRole('button', { name: 'Run task', exact: true }).isDisabled(), true);
    await page.evaluate(() => { window.fixture.holdStart = false; });
  });
});

test('pane drafts survive polling and drawer changes while active Codex replies and tool activity stream', async () => {
  await withUI(async page => {
    await page.evaluate(() => {
      window.fixture.state.codex = { authenticated: true, accountType: 'chatgpt', models: [
        { id: 'codex-model-a', displayName: 'First Codex model', inputModalities: ['text'] },
        { id: 'codex-model-b', displayName: 'Second Codex model', inputModalities: ['text'] },
      ] };
    });
    await page.getByRole('combobox', { name: 'Model', exact: true }).selectOption('codex-model-b');
    await page.getByRole('textbox', { name: 'Task', exact: true }).fill('Keep first task draft');
    await page.getByRole('textbox', { name: 'Key', exact: true }).fill('private-preference');
    await page.getByRole('textbox', { name: 'Memory', exact: true }).fill('Keep this memory draft');
    await page.getByRole('combobox', { name: 'Maximum duration', exact: true }).selectOption('1800000');
    await page.getByRole('spinbutton', { name: 'Maximum tool calls', exact: true }).fill('24');
    await page.getByRole('textbox', { name: 'Address', exact: true }).first().fill('https://draft.example/unfinished');
    await page.getByRole('button', { name: 'sessionB', exact: true }).click();
    await page.getByRole('textbox', { name: 'Task', exact: true }).fill('Independent second draft');
    await page.getByRole('combobox', { name: 'Model', exact: true }).selectOption('codex-model-a');
    await page.evaluate(() => {
      window.fixture.state.sessions[0].run = { status: 'running', provider: 'codex', toolsUsed: 1, maxTools: 24,
        deadline: Date.now() + 60000, cost: null, reply: 'Partial reply', events: [{ kind: 'tool', text: 'browser.observe completed' }] };
    });
    await page.getByRole('button', { name: 'sessionA', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Agent reply"]')?.textContent === 'Partial reply');
    assert.equal(await page.getByRole('textbox', { name: 'Task', exact: true }).inputValue(), 'Keep first task draft');
    assert.equal(await page.getByRole('combobox', { name: 'Model', exact: true }).inputValue(), 'codex-model-b');
    assert.equal(await page.getByRole('combobox', { name: 'Maximum duration', exact: true }).inputValue(), '1800000');
    assert.equal(await page.getByRole('spinbutton', { name: 'Maximum tool calls', exact: true }).inputValue(), '24');
    assert.equal(await page.getByRole('textbox', { name: 'Memory', exact: true }).inputValue(), 'Keep this memory draft');
    assert.equal(await page.getByRole('textbox', { name: 'Address', exact: true }).first().inputValue(), 'https://draft.example/unfinished');
    assert.match(await page.getByRole('list', { name: 'Tool activity', exact: true }).textContent(), /browser.observe completed/);
    assert.doesNotMatch(await page.locator('#run-status').textContent(), /\$null|\$0/);
    assert.equal(await page.getByRole('button', { name: 'Run task', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).isEnabled(), true);
    const paneMenu = page.getByLabel('Pane actions', { exact: true }).first();
    await paneMenu.click();
    await page.waitForFunction(() => window.fixture.layouts.at(-1)?.length === 0);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#drawer').isVisible(), true);
    assert.equal(await paneMenu.evaluate(node => node === document.activeElement), true);
    await page.evaluate(() => { window.fixture.state.sessions[0].run.reply = 'Partial reply grows incrementally'; });
    await page.waitForFunction(() => document.querySelector('[aria-label="Agent reply"]')?.textContent === 'Partial reply grows incrementally');
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.find(call => call.method === 'stop')), { method: 'stop', args: { paneId: 'pane-a' } });
    await page.setViewportSize({ width: 390, height: 760 });
    await page.waitForFunction(() => window.fixture.layouts.at(-1)?.length === 0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Task & memory', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('button', { name: 'Task & memory', exact: true }).evaluate(node => node === document.activeElement), true);
    await page.waitForFunction(() => window.fixture.layouts.at(-1)?.length === 1);
    await page.getByRole('button', { name: 'Task & memory', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: 'Task', exact: true }).inputValue(), 'Keep first task draft');
    assert.equal(await page.getByRole('textbox', { name: 'Memory', exact: true }).inputValue(), 'Keep this memory draft');
  });
});

test('readiness failures and Browser-only operation refuse task execution without losing drafts', async () => {
  await withUI(async page => {
    await page.getByRole('textbox', { name: 'Task', exact: true }).fill('Keep task while signing in');
    await page.evaluate(() => { window.fixture.loginError = 'Codex executable is unavailable. Install or select the trusted runtime.'; });
    await page.getByRole('button', { name: 'Sign in to Codex', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('Codex executable is unavailable'));
    assert.equal(await page.getByRole('button', { name: 'Run task', exact: true }).isDisabled(), true);
    await page.evaluate(() => { window.fixture.state.codex = { authenticated: true, accountType: 'chatgpt', models: [], error: 'No models available. Reconnect Codex.' }; });
    await page.waitForFunction(() => document.getElementById('provider-status').textContent === 'No models available. Reconnect Codex.');
    assert.equal(await page.getByRole('button', { name: 'Run task', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Sign in to Codex', exact: true }).isHidden(), true);
    await page.evaluate(() => { window.fixture.state.browserOnly = true; window.fixture.state.sessions = []; delete window.fixture.state.codex; });
    await page.waitForFunction(() => document.getElementById('session-label').textContent === 'Browser only');
    assert.equal(await page.getByRole('textbox', { name: 'Task', exact: true }).inputValue(), 'Keep task while signing in');
    assert.equal(await page.getByRole('textbox', { name: 'Memory', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Run task', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Sign in to Codex', exact: true }).isHidden(), true);
    assert.equal(await page.evaluate(() => window.fixture.calls.filter(call => call.method === 'start' || call.method === 'memory').length), 0);
    for (const width of [820, 390]) {
      await page.setViewportSize({ width, height: 760 });
      assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false);
    }
  });
});

test('a memory save finishing in another pane preserves the selected memory draft and version', async () => {
  await withUI(async page => {
    await page.evaluate(() => {
      window.fixture.records = {
        'pane-a': [{ id: 'memory-a', key: 'preference-a', text: 'First private memory', version: 3 }],
        'pane-b': [{ id: 'memory-b', key: 'preference-b', text: 'Second private memory', version: 9 }],
      };
    });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.evaluate(() => { window.fixture.holdMemory = 'pane-a'; });
    await page.getByRole('button', { name: 'Remember', exact: true }).click();
    await page.getByRole('button', { name: 'sessionB', exact: true }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('textbox', { name: 'Memory', exact: true }).fill('Keep the second edited memory');
    await page.evaluate(() => { window.fixture.holdMemory = null; });
    await page.waitForFunction(() => window.fixture.memoryFinished?.includes('pane-a'));
    await page.getByRole('button', { name: 'Remember', exact: true }).click();
    await page.waitForFunction(() => window.fixture.calls.some(call => call.method === 'memory' && call.args.paneId === 'pane-b'));
    const secondSave = await page.evaluate(() => window.fixture.calls.find(call => call.method === 'memory' && call.args.paneId === 'pane-b'));
    assert.equal(secondSave.args.args.text, 'Keep the second edited memory');
    assert.equal(secondSave.args.args.expected_version, 9);
  });
});
