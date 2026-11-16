import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { webContents } from 'electron';

/** Disposable host acceptance only. Never selected by a normal launch. */
export async function smoke({ browser, agentic, window, state, dispatch, root }) {
  let current = await state();
  const first = current.panes[0], initial = current.sessions.find(session => session.contextId === first.contextId);
  if (current.panes.length === 1) current = await dispatch('split', { paneId: first.paneId, axis: 'right' });
  const second = current.panes.find(pane => pane.paneId !== first.paneId);
  assert.notEqual(first.contextId, second.contextId);
  for (const contents of webContents.getAllWebContents().filter(contents => contents !== window.webContents)) {
    assert.equal(await contents.executeJavaScript('typeof process'), 'undefined');
    assert.equal(await contents.executeJavaScript('typeof window.automation'), 'undefined');
    assert.equal(await contents.executeJavaScript('window.open("https://example.com") === null'), true);
  }
  await dispatch('maximize', { paneId: first.paneId }); await dispatch('maximize', { paneId: first.paneId });
  await dispatch('move', { paneId: first.paneId }); await dispatch('move', { paneId: first.paneId });
  await assert.rejects(dispatch('navigate', { paneId: first.paneId, url: 'file:///etc/passwd' }), /HTTP/);
  await assert.rejects(dispatch('navigate', { paneId: first.paneId, url: 'javascript:alert(1)' }), /HTTP/);
  if (agentic) {
    const sessions = (await state()).sessions;
    const a = sessions.find(session => session.contextId === first.contextId), b = sessions.find(session => session.contextId === second.contextId);
    assert.equal(a.id, initial.id); assert.notEqual(a.id, b.id); assert.notEqual(a.profile, b.profile);
    await dispatch('memory', { paneId: first.paneId, operation: 'remember', arguments: { key: 'fixture', text: 'Private first-pane preference', request_id: 'standalone-smoke-remember' } });
    assert.equal((await dispatch('memory', { paneId: first.paneId, operation: 'recall', arguments: {} })).records.length, 1);
    assert.equal((await dispatch('memory', { paneId: second.paneId, operation: 'recall', arguments: {} })).records.length, 0);
    await dispatch('start', { paneId: first.paneId, input: { task: 'Inspect controls independently', durationMs: 30000 } });
    await dispatch('start', { paneId: second.paneId, input: { task: 'Inspect second pane', durationMs: 30000 } });
    await dispatch('stop', { paneId: first.paneId });
    const deadline = Date.now() + 15000;
    let sessionB;
    do { sessionB = (await state()).sessions.find(session => session.id === b.id); if (sessionB.run.status !== 'running') break; await delay(20); } while (Date.now() < deadline);
    assert.equal(sessionB.run.status, 'completed', JSON.stringify(sessionB.run));
    assert.equal(sessionB.run.cost, 0);
  }
  // Exercise the actual trusted preload and renderer, rather than only calling factories.
  const ui = await window.webContents.executeJavaScript(`(async () => {
    const deadline = Date.now()+5000;
    while (!document.querySelector('.pane') && Date.now()<deadline) await new Promise(r=>setTimeout(r,20));
    document.getElementById('drawer-toggle').click();
    await new Promise(r=>setTimeout(r,100));
    const s = await window.automation.state();
    return {panes:document.querySelectorAll('.pane').length,drawer:!document.getElementById('drawer').hidden,plugins:s.health.map(p=>p.id)};
  })()`);
  assert.equal(ui.panes, 2); assert.equal(ui.drawer, true);
  assert.deepEqual(ui.plugins, agentic ? ['browser', 'agentic'] : ['browser']);
  await writeFile(join(root, 'smoke-shell.png'), (await window.webContents.capturePage()).toPNG());
  for (const width of [820, 390]) {
    window.setContentSize(width, 760);
    let fit;
    const resizeDeadline = Date.now() + 3000;
    do {
      await delay(50);
      fit = await window.webContents.executeJavaScript(`({width:innerWidth,overflow:document.body.scrollWidth>innerWidth,panes:document.querySelectorAll('.pane').length,scale:devicePixelRatio})`);
    } while ((fit.width !== width || width === 390 && fit.panes !== 1) && Date.now() < resizeDeadline);
    assert.equal(fit.width, width, JSON.stringify({ fit, content: window.getContentBounds(), bounds: window.getBounds() }));
    assert.equal(fit.overflow, false, JSON.stringify(fit));
    if (width === 390) assert.equal(fit.panes, 1);
    await writeFile(join(root, `smoke-${width}.png`), (await window.webContents.capturePage()).toPNG());
    console.log(JSON.stringify({ event: 'standalone-fit', ...fit }));
  }
  console.log(JSON.stringify({ event: 'standalone-smoke', panes: current.panes.map(pane => ({ paneId: pane.paneId, contextId: pane.contextId })),
    sessions: (await state()).sessions.map(session => ({ id: session.id, profile: session.profile })), ui }));
}
