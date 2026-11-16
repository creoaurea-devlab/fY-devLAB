import { randomUUID } from 'node:crypto';
import { DebuggerTransport } from './native/debugger-transport.mjs';
import { hitPoint, scrollTarget, sensitiveQuad } from './native/geometry.mjs';
import { capturePageState, maskedText, sensitiveControl } from './native/capture.mjs';
import { parseObservation } from '../../../packages/automation-contracts/src/browser.ts';

const fault = (code, message) => Object.assign(new Error(message), { code });

/** Host passes an installed, pinned Puppeteer module. No WebSocket or browser launch. */
export async function attachBrowser({ contents, puppeteer, nativeImage, approve = async () => false }) {
  const transport = await DebuggerTransport.attach(contents);
  let browser;
  try {
    browser = await puppeteer.connect({ transport, defaultViewport: null, protocol: 'cdp', protocolTimeout: 5000 });
    const [page] = await browser.pages();
    if (!page) throw new Error('Native page target unavailable');
    const refs = new Map(), commands = new Set();
    const stopped = new AbortController();
    let revoked = false, active = false, generation = 0;
    const invalidate = () => { generation++; refs.clear(); };
    page.on('framenavigated', invalidate);
    page.on('framedetached', invalidate);
    browser.on('disconnected', () => { revoked = true; stopped.abort(); invalidate(); });
    const admitted = () => {
      if (revoked || contents.isDestroyed() || !browser.connected) throw fault('LEASE_REVOKED', 'Control was stopped or disconnected');
    };
    // Resolve the document in Puppeteer's frame session; there is no second frame registry.
    const document = async (frame, depth = 0) => {
      const client = frame.client;
      const { executionContextId } = await client.send('Page.createIsolatedWorld', {
        frameId: frame._id, worldName: 'devlab-readonly-observation', grantUniveralAccess: false,
      });
      const { result } = await client.send('Runtime.evaluate', { expression: 'document', contextId: executionContextId });
      if (!result.objectId) throw fault('DOCUMENT_UNAVAILABLE', 'Frame document unavailable');
      try {
        const { node } = await client.send('DOM.describeNode', { objectId: result.objectId, depth, pierce: false });
        return { node, client };
      } finally { await client.send('Runtime.releaseObject', { objectId: result.objectId }); }
    };
    const begin = commandId => {
      admitted();
      if (typeof commandId !== 'string' || commandId.length < 1 || commandId.length > 120) throw fault('INVALID_COMMAND', 'A bounded command ID is required');
      if (active) throw fault('CONTROL_BUSY', 'Another command is active');
      if (commands.has(commandId)) throw fault('DUPLICATE_COMMAND', 'Command already admitted; never automatically resend');
      if (commands.size >= 1000) throw fault('COMMAND_LIMIT', 'Control session command budget reached');
    };
    const approval = async request => {
      const allowed = await new Promise((resolve, reject) => {
        const cancel = () => reject(fault('LEASE_REVOKED', 'Control stopped during approval'));
        stopped.signal.addEventListener('abort', cancel, { once: true });
        Promise.resolve().then(() => approve({ ...request, signal: stopped.signal })).then(resolve, reject)
          .finally(() => stopped.signal.removeEventListener('abort', cancel));
        if (stopped.signal.aborted) cancel();
      });
      if (!allowed) throw fault('APPROVAL_DENIED', 'Action was not approved');
      admitted();
    };
    const validateTarget = async (ref, target, typing) => {
      admitted();
      if (refs.get(ref) !== target) throw fault('STALE_REF', 'Page changed before dispatch');
      let current, node, state;
      try {
        current = await document(target.frame);
        ({ node } = await target.client.send('DOM.describeNode', { backendNodeId: target.backendNodeId }));
        const { object } = await target.client.send('DOM.resolveNode', { backendNodeId: target.backendNodeId });
        try {
          const { result } = await target.client.send('Runtime.callFunctionOn', {
            objectId: object.objectId, functionDeclaration: 'function(){return {connected:this.isConnected,editable:this.isContentEditable}}', returnByValue: true,
          });
          state = result.value;
        } finally { await target.client.send('Runtime.releaseObject', { objectId: object.objectId }); }
      } catch { throw fault('STALE_REF', 'Observed node or frame is no longer available'); }
      if (current.node.backendNodeId !== target.documentId || !node || !state?.connected) throw fault('STALE_REF', 'Observed document or node changed');
      const attributes = attrs(node), name = label(node, attributes);
      if (manual(attributes, name)) throw fault('USER_STEP', 'This control requires manual input');
      if (typing && (attributes.disabled !== undefined || attributes.readonly !== undefined ||
        !(['INPUT', 'TEXTAREA'].includes(node.nodeName) || state.editable) ||
        (node.nodeName === 'INPUT' && !['', 'text', 'search', 'email', 'url', 'tel', 'number'].includes((attributes.type || '').toLowerCase()))))
        throw fault('NOT_EDITABLE', 'Observed target is not an editable text control');
    };
    const targetAction = async (action, ref, commandId, value) => {
      begin(commandId);
      const target = refs.get(ref);
      if (!target) throw fault('STALE_REF', 'Target was not observed in the current document');
      if (target.userStep) throw fault('USER_STEP', 'This control requires manual input');
      commands.add(commandId); active = true;
      try {
        await validateTarget(ref, target, action === 'type');
        await approval({ commandId, action, name: target.name, ...(action === 'type' ? { text: value } : {}) });
        await validateTarget(ref, target, action === 'type');
        await scrollTarget(target.frame, target.backendNodeId);
        let point;
        try { point = await hitPoint(target.frame, target.backendNodeId); }
        catch (error) { throw fault('TARGET_OCCLUDED', error.message); }
        await validateTarget(ref, target, action === 'type');
        const receipt = { commandId, inputDispatched: 'unknown', pageReacted: 'unknown', expectedState: 'not_checked',
          mechanism: action === 'type' ? 'cdp-mouse-and-text' : 'cdp-mouse' };
        admitted();
        if (refs.get(ref) !== target) throw fault('STALE_REF', 'Page changed before dispatch');
        const { x, y } = point;
        try {
          // Pointer focus is part of the declared typing mechanism, never a selector fallback.
          await page.mainFrame().client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
          await page.mainFrame().client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
          if (action === 'type') {
            await validateTarget(ref, target, true);
            const { object } = await target.client.send('DOM.resolveNode', { backendNodeId: target.backendNodeId });
            try {
              const { result } = await target.client.send('Runtime.callFunctionOn', { objectId: object.objectId,
                functionDeclaration: 'function(){return this === this.getRootNode().activeElement && this.ownerDocument.hasFocus()}', returnByValue: true });
              if (result.value !== true) return receipt;
            } finally { await target.client.send('Runtime.releaseObject', { objectId: object.objectId }); }
            admitted();
            if (refs.get(ref) !== target) return receipt;
            await page.mainFrame().client.send('Input.insertText', { text: value });
          }
          receipt.inputDispatched = true;
        } catch { /* A dispatched sequence may be partial. Never resend this command ID. */ }
        return receipt;
      } finally { active = false; }
    };
    return {
      // Topology is exposed only to host fixtures, never to renderer/model RPC.
      topology: () => page.frames().map(frame => ({ id: frame._id, url: frame.url(), session: frame.client.id(), main: !frame.parentFrame() })),
      async observe() {
        admitted(); invalidate();
        const targets = [], deadline = Date.now() + 10000;
        let partial = false;
        const frames = page.frames();
        if (frames.length > 16) partial = true;
        for (const frame of frames.slice(0, 16)) {
          if (Date.now() > deadline || targets.length >= 200) { partial = true; break; }
          try {
            const { node: root, client } = await document(frame, 8);
            let visited = 0;
            const visit = node => {
              if (++visited > 10000 || targets.length >= 200) { partial = true; return; }
              const attributes = attrs(node);
              const tag = node.nodeName.toLowerCase();
              const sensitive = sensitiveControl(attributes);
              if (sensitive) return;
              if ((node.childNodeCount || 0) > (node.children?.length || 0) || node.shadowRoots?.some(root => root.shadowRootType !== 'user-agent')) partial = true;
              if (['button', 'a', 'input', 'textarea', 'select'].includes(tag) || attributes.role === 'button') {
                const ref = randomUUID();
                const name = label(node, attributes);
                targets.push({ ref, frameId: frame._id, role: attributes.role || tag, name });
                refs.set(ref, { backendNodeId: node.backendNodeId, documentId: root.backendNodeId, frame, client,
                  userStep: manual(attributes, name), name });
              }
              for (const child of node.children ?? []) visit(child);
              // Child frame documents are observed separately through Puppeteer's own frame/session.
            };
            visit(root);
          } catch { partial = true; }
        }
        admitted();
        const captured = await capturePageState(page);
        admitted();
        for (const target of targets) {
          target.name = maskedText(target.name, captured.secrets);
          refs.get(target.ref).name = target.name;
        }
        return parseObservation({ version: 2, targets, content: captured.content, partial: partial || captured.partial });
      },
      click(ref, commandId) { return targetAction('click', ref, commandId); },
      async type(ref, value, commandId) {
        admitted();
        if (typeof value !== 'string' || !value.length || value.length > 10000) throw fault('INVALID_TEXT', 'Text must contain 1–10000 characters');
        if (maskedText(value) !== value || /\b(?:sk-[a-z0-9_-]{16,}|Bearer\s+\S+|-----BEGIN.*PRIVATE KEY)/i.test(value))
          throw fault('USER_STEP', 'Secret or payment input requires manual entry');
        return targetAction('type', ref, commandId, value);
      },
      async scroll(deltaY, commandId) {
        begin(commandId);
        if (!Number.isFinite(deltaY) || deltaY === 0 || Math.abs(deltaY) > 4000) throw fault('INVALID_SCROLL', 'Scroll delta must be nonzero and within 4000 CSS pixels');
        commands.add(commandId); active = true;
        try {
          const { cssVisualViewport: viewport } = await page.mainFrame().client.send('Page.getLayoutMetrics');
          if (!viewport || viewport.clientWidth < 1 || viewport.clientHeight < 1) throw fault('VIEWPORT_UNAVAILABLE', 'Viewport has no usable area');
          const receipt = { commandId, inputDispatched: 'unknown', pageReacted: 'unknown', expectedState: 'not_checked', mechanism: 'cdp-wheel' };
          admitted();
          try {
            await page.mainFrame().client.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: viewport.clientWidth / 2,
              y: viewport.clientHeight / 2, deltaX: 0, deltaY });
            receipt.inputDispatched = true;
          } catch { /* Wheel input is never automatically resent. */ }
          return receipt;
        } finally { active = false; }
      },
      async screenshot() {
        admitted();
        if (active) throw fault('CONTROL_BUSY', 'Another command is active');
        if (!nativeImage) throw fault('SCREENSHOT_UNSAFE', 'The native image redaction dependency is unavailable');
        active = true;
        const fence = generation, deadline = Date.now() + 15000;
        try {
          const geometry = async () => {
            const captured = await capturePageState(page);
            if (!captured.complete || captured.masks.length > 256) throw fault('SCREENSHOT_UNSAFE', 'Sensitive capture is incomplete or exceeds its budget');
            const rectangles = [], seen = new Set();
            for (const target of captured.masks) {
              if (Date.now() > deadline) throw fault('SCREENSHOT_UNSAFE', 'Sensitive geometry exceeded its budget');
              const key = `${target.frame._id}:${target.backendNodeId}`;
              if (seen.has(key)) continue;
              seen.add(key);
              const quad = await sensitiveQuad(target.frame, target.backendNodeId);
              const xs = quad.filter((_, index) => index % 2 === 0), ys = quad.filter((_, index) => index % 2 === 1);
              rectangles.push({ key, left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) });
            }
            return rectangles.sort((a, b) => a.key.localeCompare(b.key));
          };
          const before = await geometry();
          const { cssVisualViewport: viewport } = await page.mainFrame().client.send('Page.getLayoutMetrics');
          const { data } = await page.mainFrame().client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
          const after = await geometry();
          admitted();
          if (fence !== generation || JSON.stringify(before) !== JSON.stringify(after) || Date.now() > deadline)
            throw fault('SCREENSHOT_UNSAFE', 'Page or sensitive geometry changed during capture');
          const image = nativeImage.createFromBuffer(Buffer.from(data, 'base64'));
          const { width, height } = image.getSize();
          if (image.isEmpty() || !viewport || viewport.clientWidth < 1 || viewport.clientHeight < 1 || width * height > 16000000)
            throw fault('SCREENSHOT_UNSAFE', 'Screenshot size is unavailable or exceeds its budget');
          const bitmap = image.toBitmap();
          const sx = width / viewport.clientWidth, sy = height / viewport.clientHeight;
          for (const rectangle of before) {
            const left = Math.max(0, Math.floor((rectangle.left - viewport.offsetX - 4) * sx));
            const right = Math.min(width, Math.ceil((rectangle.right - viewport.offsetX + 4) * sx));
            const top = Math.max(0, Math.floor((rectangle.top - viewport.offsetY - 4) * sy));
            const bottom = Math.min(height, Math.ceil((rectangle.bottom - viewport.offsetY + 4) * sy));
            for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
              const offset = (y * width + x) * 4;
              bitmap[offset] = 0; bitmap[offset + 1] = 0; bitmap[offset + 2] = 0; bitmap[offset + 3] = 255;
            }
          }
          return nativeImage.createFromBitmap(bitmap, { width, height, scaleFactor: 1 }).toPNG().toString('base64');
        } catch (error) {
          if (error.code === 'LEASE_REVOKED') throw error;
          throw fault('SCREENSHOT_UNSAFE', 'A safely redacted screenshot could not be produced');
        } finally { active = false; }
      },
      revoke() { revoked = true; stopped.abort(); invalidate(); },
      async close() {
        revoked = true; stopped.abort(); invalidate();
        page.off('framenavigated', invalidate); page.off('framedetached', invalidate);
        await browser.disconnect(); transport.close();
      },
    };
  } catch (error) {
    if (browser) await browser.disconnect();
    transport.close(); throw error;
  }
}

function text(node) {
  if (node.nodeType === 3) return node.nodeValue || '';
  // Never return form values, script contents, or hidden input children as names.
  if (['INPUT', 'TEXTAREA', 'SCRIPT', 'STYLE'].includes(node.nodeName) || sensitiveControl(attrs(node)) || attrs(node).hidden !== undefined) return '';
  return (node.children ?? []).map(text).join(' ').trim().slice(0, 500);
}

const attrs = node => Object.fromEntries(Array.from({ length: (node.attributes?.length ?? 0) / 2 }, (_, i) =>
  [node.attributes[i * 2], node.attributes[i * 2 + 1]]));
const label = (node, attributes) => maskedText(attributes['aria-label'] || attributes.title || attributes.placeholder ||
  (['BUTTON', 'A'].includes(node.nodeName) ? text(node) : '')).slice(0, 500);
const manual = (attributes, name) => sensitiveControl(attributes) || (attributes.type || '').toLowerCase() === 'file' ||
  /pay|purchase|checkout|buy|grant|authoriz|password|verification|one.?time|permission|log.?in|sign.?in/i.test(name);
