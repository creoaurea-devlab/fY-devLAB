import { z } from 'zod';
import { RegistryGraphSchema } from './architecture.ts';
import type { PreimpCommand, PreimpSnapshot } from './preimp.ts';
export const ProjectSlugSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).refine(id => !['default','workspace','node-modules','dist','vendor','secrets','projects'].includes(id), 'Reserved project name');
/** A development thread is a physical working copy; its origin remains inspectable. */
export const ProjectDevelopmentSchema = z.object({ sourceProjectId: z.string().min(1), pluginId: z.string().min(1), ownerId: z.string().min(1), sourcePath: z.string().min(1), createdAt: z.string().datetime() }).strict();
export const ForkProjectSchema = z.object({ sourceProjectId: z.string().min(1).max(128), pluginId: z.string().min(1).max(128), label: z.string().trim().min(1).max(120).optional() }).strict();
export const ProjectSchema = z.object({ id: z.string(), label: z.string().min(1).max(120), base: z.boolean(), development: ProjectDevelopmentSchema.optional(), location: z.string(), available: z.boolean().optional(), preparation: z.object({ status: z.enum(['ready', 'attention']), message: z.string() }).optional(), workspaceId:z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
export type Project = z.infer<typeof ProjectSchema>;
export const CreateProjectSchema = z.object({ id: ProjectSlugSchema, label: z.string().trim().min(1).max(120) }).strict();
export const OpenProjectSchema = z.object({ path: z.string().min(1).max(4096), label: z.string().trim().min(1).max(120).optional() }).strict();
export const ProjectFileSchema = z.object({ path: z.string(), kind: z.enum(['file','directory']), bytes: z.number().int().nonnegative(), editable: z.boolean() }).strict();
export const ProjectTreeSchema = z.object({ project: ProjectSchema, revision: z.string().regex(/^[a-f0-9]{64}$/), scannedAt: z.string().datetime(), entries: z.array(ProjectFileSchema).max(5000), graph: RegistryGraphSchema }).strict();
export type ProjectTree = z.infer<typeof ProjectTreeSchema>;
export const ProjectTextSchema = z.object({ path: z.string(), text: z.string().max(131072), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type ProjectText = z.infer<typeof ProjectTextSchema>;
export const WriteProjectFileSchema = z.object({ projectId: z.string(), path: z.string().min(1).max(512), text: z.string().max(131072), expectedHash: z.string().regex(/^[a-f0-9]{64}$/).nullable() }).strict();
export type WriteProjectFile = z.infer<typeof WriteProjectFileSchema>;
export interface ProjectService {
  /** Staging is data; promotion never installs or executes a plugin. */
  preimp?(projectId: string, command: PreimpCommand): Promise<PreimpSnapshot>;
  /** Create an isolated runnable source copy before publishing its project identity. */
  fork?(command: z.infer<typeof ForkProjectSchema>): Promise<Project>;
  open?(command: z.infer<typeof OpenProjectSchema>): Promise<Project>;
  forget?(projectId:string): Promise<void>;
  /** Archive only catalog-owned development copies; callers must stop active project work first. */
  deleteThread?(projectId: string): Promise<void>;
  list(): Promise<Project[]>;
  create(command: z.infer<typeof CreateProjectSchema>): Promise<Project>;
  inspect(projectId: string): Promise<ProjectTree>;
  read(projectId: string, path: string): Promise<ProjectText>;
  write(command: WriteProjectFile): Promise<ProjectText>;
  createModule(projectId: string, path: string): Promise<{ paths: string[] }>;
}

export interface ProjectCatalog extends ProjectService {
  open(command: z.infer<typeof OpenProjectSchema>): Promise<Project>;
  forget(projectId: string): Promise<void>;
  /** Host-only root resolution. Never accept an arbitrary path in place of a project ID. */
  root(projectId: string): Promise<string>;
}
