// Adapted from Nanobrowser core/geometry.ts (Apache-2.0), inspected 2026-11-15.
// Puppeteer supplies ancestry. Quads are relative to each CDP session's root viewport.
const sessionRoot = frame => {
  let current = frame;
  while (current.parentFrame() && current.parentFrame().client === current.client) current = current.parentFrame();
  return current;
};

export async function scrollTarget(frame, backendNodeId) {
  await frame.client.send('DOM.scrollIntoViewIfNeeded', { backendNodeId });
  let root = sessionRoot(frame);
  for (let depth = 0; root.parentFrame(); depth++) {
    if (depth >= 16) throw new Error('Frame ancestry exceeds budget');
    const parent = root.parentFrame();
    const owner = await parent.client.send('DOM.getFrameOwner', { frameId: root._id });
    await parent.client.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: owner.backendNodeId });
    root = sessionRoot(parent);
  }
}

export async function hitPoint(frame, backendNodeId) {
  const { quads } = await frame.client.send('DOM.getContentQuads', { backendNodeId });
  if (quads.length !== 1 || quads[0].length !== 8) throw new Error('Observed target has no unambiguous quad');
  const q = quads[0];
  let point = { x: (q[0] + q[2] + q[4] + q[6]) / 4, y: (q[1] + q[3] + q[5] + q[7]) / 4 };
  let root = sessionRoot(frame), expected = backendNodeId;
  for (let depth = 0; depth < 17; depth++) {
    const { cssLayoutViewport: scroll } = await root.client.send('Page.getLayoutMetrics');
    const hit = await root.client.send('DOM.getNodeForLocation', {
      x: Math.round(point.x + scroll.pageX), y: Math.round(point.y + scroll.pageY),
      includeUserAgentShadowDOM: false, ignorePointerEventsNone: false,
    });
    if (hit.backendNodeId !== expected) throw new Error('Another node owns the hit point');
    const parent = root.parentFrame();
    if (!parent) return point;
    const owner = await parent.client.send('DOM.getFrameOwner', { frameId: root._id });
    const { model } = await parent.client.send('DOM.getBoxModel', { backendNodeId: owner.backendNodeId });
    const { result } = await root.client.send('Runtime.evaluate', { expression: '({width:innerWidth,height:innerHeight})', returnByValue: true });
    const c = model.content, fx = point.x / Math.max(1, result.value.width), fy = point.y / Math.max(1, result.value.height);
    point = { x: c[0] + (c[2] - c[0]) * fx + (c[6] - c[0]) * fy,
      y: c[1] + (c[3] - c[1]) * fx + (c[7] - c[1]) * fy };
    expected = owner.backendNodeId; root = sessionRoot(parent);
  }
  throw new Error('Frame ancestry exceeds budget');
}

/** Map a box through Puppeteer's OOPIF ancestry without scrolling or changing the page. */
export async function sensitiveQuad(frame, backendNodeId) {
  const { model } = await frame.client.send('DOM.getBoxModel', { backendNodeId });
  let quad = model.border;
  if (quad?.length !== 8 || !quad.every(Number.isFinite)) throw new Error('Sensitive geometry unavailable');
  let root = sessionRoot(frame);
  for (let depth = 0; root.parentFrame(); depth++) {
    if (depth >= 16) throw new Error('Frame ancestry exceeds budget');
    const parent = root.parentFrame();
    const owner = await parent.client.send('DOM.getFrameOwner', { frameId: root._id });
    const { model: ownerModel } = await parent.client.send('DOM.getBoxModel', { backendNodeId: owner.backendNodeId });
    const { cssLayoutViewport: viewport } = await root.client.send('Page.getLayoutMetrics');
    const c = ownerModel.content;
    // Perspective transforms need a different projection. Refuse an unverified approximation.
    if (c?.length !== 8 || Math.abs(c[0] + c[4] - c[2] - c[6]) > .5 ||
      Math.abs(c[1] + c[5] - c[3] - c[7]) > .5 || viewport.clientWidth <= 0 || viewport.clientHeight <= 0)
      throw new Error('Sensitive frame transform is not supported');
    quad = Array.from({ length: 4 }, (_, index) => {
      const x = quad[index * 2] / viewport.clientWidth, y = quad[index * 2 + 1] / viewport.clientHeight;
      return [c[0] + (c[2] - c[0]) * x + (c[6] - c[0]) * y,
        c[1] + (c[3] - c[1]) * x + (c[7] - c[1]) * y];
    }).flat();
    root = sessionRoot(parent);
  }
  return quad;
}
