import { z } from 'zod';
import { ProjectTextSchema } from './projects.ts';

const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const PreimpTaskSchema = z.object({
  schemaVersion: z.literal(1), id, title: z.string().trim().min(1).max(120),
  ownerId: id, createdAt: z.string().datetime(),
  files: z.array(z.object({ path: z.string().min(1).max(400), baseHash: sha.nullable() }).strict()).min(1).max(32),
}).strict();
export type PreimpTask = z.infer<typeof PreimpTaskSchema>;
export const PreimpCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('create'), id, title: z.string().trim().min(1).max(120), ownerId: id,
    paths: z.array(z.string().min(1).max(400)).min(1).max(32) }).strict(),
  z.object({ action: z.literal('inspect'), id }).strict(),
  z.object({ action: z.literal('review'), id }).strict(),
  z.object({ action: z.literal('promote'), id, revision: sha, evidence: z.string().trim().min(1).max(4000) }).strict(),
]);
export type PreimpCommand = z.infer<typeof PreimpCommandSchema>;
const status = z.enum(['staged', 'merging', 'merged']);
export const PreimpEntrySchema = PreimpTaskSchema.extend({ status });
export type PreimpEntry = z.infer<typeof PreimpEntrySchema>;
export const PreimpSnapshotSchema = z.object({
  tasks: z.array(PreimpEntrySchema).max(100),
  owners: z.array(z.object({ id: z.string(), purpose: z.string(), paths: z.array(z.string()) }).strict()),
  selected: z.object({
    task: PreimpTaskSchema, status,
    plan: ProjectTextSchema, prototype: ProjectTextSchema,
    review: z.object({ revision: sha, conflicts: z.array(z.string()),
      files: z.array(z.object({ path: z.string(), before: z.string().nullable(), after: z.string(),
        changed: z.boolean() }).strict()) }).strict().optional(),
  }).strict().optional(),
}).strict();
export type PreimpSnapshot = z.infer<typeof PreimpSnapshotSchema>;
