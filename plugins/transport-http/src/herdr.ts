import { ApplicationError, HerdrCommandSchema, ProjectIdSchema, type HerdrService } from '@devlab/contracts';
import type { IncomingMessage, ServerResponse } from 'node:http';

export async function herdrEvents(request: IncomingMessage, response: ServerResponse, url: URL, service: HerdrService | undefined, streams: Set<() => void>) {
  if (!service?.subscribe) throw new ApplicationError('SERVICE_UNAVAILABLE', 'Herdr events are unavailable.');
  const id = ProjectIdSchema.parse(url.searchParams.get('projectId')); await service.snapshot(id);
  let closed = false, unsubscribe = () => {};
  const stop = () => { if (closed) return; closed = true; clearInterval(heartbeat); unsubscribe(); streams.delete(stop); response.end(); };
  const send = () => { if (!closed && !response.write('data: {}\n\n')) stop(); };
  const heartbeat = setInterval(send, 15000); heartbeat.unref();
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  response.on('close', stop); request.on('aborted', stop); streams.add(stop);
  unsubscribe = service.subscribe(id, send); send();
}

export async function herdrRequest(path: string, method: string | undefined, url: URL, body: () => Promise<unknown>, service?: HerdrService) {
  if (!service) throw new ApplicationError('SERVICE_UNAVAILABLE', 'Herdr runtime is not enabled.');
  if (path === '/api/herdr' && method === 'GET') return service.snapshot(ProjectIdSchema.parse(url.searchParams.get('projectId')));
  const match = /^\/api\/herdr\/([^/]+)$/.exec(path);
  if (match && method === 'POST') return service.command(ProjectIdSchema.parse(decodeURIComponent(match[1]!)), HerdrCommandSchema.parse(await body()));
  throw new ApplicationError('NOT_FOUND', 'Herdr endpoint not found.');
}
