import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApplicationError, RuntimeConfigureSchema, RuntimeRewindSchema, WorkspaceSearchSchema,
  type RuntimeControl, type WorkspaceSearch } from '@devlab/contracts';

export async function runtimeRequest(request: IncomingMessage, response: ServerResponse, url: URL, options: {
  runtime?: RuntimeControl; search?: WorkspaceSearch;
  body(request: IncomingMessage, limit?: number): Promise<unknown>;
  json(response: ServerResponse, status: number, value: unknown): void;
  projectAction<T>(id: string, action: () => Promise<T>): Promise<T>;
}): Promise<boolean> {
  if (!['/api/runtime', '/api/runtime/selection', '/api/runtime/rewind', '/api/runtime/search'].includes(url.pathname)) return false;
  const unavailable = () => new ApplicationError('SERVICE_UNAVAILABLE', 'Runtime capability is disabled');
  if (url.pathname === '/api/runtime' && request.method === 'GET') {
    if (!options.runtime) throw unavailable();
    options.json(response, 200, await options.runtime.inspect()); return true;
  }
  if (request.method !== 'POST') throw new ApplicationError('NOT_FOUND', 'Runtime route not found');
  if (url.pathname === '/api/runtime/selection') {
    if (!options.runtime) throw unavailable();
    options.json(response, 200, await options.runtime.configure(RuntimeConfigureSchema.parse(await options.body(request)))); return true;
  }
  if (url.pathname === '/api/runtime/rewind') {
    if (!options.runtime) throw unavailable();
    options.json(response, 200, await options.runtime.rewind(RuntimeRewindSchema.parse(await options.body(request)))); return true;
  }
  if (url.pathname === '/api/runtime/search') {
    if (!options.search) throw unavailable();
    const input = WorkspaceSearchSchema.parse(await options.body(request));
    const controller = new AbortController();
    const abort = () => controller.abort();
    const disconnected = () => { if (!response.writableEnded) abort(); };
    request.once('aborted', abort); response.once('close', disconnected);
    try {
      const result = await options.projectAction(input.projectId, () => options.search!.search(input, controller.signal));
      if (!response.destroyed) options.json(response, 200, result);
    } finally { request.off('aborted', abort); response.off('close', disconnected); }
    return true;
  }
  throw new ApplicationError('NOT_FOUND', 'Runtime route not found');
}
