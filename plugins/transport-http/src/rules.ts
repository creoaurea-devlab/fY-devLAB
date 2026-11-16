import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { ApplicationError, ProjectIdSchema, type RulesService } from '@devlab/contracts';

/** Inspection has no writer, filesystem-path argument, or command-execution route. */
export async function rulesRequest(request: IncomingMessage, response: ServerResponse, url: URL,
  service: RulesService | undefined,
  json: (response: ServerResponse, status: number, value: unknown) => void): Promise<boolean> {
  const activity = url.pathname === '/api/rules/activity';
  if (!activity && url.pathname !== '/api/rules') return false;
  if (request.method !== 'GET') throw new ApplicationError('NOT_FOUND', 'Rules route not found');
  if (!service) throw new ApplicationError('SERVICE_UNAVAILABLE', 'Rules capability unavailable');
  if (url.search.length > 1024 || url.searchParams.getAll('projectId').length !== 1)
    throw new ApplicationError('INVALID_INPUT', 'Expected exactly one projectId');
  const input = z.object({ projectId: ProjectIdSchema }).strict().parse(Object.fromEntries(url.searchParams));
  if (activity && !service.activity) throw new ApplicationError('SERVICE_UNAVAILABLE', 'Agent activity is unavailable');
  json(response, 200, activity ? await service.activity!(input.projectId) : await service.snapshot(input.projectId));
  return true;
}
