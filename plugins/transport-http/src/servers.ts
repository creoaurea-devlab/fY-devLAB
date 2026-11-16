import { z } from 'zod';
import {
  ApplicationError,
  ProjectIdSchema,
  type ProjectServers,
} from '@devlab/contracts';
export async function serverRequest(
  path: string,
  method: string | undefined,
  body: () => Promise<unknown>,
  servers: ProjectServers | undefined,
): Promise<unknown> {
  if (!servers)
    throw new ApplicationError(
      'SERVICE_UNAVAILABLE',
      'Project servers are disabled',
    );
  if (path === '/api/servers' && method === 'GET') return servers.list();
  const match =
    /^\/api\/servers\/([a-zA-Z0-9_-]+)(?:\/(start|stop|restart))?$/.exec(path);
  if (match) {
    const id = ProjectIdSchema.parse(match[1]);
    if (method === 'GET' && !match[2]) return servers.inspect(id);
    if (method === 'POST' && match[2]) {
      z.object({})
        .strict()
        .parse(await body());
      if (match[2] === 'stop') return servers.stop(id);
      if (match[2] === 'restart') await servers.stop(id);
      return servers.start(id);
    }
  }
  throw new ApplicationError('NOT_FOUND', 'Server command not found');
}
