# AGH-03 — Relocate the control runtime and policy into the agent home

Disposition: new gap with separate owner responsibility. Canonical intent comes from the selected shared planner and this folder’s `step.yaml`; this specification becomes its reviewed `spec` link through the shared CAS writer. No status is stored here.

Routing: resolve the current owner, role, domain skills and prerequisites from [step.yaml](step.yaml).

Prerequisites: the current canonical definition owns these; preserve its real handoffs.

## Outcome and implementation boundary

Move the installed control runtime as a separately recoverable change after definition cutover. Preserve source edition untouched. Update relative control paths and stored source bindings deliberately; physical relocation must not fabricate fresh receipts. Root bootstrap instructions are updated through their planning-protocol owner in AR-13 follow-up, not by crossing this owner scope. Operational database placement is explicit and private; preserve the compatibility path until all consumers are adopted.

## Exact candidate reads

- .wisdohm/BOOT.md
- .wisdohm/router.py
- .wisdohm/session.py
- .wisdohm/common.py
- .wisdohm/planning.py
- .wisdohm/store.py
- .wisdohm/routing.py
- .wisdohm/workspaces.py
- .wisdohm/orchestration.py
- .wisdohm/protocols/maintenance.md
- .agents/plans/authority.yaml

## Exact candidate writes

- .agents/runtime/router.py
- .agents/runtime/session.py
- .agents/runtime/common.py
- .agents/runtime/planning.py
- .agents/runtime/store.py
- .agents/runtime/routing.py
- .agents/runtime/workspaces.py
- .agents/runtime/orchestration.py
- .agents/BOOT.md
- .agents/policy.yaml
- .agents/protocols/rules.md
- .agents/protocols/work.md
- .agents/protocols/updates.md
- .agents/protocols/maintenance.md
- .wisdohm/router.py
- .agents/project.yaml
- .wisdohm/BOOT.md
- .wisdohm/session.py
- .wisdohm/common.py
- .wisdohm/planning.py
- .wisdohm/store.py
- .wisdohm/routing.py
- .wisdohm/workspaces.py
- .wisdohm/orchestration.py
- .wisdohm/policy.yaml
- .wisdohm/journey.yaml
- .wisdohm/config/project.yaml
- .wisdohm/config/agents.yaml
- .wisdohm/config/owner-profiles.yaml
- .wisdohm/protocols/rules.md
- .wisdohm/protocols/work.md
- .wisdohm/protocols/updates.md
- .wisdohm/protocols/maintenance.md
- .agents/skills/wisdohm-owner/SKILL.md
- .agents/skills/wisdohm-orchestrate/SKILL.md

## Acceptance

- AH-10: Runtime source/policy/guidance entry lives under .agents; the old router is an explicit minimal forwarding compatibility entry.
- AH-08: devLAB operational data is migrated through online backup/validated restore; no source-release database is copied and session roots/history keep their meaning.
- AH-06: Maintenance pins are re-resolved/reviewed with confinement and profile-skill hashing retained.
- AH-10: Existing callers continue through one selected implementation; old full runtime copies are archived only after reference tracing.
- AH-10: Retire/archive old full control files within the declared old-file scope; leave only intentionally required forwarding entries/derived views, and preserve source/config/data restore evidence.
- AH-10: Update the existing owner/orchestration skills to selected file-authority semantics and source-generation routing; preserve advisory telemetry and evidence distinctions.

## Failure behavior

- Missing new runtime, version mismatch and broken forwarding fail clearly before initialization.
- Moving source or data cannot turn old checks into new proof.
- Interrupted migration retains backup and coherent chosen entry rather than two writable runtimes.

## Verification and completion

Selected verification level: **integration**, justified by the changed contracts/data/resource risks. Run only relevant declared checks and document assessment for prose portions.

- `python3 -B scripts/wisdohm27.test.py`
- `python3 .agents/runtime/router.py --target . db status`

Commands are intended future checks, not evidence already executed. AGH-01 creates the new contract/fixture probes. AR-21 owns later integration and version-assertion edits; request that owner before changing shared tests. Missing required behavior coverage is a bounded verification substep, not permission to weaken acceptance or invent passing checks.

Completion evidence records actual inputs/generation, command outcomes or supported review assessment, source hashes, four-group memory review and remaining limits. Existing Running/Review work needs a real handoff; empty claims do not release it.

## Rollback

Re-read current source and preserve work created after preflight; restore only this owner’s bounded files from the verified source snapshot. Runtime/data rollback restores matching code/configuration plus an online SQLite backup, preserving post-cutover work first.

[Specification](../../SPEC.md) · [Roadmap](../../ROADMAP.md)
