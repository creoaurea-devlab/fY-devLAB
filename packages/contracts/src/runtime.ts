import { z } from 'zod';

const revision = z.string().regex(/^[a-f0-9]{64}$/);
export const RuntimeSelectionSchema = z.record(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), z.boolean()).refine(value => Object.keys(value).length <= 64, 'Too many plugins');
export const RuntimeConfigureSchema = z.object({ expectedRevision: revision, changes: RuntimeSelectionSchema }).strict();
export const RuntimeRewindSchema = z.object({ expectedRevision: revision }).strict();
export const RuntimeDiagnosticSchema = z.object({ at: z.string().datetime(), operation: z.literal('workspace-search'),
  outcome: z.enum(['ok', 'error', 'cancelled']), durationMs: z.number().nonnegative(), matches: z.number().int().nonnegative() }).strict();
export type RuntimeDiagnostic = z.infer<typeof RuntimeDiagnosticSchema>;
export const RuntimeInventorySchema = z.object({ revision, canRewind: z.boolean(), restartRequired: z.boolean(),
  plugins: z.array(z.object({ apiVersion: z.literal(1), id: z.string(), version: z.string(), enabled: z.boolean(), running: z.boolean(),
    state: z.enum(['active', 'failed', 'disposed', 'disabled', 'not-started']), generation: z.number().int().nonnegative(),
    provides: z.array(z.string()), requires: z.array(z.string()), live: z.array(z.string()),
    capabilities: z.array(z.string()), reload: z.enum(['idle', 'restart']), protected: z.boolean(),
  }).strict()).max(64), diagnostics: z.array(RuntimeDiagnosticSchema).max(100),
}).strict();
export type RuntimeInventory = z.infer<typeof RuntimeInventorySchema>;
export const WorkspaceSearchSchema = z.object({ projectId: z.string().min(1).max(128), query: z.string().trim().min(1).max(120),
  maxResults: z.number().int().min(1).max(100).default(30) }).strict();
export type WorkspaceSearchInput = z.input<typeof WorkspaceSearchSchema>;
export const WorkspaceSearchResultSchema = z.object({ matches: z.array(z.object({ path: z.string(), line: z.number().int().positive(),
  text: z.string().max(240) }).strict()).max(100), scanned: z.number().int().nonnegative(), skipped: z.number().int().nonnegative(), truncated: z.boolean() }).strict();
export type WorkspaceSearchResult = z.infer<typeof WorkspaceSearchResultSchema>;
export interface WorkspaceSearch {
  search(input: WorkspaceSearchInput, signal?: AbortSignal): Promise<WorkspaceSearchResult>;
}
export interface RuntimeControl {
  inspect(): Promise<RuntimeInventory>;
  configure(input: z.infer<typeof RuntimeConfigureSchema>): Promise<RuntimeInventory>;
  rewind(input: z.infer<typeof RuntimeRewindSchema>): Promise<RuntimeInventory>;
  /** Local metadata only; query text, source contents and credentials never enter diagnostics. */
  record(event: RuntimeDiagnostic): void;
}
export interface RuntimeClient extends Pick<RuntimeControl, 'inspect' | 'configure' | 'rewind'>, WorkspaceSearch {}
