import { z } from 'zod';
import { ProjectIdSchema } from './workspace.ts';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const BrowserIdentitySchema = z
  .object({ projectId: ProjectIdSchema, browserId: id })
  .strict();
export type BrowserIdentity = z.infer<typeof BrowserIdentitySchema>;
export const BrowserViewportSchema = z
  .object({
    width: z.number().int().min(480).max(1920),
    height: z.number().int().min(240).max(1200),
  })
  .strict();
export const BrowserURLSchema = z
  .string()
  .max(4096)
  .refine((value) => {
    if (value === 'about:blank') return true;
    try {
      const url = new URL(value);
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, 'Use an http(s) URL without embedded credentials, or about:blank');
export const BrowserConfigSchema = BrowserIdentitySchema.extend({
  url: BrowserURLSchema.default('about:blank'),
  mode: z.enum(['persistent', 'temporary']).default('persistent'),
  viewport: BrowserViewportSchema.default({ width: 1280, height: 720 }),
}).strict();
export type BrowserConfig = z.infer<typeof BrowserConfigSchema>;
export const BrowserTargetSchema = BrowserIdentitySchema.extend({
  generation: z.string().uuid(),
  pageId: z.string().uuid(),
}).strict();
export type BrowserTarget = z.infer<typeof BrowserTargetSchema>;
export const BrowserActorSchema = z
  .object({ kind: z.enum(['human', 'agent']), id })
  .strict();
export type BrowserActor = z.infer<typeof BrowserActorSchema>;
export const BrowserLeaseSchema = BrowserTargetSchema.omit({ pageId: true })
  .extend({
    token: z.string().uuid(),
    actor: BrowserActorSchema,
    expiresAt: z.number().int(),
  })
  .strict();
export type BrowserLease = z.infer<typeof BrowserLeaseSchema>;
export const BrowserSessionSchema = BrowserConfigSchema.omit({ url: true })
  .extend({
    generation: z.string().uuid(),
    activePageId: z.string().uuid(),
    pages: z
      .array(
        z.object({ id: z.string().uuid(), url: z.string().max(8192) }).strict(),
      )
      .max(12),
  })
  .strict();
export type BrowserSession = z.infer<typeof BrowserSessionSchema>;
export const BrowserLocatorSchema = z
  .object({
    by: z.enum(['role', 'label', 'text', 'placeholder', 'testId', 'css']),
    value: z.string().min(1).max(512),
    name: z.string().max(512).optional(),
    exact: z.boolean().default(true),
    frame: z.string().min(1).max(512).optional(),
  })
  .strict();
export const BrowserActionSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('observe') }).strict(),
  z.object({ op: z.literal('navigate'), url: BrowserURLSchema }).strict(),
  z.object({ op: z.literal('back') }).strict(),
  z.object({ op: z.literal('forward') }).strict(),
  z.object({ op: z.literal('reload') }).strict(),
  z.object({ op: z.literal('click'), locator: BrowserLocatorSchema }).strict(),
  z
    .object({
      op: z.literal('fill'),
      locator: BrowserLocatorSchema,
      text: z.string().max(16384),
    })
    .strict(),
  z
    .object({
      op: z.literal('select'),
      locator: BrowserLocatorSchema,
      value: z.string().max(1024),
    })
    .strict(),
  z.object({ op: z.literal('press'), key: z.string().min(1).max(80) }).strict(),
  z.object({ op: z.literal('type'), text: z.string().max(16384) }).strict(),
  z
    .object({
      op: z.literal('pointer'),
      viewport: BrowserViewportSchema,
      phase: z.enum(['move', 'down', 'up']),
      x: z.number().finite().min(0).max(1920),
      y: z.number().finite().min(0).max(1200),
      button: z.enum(['left', 'middle', 'right']).default('left'),
    })
    .strict(),
  z
    .object({
      op: z.literal('scroll'),
      deltaX: z.number().finite().min(-10000).max(10000),
      deltaY: z.number().finite().min(-10000).max(10000),
    })
    .strict(),
  z
    .object({ op: z.literal('resize'), viewport: BrowserViewportSchema })
    .strict(),
  z
    .object({
      op: z.literal('newTab'),
      url: BrowserURLSchema.default('about:blank'),
    })
    .strict(),
  z.object({ op: z.literal('selectTab'), pageId: z.string().uuid() }).strict(),
  z.object({ op: z.literal('closeTab') }).strict(),
  z.object({ op: z.literal('screenshot') }).strict(),
  z.object({ op: z.literal('heartbeat') }).strict(),
  z.object({ op: z.literal('stop') }).strict(),
]);
export type BrowserAction = z.infer<typeof BrowserActionSchema>;
export const BrowserFrameSchema = z
  .object({
    target: BrowserTargetSchema,
    viewport: BrowserViewportSchema,
    mime: z.literal('image/jpeg'),
    data: z.string().max(3_000_000),
  })
  .strict();
