import { z } from 'zod';
import { ProjectIdSchema } from './workspace.ts';

export const TerminalSizeSchema = z.object({
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(2).max(500),
}).strict();
export const TerminalOwnershipSchema = z.object({
  mode: z.enum(['off', 'guided', 'strict']),
  ownerId: z.string().min(1).max(128).optional(),
  revision: z.string().optional(),
}).strict();
export type TerminalOwnership = z.infer<typeof TerminalOwnershipSchema>;
export const TerminalOwnershipsSchema = z.object({
  owners: z.array(z.object({ id: z.string(), label: z.string(), files: z.array(z.string()) }).strict()),
  strict: z.object({ available: z.boolean(), reason: z.string().optional() }).strict(),
}).strict();
export type TerminalOwnerships = z.infer<typeof TerminalOwnershipsSchema>;
export const TerminalCreateSchema = TerminalSizeSchema.extend({
  projectId: ProjectIdSchema,
  nodeId: z.string().min(1).max(128),
  cwd: z.string().max(1024).refine(v => !v.includes('\0')).default('.'),
  shell: z.enum(['bash', 'sh']).default('bash'),
  ownership: TerminalOwnershipSchema.omit({revision: true}).optional(),
  parentSessionId: z.string().uuid().optional(),
}).strict();
export type TerminalCreate = z.infer<typeof TerminalCreateSchema>;
export const TerminalInputSchema = z.object({
  data: z.string().min(1).max(65536),
}).strict();
export const TerminalSessionSchema = TerminalSizeSchema.extend({
  kind: z.literal('herdr').optional(),
  id: z.string().uuid(),
  projectId: ProjectIdSchema,
  nodeId: z.string(),
  cwd: z.string(),
  shell: z.enum(['bash', 'sh']),
  ownership: TerminalOwnershipSchema.optional(),
  parentSessionId: z.string().uuid().optional(),
  pid: z.number().int().positive(),
  status: z.enum(['running', 'exited']),
  exitCode: z.number().int().nullable(),
  cursor: z.number().int().nonnegative(),
}).strict();
export type TerminalSession = z.infer<typeof TerminalSessionSchema>;
export const TerminalReplaySchema = z.object({
  session: TerminalSessionSchema,
  reset: z.boolean(),
  chunks: z.array(z.object({seq: z.number().int().positive(), data: z.string()}).strict()),
}).strict();
export type TerminalReplay = z.infer<typeof TerminalReplaySchema>;

/** Configured host roots; resolving cwd does not sandbox an interactive shell. */
export interface WorkspaceRoots {
  resolve(projectId: string, cwd: string): Promise<string>;
}
/** App owns PTYs. Detaching observers never stops a process. Output is transient. */
export interface TerminalService {
  /** Trusted in-process attachment only. Never expose executable/env through HTTP. */
  attachManaged?(command: {
    projectId: string; nodeId: string; executable: string; args: string[];
    cwd: string; env: Record<string, string>; cols: number; rows: number;
  }): Promise<TerminalSession>;
  ownerships(projectId: string): Promise<TerminalOwnerships>;
  create(command: TerminalCreate): Promise<TerminalSession>;
  list(projectId: string): TerminalSession[];
  inspect(id: string): TerminalSession;
  read(id: string, after: number): TerminalReplay;
  subscribe(id: string, listener: () => void): () => void;
  write(id: string, data: string): void;
  resize(id: string, size: z.infer<typeof TerminalSizeSchema>): void;
  close(id: string): Promise<TerminalSession>;
}
