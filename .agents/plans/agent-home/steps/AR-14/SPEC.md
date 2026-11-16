Migration changes only ownership discovery. Existing14terminal/confinement tests passed; unrelated pending terminal feature work remains in its owner lane and is not reported complete.

# AR-14 — Resolve terminal ownership from the selected grouped definition snapshot

Disposition: reviewed refinement of existing pending task. Canonical intent comes from the selected shared planner and this folder’s `step.yaml`; this specification becomes its reviewed `spec` link through the shared CAS writer. No status is stored here.

Routing: resolve the current owner, role, domain skills and prerequisites from [step.yaml](step.yaml).

Prerequisites: the current canonical definition owns these; preserve its real handoffs.

## Outcome and implementation boundary

Replace the local ownership parser with the selected shared snapshot interface while retaining terminal lifecycle/confinement. Work follows the existing TERM-SERVICE scope/handoff; this task does not independently repair persisted socket identities.

## Exact candidate reads

- plugins/terminal-pty/src/index.ts
- plugins/terminal-pty/src/confinement.ts
- packages/contracts/src/ownership.ts

## Exact candidate writes

- plugins/terminal-pty/src/index.ts

## Acceptance

- AH-06: Effective terminal policy resolves the exact capability paths from one validated selected snapshot; grouping never broadens a terminal grant.
- AH-06: Existing session policy/identity remains immutable across authority refresh and backend restart.
- AH-01: Catalogue reads are bounded/asynchronous and invalidated by source generation rather than repeated YAML subprocesses.

## Failure behavior

- Invalid/missing/ambiguous ownership yields actionable refusal without permissive fallback.
- Refresh never mutates already-issued terminal policy or kills another owner.

## Verification and completion

Selected verification level: **targeted**, justified by the changed contracts/data/resource risks. Run only relevant declared checks and document assessment for prose portions.

- `node --test scripts/terminal-confinement.test.ts scripts/terminal-lease.test.ts`

Commands are intended future checks, not evidence already executed. AGH-01 creates the new contract/fixture probes. AR-21 owns later integration and version-assertion edits; request that owner before changing shared tests. Missing required behavior coverage is a bounded verification substep, not permission to weaken acceptance or invent passing checks.

Completion evidence records actual inputs/generation, command outcomes or supported review assessment, source hashes, four-group memory review and remaining limits. Existing Running/Review work needs a real handoff; empty claims do not release it.

## Rollback

Re-read current source and preserve work created after preflight; restore only this owner’s bounded files from the verified source snapshot. Runtime/data rollback restores matching code/configuration plus an online SQLite backup, preserving post-cutover work first.

[Specification](../../SPEC.md) · [Roadmap](../../ROADMAP.md)
