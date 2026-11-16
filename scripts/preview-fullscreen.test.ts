import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewFullscreen, type FullscreenDocument, type FullscreenElement } from '../plugins/ui-preview/src/fullscreen.ts';

function deferred() {
  let resolve!: () => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(timeoutMs = 20) {
  const listeners = new Set<() => void>();
  const requests: ReturnType<typeof deferred>[] = [];
  let exits = 0, focused = 0;
  const element: FullscreenElement = { isConnected: true, requestFullscreen() {
    const request = deferred(); requests.push(request); return request.promise;
  } };
  const document: FullscreenDocument = { fullscreenElement: null,
    async exitFullscreen() { exits++; document.fullscreenElement = null; for (const listener of listeners) listener(); },
    addEventListener(_, listener) { listeners.add(listener); }, removeEventListener(_, listener) { listeners.delete(listener); } };
  const owner = createPreviewFullscreen({ document, getElement: () => element, timeoutMs });
  const trigger = { isConnected: true, focus() { focused++; } };
  return { document, element, owner, requests, listeners, trigger,
    setFullscreen(value: FullscreenElement | null) { document.fullscreenElement = value; for (const listener of listeners) listener(); },
    exits: () => exits, focused: () => focused };
}

test('hung requests coalesce without noisy error and timeout releases the next attempt', async () => {
  const f = fixture();
  const first = f.owner.enter('a'), duplicate = f.owner.enter('a');
  assert.equal(first, duplicate); assert.equal(await f.owner.enter('other-pane'), false);
  assert.equal(f.requests.length, 1); assert.equal(f.owner.snapshot().error, '');
  assert.equal(await first, false); assert.match(f.owner.snapshot().error, /did not respond/);
  const retry = f.owner.enter('a'); assert.equal(f.requests.length, 2);
  f.setFullscreen(f.element); assert.equal(await retry, true);
  f.requests[0]!.resolve(); await Promise.resolve(); assert.equal(f.exits(), 0);
  f.owner.dispose();
});

test('fullscreenchange settles actual entry even if the browser promise never settles', async () => {
  const f = fixture(); const result = f.owner.enter('a', f.trigger);
  f.setFullscreen(f.element); assert.equal(await result, true);
  assert.equal(await f.owner.enter('a'), true); assert.equal(f.requests.length, 1);
  await f.owner.exit(); assert.equal(f.owner.snapshot().mode, null); assert.equal(f.focused(), 1); f.owner.dispose();
});

test('promise success and denial both release the request', async () => {
  const f = fixture(); const denied = f.owner.enter('a'); f.requests[0]!.reject(new Error('denied'));
  assert.equal(await denied, false); assert.match(f.owner.snapshot().error, /denied/);
  const valid = f.owner.enter('a'); f.document.fullscreenElement = f.element; f.requests[1]!.resolve();
  assert.equal(await valid, true); assert.equal(f.owner.snapshot().mode, 'native'); f.owner.dispose();
});

test('exit cancels pending entry and a late success exits only its own element', async () => {
  const f = fixture(); const pending = f.owner.enter('a', f.trigger);
  await f.owner.exit(); assert.equal(await pending, false); assert.equal(f.focused(), 1);
  f.document.fullscreenElement = f.element; f.requests[0]!.resolve(); await Promise.resolve();
  assert.equal(f.exits(), 1); assert.equal(f.owner.snapshot().mode, null); f.owner.dispose();
});

test('late fullscreenchange after canceled hung entry is cleaned without waiting for its promise', async () => {
  const f = fixture(); const pending = f.owner.enter('a'); await f.owner.exit();
  assert.equal(await pending, false); f.setFullscreen(f.element);
  assert.equal(f.document.fullscreenElement, null); assert.equal(f.exits(), 1); f.owner.dispose();
});

test('dispose cancels pending state and cleans a late successful request', async () => {
  const f = fixture(); const pending = f.owner.enter('a'); f.owner.dispose();
  assert.equal(await pending, false); assert.equal(f.listeners.size, 0);
  f.document.fullscreenElement = f.element; f.requests[0]!.resolve(); await Promise.resolve(); assert.equal(f.exits(), 1);
});

test('foreign fullscreen is never exited by entry, late cleanup, exit or disposal', async () => {
  const f = fixture(); const pending = f.owner.enter('a'); await f.owner.exit();
  const foreign = {}; f.document.fullscreenElement = foreign; f.requests[0]!.resolve(); await pending; await Promise.resolve();
  assert.equal(await f.owner.enter('a'), false); await f.owner.exit(); f.owner.dispose();
  assert.equal(f.document.fullscreenElement, foreign); assert.equal(f.exits(), 0);
});

test('maximize cancels a hung native request and retains its in-app mode after late entry cleanup', async () => {
  const f = fixture(); const pending = f.owner.enter('a'); f.owner.maximize('a');
  assert.equal(await pending, false); assert.equal(f.owner.snapshot().mode, 'maximized');
  f.document.fullscreenElement = f.element; f.requests[0]!.resolve(); await Promise.resolve();
  assert.equal(f.exits(), 1); assert.equal(f.owner.snapshot().mode, 'maximized'); f.owner.dispose();
});

test('hung exit is bounded while retaining truthful native state and Escape guidance', async () => {
  const f = fixture(); const result = f.owner.enter('a'); f.setFullscreen(f.element); assert.equal(await result, true);
  f.document.exitFullscreen = () => new Promise(() => {});
  await f.owner.exit(); assert.equal(f.owner.snapshot().mode, 'native'); assert.match(f.owner.snapshot().error, /Escape/);
  f.setFullscreen(null); assert.equal(f.owner.snapshot().mode, null); f.owner.dispose();
});