export type BrowserFrame = z.infer<typeof BrowserFrameSchema>;
export const BrowserResultSchema = z
  .object({
    session: BrowserSessionSchema.nullable(),
    observation: z
      .object({
        title: z.string().max(1024),
        url: z.string().max(8192),
        aria: z.string().max(16000),
        truncated: z.boolean(),
      })
      .strict()
      .optional(),
    image: BrowserFrameSchema.optional(),
  })
  .strict();
export type BrowserResult = z.infer<typeof BrowserResultSchema>;
export const BrowserCommandSchema = BrowserTargetSchema.extend({
  commandId: z.string().uuid(),
  token: z.string().uuid(),
  actor: BrowserActorSchema,
  action: BrowserActionSchema,
}).strict();
export type BrowserCommand = z.infer<typeof BrowserCommandSchema>;
export const BrowserEntrySchema = z
  .object({
    projectId: ProjectIdSchema,
    browserId: id,
    label: z.string(),
    mode: z.enum(['persistent', 'temporary']),
    url: z.string(),
    wiredAgentIds: z.array(id),
    session: BrowserSessionSchema.nullable(),
    owner: BrowserLeaseSchema.omit({ token: true }).nullable(),
  })
  .strict();
export type BrowserEntry = z.infer<typeof BrowserEntrySchema>;

/** Host-private adapter boundary; no Playwright type escapes into consumers. */
export interface BrowserAdapter {
  snapshot(): Pick<BrowserSession, 'activePageId' | 'pages' | 'viewport'>;
  execute(
    pageId: string,
    action: BrowserAction,
  ): Promise<Pick<BrowserResult, 'observation'>>;
  frame(
    pageId: string,
  ): Promise<{ data: string; viewport: BrowserSession['viewport'] }>;
  close(): Promise<void>;
}
export interface BrowserHost {
  list(projectId: string): BrowserSession[];
  inspect(identity: BrowserIdentity): BrowserSession | null;
  start(config: BrowserConfig): Promise<BrowserSession>;
  execute(target: BrowserTarget, action: BrowserAction): Promise<BrowserResult>;
  frame(target: BrowserTarget): Promise<BrowserFrame>;
  stop(identity: BrowserIdentity): Promise<void>;
  clearProfile(identity: BrowserIdentity): Promise<void>;
}
/** All externally exposed mutations go through this single-writer owner. */
export interface BrowserControl {
  discover(projectId: string): Promise<BrowserEntry[]>;
  start(
    identity: BrowserIdentity,
    actor: BrowserActor,
  ): Promise<BrowserSession>;
  acquire(
    target: BrowserTarget,
    actor: BrowserActor,
    takeover?: boolean,
  ): Promise<BrowserLease>;
  command(command: BrowserCommand): Promise<BrowserResult>;
  release(lease: BrowserLease): Promise<void>;
  frame(target: BrowserTarget): Promise<BrowserFrame>;
  clearProfile(identity: BrowserIdentity, actor: BrowserActor): Promise<void>;
}
