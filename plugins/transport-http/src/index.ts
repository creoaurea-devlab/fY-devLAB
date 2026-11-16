import { runtimeRequest } from './runtime.ts';
import { terminalRequest } from './terminals.ts';
import { herdrEvents, herdrRequest } from './herdr.ts';
import { rulesRequest } from './rules.ts';
import { projectRequest } from './projects.ts';
import { serverRequest } from './servers.ts';
import { browserRequest } from './browser.ts';
import { serveHoodRequest } from '@creoaurea/pop-the-hood/http';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { z } from 'zod';
import {
  ApplicationError,
  PreviewNativeTargetSchema,
  SaveCanvasSchema,
  ProjectIdSchema,
  PreimpTaskSchema,
  type PluginDefinition,
  type PluginHealth,
} from '@devlab/contracts';

interface Options {
  herdr?: boolean;
  port: number;
  canvas?: boolean;
  projects?: boolean;
  rules?: boolean;
  servers?: boolean;
  terminals?: boolean;
  browsers?: boolean;
  architecture?: boolean;
  runtime?: boolean;
  search?: boolean;
  webRoot?: string;
  allowedOrigins?: string[];
  diagnostics: () => { phase: string; plugins: PluginHealth[] };
}
async function body(request: IncomingMessage, limit = 8192): Promise<unknown> {
  if (!request.headers['content-type']?.startsWith('application/json'))
    throw new ApplicationError('INVALID_INPUT', 'Expected application/json');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const data = Buffer.from(chunk);
    size += data.length;
    if (size > limit)
      throw new ApplicationError(
        'PAYLOAD_TOO_LARGE',
        `Maximum body size is ${limit} bytes`,
      );
    chunks.push(data);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new ApplicationError('INVALID_INPUT', 'Invalid JSON');
  }
}
function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

