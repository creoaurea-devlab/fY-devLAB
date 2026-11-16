import { z } from 'zod';
import { ProjectIdSchema } from './workspace.ts';
import { TerminalSessionSchema } from './terminal.ts';

const pane = z.string().regex(/^w\d+:p\d+$/).max(80);
const label = z.string().trim().min(1).max(80).refine(value => !/[\x00-\x1f\x7f]/.test(value));
export const HerdrCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start') }).strict(),
  z.object({ type: z.literal('stop') }).strict(),
  z.object({ type: z.literal('attach') }).strict(),
  z.object({ type: z.literal('detach') }).strict(),
  z.object({ type: z.literal('create'), label }).strict(),
  z.object({ type: z.literal('select'), workspaceId: z.string().regex(/^w\d+$/).max(80) }).strict(),
  z.object({ type: z.literal('split'), paneId: pane, direction: z.enum(['right', 'down']) }).strict(),
  z.object({ type: z.literal('focus'), paneId: pane }).strict(),
  z.object({ type: z.literal('zoom'), paneId: pane, mode: z.enum(['on', 'off']) }).strict(),
  z.object({ type: z.literal('resize'), paneId: pane, direction: z.enum(['left', 'right', 'up', 'down']), amount: z.number().min(0.01).max(0.5) }).strict(),
  z.object({ type: z.literal('rename'), paneId: pane, label }).strict(),
  z.object({ type: z.literal('close'), paneId: pane }).strict(),
  z.object({ type: z.literal('input'), paneId: pane, text: z.string().min(1).max(16384) }).strict(),
  z.object({ type: z.literal('key'), paneId: pane, key: z.enum(['enter', 'ctrl+c']) }).strict(),
]);
export type HerdrCommand = z.infer<typeof HerdrCommandSchema>;
export const HerdrSnapshotSchema = z.object({
  projectId: ProjectIdSchema,
  state: z.enum(['stopped', 'running', 'unavailable', 'error']),
  message: z.string(),
  version: z.string(),
  protocol: z.number().int(),
  policy: z.object({ mode: z.literal('contained-project'), network: z.literal('offline'), revision: z.string(), projectPath: z.literal('/workspace') }).strict(),
  workspaces: z.array(z.object({ id: z.string(), label: z.string(), focused: z.boolean() }).strict()),
  panes: z.array(z.object({ id: z.string(), workspaceId: z.string(), label: z.string(), focused: z.boolean(), tabId: z.string(), zoomed: z.boolean(),
    agent: z.string().nullable(), agentStatus: z.enum(['idle', 'working', 'blocked', 'done', 'unknown']) }).strict()),
  attachment: TerminalSessionSchema.nullable(),
}).strict();
export type HerdrSnapshot = z.infer<typeof HerdrSnapshotSchema>;
export interface HerdrService {
  /** Invalidations only; reconnect always reads a complete authoritative snapshot. */
  subscribe?(projectId: string, changed: () => void): () => void;
  snapshot(projectId: string): Promise<HerdrSnapshot>;
  command(projectId: string, command: HerdrCommand): Promise<HerdrSnapshot>;
}
