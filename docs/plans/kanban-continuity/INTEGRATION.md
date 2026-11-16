# Integration, authority and ownership

## Proposed authority decision — ratify in K002

Retain `.context/state/tasks.json` as the target's single goal/milestone/slice/atomic-definition graph and resolve execution from explicit trusted task-bound receipts. It has no status field today. Do not inject arbitrary status fields, infer a checkpoint by title, copy Full's `.planea` roadmap, or set task.complete from a work-card checkbox. If a durable status field is truly needed, add it once through a reviewed target-local migration with one writer; no parallel status database.

Add one versioned project-local Continuity metadata document, proposed `.context/state/continuity.json`, governed by Planning's strict schema. It owns capability/work/blueprint/rule/release/live-edge and Continuity journal facts, linking canonical task/UI/feature/module identities rather than copying them as writable authorities. Work-card stage is domain workflow, not atomic task execution state; progress and release readiness are projections over those links and fresh evidence.

The Continuity journal records product-domain actions. `.context/state/events.jsonl` retains agent/governance changes through existing update policy. Neither is called a tamper-proof log or used as a fabricated completion receipt. Optional presentation preferences stay in browser storage; sample data never enters a real project without explicit import/preview.

One project-scoped Planning command owner validates and atomically replaces the bounded metadata record plus its embedded event records, with revision/digest fencing, server identity, command IDs/idempotent result correlation and tested crash behavior. Select a proven existing guarded-writer primitive after the K002 spike; do not install a graph database or generic event platform. Cross-authority publication of task definitions is an explicit guarded operation: stage its intent, run the canonical writer, then link the returned task IDs/receipt. A crash must expose pending reconciliation and never claim both committed. No UI keystroke silently writes every authority file.

## Minimal capability boundaries

| Owner | Candidate responsibility | Public dependency |
|---|---|---|
| service-contracts | Planning/Continuity IDs, bounded schemas, command/read/error shapes | Existing shared contracts only |
| planning-service (register at K002) | `plugins/planning-local` domain/store/projections/evidence/receipt adapter internals | Service contracts and existing workspace/project resolution |
| planning-ui (register at K002) | `plugins/ui-kanban` Board/Graph/Journal/Workspace views and intent dispatch | UI/service contracts; installed layout primitives |
| workspace-shell | Host drawer visibility/geometry/trigger focus and retained other surfaces | Public UI contribution contract |
| browser-client / http-transport | Validation, project binding, bounds/origin/error transport | Public service schemas |
| integration / verification | Serialized package/lock/catalog/registry writes and combined tests | Declared owner scopes |

Keep pure domain/store helpers inside Planning initially: one capability needs no six-plugin framework. UI imports public contracts and its own internals, never server implementations. `src/profile.ts` composes factories; the kernel owns no Continuity product behavior. New source acquisitions come from reviewed installed/reference code, preserve originals and are registered as truthful local package overrides. Never edit node_modules or silently bypass archive checks.

## Existing path to preserve

`src/contributions.ts` → `src/shell.tsx` with ProjectWorkspace → ui-shell `renderPlanning(visible)` → ui-kanban PlanningView → `client.planning` → guarded HTTP planning route → selected PlanningService. Source masks/provider selection currently interrupt this path. Existing commands have strict begin/verify/finish/reset/move shapes, expected revision/digest and validated responses. Use an additive versioned Continuity namespace, not unknown properties stuffed into old schemas.

The existing observer already gates polling by visibility, serializes writes and fences projects/generations. Carry those properties through the new views. The header should display server-derived writability/revision/errors from this same resource owner, never a second local project store.

## Full reference boundary

Full's planning-local is gated on a planea-pointer-v1 and `.planea/roadmap.json` schema2 matching the physical project root. Its executor pins installed authority bytes and private lifecycle receipts. DevTest uses Wisdom2.4 default agent orchestration and currently an empty target registry. Reuse its locking/fencing/argv/disposal design properties after review; selecting the unchanged Full factory or Wisdom tool does not implement DevTest's writer or release policy.

Call only a trusted, selected executor with argument arrays and bounded check definitions. Never execute arbitrary imported target Python, shell commands or user JSON to produce a green badge. Keep secrets/private executor state outside tracked source and never return them in context exports. Without a provider, expose inspection/context only and truthful unavailable execution controls.

## Shared-file coordination

Concurrent terminal work touches contracts/client/transport/shell/main/profile/package metadata. K001 freezes or rebases against its accepted source state. One integration writer merges these files; workers receive exact nonoverlapping files after K004 contracts are agreed. Recheck source hashes at each preflight; do not overwrite whole source from older Full copies. Baseline registry coverage has existing unowned terminal scripts, so register actual files before the first feature mutation.

Current `PLAN.json` is the design/dependency/coverage authority. K002 publishes implementation entries into the existing execution registry after source scopes and migrations are concrete. Planning-only import cannot safely pre-authorize nonexistent modules or declare checks completed. Target BOOT/rules/updates stay controlling; unavailable context measurements never receive invented values or DONE receipts.

Package bootstrap: K007 acquires every installed ui-kanban source file and manifest and serially updates root dependency/lock/catalog before local UI tests. K010 likewise acquires/publishes ui-projects only if the cancellable guard requires modifying its direct project-selection entrypoint. Candidate multi-owner outcomes are integration tasks decomposed into exact child scopes at K002, not copied verbatim into single-owner worker records. K001 adds real fixture smoke tests; K002 adds authority/migration tests and registry validation.
