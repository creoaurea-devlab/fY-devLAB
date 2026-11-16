import { z } from 'zod';
import { ProjectIdSchema } from './workspace.ts';
import { RegistryGraphSchema } from './architecture.ts';
import { AgentDefinitionIdSchema } from './ownership.ts';

export const AgentAssessmentEvidenceSchema = z.object({
  schema_version: z.literal(1), step_id: AgentDefinitionIdSchema,
  definition_digest: z.string().regex(/^[a-f0-9]{64}$/),
  actor: z.string().trim().min(1).max(4000), recorded_at: z.string().datetime(),
  kind: z.literal('assessed'), assessment: z.string().trim().min(1).max(4000), accepted: z.boolean(),
}).strict();
export type AgentAssessmentEvidence = z.infer<typeof AgentAssessmentEvidenceSchema>;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative();
export const RulesHarnessSchema = z.object({
  health: z.object({ status: z.enum(['healthy', 'attention', 'unavailable']), issues: z.array(z.string()).max(64) }),
  memory: z.object({
    integrity: z.enum(['ok', 'failed', 'unavailable']),
    groups: z.array(z.object({ kind: z.string(), count })).max(32),
    stages: z.array(z.object({ stage: z.string(), count })).max(32),
    freshness: z.object({ current: count, stale: count, missing: count, unverified: count, scanned: count, truncated: z.boolean() }),
  }),
  routing: z.object({ status: z.enum(['valid', 'invalid', 'unavailable']), owners: count, profiles: count, skills: count }),
  gates: z.array(z.object({
    id: z.enum(['PLAN', 'BUILD', 'CHECK', 'REPAIR', 'DONE', 'BOOT', 'PREFLIGHT', 'WORK', 'VERIFY', 'CLOSE']), label: z.string(), sourcePath: z.string(),
    number: z.number().int().positive(), instruction: z.string().max(4096),
  })).max(5),
  memoryGraph: z.object({
    status: z.enum(['ready', 'unavailable']), graph: RegistryGraphSchema,
    tables: z.array(z.object({ table: z.enum(['sessions', 'memory', 'events', 'claims']), total: count, shown: count })).max(4),
    truncated: z.boolean(), snapshotId: hash,
  }),
});
export type RulesHarness = z.infer<typeof RulesHarnessSchema>;
export const RulesSourceSchema = z.object({
  id: z.string(), path: z.string(), label: z.string(),
  category: z.enum(['engineering','maintenance','solid','workflow','configuration','reference']),
  status: z.enum(['current','stale','missing','invalid','unverified']),
  sha256: hash.optional(), expectedSha256: hash.optional(), text: z.string().max(65536), truncated: z.boolean(),
  numberedRules: z.array(z.object({number: z.number().int(), text: z.string(), line: z.number().int()})).max(128),
  review: z.enum(['required','reference']),
});
export const RulesCheckSchema = z.object({
  id: z.string(), sessionId: z.string(), command: z.string(), exitCode: z.number().int().optional(),
  result: z.enum(['passed','failed','unknown']), freshness: z.enum(['current','stale','unverified','historical']),
  recordedAt: z.string().optional(), reason: z.string(),
  evidence: z.array(z.object({path: z.string(), expectedSha256: hash.optional(), actualSha256: hash.optional(),
    status: z.enum(['current','stale','missing','unsafe'])})),
});
export const RulesSnapshotSchema = z.object({
  projectId: ProjectIdSchema, observedAt: z.string(),
  edition: z.enum(['wisdohm-2.6','wisdohm-2.7','legacy-context-2.4','absent','unsupported']),
  authority: z.object({entryPath: z.string(), memoryPath: z.string().optional(), version: z.string().optional(),
    status: z.enum(['ready','missing','invalid','unpopulated'])}),
  sources: z.array(RulesSourceSchema).max(32), checks: z.array(RulesCheckSchema).max(100),
  memory: z.object({status: z.enum(['populated','unpopulated','missing','invalid']), records: z.number().int().nonnegative(),
    sessions: z.number().int().nonnegative(), reason: z.string()}),
  commands: z.array(z.object({label: z.string(), command: z.string()})), warnings: z.array(z.string()),
  harness: RulesHarnessSchema.optional(),
  assessments: z.array(AgentAssessmentEvidenceSchema).max(100).optional(),
});
export type RulesSource = z.infer<typeof RulesSourceSchema>;
export type RulesCheck = z.infer<typeof RulesCheckSchema>;
export type RulesSnapshot = z.infer<typeof RulesSnapshotSchema>;
/** A claim reserves a path until released. updatedAt is a governance write, not a heartbeat. */
export const AgentTrafficSnapshotSchema = z.object({
  projectId: ProjectIdSchema,
  observedAt: z.string().datetime({ offset: true }),
  status: z.enum(['ready', 'missing', 'invalid', 'unsupported']),
  reason: z.string().max(500).optional(),
  totalSessions: count,
  totalClaims: count,
  truncated: z.boolean(),
  sessions: z.array(z.object({
    id: z.string().min(1).max(128),
    stepId: z.string().min(1).max(96).optional(),
    owner: z.string().min(1).max(128),
    stage: z.string().min(1).max(32),
    updatedAt: z.string().datetime({ offset: true }).optional(),
  }).strict()).max(256),
  claims: z.array(z.object({
    path: z.string().min(1).max(1024),
    sessionId: z.string().min(1).max(128),
  }).strict()).max(1024),
}).strict();
export type AgentTrafficSnapshot = z.infer<typeof AgentTrafficSnapshotSchema>;
/** Read-only, bounded observations. A passing receipt is not universal rule compliance. */
export interface RulesService {
  snapshot(projectId: string): Promise<RulesSnapshot>;
  activity?(projectId: string): Promise<AgentTrafficSnapshot>;
}
