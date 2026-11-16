# AGH-01 — Create contract and migration fixtures for the shared definitions

Disposition: new gap with separate owner responsibility. Canonical intent comes from the selected shared planner and this folder’s `step.yaml`; this specification becomes its reviewed `spec` link through the shared CAS writer. No status is stored here.

Routing: resolve the current owner, role, domain skills and prerequisites from [step.yaml](step.yaml).

Prerequisites: the current canonical definition owns these; preserve its real handoffs.

## Outcome and implementation boundary

Create reusable disposable fixtures and executable contract checks before consumers add their behavior. A passing fixture check proves its setup/expected data only. New consumer behavior is tested by AR-21 after implementation; it is never counted as already passing or skipped into completion.

## Exact candidate reads

- packages/contracts/src/agent-definitions.ts
- .agents/plans/agent-home/SPEC.md
- scripts/wisdohm27.test.py
- scripts/planning.test.ts

## Exact candidate writes

- scripts/agent-definitions.test.ts
- scripts/agent-home-fixture.py

## Acceptance

- AH-01: Fixtures validate the approved DTO and contain a representative existing plan, reports, source hashes and pending/running/review cases.
- AH-05: Malformed, duplicate, escaping, symlinked, stale-revision and colliding ownership examples are independently specified.
- AH-03: Review-only prose, read-only audit and behavior-changing bugfix examples have different meaningful evidence requirements.

## Failure behavior

- Fixture self-check fails on mismatched IDs/reports/hash baseline.
- No check touches the live database, drafts, provider account or release source.

## Verification and completion

Selected verification level: **targeted**, justified by the changed contracts/data/resource risks. Run only relevant declared checks and document assessment for prose portions.

- `node --test scripts/agent-definitions.test.ts`
- `python3 -B scripts/agent-home-fixture.py --self-check`

Commands are intended future checks, not evidence already executed. AGH-01 creates the new contract/fixture probes. AR-21 owns later integration and version-assertion edits; request that owner before changing shared tests. Missing required behavior coverage is a bounded verification substep, not permission to weaken acceptance or invent passing checks.

Completion evidence records actual inputs/generation, command outcomes or supported review assessment, source hashes, four-group memory review and remaining limits. Existing Running/Review work needs a real handoff; empty claims do not release it.

## Rollback

Re-read current source and preserve work created after preflight; restore only this owner’s bounded files from the verified source snapshot. Runtime/data rollback restores matching code/configuration plus an online SQLite backup, preserving post-cutover work first.

[Specification](../../SPEC.md) · [Roadmap](../../ROADMAP.md)
