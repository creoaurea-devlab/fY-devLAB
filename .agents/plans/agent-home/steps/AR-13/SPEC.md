# AR-13 — Activate file definitions after a reviewed migration and restore rehearsal

Disposition: reviewed refinement of existing pending task. Canonical intent comes from the selected shared planner and this folder’s `step.yaml`; this specification becomes its reviewed `spec` link through the shared CAS writer. No status is stored here.

Routing: resolve the current owner, role, domain skills and prerequisites from [step.yaml](step.yaml).

Prerequisites: the current canonical definition owns these; preserve its real handoffs.

## Outcome and implementation boundary

Coordinate the cutover using the AR-11/12 writer and an explicit authority manifest, not direct rewrites. The manifest owns only source selection/version, never task bodies or status. Preserve the current operational state until all required consumers agree on the selected generation; derive compatibility exports while their readers still need them. This is a separately reviewed activation, not implied by creating folder templates.

## Exact candidate reads

- .context/protocols/plan.md
- .context/state/tasks.json
- .context/state/progress.json
- .agents/plans/agent-home/SPEC.md
- scripts/planner.ts

## Exact candidate writes

- .agents/plans/authority.yaml
- .context/protocols/plan.md
- AGENTS.md

## Acceptance

- AH-07: Authority selection changes only after a full source/data snapshot and a disposable conversion/restore rehearsal.
- AH-09: All current definitions/reports and protected Running/Review handoffs are compared against fresh preflight digests; bindings become full step definitions exactly once.
- AH-07: Old JSON/ownership representations become read-only derived views or preserved import provenance, with no competing editable source.
- AH-10: Root instructions name one supported entry path and distinguish staged guidance from activated runtime behavior.
- AH-07: Activation waits for terminal/project/harness and trusted-observer parity with the staged source generation; unsupported consumers retain a generated read-only view and cannot edit old definitions.

## Failure behavior

- New work or report changes after preflight require a fresh snapshot/reconciliation.
- No old Running/Review owner is released merely because claims are empty.
- Failed restore rehearsal leaves current JSON writer active and reports the precise failure.

## Verification and completion

Selected verification level: **integration**, justified by the changed contracts/data/resource risks. Run only relevant declared checks and document assessment for prose portions.

- `node scripts/planner.ts --root . snapshot`
- `python3 .agents/plans/agent-home/validate.py --root .`

Commands are intended future checks, not evidence already executed. AGH-01 creates the new contract/fixture probes. AR-21 owns later integration and version-assertion edits; request that owner before changing shared tests. Missing required behavior coverage is a bounded verification substep, not permission to weaken acceptance or invent passing checks.

Completion evidence records actual inputs/generation, command outcomes or supported review assessment, source hashes, four-group memory review and remaining limits. Existing Running/Review work needs a real handoff; empty claims do not release it.

## Rollback

Re-read current source and preserve work created after preflight; restore only this owner’s bounded files from the verified source snapshot. Runtime/data rollback restores matching code/configuration plus an online SQLite backup, preserving post-cutover work first.

[Specification](../../SPEC.md) · [Roadmap](../../ROADMAP.md)
