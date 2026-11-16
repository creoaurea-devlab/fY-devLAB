import { z } from 'zod';

export const ProjectIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const coordinate = z.number().finite().min(-10_000_000).max(10_000_000);
const identifier = z.string().min(1).max(128);
export const CanvasNodeSchema = z
  .object({
    id: identifier,
    type: z.string().min(1).max(128).default('unknown'),
    position: z.object({ x: coordinate, y: coordinate }),
    data: z.record(z.unknown()),
  })
  .passthrough();
export const CanvasEdgeSchema = z
  .object({
    id: identifier,
    source: identifier,
    target: identifier,
    sourceHandle: z.string().nullable().optional(),
    targetHandle: z.string().nullable().optional(),
  })
  .passthrough();

/** Renderer-neutral JSON. Unknown node types and extension fields round-trip. */
export const CanvasGraphSchema = z
  .object({
    name: z.string().trim().min(1).max(200).default('My Agent Flow'),
    nodes: z.array(CanvasNodeSchema).max(2000),
    edges: z.array(CanvasEdgeSchema).max(5000),
    viewport: z
      .object({
        x: coordinate,
        y: coordinate,
        zoom: z.number().finite().min(0.05).max(10),
      })
      .optional(),
  })
  .passthrough()
  .superRefine((graph, context) => {
    const ids = new Set<string>();
    for (const node of graph.nodes) {
      if (ids.has(node.id))
        context.addIssue({ code: 'custom', message: 'Duplicate node ID' });
      ids.add(node.id);
    }
    const edges = new Set<string>();
    for (const edge of graph.edges) {
      if (edges.has(edge.id) || !ids.has(edge.source) || !ids.has(edge.target))
        context.addIssue({
          code: 'custom',
          message: 'Duplicate or dangling edge',
        });
      edges.add(edge.id);
    }
    const queue: [unknown, number][] = [[graph, 0]];
    let count = 0;
    while (queue.length) {
      const [value, depth] = queue.pop()!;
      if (++count > 200_000 || depth > 32) {
        context.addIssue({
          code: 'custom',
          message: 'Graph metadata is too complex',
        });
        break;
      }
      if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'boolean'
      )
        continue;
      if (typeof value === 'number' && Number.isFinite(value)) continue;
      if (Array.isArray(value)) {
        for (const item of value) queue.push([item, depth + 1]);
        continue;
      }
      if (
        typeof value === 'object' &&
        Object.getPrototypeOf(value) === Object.prototype
      ) {
        for (const item of Object.values(value)) queue.push([item, depth + 1]);
        continue;
      }
      context.addIssue({
        code: 'custom',
        message: 'Graph must contain finite JSON values only',
      });
      break;
    }
  })
  .transform((graph) => {
    const result: typeof graph = { ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.type === 'browser') {
        // Browser identity is node.id. Credentials and runtime handles never persist.
        const allowed = ['label','url','mode','width','height','collapsed'];
        return { ...node, data: Object.fromEntries(Object.entries(node.data).filter(([key]) => allowed.includes(key))) };
      }
      if (node.type !== 'terminal') return node;
      // Saved renderer data must never resurrect an old process/session identity.
      const data = { ...node.data };
      delete data.sessionId;
      delete data.ptyId;
      delete data.terminalId;
      return { ...node, data: { ...data, status: 'idle' } };
    }),
    };
    return result;
  });
export type CanvasGraph = z.infer<typeof CanvasGraphSchema>;
export type CanvasNode = z.infer<typeof CanvasNodeSchema>;
export const SaveCanvasSchema = z
  .object({
    projectId: ProjectIdSchema,
    expectedRevision: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 1),
    graph: CanvasGraphSchema,
  })
  .strict();
export type SaveCanvas = z.infer<typeof SaveCanvasSchema>;
export const CanvasDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: ProjectIdSchema,
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    graph: CanvasGraphSchema,
  })
  .strict();
export type CanvasDocument = z.infer<typeof CanvasDocumentSchema>;
/** expectedRevision=0 creates; conflicting writes fail with REVISION_CONFLICT. */
export interface CanvasStore {
  load(projectId: string): Promise<CanvasDocument | null>;
  save(command: SaveCanvas): Promise<CanvasDocument>;
}
