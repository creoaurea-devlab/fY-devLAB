const api = window.automation;
const $ = id => document.getElementById(id);
let state, selected, signature, drawerOpen = false, editVersion, polling = false, loginPending = false;
const drafts = new Map();
const addresses = new Map();
const starting = new Set();
const element = (tag, content, attributes = {}) => {
  const node = document.createElement(tag); if (content) node.textContent = content;
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
};
const report = error => { $('status').textContent = error?.message || String(error); };
async function action(operation) {
  try { $('status').textContent = ''; const result = await operation(); await refresh(true); return result; }
  catch (error) { report(error); }
}
function session() { return state?.sessions.find(item => item.contextId === state.panes.find(pane => pane.paneId === selected)?.contextId); }
function rememberDraft() {
  if (!selected) return;
  drafts.set(selected, { task: $('task').value, key: $('memory-key').value, memory: $('memory-text').value, version: editVersion,
    model: $('model').value, duration: $('duration').value, maxTools: $('max-tools').value });
}
function select(paneId) {
  rememberDraft(); selected = paneId;
  const draft = drafts.get(paneId) || {};
  $('task').value = draft.task || ''; $('memory-key').value = draft.key || ''; $('memory-text').value = draft.memory || ''; editVersion = draft.version;
  $('duration').value = draft.duration || '60000'; $('max-tools').value = draft.maxTools || '10';
  $('memories').replaceChildren();
  for (const pane of document.querySelectorAll('.pane')) pane.classList.toggle('selected', pane.dataset.pane === selected);
  renderSession(); if (drawerOpen) void recall(); layout();
}
function renderSession() {
  const current = session();
  $('session-label').textContent = current ? `Session ${current.id.slice(0, 8)}` : 'Browser only';
  $('memory-label').textContent = current ? `Private memory · ${current.profile.slice(0, 8)}` : 'Agentic plugin is disabled';
  for (const control of $('drawer').querySelectorAll('input,textarea,select,button')) if (control.id !== 'drawer-close') control.disabled = !current;
  const run = current?.run;
  renderCodex(current, run);
  const status = run ? [run.status, `${run.toolsUsed}/${run.maxTools} tools`,
    typeof run.cost === 'number' ? `$${run.cost}` : 'Cost unavailable'] : ['No active run'];
  if (run?.status === 'running' && Number.isFinite(run.deadline)) status.push(`${Math.max(0, Math.ceil((run.deadline - Date.now()) / 1000))}s remaining`);
  $('run-status').textContent = status.join(' · ');
  const reply = run?.reply || (typeof run?.result === 'string' ? run.result : run?.result?.message || '');
  // Append to the existing text node so a growing reply retains the reader's selection.
  if ($('run-result').textContent !== reply) {
    const output = $('run-result'), atEnd = output.scrollHeight - output.scrollTop - output.clientHeight < 24;
    if (output.firstChild?.nodeType === Node.TEXT_NODE && reply.startsWith(output.textContent)) output.firstChild.appendData(reply.slice(output.textContent.length));
    else output.textContent = reply;
    if (atEnd) output.scrollTop = output.scrollHeight;
  }
  $('run-result').setAttribute('aria-busy', String(run?.status === 'running'));
  const events = (run?.events || []).filter(event => event.kind === 'tool');
  const eventSignature = JSON.stringify(events);
  if ($('run-events').dataset.events !== eventSignature) {
    $('run-events').replaceChildren(...events.map(event => element('li', event.text)));
    $('run-events').dataset.events = eventSignature;
  }
  $('run-activity').hidden = !events.length;
  $('stop').disabled = run?.status !== 'running';
}
function renderCodex(current, run) {
  const codex = state?.codex, enabled = !!current && !state.browserOnly;
  const models = codex?.models || [], draft = drafts.get(selected) || {};
  const model = draft.model || models[0]?.id || '';
  const modelSignature = JSON.stringify([models, model]);
  if ($('model').dataset.models !== modelSignature) {
    const options = models.map(item => element('option', item.displayName || item.id, { value: item.id }));
    if (!models.some(item => item.id === model)) options.unshift(element('option', model ? `${model} · unavailable` : 'No models available', { value: model, disabled: '' }));
    $('model').replaceChildren(...options); $('model').dataset.models = modelSignature;
  }
  $('model').value = model;
  if (!draft.model && model) { draft.model = model; drafts.set(selected, draft); }
  const authenticated = enabled && codex?.authenticated === true, modelAvailable = models.some(item => item.id === model);
  const busy = run?.status === 'running' || starting.has(selected);
  $('codex-login').hidden = !enabled || authenticated;
  $('codex-login').disabled = !enabled || loginPending;
  $('codex-login').textContent = loginPending ? 'Opening Codex sign in…' : 'Sign in to Codex';
  const account = ['Codex', codex?.accountType === 'chatgpt' ? 'ChatGPT' : 'Signed in'];
  if (codex?.planType) account.push(codex.planType);
  if (!models.length) account.push('No models available');
  else if (!modelAvailable) account.push('Select an available model');
  $('provider-status').textContent = !enabled ? 'Browser only · Agentic is disabled.'
    : codex?.error || (authenticated ? account.join(' · ') : 'Sign in to the installed Codex to run a task.');
  $('model').disabled = !authenticated || !models.length || busy;
  $('start').disabled = !authenticated || !modelAvailable || busy;
}
function layout() {
  const menuOpen = !!document.querySelector('.pane-header details[open]');
  const rectangles = menuOpen ? [] : [...document.querySelectorAll('.native')].map(node => {
    const box = node.getBoundingClientRect(); return { paneId: node.dataset.pane, x: box.x, y: box.y, width: box.width, height: box.height };
  }).filter(rect => rect.width > 0 && rect.height > 0);
  void api.layout(rectangles).catch(report);
}
function renderTree(tree) {
  if (tree.paneId) {
    const pane = state.panes.find(item => item.paneId === tree.paneId), current = state.sessions.find(item => item.contextId === pane.contextId);
    const node = element('section', '', { class: `pane${selected === pane.paneId ? ' selected' : ''}`, 'data-pane': pane.paneId, 'aria-label': `Browser ${pane.contextId.slice(0, 8)}` });
    const header = element('header', '', { class: 'pane-header' });
    const label = element('button', current ? current.id.slice(0, 8) : pane.contextId.slice(0, 8), { class: 'pane-label', title: 'Select this session' });
    label.onclick = () => select(pane.paneId);
    const form = element('form'), address = element('input', '', { 'aria-label': 'Address', placeholder: 'https://example.com', spellcheck: 'false' });
    address.value = addresses.get(pane.paneId) ?? pane.url;
    address.oninput = () => addresses.set(pane.paneId, address.value);
    form.append(address, element('button', 'Go'));
    form.onsubmit = event => { event.preventDefault(); addresses.delete(pane.paneId); void action(() => api.navigate(pane.paneId, address.value.includes(':') ? address.value : 'https://' + address.value)); };
    const menu = element('details'), summary = element('summary', '⋮', { 'aria-label': 'Pane actions' }), items = element('div', '', { class: 'menu' });
    const entries = [
      ['Back', () => api.history(pane.paneId, 'back')], ['Forward', () => api.history(pane.paneId, 'forward')], ['Reload', () => api.history(pane.paneId, 'reload')],
      ['Split right', () => api.split(pane.paneId, 'right')], ['Split down', () => api.split(pane.paneId, 'down')],
      ['Move to next slot', () => api.move(pane.paneId)], ['Maximize / restore', () => api.maximize(pane.paneId)], ['Close pane', () => api.closePane(pane.paneId)],
    ];
    for (const [name, run] of entries) {
      const button = element('button', name, { type: 'button' });
      if (name.startsWith('Split') && state.panes.length >= 4 || name === 'Close pane' && state.panes.length === 1) button.disabled = true;
      if (name === 'Back' && !pane.canGoBack || name === 'Forward' && !pane.canGoForward) button.disabled = true;
      button.onclick = () => { menu.open = false; void action(run); }; items.append(button);
    }
    menu.append(summary, items); menu.ontoggle = layout;
    header.append(label, form, menu); node.append(header, element('div', '', { class: 'native', 'data-pane': pane.paneId }));
    header.addEventListener('pointerdown', () => { if (selected !== pane.paneId) select(pane.paneId); });
    return node;
  }
  const node = element('div', '', { class: `split ${tree.axis}` });
  const first = element('div', '', { class: 'branch' }), second = element('div', '', { class: 'branch' });
  first.style.flex = `${tree.ratio} 1 0`; second.style.flex = `${1 - tree.ratio} 1 0`;
  first.append(renderTree(tree.first)); second.append(renderTree(tree.second));
  const separator = element('div', '', { role: 'separator', tabindex: '0', 'aria-label': 'Resize browser split',
    'aria-orientation': tree.axis === 'right' ? 'vertical' : 'horizontal', 'aria-valuemin': '15', 'aria-valuemax': '85', 'aria-valuenow': String(Math.round(tree.ratio * 100)) });
  const anchor = tree.splitId;
  separator.onkeydown = event => {
    const delta = ['ArrowRight', 'ArrowDown'].includes(event.key) ? .05 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -.05 : 0;
    if (delta) { event.preventDefault(); void action(() => api.resize(anchor, Math.max(.15, Math.min(.85, tree.ratio + delta)))); }
  };
  separator.onpointerdown = event => {
    event.preventDefault(); separator.setPointerCapture(event.pointerId);
    const move = event => {
      const box = node.getBoundingClientRect();
      const ratio = tree.axis === 'right' ? (event.clientX - box.x) / box.width : (event.clientY - box.y) / box.height;
      tree.ratio = Math.max(.15, Math.min(.85, ratio)); first.style.flex = `${tree.ratio} 1 0`; second.style.flex = `${1 - tree.ratio} 1 0`; layout();
    };
    separator.onpointermove = move;
    separator.onpointerup = () => { separator.onpointermove = null; void action(() => api.resize(anchor, tree.ratio)); };
  };
  node.append(first, separator, second); return node;
}
async function refresh(force = false) {
  if (polling && !force) return;
  polling = true;
  try {
    state = await api.state();
    const selectedPane = state.panes.find(pane => pane.paneId === selected);
    if (selectedPane?.error) $('status').textContent = selectedPane.error;
    $('mode').textContent = state.browserOnly ? 'Manual · Agentic disabled' : 'Independent sessions · Codex';
    if (!selected || !state.panes.some(pane => pane.paneId === selected)) select(state.panes[0].paneId);
    const narrow = $('workspace').clientWidth < 500;
    document.body.classList.toggle('narrow', narrow);
    if ($('pane-picker').dataset.panes !== state.panes.map(pane => pane.paneId).join()) {
      $('pane-picker').replaceChildren(...state.panes.map((pane, i) => element('option', `Pane ${i + 1}`, { value: pane.paneId })));
      $('pane-picker').dataset.panes = state.panes.map(pane => pane.paneId).join();
    }
    $('pane-picker').value = selected;
    const next = JSON.stringify([state.tree, state.maximized, narrow, narrow ? selected : null, state.panes.map(pane => [pane.paneId, pane.url, pane.canGoBack, pane.canGoForward])]);
    if (signature !== next) {
      signature = next;
      const tree = state.maximized || narrow ? { paneId: state.maximized || selected } : state.tree;
      $('workspace').replaceChildren(renderTree(tree));
    }
    // Polling does not overwrite address/task/memory drafts or recreate the native resources.
    renderSession(); layout();
  } catch (error) { report(error); }
  finally { polling = false; }
}
async function recall() {
  if (!session()) return;
  const pane = selected;
  try {
    const result = await api.memory(pane, 'recall', {}); if (pane !== selected) return;
    $('memories').replaceChildren();
    for (const record of result.records) {
      const row = element('article', '', { class: 'memory-record' });
      row.append(element('strong', `${record.key} · v${record.version}`), element('p', record.text));
      const edit = element('button', 'Edit', { type: 'button' });
      edit.onclick = () => { $('memory-key').value = record.key; $('memory-text').value = record.text; editVersion = record.version; $('memory-text').focus(); };
      const forget = element('button', 'Forget', { type: 'button' });
      forget.onclick = () => { void action(async () => { await api.memory(pane, 'forget', { reference: record.id, request_id: crypto.randomUUID() }); await recall(); }); };
      row.append(edit, forget); $('memories').append(row);
    }
  } catch (error) { report(error); }
}
function drawer(open) {
  drawerOpen = open; $('drawer').hidden = !open; $('drawer-toggle').setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('drawer-open', open);
  if (open) { renderSession(); void recall(); ($('task').disabled ? $('drawer-close') : $('task')).focus(); } else $('drawer-toggle').focus();
  void refresh(true);
}
$('drawer-toggle').onclick = () => drawer(!drawerOpen); $('drawer-close').onclick = () => drawer(false);
$('task-form').onsubmit = event => {
  event.preventDefault();
  if ($('start').disabled) return;
  rememberDraft();
  const pane = selected, input = { task: $('task').value, durationMs: Number($('duration').value),
    maxTools: Number($('max-tools').value), model: $('model').value, provider: 'codex' };
  starting.add(pane); renderSession();
  void action(() => api.start(pane, input)).finally(() => { starting.delete(pane); renderSession(); });
};
$('codex-login').onclick = async () => {
  if (loginPending || state?.browserOnly || state?.codex?.authenticated) return;
  loginPending = true; renderSession();
  try { await action(() => api.login()); }
  finally { loginPending = false; renderSession(); }
};
for (const id of ['task', 'model', 'duration', 'max-tools', 'memory-key', 'memory-text']) $(id).addEventListener('input', rememberDraft);
$('stop').onclick = () => { void action(() => api.stop(selected)); };
$('memory-form').onsubmit = event => {
  event.preventDefault(); const pane = selected, version = editVersion;
  rememberDraft();
  void action(async () => {
    await api.memory(pane, 'remember', { key: $('memory-key').value, text: $('memory-text').value, request_id: crypto.randomUUID(),
      ...(version === undefined ? {} : { expected_version: version }) });
    if (pane === selected && editVersion === version) { editVersion = undefined; rememberDraft(); }
    else {
      const draft = drafts.get(pane);
      if (draft?.version === version) draft.version = undefined;
    }
    if (pane === selected) await recall();
  });
};
$('recall').onclick = () => { void recall(); };
$('pane-picker').onchange = () => { select($('pane-picker').value); void refresh(true); };
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const menus = [...document.querySelectorAll('.pane-header details[open]')];
  if (menus.length) {
    event.preventDefault(); for (const menu of menus) menu.open = false;
    menus[0].querySelector('summary').focus(); layout();
  } else if (drawerOpen) { event.preventDefault(); drawer(false); }
});
window.addEventListener('resize', () => { void refresh(true); });
new ResizeObserver(layout).observe($('workspace'));
setInterval(() => { void refresh(); }, 750);
void refresh(true);
