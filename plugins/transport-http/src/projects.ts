import { z } from 'zod';
import {
  ApplicationError,
  CreateProjectSchema,
  PreimpCommandSchema,
  ForkProjectSchema,
  OpenProjectSchema,
  ProjectIdSchema,
  WriteProjectFileSchema,
  type ProjectCatalog,
  type ProjectServers,
  type TerminalService,
  type HerdrService,
} from '@devlab/contracts';
/** Project commands share the catalog identity; preparation is an owned capability. */
export async function projectRequest(
  path: string,
  method: string | undefined,
  url: URL,
  body: (limit?: number) => Promise<unknown>,
  projects: ProjectCatalog | undefined,
  servers?: ProjectServers,
  activity?: { terminals?: TerminalService; herdr?: HerdrService },
): Promise<{ status: number; value: unknown }> {
  if (!projects)
    throw new ApplicationError(
      'SERVICE_UNAVAILABLE',
      'Projects are unavailable',
    );
  const parts = path.split('/').filter(Boolean),
    id = parts[2];
  if (parts.length === 2 && method === 'GET')
    return { status: 200, value: await projects.list() };
  if (parts.length === 2 && method === 'POST') {
    const created = await projects.create(
      CreateProjectSchema.parse(await body()),
    );
    return { status: 201, value: created };
  }
  if (path === '/api/projects/open' && method === 'POST') {
    const opened = await projects.open(OpenProjectSchema.parse(await body()));
    return { status: 200, value: opened };
  }
  if (path === '/api/projects/fork' && method === 'POST') {
    const command = ForkProjectSchema.parse(await body());
    if (!projects.fork) throw new ApplicationError('SERVICE_UNAVAILABLE', 'Project development forks are unavailable');
    return { status: 201, value: await projects.fork(command) };
  }
  if (!id) throw new ApplicationError('NOT_FOUND', 'Project command not found');
  ProjectIdSchema.parse(id);
  if (parts.length === 4 && ['delete-thread', 'forget'].includes(parts[3]!) && method === 'POST' && activity?.herdr) {
    const runtime = await activity.herdr.snapshot(id);
    if (runtime.state === 'running' || runtime.state === 'error' || runtime.attachment)
      throw new ApplicationError('CONFLICT', 'Stop this project’s Herdr runtime before removing it');
  }
  if (parts.length === 4 && parts[3] === 'preimp' && method === 'POST') {
    if (!projects.preimp) throw new ApplicationError('SERVICE_UNAVAILABLE', 'Preimplementation is unavailable');
    return { status: 200, value: await projects.preimp(id, PreimpCommandSchema.parse(await body(24000))) };
  }
  if (parts.length === 4 && parts[3] === 'delete-thread' && method === 'POST') {
    z.object({}).strict().parse(await body());
    if (!projects.deleteThread)
      throw new ApplicationError('SERVICE_UNAVAILABLE', 'Development thread deletion is unavailable');
    const selected = (await projects.list()).find(project => project.id === id);
    if (!selected?.development || selected.base)
      throw new ApplicationError('PATH_DENIED', 'Only development threads can be deleted');
    const previews = await servers?.list() ?? [];
    if (activity?.terminals?.list(id).some(terminal => terminal.projectId === id && terminal.status === 'running'))
      throw new ApplicationError('CONFLICT', 'Close the running terminal before deleting this thread');
    if (previews.some(preview => preview.projectId === id && ['installing', 'starting', 'ready'].includes(preview.status)))
      throw new ApplicationError('CONFLICT', 'Stop preview first before deleting this thread');
    await projects.deleteThread(id);
    return { status: 200, value: { ok: true } };
  }
  if (parts.length === 4 && parts[3] === 'forget' && method === 'POST') {
    z.object({})
      .strict()
      .parse(await body());
    await projects.forget(id);
    return { status: 200, value: { ok: true } };
  }
  if (parts.length === 4 && parts[3] === 'files' && method === 'GET')
    return { status: 200, value: await projects.inspect(id) };
  if (parts.length === 4 && parts[3] === 'file' && method === 'GET')
    return {
      status: 200,
      value: await projects.read(
        id,
        z.string().min(1).max(512).parse(url.searchParams.get('path')),
      ),
    };
  if (parts.length === 4 && parts[3] === 'file' && method === 'POST')
    return {
      status: 200,
      value: await projects.write(
        WriteProjectFileSchema.parse({
          ...z
            .object({
              path: z.string(),
              text: z.string(),
              expectedHash: z.string().nullable(),
            })
            .strict()
            .parse(await body(300000)),
          projectId: id,
        }),
      ),
    };
  if (parts.length === 4 && parts[3] === 'module' && method === 'POST')
    return {
      status: 201,
      value: await projects.createModule(
        id,
        z
          .object({ path: z.string().min(1).max(512) })
          .strict()
          .parse(await body()).path,
      ),
    };
  throw new ApplicationError('NOT_FOUND', 'Project command not found');
}
