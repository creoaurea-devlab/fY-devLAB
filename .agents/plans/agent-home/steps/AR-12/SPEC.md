# AR-12 — Expose the same agent-home writer through the existing CLI

Disposition: reviewed refinement of existing pending task. Canonical intent comes from the selected shared planner and this folder’s `step.yaml`; this specification becomes its reviewed `spec` link through the shared CAS writer. No status is stored here.

Routing: resolve the current owner, role, domain skills and prerequisites from [step.yaml](step.yaml).

Prerequisites: the current canonical definition owns these; preserve its real handoffs.

## Outcome and implementation boundary

Keep existing CLI command behavior and JSON envelopes compatible while adding any explicit prepare/activate operation through the same service. Validate root, size, revisions and task identity before mutation; avoid a second folder-import utility with its own write semantics.

## Exact candidate reads

- scripts/planner.ts
- plugins/planning-local/src/index.ts
- packages/contracts/src/planner.ts

## Exact candidate writes

- scripts/planner.ts

## Acceptance

- AH-07: Offline CLI and application use the same selected definition/report writer and conflict semantics.
- AH-09: Snapshot is read-only; import/export identifies source authority and provenance and preserves canonical task IDs.
- AH-03: CLI accepts supported assessment evidence without demanding invented shell checks for low-risk prose.

## Failure behavior

- Malformed/oversized/cross-project input and stale selection are refused without writes.
- Ambiguous activation remains a recoverable checkpoint.

## Verification and completion

Selected verification level: **targeted**, justified by the changed contracts/data/resource risks. Run only relevant declared checks and document assessment for prose portions.

- `node scripts/planner.ts --root . snapshot`
- `node --test scripts/planning.test.ts`

Commands are intended future checks, not evidence already executed. AGH-01 creates the new contract/fixture probes. AR-21 owns later integration and version-assertion edits; request that owner before changing shared tests. Missing required behavior coverage is a bounded verification substep, not permission to weaken acceptance or invent passing checks.

Completion evidence records actual inputs/generation, command outcomes or supported review assessment, source hashes, four-group memory review and remaining limits. Existing Running/Review work needs a real handoff; empty claims do not release it.

## Rollback

Re-read current source and preserve work created after preflight; restore only this owner’s bounded files from the verified source snapshot. Runtime/data rollback restores matching code/configuration plus an online SQLite backup, preserving post-cutover work first.

[Specification](../../SPEC.md) · [Roadmap](../../ROADMAP.md)
