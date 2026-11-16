import { z } from 'zod';

// Keep the existing public planner IDs. The older Python session ID limit is a
// separate runtime compatibility concern, not a reason to rewrite task IDs.
export const AgentDefinitionIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/);

const confined = (value: string, pattern: boolean) => {
  if (!value || value.length > 1024 || /[\u0000-\u001f\u007f-\u009f\\:]/.test(value) || value.startsWith('/')) return false;
  const parts = (pattern && value.endsWith('/') ? value.slice(0, -1) : value).split('/');
  return parts.every(part => part && part !== '.' && part !== '..');
};

/** Lexical relative paths only; the trusted loader still checks filesystem aliases. */
export const AgentRelativePathSchema = z.string().min(1).max(1024)
  .refine(value => confined(value, false) && !/[*?\[\]]/.test(value), 'Expected an exact confined relative path');

/** Supported ownership syntax: literal text, * and ?, plus a directory-ending /. */
export const OwnershipPatternSchema = z.string().min(1).max(1024)
  .refine(value => confined(value, true) && !/[\[\]{}]/.test(value), 'Expected a confined ownership pattern using only * and ?');

const unique = (values: string[]) => new Set(values).size === values.length;
const relativePaths = z.array(AgentRelativePathSchema).max(1000).refine(unique, 'Paths must be unique');

export const OwnershipSegmentSchema = z.object({
  schema_version: z.literal(1),
  id: AgentDefinitionIdSchema,
  group: AgentDefinitionIdSchema.optional(),
  purpose: z.string().trim().min(1).max(4000),
  paths: z.array(OwnershipPatternSchema).min(1).max(1000).refine(unique, 'Ownership patterns must be unique'),
  public: relativePaths,
  uses: z.array(AgentDefinitionIdSchema).max(1000).refine(unique, 'Dependencies must be unique'),
  guidance: relativePaths,
}).strict();
export type OwnershipSegment = z.infer<typeof OwnershipSegmentSchema>;

// Greedy glob matching keeps untrusted wildcard sequences out of a backtracking
// regular expression. Like the current Python matcher, * can cross a slash.
function globMatches(path: string, pattern: string): boolean {
  const characters = Array.from(path);
  const tokens = Array.from(pattern);
  let position = 0, token = 0, star = -1, retry = 0;
  while (position < characters.length) {
    if (tokens[token] === '?' || tokens[token] === characters[position]) {
      position++; token++;
    } else if (tokens[token] === '*') {
      star = token++; retry = position;
    } else if (star >= 0) {
      token = star + 1; position = ++retry;
    } else return false;
  }
  while (tokens[token] === '*') token++;
  return token === tokens.length;
}

/** Match data only; ownership uniqueness and dependency validity need the full catalog. */
export function ownershipMatchesPath(path: string, pattern: string): boolean {
  if (!AgentRelativePathSchema.safeParse(path).success || !OwnershipPatternSchema.safeParse(pattern).success) return false;
  if (pattern.endsWith('/')) return path === pattern.slice(0, -1) || path.startsWith(pattern);
  return globMatches(path, pattern) || (pattern.startsWith('**/') && globMatches(path, pattern.slice(3)));
}
