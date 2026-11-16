# Specification — one integrated Planning unit

## User outcome

Adapt the supplied Kanban v2 Continuity flow into the existing `#workspace-planning-drawer`, including the nested section/header the user identified. Header, body and work inspector are a singular coherent unit with shared bounds, selection, focus, scroll and lifecycle. Preserve the prototype's content hierarchy, restrained card/graph/inspector presentation and Board → Graph → Journal / four-layer Workspace flow. The app continues to own global project navigation and workspace layout.

Do not embed the full HTML/iframe/sidebar or import its global body/:root/button/dialog styles. Keep one content root with a cohesive header; merge project/revision/loading/refresh status into that header and remove the separate transport strip/duplicate Plan title. Use host semantic tokens and container-aware sizing. Preserve mounted editor/preview/terminal owners when opening, resizing, expanding or closing Planning.

## Required functional parity

- Work Board: module/all scope, summary/counts, search/Ready, Plan/Queue/Process/Review/Done, concise source/owner/progress badges, guarded drag plus keyboard actions, new/linked work and released read-only records. Prototype WIP2 is the initial explicit policy, applied globally rather than to filtered cards.
- Workspace: one inspector with Overview, Blueprint, Delivery, History; behavior/outcome/non-goals/acceptance; declared scope; UI identity/action/token contracts; rule versions; decisions; tasks/evidence/review/gates; exact-source comparison; archive/restore; context export.
- Work inheritance: new/extend/fix/next-version/variant from explicit source; reset completion/proof/review/runtime identities. Variant creates new capability/UI identities, remaps parent origins and clears write scope. Old snapshots are never silently changed.
- Knowledge graph: focused Lineage, Dependencies, Rules & UI lenses, typed nodes and relationships, ownership/module context, inspect/open/+ dispatch, pan/zoom/fit and keyboard support. Coordinates are presentation; this is not the executable agent canvas or source-code analysis.
- Journal and Data: appended context/navigation/search, full backup versus journal-only export, bounded validated v2/legacy import, replacement preview/confirmation, safe reset/conflict recovery and honest storage/read-only states.

`PLAN.json` contains F01–F41 with source anchors and assigned implementation tasks. U01–U04 and X01–X06 add the integration and shipping acceptance. No feature becomes implemented merely because its document or UI placeholder exists.

## Domain distinctions that must survive wiring

| Concept | Meaning | Not interchangeable with |
|---|---|---|
| Capability | Long-lived feature/plugin identity and module reference | Milestone/task |
| Work card | Proposed change/draft and workflow stage | Successful execution receipt |
| Blueprint | Behavior, acceptance, UI/rule/scope/decision references | Running agent configuration |
| Rule version | Exact immutable logic-definition pin | Arbitrary executable formula |
| Release | Accepted source-bound snapshot with pins and proof | Deployment/Git commit |
| Atomic task | Scoped execution definition plus bound runtime evidence | An editable checklist checkbox |
| Journal event | Context for a committed action | Tamper-proof external evidence |

Prototype project revision, draft revision and per-capability semver are separate. Target source digests and check/receipt IDs add execution identity; none replaces the others. Module/file ownership and source-backed UI facts refer to their existing canonical registries.

## Intentional production corrections

These preserve the workflows while correcting documented prototype limitations: exact dependency release pins inside snapshots; historical rule detail from snapshot definitions; full nested/reference validation; true CAS/idempotent atomic persistence; stale-base checks; dirty-input guards; source-bound evidence; no task completion from manual toggles. Migration records uncertain old pins as unknown; it never reconstructs historical truth from today's baseline.

Preserve non-sequential editable stage navigation subject to declared blockers/WIP; Done is only a successful release command. Review must be explicit and current; UI column labels cannot bypass the target’s actual verification policy. Failing evidence requires an explicit trusted retest/supersession rule, not an appended user-entered pass.

## Capability and failure contract

Loading/empty/unavailable/read-only/busy/capacity/invalid/stale-source/revision-conflict/storage-failure states must be distinct and recoverable. Project switches fence stale callbacks. Imported code/commands/formula strings never execute. Client-supplied actor IDs or allowlists cannot authorize writes. An unavailable trusted executor or receipt path disables Begin/Verify/Finish/release actions with reasons; there is no simulated completion.

## Initial delivery scope

Required M01–M07 includes exportable agent context and links to real ownership/task readiness. It does not launch agents, enforce ownership by exported text, introduce conversation threads, initialize Git, connect CI accounts or deploy software. M08 separately records the prototype architecture's reuse discovery, consumer upgrades, revert proposals, scale tooling and optional external adapters.

Acceptance requires actual positive and failure checks in VERIFICATION.md, parity review against all four supplied views, unchanged historical snapshots and retained app lifecycle. The prototype's manual evidence and historic46-check report are reference material only.
