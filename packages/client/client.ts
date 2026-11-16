import { listenTerminal } from './terminals.ts';
import { createHoodClient } from '@creoaurea/pop-the-hood/browser';
import type { ApplicationClient } from '@devlab/ui-contracts';
import { z } from 'zod';
import {
  HerdrCommandSchema, HerdrSnapshotSchema,
  RuntimeInventorySchema, RuntimeConfigureSchema, RuntimeRewindSchema, WorkspaceSearchSchema, WorkspaceSearchResultSchema,
  RulesSnapshotSchema,
  PreimpCommandSchema, PreimpSnapshotSchema,
  OpenProjectSchema,
  ProjectServerStateSchema,
  CanvasDocumentSchema,
  SaveCanvasSchema,
  ApplicationError,
  TerminalSessionSchema,
  TerminalReplaySchema,
  TerminalCreateSchema,
  TerminalInputSchema,
  TerminalSizeSchema,
  ProjectSchema,
  ProjectTreeSchema,
  ProjectTextSchema,
  CreateProjectSchema,
  ForkProjectSchema,
  WriteProjectFileSchema,
  BrowserEntrySchema,
  BrowserSessionSchema,
  BrowserLeaseSchema,
  BrowserResultSchema,
  BrowserFrameSchema,
  BrowserCommandSchema,
  type BrowserEntry,
} from '@devlab/contracts';
const HealthSchema = z.object({
  phase: z.string(),
  plugins: z.array(
    z.object({
      id: z.string(),
      version: z.string(),
      state: z.enum(['active', 'failed', 'disposed']),
      generation: z.number(),
      leases: z.number(),
    }),
  ),
});
async function request(path: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch(
    `/api${path}`,
    body === undefined
      ? { signal }
      : {
          signal,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const value: unknown = await response.json();
  if (!response.ok) {
    const e = z
      .object({ code: z.string(), message: z.string() })
      .safeParse(value);
    throw new ApplicationError(
      e.success ? e.data.code : 'HTTP_ERROR',
      e.success ? e.data.message : `Request failed (${response.status})`,
    );
  }
  return value;
}
// Bound control requests so an interrupted connection cannot hold discovery,
// Retry, Stop, or the ordered input queue forever. Mutations are never replayed.
function terminalRequest(path: string, body?: unknown) {
  return request(path, body, AbortSignal.timeout(path === '/terminals' ? 30000 : 15000));
}
// All visible browser nodes share this client. Share discovery, not control leases.
const browserDiscovery = new Map<
  string,
  { expiresAt: number; value: Promise<BrowserEntry[]> }
>();
function discoverBrowsers(projectId: string): Promise<BrowserEntry[]> {
  const cached = browserDiscovery.get(projectId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const entry = {
    expiresAt: Infinity,
    value: Promise.resolve([] as BrowserEntry[]),
  };
  entry.value = request(`/browsers?projectId=${encodeURIComponent(projectId)}`)
    .then((value) => {
      const result = BrowserEntrySchema.array().parse(value);
      entry.expiresAt = Date.now() + 250;
      return result;
    })
    .catch((error) => {
      if (browserDiscovery.get(projectId) === entry)
        browserDiscovery.delete(projectId);
      throw error;
    });
  browserDiscovery.set(projectId, entry);
  return entry.value;
}
async function mutateBrowser<T extends { projectId: string }>(
  path: string,
  body: T,
) {
  browserDiscovery.delete(body.projectId);
  try {
    return await request(path, body);
  } finally {
    browserDiscovery.delete(body.projectId);
  }
}
export const client: ApplicationClient = {
  herdr: {
    subscribe(projectId, changed) {
      const events = new EventSource('/api/herdr/events?projectId=' + encodeURIComponent(projectId));
      events.onmessage = changed; events.onerror = changed;
      return () => events.close();
    },
    snapshot: async projectId => HerdrSnapshotSchema.parse(await request('/herdr?projectId=' + encodeURIComponent(projectId), undefined, AbortSignal.timeout(15000))),
    command: async (projectId, command) => HerdrSnapshotSchema.parse(await request('/herdr/' + encodeURIComponent(projectId), HerdrCommandSchema.parse(command), AbortSignal.timeout(30000))),
  },
  runtime: {
    inspect: async () => RuntimeInventorySchema.parse(await request('/runtime', undefined, AbortSignal.timeout(15000))),
    configure: async input => RuntimeInventorySchema.parse(await request('/runtime/selection', RuntimeConfigureSchema.parse(input), AbortSignal.timeout(15000))),
    rewind: async input => RuntimeInventorySchema.parse(await request('/runtime/rewind', RuntimeRewindSchema.parse(input), AbortSignal.timeout(15000))),
    search: async (input, signal) => WorkspaceSearchResultSchema.parse(await request('/runtime/search', WorkspaceSearchSchema.parse(input),
      signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000))),
  },
  rules: { snapshot: async projectId => RulesSnapshotSchema.parse(await request(`/rules?projectId=${encodeURIComponent(projectId)}`)) },
  browsers: {
    discover: discoverBrowsers,
    start: async (identity, actor) =>
      BrowserSessionSchema.parse(
        await mutateBrowser('/browsers/start', { ...identity, actor }),
      ),
    acquire: async (target, actor, takeover = false) =>
      BrowserLeaseSchema.parse(
        await mutateBrowser('/browsers/acquire', {
          ...target,
          actor,
          takeover,
        }),
      ),
    command: async (input) =>
      BrowserResultSchema.parse(
        await mutateBrowser(
          '/browsers/command',
          BrowserCommandSchema.parse(input),
        ),
      ),
    release: async (lease) => {
      await mutateBrowser('/browsers/release', lease);
    },
    clearProfile: async (identity, actor) => {
      await mutateBrowser('/browsers/clear', { ...identity, actor });
    },
    frame: async (target, signal) =>
      BrowserFrameSchema.parse(
        await request(
          '/browsers/frame?' + new URLSearchParams(target),
          undefined,
          signal,
        ),
      ),
  },
  previewInspector: {
    openWorkspace: async (projectId,target) => z.object({sessionId:z.string().uuid()}).parse(await request('/preview/workspace',{projectId,...(target?{target}:{})})),
    openDevTools: async (sessionId,projectId) => request('/preview/devtools',{sessionId,projectId}),
    closeWorkspace: async (sessionId) => { await request('/preview/close',{sessionId,projectId:'default'}); },
  },
  servers: {
    list: async () => ProjectServerStateSchema.array().parse(await request('/servers')),
    inspect: async (id) => ProjectServerStateSchema.parse(await request(`/servers/${encodeURIComponent(id)}`)),
    start: async (id) => ProjectServerStateSchema.parse(await request(`/servers/${encodeURIComponent(id)}/start`,{})),
    stop: async (id) => ProjectServerStateSchema.parse(await request(`/servers/${encodeURIComponent(id)}/stop`,{})),
  },
  projects: {
    preimp: async (id, command) => PreimpSnapshotSchema.parse(await request(`/projects/${encodeURIComponent(id)}/preimp`, PreimpCommandSchema.parse(command))),
    fork: async (input) => ProjectSchema.parse(await request('/projects/fork', ForkProjectSchema.parse(input))),
    open: async(input)=>ProjectSchema.parse(await request('/projects/open',OpenProjectSchema.parse(input))),
    forget: async(id)=>{await request(`/projects/${encodeURIComponent(id)}/forget`,{});},
    deleteThread: async (id) => { z.object({ ok: z.literal(true) }).strict().parse(await request(`/projects/${encodeURIComponent(id)}/delete-thread`, {})); },
    list: async () => ProjectSchema.array().parse(await request('/projects')),
    create: async (input) =>
      ProjectSchema.parse(
        await request('/projects', CreateProjectSchema.parse(input)),
      ),
    inspect: async (id) =>
      ProjectTreeSchema.parse(
        await request(`/projects/${encodeURIComponent(id)}/files`),
      ),
    read: async (id, path) =>
      ProjectTextSchema.parse(
        await request(
          `/projects/${encodeURIComponent(id)}/file?path=${encodeURIComponent(path)}`,
        ),
      ),
    write: async (input) => {
      const { projectId, ...body } = WriteProjectFileSchema.parse(input);
      return ProjectTextSchema.parse(
        await request(`/projects/${encodeURIComponent(projectId)}/file`, body),
      );
    },
    createModule: async (id, path) =>
      z
        .object({ paths: z.string().array() })
        .parse(
          await request(`/projects/${encodeURIComponent(id)}/module`, { path }),
        ),
  },
  registry: createHoodClient(),
  terminals: {
    ownerships: async (projectId) => (await import('@devlab/contracts')).TerminalOwnershipsSchema.parse(
      await terminalRequest(`/terminals/ownerships?projectId=${encodeURIComponent(projectId)}`)),
    list: async (projectId) =>
      z
        .array(TerminalSessionSchema)
        .parse(
          await terminalRequest(
            `/terminals?projectId=${encodeURIComponent(projectId)}`,
          ),
        ),
    create: async (command) =>
      TerminalSessionSchema.parse(
        await terminalRequest('/terminals', TerminalCreateSchema.parse(command)),
      ),
    inspect: async (id) =>
      TerminalReplaySchema.parse(
        await terminalRequest(`/terminals/${encodeURIComponent(id)}`),
      ).session,
    write: async (id, data) => {
      await terminalRequest(
        `/terminals/${encodeURIComponent(id)}/input`,
        TerminalInputSchema.parse({ data }),
      );
    },
    resize: async (id, cols, rows) => {
      await terminalRequest(
        `/terminals/${encodeURIComponent(id)}/resize`,
        TerminalSizeSchema.parse({ cols, rows }),
      );
    },
    close: async (id) =>
      TerminalSessionSchema.parse(
        await terminalRequest(`/terminals/${encodeURIComponent(id)}/close`, {}),
      ),
    listen: listenTerminal,
  },
  canvas: {
    load: async (projectId) => {
      const value = await request(`/canvas/${encodeURIComponent(projectId)}`);
      return value === null ? null : CanvasDocumentSchema.parse(value);
    },
    save: async (command) =>
      CanvasDocumentSchema.parse(
        await request('/canvas', SaveCanvasSchema.parse(command)),
      ),
  },
  health: async () => HealthSchema.parse(await request('/health')),
};
