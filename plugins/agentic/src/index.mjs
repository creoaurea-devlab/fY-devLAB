import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bindMemory } from './memory/index.mjs';
import { parseObservation } from '../../../packages/automation-contracts/src/browser.ts';

const identifier = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const text = (value, max = 16000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Text must be 1–${max} characters`);
  return value.trim();
};
const abort = signal => { if (signal.aborted) throw new Error('Run stopped'); };
function untilStopped(operation, signal) {
  return new Promise((resolve, reject) => {
    const stopped = () => reject(new Error('Run stopped'));
    signal.addEventListener('abort', stopped, { once: true });
    if (signal.aborted) stopped();
    Promise.resolve(operation).then(resolve, reject).finally(() => signal.removeEventListener('abort', stopped));
  });
}

/** Fake provider performs useful read-only checks and costs nothing. It never claims task completion. */
export async function inspectProvider({ task, tools, signal }) {
  abort(signal);
  const memory = await tools.memory('context', { query: task.slice(0, 500), max_chars: 2400 });
  abort(signal);
  const observation = tools.observe ? await tools.observe() : null;
  abort(signal);
  return { message: observation ? `Inspected ${observation.targets.length} controls${observation.partial ? ' (partial capture)' : ''}. No task actions were executed.` : 'Memory inspected. Browser tools unavailable.',
    observation, memory, verificationDebt: ['A real provider and task-specific postcondition checks are required.'] };
}

/** Independent session owner. Browser is an injected neutral port; no native objects or raw CDP. */
export async function createAgentic({ root, moduleRoot, python, installation, owner, project, browser,
  provider = inspectProvider, providerName = 'fake-inspect' }) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, 'sessions.json'), workers = new Map(), active = new Map();
  let sessions = [], closed = false, closing = null, saving = Promise.resolve();
  const save = () => {
    const data = JSON.stringify({ version: 1, installation, owner, project, sessions });
    saving = saving.then(async () => { await writeFile(path + '.tmp', data, { mode: 0o600 }); await rename(path + '.tmp', path); });
    return saving;
  };
  try {
    const saved = JSON.parse(await readFile(path, 'utf8'));
    if (saved.version !== 1 || saved.installation !== installation || saved.owner !== owner || saved.project !== project ||
      !Array.isArray(saved.sessions) || saved.sessions.length > 1000 ||
      saved.sessions.some(session => !identifier(session.id) || !identifier(session.profile) || !identifier(session.contextId)))
      throw new Error('Incompatible session data; choose a separate root');
    sessions = saved.sessions;
    for (const session of sessions) if (session.run?.status === 'running') {
      session.run.status = 'interrupted'; session.run.result = 'Process ended; explicit new run required. Unknown actions are never replayed.';
    }
    await save();
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const get = sessionId => {
    if (closed || closing) throw new Error('Agentic is closed');
    const session = sessions.find(item => item.id === sessionId);
    if (!session) throw new Error('Unknown agent session');
    return session;
  };
  const summary = session => structuredClone({ ...session, messages: session.messages.slice(-10), omittedMessages: Math.max(0, session.messages.length - 10) });
  async function memory(session) {
    if (workers.has(session.id)) return workers.get(session.id);
    if (!moduleRoot) throw new Error('Memory Node runtime not configured');
    if (workers.size >= 4) {
      const idle = [...workers.keys()].find(key => !active.has(key));
      if (!idle) throw new Error('Four active memory bindings allowed');
      await workers.get(idle).close(); workers.delete(idle);
    }
    const worker = bindMemory({ moduleRoot, python, database: join(root, 'memory.sqlite'), binding: {
      installation, owner, project, profile: session.profile, session: session.id,
    } });
    workers.set(session.id, worker);
    try { await worker.ready; return worker; }
    catch (error) { workers.delete(session.id); await worker.close(); throw error; }
  }
  async function callMemory(session, operation, arguments_) {
    const worker = await memory(session);
    try { return await worker.call(operation, arguments_); }
    catch (error) {
      // No hidden mutation retry. A later explicit retry retains binding and request_id.
      if (!error.code) { workers.delete(session.id); await worker.close(); }
      throw error;
    }
  }
  async function stop(sessionId) {
    const session = sessions.find(item => item.id === sessionId), job = active.get(sessionId);
    if (!session || closed) throw new Error('Agentic session unavailable');
    if (job) {
      job.controller.abort();
      // Revocation precedes waiting for provider completion.
      await browser?.release(session.contextId);
      await job.done;
    }
    return summary(session);
  }
  return {
    list: () => sessions.map(summary),
    async ensure(contextId) {
      if (closed || closing || !identifier(contextId)) throw new Error('Invalid browser context');
      let session = sessions.find(item => item.contextId === contextId);
      if (!session) {
        if (sessions.length >= 1000) throw new Error('Saved session limit reached');
        session = { id: randomUUID(), profile: randomUUID(), contextId, messages: [], run: null };
        sessions.push(session); await save();
      }
      return summary(session);
    },
    async memory(sessionId, operation, args = {}) {
      const session = get(sessionId);
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid memory arguments');
      if (operation === 'remember') {
        if (Object.keys(args).some(key => !['text', 'key', 'kind', 'request_id', 'expected_version'].includes(key))) throw new Error('Memory scope is host-bound');
        return callMemory(session, 'remember', { candidate: {
          kind: args.kind || 'preference', key: text(args.key, 240), text: text(args.text),
          scope: 'agent', scope_id: session.profile, source: 'standalone-user',
        }, request_id: text(args.request_id, 120), ...(args.expected_version === undefined ? {} : { expected_version: args.expected_version }) });
      }
      if (operation === 'recall') return callMemory(session, 'recall', { query: String(args.query || '').slice(0, 1000), limit: 50 });
      if (operation === 'context') return callMemory(session, 'context', { query: String(args.query || '').slice(0, 1000), max_chars: 4000 });
      if (operation === 'forget') return callMemory(session, 'forget', { reference: text(args.reference, 120), request_id: text(args.request_id, 120) });
      throw new Error('Memory operation unavailable; agent bindings cannot review/promote shared records');
    },
    async start(sessionId, input) {
      const session = get(sessionId);
      if (active.has(sessionId)) throw new Error('Session already running');
      if (active.size >= 4) throw new Error('Four active runs allowed');
      const task = text(input.task), durationMs = input.durationMs ?? 60000;
      if (!Number.isInteger(durationMs) || durationMs < 100 || durationMs > 1800000) throw new Error('Run duration must be 100 ms–30 minutes');
      if (input.provider && input.provider !== providerName) throw new Error('Provider not configured');
      const maxTools = input.maxTools ?? 10;
      if (!Number.isInteger(maxTools) || maxTools < 1 || maxTools > 200) throw new Error('Tool budget must be 1–200');
      const run = { id: randomUUID(), status: 'running', provider: providerName, startedAt: Date.now(), deadline: Date.now() + durationMs,
        maxTools, toolsUsed: 0, cost: 0, result: null };
      session.messages.push({ role: 'user', text: task, at: Date.now() }); session.run = run;
      const persisted = save();
      const controller = new AbortController();
      const job = { controller, done: null };
      active.set(sessionId, job);
      const timer = setTimeout(() => { controller.abort(); void browser?.release(session.contextId); }, durationMs);
      const bounded = async operation => {
        abort(controller.signal);
        if (++run.toolsUsed > maxTools) throw new Error('Tool budget reached');
        await save(); const result = await operation(); abort(controller.signal); return result;
      };
      job.done = (async () => {
        try {
          await persisted;
          const tools = {
            memory: (operation, args) => {
              if (!['recall', 'context'].includes(operation)) throw new Error('This inspection provider has read-only memory tools');
              return bounded(() => callMemory(session, operation, args));
            },
            ...(browser ? { observe: () => bounded(async () => parseObservation(await browser.observe(session.contextId))) } : {}),
          };
          const response = await untilStopped(provider({ task, tools, signal: controller.signal }), controller.signal);
          abort(controller.signal); run.status = 'completed'; run.result = response;
          session.messages.push({ role: 'assistant', text: response.message, at: Date.now() });
        } catch (error) { run.status = controller.signal.aborted ? 'stopped' : 'failed'; run.result = error.message; }
        finally {
          clearTimeout(timer); await browser?.release(session.contextId);
          run.finishedAt = Date.now(); active.delete(sessionId); await save();
        }
      })();
      // Provider failure is persisted by the job; background persistence errors are visible to close/stop.
      job.done.catch(() => {});
      await persisted; return summary(session);
    },
    stop,
    async close() {
      if (closing) return closing;
      closing = (async () => {
        await Promise.all([...active.keys()].map(stop)); closed = true;
        await Promise.all([...workers.values()].map(worker => worker.close())); workers.clear(); await saving;
      })();
      return closing;
    },
  };
}

export function agenticPlugin(options) {
  return {
    manifest: { id: 'agentic', version: '0.1.0', apiVersion: 1, provides: ['agentic'], requires: [], capabilities: ['automation.agentic'], reload: 'restart' },
    async activate(scope) {
      const service = await createAgentic(options);
      scope.onDispose(() => service.close()); scope.provide('agentic', service);
    },
  };
}
