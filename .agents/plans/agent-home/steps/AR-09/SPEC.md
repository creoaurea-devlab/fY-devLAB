# AR-09 — Define one file-based agent/step contract and proportional evidence model

Disposition: reviewed refinement of existing pending task. Canonical intent comes from the selected shared planner and this folder’s `step.yaml`; this specification becomes its reviewed `spec` link through the shared CAS writer. No status is stored here.

Routing: resolve the current owner, role, domain skills and prerequisites from [step.yaml](step.yaml).

Prerequisites: the current canonical definition owns these; preserve its real handoffs.

## Outcome and implementation boundary

Freeze consumer-focused data contracts before loader/writer work. Map legacy effect=feature/bugfix/read_only deliberately; do not infer write permission from kind. Derive supported kind names from versioned workflow definitions. Review completion is supported as a real evidence variant; executable source checks remain required until the runtime adopts that contract.

## Exact candidate reads

- packages/contracts/src/planner.ts
- packages/contracts/src/rules.ts
- .wisdohm/planning.py
- .agents/guides/VERIFICATION.md

## Exact candidate writes

- packages/contracts/src/agent-definitions.ts
- packages/contracts/src/ownership.ts
- packages/contracts/src/planner.ts
- packages/contracts/src/rules.ts
- packages/contracts/src/index.ts

## Acceptance

- AH-01: Define versioned role, kind/workflow, ownership segment and canonical step DTOs; distinguish task kind from permitted effect.
- AH-02: Canonical step fields are id, kind, effect, owner, read/write scope, prerequisites, acceptance and structured verification; ID/hierarchy remain stable.
- AH-03: Verification supports reasoned review, smoke, targeted and integration evidence. Low-risk prose accepts attributed assessment; no fabricated command or automatic suite requirement.
- AH-04: Exported/browser contracts contain data only; reported status, assessed outcome and verified execution remain distinct.

## Failure behavior

- Unknown versions/fields, unsafe paths, unknown owner/kind and incompatible legacy values produce explicit validation errors.
- Conflicting task/kind/effect combinations are rejected without rewriting input.
- Prose review cannot substitute for required behavior/resource checks.

## Verification and completion

Selected verification level: **targeted**, justified by the changed contracts/data/resource risks. Run only relevant declared checks and document assessment for prose portions.

- `./node_modules/.bin/tsc --noEmit`
- `node --test scripts/process.test.ts`

Commands are intended future checks, not evidence already executed. AGH-01 creates the new contract/fixture probes. AR-21 owns later integration and version-assertion edits; request that owner before changing shared tests. Missing required behavior coverage is a bounded verification substep, not permission to weaken acceptance or invent passing checks.

Completion evidence records actual inputs/generation, command outcomes or supported review assessment, source hashes, four-group memory review and remaining limits. Existing Running/Review work needs a real handoff; empty claims do not release it.

## Rollback

Re-read current source and preserve work created after preflight; restore only this owner’s bounded files from the verified source snapshot. Runtime/data rollback restores matching code/configuration plus an online SQLite backup, preserving post-cutover work first.

[Specification](../../SPEC.md) · [Roadmap](../../ROADMAP.md)
