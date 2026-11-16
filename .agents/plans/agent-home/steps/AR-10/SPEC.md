# AR-10 — Load agent definitions and grouped ownership through one runtime interface

Disposition: reviewed refinement of existing pending task. Canonical intent comes from the selected shared planner and this folder’s `step.yaml`; this specification becomes its reviewed `spec` link through the shared CAS writer. No status is stored here.

Routing: resolve the current owner, role, domain skills and prerequisites from [step.yaml](step.yaml).

Prerequisites: the current canonical definition owns these; preserve its real handoffs.

## Outcome and implementation boundary

Implement the shared resolver with existing Python/path/hash facilities. Its interface supplies normalized snapshot, exact path routing and validation. Read selected-root definitions as bounded data; never import selected-root Python while inspecting it. Keep policy in one location, roles separate from domain skill packs, and 32 existing capabilities addressable. Before activation the new step.yaml files are reference bindings, not duplicate definitions.

## Exact candidate reads

- .wisdohm/orchestration.py
- .wisdohm/planning.py
- .wisdohm/common.py
- .wisdohm/config/agents.yaml
- .wisdohm/config/owner-profiles.yaml
- packages/contracts/src/agent-definitions.ts

## Exact candidate writes

- .agents/runtime/definitions.py
- .wisdohm/orchestration.py
- .wisdohm/planning.py
- .wisdohm/common.py
- .wisdohm/journey.yaml
- .agents/ownership/backend/project-service.yaml
- .agents/ownership/backend/backend-host.yaml
- .agents/ownership/browser/browser-bootstrap.yaml
- .agents/ownership/browser/workspace-ui.yaml
- .agents/ownership/delivery/source-maps.yaml
- .agents/ownership/verification/verification.yaml
- .agents/ownership/browser/preview-client.yaml
- .agents/ownership/browser/browser-client.yaml
- .agents/ownership/contracts/service-contracts.yaml
- .agents/ownership/backend/http-transport.yaml
- .agents/ownership/browser/canvas-ui.yaml
- .agents/ownership/contracts/ui-contracts.yaml
- .agents/ownership/browser/workspace-shell.yaml
- .agents/ownership/browser/terminal-view.yaml
- .agents/ownership/backend/terminal-service.yaml
- .agents/ownership/delivery/delivery-config.yaml
- .agents/ownership/browser/preview-view.yaml
- .agents/ownership/coordination/planning-service.yaml
- .agents/ownership/browser/planning-ui.yaml
- .agents/ownership/coordination/planning-tools.yaml
- .agents/ownership/coordination/planning-protocol.yaml
- .agents/ownership/coordination/process-definition.yaml
- .agents/ownership/backend/rules-service.yaml
- .agents/ownership/browser/rules-ui.yaml
- .agents/ownership/coordination/rules-bootstrap.yaml
- .agents/ownership/coordination/governance-runtime.yaml
- .agents/ownership/delivery/ui-development.yaml
- .agents/ownership/browser/project-view.yaml
- .agents/ownership/browser/hood-view.yaml
- .agents/ownership/backend/wisdom-service.yaml
- .agents/ownership/browser/spec-ui.yaml
- .agents/ownership/backend/codex-harness.yaml
- .agents/skills/domain-source-of-truth/SKILL.md
- .agents/skills/domain-backend/SKILL.md
- .agents/skills/domain-browser/SKILL.md
- .agents/skills/domain-contracts/SKILL.md
- .agents/skills/domain-verification/SKILL.md
- .agents/skills/domain-delivery/SKILL.md

## Acceptance

- AH-01: One bounded data loader resolves step → kind workflow → execution role → ownership segment/domain skills; it returns source digests/revisions.
- AH-06: Ownership grouping changes navigation without merging disjoint capability scopes; exact ownership is unique and dependencies remain acyclic.
- AH-07: During transition, existing SQL/JSON authorities remain active. Full per-step YAML and ownership files become authoritative only at explicit activation.
- AH-01: Kind discovery comes from workflow metadata; old runtime lists are generated compatibility values. Review-assessment semantics implement the AR-09 contract.
- AH-06: Publish one staged ownership segment file per existing capability, including domain skills/profile mapping; activation selects these instead of SQL ownership, without editing live grants.
- AH-06: Materialize six selected domain skill assets under .agents with provenance. Canonical ownership segments reference those domain skills and permitted role IDs; workflow chooses execution role. Active reads retire old external skill/profile references at activation, retaining originals as provenance.

## Failure behavior

- Conflicting ownership, invalid reference/version, escaping input and malformed workflow fail before claims or writes.
- Missing optional prose context is a disclosed note, not a global stop.
- A single unsupported task is reported specifically rather than hiding unrelated ready tasks.
- Generated discovery is not independently editable.

## Verification and completion

Selected verification level: **targeted**, justified by the changed contracts/data/resource risks. Run only relevant declared checks and document assessment for prose portions.

- `python3 -B scripts/wisdohm27.test.py`
- `node --test scripts/agent-definitions.test.ts`
- `python3 .agents/runtime/definitions.py validate --root .`

Commands are intended future checks, not evidence already executed. AGH-01 creates the new contract/fixture probes. AR-21 owns later integration and version-assertion edits; request that owner before changing shared tests. Missing required behavior coverage is a bounded verification substep, not permission to weaken acceptance or invent passing checks.

Completion evidence records actual inputs/generation, command outcomes or supported review assessment, source hashes, four-group memory review and remaining limits. Existing Running/Review work needs a real handoff; empty claims do not release it.

## Rollback

Re-read current source and preserve work created after preflight; restore only this owner’s bounded files from the verified source snapshot. Runtime/data rollback restores matching code/configuration plus an online SQLite backup, preserving post-cutover work first.

[Specification](../../SPEC.md) · [Roadmap](../../ROADMAP.md)
