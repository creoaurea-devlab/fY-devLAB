// Snapshot reads are kept in the host. Returned content never includes form values or page code.
const attributesOf = (node, strings) => Object.fromEntries(Array.from({ length: node.length / 2 }, (_, i) =>
  [strings[node[i * 2]], strings[node[i * 2 + 1]] ?? '']));

export function sensitiveControl(attributes) {
  return attributes['data-sensitive'] !== undefined || ['password', 'hidden'].includes((attributes.type || '').toLowerCase()) ||
    /cc-|one-time-code/i.test(attributes.autocomplete || '') ||
    /password|passwd|secret|api.?key|access.?token|auth.?token|card.?number|card.?num|credit|cvc|cvv|\botp\b|verification|one.?time/i.test(
      ['name', 'id', 'aria-label', 'placeholder'].map(key => attributes[key] || '').join(' '));
}

export function maskedText(value, secrets = []) {
  let text = value;
  for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted]');
  return text.replace(/\b(?:\d[ -]?){12,18}\d\b/g, '[redacted]')
    .replace(/\b((?:verification|security|one[ -]?time|otp)\s*(?:code)?\s*[:=-]?\s*)\d{4,8}\b/gi, '$1[redacted]');
}

/** Puppeteer remains the only topology owner; snapshots are per existing session root. */
export async function capturePageState(page) {
  const frames = page.frames(), deadline = Date.now() + 10000, parts = [], masks = [], secrets = [], textNodes = [];
  let partial = frames.length > 16, truncated = false, size = 0;
  const roots = frames.filter(frame => !frame.parentFrame() || frame.parentFrame().client !== frame.client);
  for (const root of roots.slice(0, 16)) {
    if (Date.now() > deadline) { partial = true; break; }
    try {
      const { documents, strings } = await root.client.send('DOMSnapshot.captureSnapshot', { computedStyles: ['display', 'visibility'] });
      let visited = 0;
      for (const document of documents) {
        const frame = frames.find(frame => frame._id === strings[document.frameId]);
        if (!frame) { partial = true; continue; }
        const { nodes, layout } = document, excluded = [], sensitive = [];
        if (nodes.nodeType.length > 10000) { partial = true; continue; }
        for (let index = 0; index < nodes.nodeType.length; index++) {
          if (++visited > 10000 || Date.now() > deadline) { partial = true; break; }
          const tag = strings[nodes.nodeName[index]], parent = nodes.parentIndex[index];
          const attributes = attributesOf(nodes.attributes[index], strings);
          sensitive[index] = sensitive[parent] || sensitiveControl(attributes);
          excluded[index] = excluded[parent] || sensitive[index] || ['INPUT', 'TEXTAREA', 'SELECT', 'SCRIPT', 'STYLE', 'NOSCRIPT'].includes(tag);
          if (sensitive[index]) {
            const position = nodes.inputValue?.index.indexOf(index) ?? -1;
            const value = position >= 0 ? strings[nodes.inputValue.value[position]] : attributes.value;
            if (value) secrets.push(value);
            if (nodes.nodeType[index] === 3 && strings[nodes.nodeValue[index]]) secrets.push(strings[nodes.nodeValue[index]]);
          }
        }
        for (let index = 0; index < layout.nodeIndex.length; index++) {
          const nodeIndex = layout.nodeIndex[index];
          if (excluded[nodeIndex] === undefined) continue;
          const styles = layout.styles[index].map(value => strings[value]);
          if (styles[0] === 'none' || ['hidden', 'collapse'].includes(styles[1])) continue;
          const value = strings[nodes.nodeValue[nodeIndex]] || '';
          if (sensitive[nodeIndex] && !sensitive[nodes.parentIndex[nodeIndex]]) {
            const element = nodes.nodeType[nodeIndex] === 3 ? nodes.parentIndex[nodeIndex] : nodeIndex;
            masks.push({ frame, backendNodeId: nodes.backendNodeId[element] });
          }
          if (nodes.nodeType[nodeIndex] !== 3 || excluded[nodeIndex]) continue;
          textNodes.push({ value, frame, backendNodeId: nodes.backendNodeId[nodes.parentIndex[nodeIndex]] });
          const text = value.replace(/\s+/g, ' ').trim();
          if (!text) continue;
          if (size + text.length + 1 > 20000) { truncated = true; continue; }
          parts.push(text); size += text.length + 1;
        }
      }
    } catch { partial = true; }
  }
  for (const node of textNodes) if (maskedText(node.value, secrets) !== node.value) masks.push(node);
  return { secrets, complete: !partial, content: { trust: 'untrusted-page-content', text: maskedText(parts.join(' '), secrets).slice(0, 20000), truncated },
    masks, partial: partial || truncated };
}
