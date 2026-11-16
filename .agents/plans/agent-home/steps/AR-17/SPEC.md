# AR-17 — Observe agent-home definitions and operational evidence without executing project code

Disposition: reviewed refinement of existing pending task. Canonical intent comes from the selected shared planner and this folder’s `step.yaml`; this specification becomes its reviewed `spec` link through the shared CAS writer. No status is stored here.

Routing: resolve the current owner, role, domain skills and prerequisites from [step.yaml](step.yaml).

Prerequisites: the current canonical definition owns these; preserve its real handoffs.

## Outcome and implementation boundary

Stage the existing trusted observer to decode both selected authorities and both old/new control paths before activation, independently of project-executable code. Use installed schemas/bounded reads, not importing .agents/runtime/definitions.py from the selected project. Preserve actual read-only database bytes and existing2.6/2.7 compatibility until retired explicitly.

## Exact candidate reads

- plugins/rules-local/src/read-memory.py
- plugins/rules-local/src/snapshot.ts
- packages/contracts/src/rules.ts
- .agents/plans/authority.yaml

## Exact candidate writes

- plugins/rules-local/src/read-memory.py

## Acceptance

- AH-12: Installed trusted reader inspects versioned agent-home files and operational SQLite read-only; it never imports or launches selected-project runtime code.
- AH-03: Review-assessed, reported, historical, stale, verified and integrated results remain visibly distinct.
- AH-12: Limits/truncation, unknown source versions and external workspaces remain disclosed rather than promoted to current evidence.
- AH-12: Stage dual-source/dual-control-path observation before activation; old authority remains correctly observed until selection changes, then the same trusted reader observes .agents without executable imports.
- AH-12: Limit this change to the trusted reader; AR-05 retains snapshot interpreter and README ownership, avoiding an unrelated startup-chain dependency or concurrent source edits.

## Failure behavior

- Malicious Python, symlinks, hardlinks, secret paths and malformed/oversized inputs cannot execute or escape inspection.
- Absent required bindings become unverified, never silently current.

## Verification and completion

Selected verification level: **targeted**, justified by the changed contracts/data/resource risks. Run only relevant declared checks and document assessment for prose portions.

- `node --test scripts/rules.test.ts`
- `python3 -B scripts/rules27.test.py`

Commands are intended future checks, not evidence already executed. AGH-01 creates the new contract/fixture probes. AR-21 owns later integration and version-assertion edits; request that owner before changing shared tests. Missing required behavior coverage is a bounded verification substep, not permission to weaken acceptance or invent passing checks.

Completion evidence records actual inputs/generation, command outcomes or supported review assessment, source hashes, four-group memory review and remaining limits. Existing Running/Review work needs a real handoff; empty claims do not release it.

## Rollback

Re-read current source and preserve work created after preflight; restore only this owner’s bounded files from the verified source snapshot. Runtime/data rollback restores matching code/configuration plus an online SQLite backup, preserving post-cutover work first.

[Specification](../../SPEC.md) · [Roadmap](../../ROADMAP.md)
