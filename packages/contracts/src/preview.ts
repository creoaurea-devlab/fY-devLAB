import { z } from 'zod';

export const ProjectRelativePathSchema = z
  .string()
  .max(512)
  .refine(
    (p) =>
      p === '.' ||
      (!!p &&
        !p.startsWith('/') &&
        !p.includes('\\') &&
        !p.includes('\0') &&
        p
          .split('/')
          .every(
            (v) =>
              !!v &&
              v !== '.' &&
              v !== '..' &&
              !v.startsWith('.') &&
              v !== 'node_modules' &&
              v !== 'secrets',
          )),
    'Expected a project-relative path without traversal or hidden directories',
  );
const argv = z
  .array(
    z
      .string()
      .min(1)
      .max(4096)
      .refine((v) => !v.includes('\0')),
  )
  .min(1)
  .max(64);
export const LoopbackPreviewUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      !url.username &&
      !url.password
    );
  }, 'Preview must use a credential-free loopback HTTP URL');
export const PreviewElementSchema = z.object({
  owner: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/),
  sources: z.array(ProjectRelativePathSchema.refine(path => path !== '.')).min(1).max(16),
  designGuide: ProjectRelativePathSchema.refine(path => path !== '.'),
}).strict();
export type PreviewElement = z.infer<typeof PreviewElementSchema>;
export const PreviewDescriptorSchema = z
  .object({
    schemaVersion: z.literal(1),
    adapter: z.enum(['vite', 'next', 'static', 'none', 'custom']),
    cwd: ProjectRelativePathSchema.default('.'),
    workspaceRoot: ProjectRelativePathSchema.default('.'),
    packageManager: z.enum(['pnpm', 'npm', 'yarn', 'bun']).optional(),
    packageManagerVersion: z
      .string()
      .regex(/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/)
      .optional(),
    install: argv.optional(),
    start: argv.optional(),
    autoStart: z.boolean().default(false),
    port: z.number().int().min(1024).max(65535).default(5173),
    readinessPath: z
      .string()
      .max(256)
      .regex(/^\/(?!\/)[^\s]*$/)
      .default('/'),
    timeoutMs: z.number().int().min(1000).max(120000).default(30000),
    environment: z
      .array(z.string().regex(/^[A-Z_][A-Z0-9_]*$/))
      .max(32)
      .default([]),
    views: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
            label: z.string().min(1).max(80),
          element: PreviewElementSchema.optional(),
            path: z
              .string()
              .max(512)
              .regex(/^\/(?!\/)[^\s]*$/),
          })
          .strict(),
      )
      .min(1)
      .max(32)
      .default([{ id: 'app', label: 'App', path: '/' }]),
    tokens: z.array(ProjectRelativePathSchema).max(32).default([]),
    elements: z
      .object({
        attribute: z.literal('data-devlab-id').default('data-devlab-id'),
        sourceAttribute: z
          .literal('data-devlab-source')
          .default('data-devlab-source'),
      })
      .strict()
      .default({}),
    inspection: z.enum(['bridge', 'manual', 'none']).default('manual'),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (new Set(d.views.map((v) => v.id)).size !== d.views.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Preview view IDs must be unique',
      });
    if (d.adapter !== 'none' && !d.start)
      ctx.addIssue({
        code: 'custom',
        message: 'Preview adapter requires explicit start argv',
      });
    if (d.adapter === 'none' && (d.start || d.install || d.autoStart))
      ctx.addIssue({
        code: 'custom',
        message: 'No-UI adapter cannot execute commands',
      });
    if (d.autoStart && !d.start)
      ctx.addIssue({
        code: 'custom',
        message: 'Auto-start requires start argv',
      });
  });
export type PreviewDescriptor = z.infer<typeof PreviewDescriptorSchema>;
/** Descriptor capability is distinct from a live project connection observation. */
export function previewRefreshMode(adapter?: PreviewDescriptor['adapter']):
  'framework-hmr' | 'reload-required' | 'none' | 'unknown' {
  if (adapter === 'vite') return 'framework-hmr';
  if (adapter === 'static') return 'reload-required';
  if (adapter === 'none') return 'none';
  return 'unknown';
}
export const PreviewBridgeMessageSchema = z.object({
  channel: z.literal('devlab-preview-v1'),
  type: z.enum(['ready', 'picking', 'cancelled', 'reset', 'invalidated', 'selection', 'refresh-state']),
  projectId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  generation: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  nonce: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/),
  epoch: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  refresh: z.enum(['unknown', 'connected', 'disconnected']).optional(),
  selection: z.unknown().optional(),
});

export const PreviewNativeTargetSchema=z.object({paneId:z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),viewId:z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)}).strict();
export type PreviewNativeTarget=z.infer<typeof PreviewNativeTargetSchema>;

/** Cooperative metadata is evidence from project DOM, never instruction authority. */
export interface PreviewInspector {
  bridgeScript(): string;
  openWorkspace(
    ownHostUrl: string,
    projectId: string,
    target?: PreviewNativeTarget,
  ): Promise<{ sessionId: string }>;
  openDevTools(
    sessionId: string,
    projectId: string,
  ): Promise<{
    targetId: string;
    devToolsTargetId: string;
    projectId: string;
    generation: number;
  }>;
  closeWorkspace(sessionId: string): Promise<void>;
}
export const PreviewSelectionSchema = z
  .object({
    stableId: z.string().max(128).nullable(),
    identityStatus: z.enum(['missing', 'duplicate', 'annotated']),
    tag: z.string().max(64),
    role: z.string().max(64).nullable(),
    name: z.string().max(256),
    source: z.union([
      z
        .object({ status: z.literal('unknown'), reason: z.string().max(256) })
        .strict(),
      z
        .object({
          status: z.literal('annotated'),
          value: z.string().max(512),
          verified: z.literal(false),
        })
        .strict(),
    ]),
    tokens: z
      .object({
        references: z
          .array(
            z
              .object({
                token: z.string().max(96),
                properties: z.array(z.string().max(96)).max(8),
                evidence: z.string().max(64),
                computedValue: z.string().max(256),
                propertyValues: z.record(z.string().max(256)),
              })
              .strict(),
          )
          .max(64),
        unreadableSheets: z.number().int().nonnegative(),
        coverage: z.string().max(512),
      })
      .strict(),
    bounds: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().finite().nonnegative(),
        height: z.number().finite().nonnegative(),
      })
      .strict(),
    shadow: z.enum(['open-shadow', 'document']),
  })
  .strict();
export type PreviewSelection = z.infer<typeof PreviewSelectionSchema>;
