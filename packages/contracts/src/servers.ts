import { z } from 'zod';
import { PreviewDescriptorSchema, type PreviewDescriptor } from './preview.ts';
export type ProjectServerState = {
  instanceId?: string;
  projectId: string;
  generation: number;
  status:
    | 'unconfigured'
    | 'invalid'
    | 'stopped'
    | 'installing'
    | 'starting'
    | 'ready'
    | 'failed';
  url?: string;
  error?: string;
  fingerprint?: string;
  descriptor?: PreviewDescriptor;
  logs: string[];
};
export interface ProjectServers {
  inspect(projectId: string): Promise<ProjectServerState>;
  list(): Promise<ProjectServerState[]>;
  start(projectId: string): Promise<ProjectServerState>;
  stop(projectId: string): Promise<ProjectServerState>;
}

export const ProjectServerStateSchema = z
  .object({
    projectId: z.string(),
    instanceId: z.string().uuid().optional(),
    generation: z.number().int().nonnegative(),
    status: z.enum([
      'unconfigured',
      'invalid',
      'stopped',
      'installing',
      'starting',
      'ready',
      'failed',
    ]),
    descriptor: PreviewDescriptorSchema.optional(),
    url: z.string().url().optional(),
    error: z.string().optional(),
    fingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    logs: z.array(z.string()).max(32768),
  })
  .strict();
