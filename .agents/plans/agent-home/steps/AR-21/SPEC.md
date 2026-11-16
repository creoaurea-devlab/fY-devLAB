# AR-21 — Prove the combined file-authority migration and retire competing definitions

Disposition: reviewed refinement of existing pending task. Canonical intent comes from the selected shared planner and this folder’s `step.yaml`; this specification becomes its reviewed `spec` link through the shared CAS writer. No status is stored here.

Routing: resolve the current owner, role, domain skills and prerequisites from [step.yaml](step.yaml).

Prerequisites: the current canonical definition owns these; preserve its real handoffs.

## Outcome and implementation boundary

Own substantive migration/dispatch/race tests and version-specific assertion updates, retaining safety regressions. Check source-map/Process/package consumers through the generated compatibility view where their separate owner migration is pending. Retire obsolete editable definition copies through their owning modules only after consumer inventory and source-generation parity are proven. Broad build/full-suite checks belong to this combined source delivery or actual affected interfaces, not every task.

## Exact candidate reads

- .agents/plans/agent-home/SPEC.md
- packages/contracts/src/agent-definitions.ts
- scripts/planner.ts
- plugins/rules-local/src/read-memory.py
- scripts/agent-home-fixture.py

## Exact candidate writes

- scripts/agent-home-runtime.test.py
- scripts/agent-home.test.ts
- scripts/wisdohm27.test.py
- scripts/planning.test.ts
- scripts/rules.test.ts
- scripts/wisdom.test.ts
- scripts/maintenance.test.ts
- scripts/ui-elements.test.ts

## Acceptance

- AH-07: Every selected harness/planner/reader agrees on source generation and no independently editable legacy definition source remains.
- AH-08: Disposable real-data upgrade and restore preserve all current IDs/reports/session history/claims and fail safely on interruption or concurrent source edits.
- AH-11: Bugfix and read-only audit complete through actual dispatch/session/evidence paths; wrong-owner/stale input/active-handoff collisions are rejected.
- AH-03: A low-risk prose step completes with supported attributed review; behavioral/runtime steps require their meaningful checks.
- AH-12: Trusted Rules Board cannot execute malicious selected-project code; full UI retention/keyboard/failure probes run only for changed interactions.

## Failure behavior

- A failed check remains failed; no fake true command or provider-success report closes the run.
- A mismatch leaves selected authority recoverable and preserves proposals/check outputs.
- Deployment and live provider/account work are separate acceptance only if authorized.

## Verification and completion

Selected verification level: **integration**, justified by the changed contracts/data/resource risks. Run only relevant declared checks and document assessment for prose portions.

- `python3 -B scripts/agent-home-runtime.test.py`
- `node --test scripts/agent-home.test.ts scripts/agent-definitions.test.ts scripts/planning.test.ts scripts/rules.test.ts scripts/wisdom.test.ts scripts/maintenance.test.ts scripts/ui-elements.test.ts`
- `./node_modules/.bin/tsc --noEmit`

Commands are intended future checks, not evidence already executed. AGH-01 creates the new contract/fixture probes. AR-21 owns later integration and version-assertion edits; request that owner before changing shared tests. Missing required behavior coverage is a bounded verification substep, not permission to weaken acceptance or invent passing checks.

Completion evidence records actual inputs/generation, command outcomes or supported review assessment, source hashes, four-group memory review and remaining limits. Existing Running/Review work needs a real handoff; empty claims do not release it.

## Rollback

Re-read current source and preserve work created after preflight; restore only this owner’s bounded files from the verified source snapshot. Runtime/data rollback restores matching code/configuration plus an online SQLite backup, preserving post-cutover work first.

[Specification](../../SPEC.md) · [Roadmap](../../ROADMAP.md)
