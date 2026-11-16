# AR-15 — Resolve project-copy ownership from the selected definition snapshot

Disposition: reviewed refinement of existing pending task. Canonical intent comes from the selected shared planner and this folder’s `step.yaml`; this specification becomes its reviewed `spec` link through the shared CAS writer. No status is stored here.

Routing: resolve the current owner, role, domain skills and prerequisites from [step.yaml](step.yaml).

Prerequisites: the current canonical definition owns these; preserve its real handoffs.

## Outcome and implementation boundary

Adapt only ownership discovery in the existing copy implementation. Keep current public ProjectService behavior, original source/data protections and archive lifecycle. Source-map readers may consume generated exact-file compatibility views until their own owner adopts the resolver.

## Exact candidate reads

- plugins/project-local/src/fork.ts
- packages/contracts/src/ownership.ts

## Exact candidate writes

- plugins/project-local/src/fork.ts

## Acceptance

- AH-06: Development-copy owner/path lookup uses the same selected capability generation as path routing.
- AH-09: Fork provenance, source isolation, protected backup roots and stale-write errors retain their behavior.

## Failure behavior

- Escaping paths, unknown owner/plugin and changed source generation refuse publication without partial copies.

## Verification and completion

Selected verification level: **targeted**, justified by the changed contracts/data/resource risks. Run only relevant declared checks and document assessment for prose portions.

- `node --test scripts/project-development.test.ts scripts/project-thread-delete.test.ts`

Commands are intended future checks, not evidence already executed. AGH-01 creates the new contract/fixture probes. AR-21 owns later integration and version-assertion edits; request that owner before changing shared tests. Missing required behavior coverage is a bounded verification substep, not permission to weaken acceptance or invent passing checks.

Completion evidence records actual inputs/generation, command outcomes or supported review assessment, source hashes, four-group memory review and remaining limits. Existing Running/Review work needs a real handoff; empty claims do not release it.

## Rollback

Re-read current source and preserve work created after preflight; restore only this owner’s bounded files from the verified source snapshot. Runtime/data rollback restores matching code/configuration plus an online SQLite backup, preserving post-cutover work first.

[Specification](../../SPEC.md) · [Roadmap](../../ROADMAP.md)
