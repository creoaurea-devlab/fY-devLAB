# AR-16 — Build every Codex dispatch from agent-home definitions and real claims

Disposition: reviewed refinement of existing pending task. Canonical intent comes from the selected shared planner and this folder’s `step.yaml`; this specification becomes its reviewed `spec` link through the shared CAS writer. No status is stored here.

Routing: resolve the current owner, role, domain skills and prerequisites from [step.yaml](step.yaml).

Prerequisites: the current canonical definition owns these; preserve its real handoffs.

## Outcome and implementation boundary

Connect current single-task runner to the common file definitions; keep provider process adapter and current account/queue UI contracts. Reuse TH-17 scheduler safety instead of writing another scheduler. Domain profiles contribute skills; role×domain combinations do not become a growing profile matrix. Read-only reviewer/diagnosis behavior and no target-code execution remain enforced.

## Exact candidate reads

- plugins/codex-harness/src/service.ts
- packages/contracts/src/harness.ts
- packages/contracts/src/agent-definitions.ts
- .agents/guides/VERIFICATION.md

## Exact candidate writes

- plugins/codex-harness/src/service.ts
- plugins/codex-harness/src/service.test.ts

## Acceptance

- AH-01: Ordinary implementation and triage both load canonical step, workflow, role, ownership/domain skills and source generation through the same resolver.
- AH-11: Dispatch rechecks current task digest, prerequisites, active/review handoffs and exact claims before starting the provider turn.
- AH-11: A real step-bound WISDOHM session is created and claimed before provider execution; ambiguous launch/cancellation retains recoverable identity.
- AH-03: Harness selects evidence requirements from structured verification policy; it does not demand tests for every prose task or equate provider exit0 with verified completion.

## Failure behavior

- Stale scope, conflicting claim or unresolved handoff prevents turn/start.
- Failed or uncertain session/provider creation can be reconciled without duplicate execution.
- Context remains unknown under advisory policy; measured threshold crossings still checkpoint.

## Verification and completion

Selected verification level: **targeted**, justified by the changed contracts/data/resource risks. Run only relevant declared checks and document assessment for prose portions.

- `node --test plugins/codex-harness/src/service.test.ts scripts/harness-http.test.ts`

Commands are intended future checks, not evidence already executed. AGH-01 creates the new contract/fixture probes. AR-21 owns later integration and version-assertion edits; request that owner before changing shared tests. Missing required behavior coverage is a bounded verification substep, not permission to weaken acceptance or invent passing checks.

Completion evidence records actual inputs/generation, command outcomes or supported review assessment, source hashes, four-group memory review and remaining limits. Existing Running/Review work needs a real handoff; empty claims do not release it.

## Rollback

Re-read current source and preserve work created after preflight; restore only this owner’s bounded files from the verified source snapshot. Runtime/data rollback restores matching code/configuration plus an online SQLite backup, preserving post-cutover work first.

[Specification](../../SPEC.md) · [Roadmap](../../ROADMAP.md)
