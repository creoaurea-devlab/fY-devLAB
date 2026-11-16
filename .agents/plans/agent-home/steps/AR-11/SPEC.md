# AR-11 — Write one task per folder through the existing planner interface

Disposition: reviewed refinement of existing pending task. Canonical intent comes from the selected shared planner and this folder’s `step.yaml`; this specification becomes its reviewed `spec` link through the shared CAS writer. No status is stored here.

Routing: resolve the current owner, role, domain skills and prerequisites from [step.yaml](step.yaml).

Prerequisites: the current canonical definition owns these; preserve its real handoffs.

## Outcome and implementation boundary

Adapt the current writer rather than introducing another independently writable planner. Before activation it continues using legacy JSON and can generate validated staged folder output. The target authority separates per-task files from group references and operational reports. Use the shared trusted parse/write facility with bounded asynchronous calls; never repeat synchronous YAML parsing for each field or module.

## Exact candidate reads

- plugins/planning-local/src/store.ts
- plugins/planning-local/src/index.ts
- packages/contracts/src/planner.ts
- packages/contracts/src/agent-definitions.ts
- .context/state/tasks.json
- .context/state/progress.json

## Exact candidate writes

- plugins/planning-local/src/store.ts
- plugins/planning-local/src/index.ts

## Acceptance

- AH-02: Existing PlannerWorkspaceService interface serves definitions from the selected authority and exposes revisions/digests consistently.
- AH-07: Each canonical task has exactly one authoritative full step.yaml after activation; hierarchy/catalog stores references rather than repeated task bodies.
- AH-08: Existing lock/journal/CAS/replay protections cover multi-file create/edit/move/import and operational report updates, including interrupted writes.
- AH-09: Explicit conversion preserves every current ID, hierarchy, dependency, report provenance and reference; no silent bulk completion.

## Failure behavior

- Stale digest, replay payload mismatch and external edit fail without losing the proposal.
- Partial multi-file writes recover or stop with precise retained artifacts.
- Unsupported source/report semantics must be retained or explicitly resolved before activation.

## Verification and completion

Selected verification level: **targeted**, justified by the changed contracts/data/resource risks. Run only relevant declared checks and document assessment for prose portions.

- `node --test scripts/planning.test.ts`
- `node --test scripts/agent-definitions.test.ts`

Commands are intended future checks, not evidence already executed. AGH-01 creates the new contract/fixture probes. AR-21 owns later integration and version-assertion edits; request that owner before changing shared tests. Missing required behavior coverage is a bounded verification substep, not permission to weaken acceptance or invent passing checks.

Completion evidence records actual inputs/generation, command outcomes or supported review assessment, source hashes, four-group memory review and remaining limits. Existing Running/Review work needs a real handoff; empty claims do not release it.

## Rollback

Re-read current source and preserve work created after preflight; restore only this owner’s bounded files from the verified source snapshot. Runtime/data rollback restores matching code/configuration plus an online SQLite backup, preserving post-cutover work first.

[Specification](../../SPEC.md) · [Roadmap](../../ROADMAP.md)
