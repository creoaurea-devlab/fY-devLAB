# AGH-02 — Store reported workflow state independently from definition projections

Disposition: new gap with separate owner responsibility. Canonical intent comes from the selected shared planner and this folder’s `step.yaml`; this specification becomes its reviewed `spec` link through the shared CAS writer. No status is stored here.

Routing: resolve the current owner, role, domain skills and prerequisites from [step.yaml](step.yaml).

Prerequisites: the current canonical definition owns these; preserve its real handoffs.

## Outcome and implementation boundary

Add the operational storage required by the current product DTO before planner cutover. Keep source definitions outside SQL authority after activation; persist workflow reports separately from disposable definition caches. Use explicit schema upgrade and rollback with review of version-specific assertions by the verification owner. Old schema remains readable in compatibility mode until activation.

## Exact candidate reads

- .wisdohm/store.py
- .wisdohm/session.py
- packages/contracts/src/planner.ts
- scripts/agent-home-fixture.py

## Exact candidate writes

- .wisdohm/store.py
- .wisdohm/session.py

## Acceptance

- AH-08: Reported progress/order/idempotency history migrates into explicit operational storage without fake execution sessions or promotion to verified evidence.
- AH-08: Versioned transactional upgrade preserves sessions, notes/events, reports, claims and prior failed checks; online backup precedes upgrade.
- AH-07: Definition SQL rows are identified as derived projections after activation; refreshing them cannot erase reports or execution evidence.
- AH-03: Source review, assessed discovery and executed checks have supported finish semantics matched to the declared verification choice.

## Failure behavior

- Unknown schema, import conflict and interruption roll back the whole operational transaction.
- Missing actual context remains visibly unknown under advisory policy.
- Failed required check or stale input cannot be closed by changing a report.

## Verification and completion

Selected verification level: **targeted**, justified by the changed contracts/data/resource risks. Run only relevant declared checks and document assessment for prose portions.

- `python3 -B scripts/wisdohm27.test.py`
- `python3 -B scripts/agent-home-fixture.py --self-check`

Commands are intended future checks, not evidence already executed. AGH-01 creates the new contract/fixture probes. AR-21 owns later integration and version-assertion edits; request that owner before changing shared tests. Missing required behavior coverage is a bounded verification substep, not permission to weaken acceptance or invent passing checks.

Completion evidence records actual inputs/generation, command outcomes or supported review assessment, source hashes, four-group memory review and remaining limits. Existing Running/Review work needs a real handoff; empty claims do not release it.

## Rollback

Re-read current source and preserve work created after preflight; restore only this owner’s bounded files from the verified source snapshot. Runtime/data rollback restores matching code/configuration plus an online SQLite backup, preserving post-cutover work first.

[Specification](../../SPEC.md) · [Roadmap](../../ROADMAP.md)
