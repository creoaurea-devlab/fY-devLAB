Portable bundle migration already owns population.ts and includes the unused YAML-import correction. Broad startup fixture AR-03/AR-06 sequence is not a prerequisite for this source migration.

# AR-20 — Package the portable agent home with one selected runtime

Disposition: reviewed refinement of existing pending task. Canonical intent comes from the selected shared planner and this folder’s `step.yaml`; this specification becomes its reviewed `spec` link through the shared CAS writer. No status is stored here.

Routing: resolve the current owner, role, domain skills and prerequisites from [step.yaml](step.yaml).

Prerequisites: the current canonical definition owns these; preserve its real handoffs.

## Outcome and implementation boundary

Generate bundle discovery from the installed canonical definition sources and verified package manifest. Update project setup instructions and reader detection together. Keep external .wisdohm compatibility only while selected callers require it; there is one active implementation and one authority manifest.

## Exact candidate reads

- plugins/wisdom-tool/src/bundle.json
- plugins/wisdom-tool/src/population.ts
- plugins/wisdom-tool/src/index.ts
- .agents/plans/authority.yaml

## Exact candidate writes

- plugins/wisdom-tool/src/bundle.json
- plugins/wisdom-tool/src/population.ts
- plugins/wisdom-tool/src/index.ts
- plugins/wisdom-tool/SETUP.md

## Acceptance

- AH-10: Portable bundle contains reviewed .agents role/workflow/skill/runtime sources and no populated database, secrets or devLAB absolute paths.
- AH-09: Existing custom targets receive reviewed conflicts, not wholesale runtime replacement.
- AH-08: Interrupted setup/repair preserves a recoverable chosen authority and reports actual partial state.

## Failure behavior

- Drifted proposal, unsafe parent path and competing target activity abort before overwriting authority.
- Blanket cleanup of locks/data or source project history is forbidden; preserve meaningful partial state.

## Verification and completion

Selected verification level: **targeted**, justified by the changed contracts/data/resource risks. Run only relevant declared checks and document assessment for prose portions.

- `node --test scripts/wisdom.test.ts scripts/wisdom-healing.test.ts`

Commands are intended future checks, not evidence already executed. AGH-01 creates the new contract/fixture probes. AR-21 owns later integration and version-assertion edits; request that owner before changing shared tests. Missing required behavior coverage is a bounded verification substep, not permission to weaken acceptance or invent passing checks.

Completion evidence records actual inputs/generation, command outcomes or supported review assessment, source hashes, four-group memory review and remaining limits. Existing Running/Review work needs a real handoff; empty claims do not release it.

## Rollback

Re-read current source and preserve work created after preflight; restore only this owner’s bounded files from the verified source snapshot. Runtime/data rollback restores matching code/configuration plus an online SQLite backup, preserving post-cutover work first.

[Specification](../../SPEC.md) · [Roadmap](../../ROADMAP.md)