export function httpTransport(options: Options): PluginDefinition {
  return {
    manifest: {
      id: 'transport-http',
      version: '1.0.0',
      apiVersion: 1,
      provides: ['http'],
      requires: [
        ...(options.herdr ? ['herdr' as const] : []),
        ...(options.canvas ? ['canvas' as const] : []),
        ...(options.projects ? ['projects' as const] : []),
        ...(options.rules ? ['rules' as const] : []),
        ...(options.servers ? ['servers' as const, 'previewInspector' as const] : []),
        ...(options.terminals ? ['terminals' as const] : []),
        ...(options.browsers ? ['browserControl' as const] : []),
        ...(options.architecture ? ['architecture' as const] : []),
        ...(options.runtime ? ['runtimeControl' as const] : []),
        ...(options.search ? ['workspaceSearch' as const] : []),
      ],
      capabilities: ['network:loopback'],
      reload: 'restart',
    },
    async activate(scope) {
      const herdr = options.herdr ? scope.get('herdr') : undefined;
      const inspector = options.servers ? scope.get('previewInspector') : undefined;
      const servers = options.servers ? scope.get('servers') : undefined;
      const runtime = options.runtime ? scope.get('runtimeControl') : undefined;
      const search = options.search ? scope.get('workspaceSearch') : undefined;
      const rules = options.rules ? scope.get('rules') : undefined;
      const projects = options.projects ? scope.get('projects') : undefined;
      const canvas = options.canvas ? scope.get('canvas') : undefined;
      const terminals = options.terminals ? scope.get('terminals') : undefined;
      const registry = options.architecture
        ? scope.get('architecture')
        : undefined;
      const browser = options.browsers ? scope.get('browserControl') : undefined;
      // Admission spans async startup/archive work. A rejected request never
      // enters a capability; unrelated project requests remain independent.
      const projectStarts = new Map<string, number>();
      const deletingThreads = new Set<string>();
      const deletedThreads = new Set<string>();
      async function projectAction<T>(id: string, action: () => Promise<T>, deleting = false, permanently = deleting): Promise<T> {
        if (deletedThreads.has(id)) throw new ApplicationError('PATH_DENIED', 'Development thread was deleted');
        if (deletingThreads.has(id) || (deleting && projectStarts.has(id)))
          throw new ApplicationError('CONFLICT', 'Project action is in progress; retry after it finishes');
        if (deleting) deletingThreads.add(id);
        else projectStarts.set(id, (projectStarts.get(id) ?? 0) + 1);
        try {
          const result = await action();
          if (permanently) deletedThreads.add(id);
          return result;
        } finally {
          if (deleting) deletingThreads.delete(id);
          else {
            const remaining = (projectStarts.get(id) ?? 1) - 1;
            if (remaining) projectStarts.set(id, remaining);
            else projectStarts.delete(id);
          }
        }
      }
      scope.onDispose(() => { projectStarts.clear(); deletingThreads.clear(); deletedThreads.clear(); });
      const streams = new Set<() => void>();
      const server = createServer((request, response) => {
        void (async () => {
          const origin = request.headers.origin;
          const address = server.address();
          const ownOrigin =
            typeof address === 'object' && address
              ? `http://127.0.0.1:${address.port}`
              : '';
          if (request.headers.host !== ownOrigin.slice('http://'.length))
            throw new ApplicationError('ORIGIN_DENIED', 'Host is not allowed');
          if (
            origin &&
            origin !== ownOrigin &&
            !options.allowedOrigins?.includes(origin)
          )
            throw new ApplicationError(
              'ORIGIN_DENIED',
              'Origin is not allowed',
            );
          const url = new URL(request.url ?? '/', 'http://127.0.0.1');
          if (request.method === 'GET' && url.pathname === '/api/health') {
            json(response, 200, options.diagnostics());
            return;
          }
          if (await runtimeRequest(request, response, url, { runtime, search, body, json, projectAction })) return;
          const prototype = /^\/api\/projects\/([^/]+)\/preimp\/([^/]+)\/prototype$/.exec(url.pathname);
          if (request.method === 'GET' && prototype) {
            if (!projects) throw new ApplicationError('SERVICE_UNAVAILABLE', 'Projects are unavailable');
            const projectId = ProjectIdSchema.parse(decodeURIComponent(prototype[1]!));
            const taskId = PreimpTaskSchema.shape.id.parse(decodeURIComponent(prototype[2]!));
            const file = await projects.read(projectId, `_preimp/${taskId}/prototype.html`);
            if (url.searchParams.get('revision') !== file.sha256) throw new ApplicationError('CONFLICT', 'Prototype changed; refresh its staged task');
            response.writeHead(200, {
              'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
              'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
              'permissions-policy': 'camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=()',
              'content-security-policy': `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self' ${(options.allowedOrigins ?? []).join(' ')}`,
            });
            response.end(file.text); return;
          }
  if (await rulesRequest(request, response, url, rules, json)) return;
if (request.method === 'GET' && url.pathname === '/api/preview/bridge.js') {
            if (!inspector) throw new ApplicationError('SERVICE_UNAVAILABLE', 'Preview inspection is unavailable');
            response.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8',
              'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
            response.end(inspector.bridgeScript()); return;
          }
          if (url.pathname.startsWith('/api/preview/')) {
            if (!inspector || request.method !== 'POST') throw new ApplicationError('SERVICE_UNAVAILABLE','Native inspection is unavailable');
            if (url.pathname === '/api/preview/workspace') {
              const input=z.object({projectId:ProjectIdSchema,target:PreviewNativeTargetSchema.optional()}).strict().parse(await body(request));
              json(response,200,await inspector.openWorkspace(ownOrigin+'/',input.projectId,input.target));return;
            }
            const input=z.object({projectId:ProjectIdSchema,sessionId:z.string().uuid()}).strict().parse(await body(request));
            if(url.pathname === '/api/preview/devtools') { json(response,200,await inspector.openDevTools(input.sessionId,input.projectId));return; }
            if(url.pathname === '/api/preview/close') { await inspector.closeWorkspace(input.sessionId);json(response,200,{ok:true});return; }
            throw new ApplicationError('NOT_FOUND','Preview command not found');
          }
          if (url.pathname === '/api/servers' || url.pathname.startsWith('/api/servers/')) {
          const start = request.method === 'POST' && /^\/api\/servers\/([a-zA-Z0-9_-]+)\/(start|restart)$/.exec(url.pathname);
          const action = () => serverRequest(url.pathname,request.method,()=>body(request),servers);
          json(response,200,await (start ? projectAction(ProjectIdSchema.parse(start[1]), action) : action()));
            return;
          }
          if (url.pathname === '/api/browsers' || url.pathname.startsWith('/api/browsers/')) {
            json(response,200,await browserRequest(url.pathname,request.method,url,()=>body(request,100000),browser));
            return;
          }
          if (registry && await serveHoodRequest(request, response, registry, streams)) return;
          if (url.pathname === '/api/projects' || url.pathname.startsWith('/api/projects/')) {
          const deletion = request.method === 'POST' && /^\/api\/projects\/([^/]+)\/(?:delete-thread|forget)$/.exec(url.pathname);
          const action = () => projectRequest(url.pathname,request.method,url,(limit)=>body(request,limit),projects,servers,{ terminals, herdr });
          const result=await (deletion ? projectAction(ProjectIdSchema.parse(deletion[1]), action, true, url.pathname.endsWith('/delete-thread')) : action());
            json(response,result.status,result.value);return;
          }

          if (url.pathname === '/api/herdr' || url.pathname.startsWith('/api/herdr/')) {
            if (url.pathname === '/api/herdr/events' && request.method === 'GET') { await herdrEvents(request, response, url, herdr, streams); return; }
            const match = request.method === 'POST' && /^\/api\/herdr\/([^/]+)$/.exec(url.pathname);
            const action = () => herdrRequest(url.pathname, request.method, url, () => body(request, 65536), herdr);
            json(response, 200, await (match ? projectAction(ProjectIdSchema.parse(decodeURIComponent(match[1]!)), action) : action())); return;
          }
          if (url.pathname === '/api/terminals' || url.pathname.startsWith('/api/terminals/')) {
            await terminalRequest({ request, response, url, terminals, streams, body, json, projectAction });
            return;
          }
          const graphMatch = /^\/api\/canvas\/([a-zA-Z0-9_-]+)$/.exec(
            url.pathname,
          );
          if (
            (request.method === 'GET' && graphMatch) ||
            (request.method === 'POST' && url.pathname === '/api/canvas')
          ) {
            if (!canvas)
              throw new ApplicationError(
                'SERVICE_UNAVAILABLE',
                'Canvas storage is not enabled in this profile',
              );
            if (request.method === 'GET')
              json(
                response,
                200,
                await canvas.load(ProjectIdSchema.parse(graphMatch![1])),
              );
            else
              json(
                response,
                200,
                await canvas.save(
                  SaveCanvasSchema.parse(await body(request, 2 * 1024 * 1024)),
                ),
              );
            return;
          }
          if (
            request.method === 'GET' &&
            options.webRoot &&
            (url.pathname === '/' || url.pathname.startsWith('/assets/'))
          ) {
            const root = await realpath(options.webRoot);
            const candidate = resolve(
              root,
              url.pathname === '/'
                ? 'index.html'
                : `.${decodeURIComponent(url.pathname)}`,
            );
            if (!candidate.startsWith(root + sep))
              throw new ApplicationError('PATH_DENIED', 'Invalid asset path');
            const file = await realpath(candidate);
            if (!file.startsWith(root + sep))
              throw new ApplicationError(
                'PATH_DENIED',
                'Asset is outside web root',
              );
            const types: Record<string, string> = {
              '.html': 'text/html',
              '.js': 'text/javascript',
              '.css': 'text/css',
              '.svg': 'image/svg+xml',
            };
            response.writeHead(200, {
              'content-type':
                types[extname(file)] ?? 'application/octet-stream',
              'x-content-type-options': 'nosniff',
              'content-security-policy':
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-src 'self' http://127.0.0.1:* http://localhost:*; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
            });
            response.end(await readFile(file));
            return;
          }
          json(response, 404, {
            code: 'NOT_FOUND',
            message: 'Route not found',
          });
        })().catch((error: unknown) => {
          if (response.headersSent) {
            response.destroy();
            return;
          }
          const code =
            error instanceof ApplicationError
              ? error.code
              : error instanceof z.ZodError
                ? 'INVALID_INPUT'
                : typeof error === 'object' &&
                    error !== null &&
                    'code' in error &&
                    error.code === 'ENOENT'
                  ? 'NOT_FOUND'
                  : 'INTERNAL_ERROR';
          const status =
            code === 'RUN_NOT_FOUND' ||
            code === 'NOT_FOUND' ||
            code === 'TERMINAL_NOT_FOUND'
              ? 404
              : code === 'ORIGIN_DENIED' || code === 'PATH_DENIED'
                ? 403
                : code === 'PAYLOAD_TOO_LARGE'
                  ? 413
                  : code === 'INVALID_INPUT'
                    ? 400
                    : code === 'NOT_READY' || code === 'SERVICE_UNAVAILABLE' || code === 'HERDR_UNAVAILABLE'
                      ? 503
                      : code === 'INTERNAL_ERROR'
                        ? 500
                        : 409;
          json(response, status, {
            code,
            message: error instanceof Error ? error.message : 'Request failed',
          });
        });
      });
      scope.onDispose(
        () =>
          new Promise<void>((resolveClose, reject) => {
            for (const close of [...streams]) close();
            server.close((error) => (error ? reject(error) : resolveClose()));
            server.closeIdleConnections();
          }),
      );
      await new Promise<void>((ready, reject) => {
        server.once('error', reject);
        server.listen(options.port, '127.0.0.1', () => {
          server.removeListener('error', reject);
          ready();
        });
      });
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('Missing HTTP address');
      scope.provide('http', { url: `http://127.0.0.1:${address.port}` });
    },
  };
}
