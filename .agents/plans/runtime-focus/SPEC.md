# Runtime focus — clear execution and fluent Kanban agents

User request, 2026-11-04: remove the intervening Run confirmation presentation; Run should start the selected task or queue. Show concise step-based runtime output so a person can distinguish running, waiting, failed and disconnected activity. Give agents a discoverable skill, authoritative schemas and direct commands for milestones, slices, tasks and board state. This request creates a plan only.

## Verified source and existing work
- `plugins/ui-kanban/src/view.tsx`: task Run opens an inspector; slice/milestone Run opens the queue drawer. Board, Execution and Process already exist.
- `plugins/ui-kanban/src/harness.tsx`: an additional confirmation controls task dispatch; a one-second polling loop shows raw output and final status.
- `plugins/ui-kanban/src/batch.tsx`: existing queue presentation and review/dependency handling are the integration point, not a replacement queue engine.
- `packages/contracts/src/harness.ts`: run output, status and updatedAt exist; these alone do not establish a process heartbeat.
- `packages/contracts/src/planner.ts`, `scripts/planner.ts`, `plugins/planning-local/src/store.ts`: validated revision/digest-checked shared writer already supports hierarchy, reports, moves and milestone stage/group/archive. Supplying an ID edits an existing entity; creating one omits the ID.
- Existing PROC-M1 tasks are reported complete. Preserve their definitions, independent Running/Review owners, process editing and existing global execution view.

## Acceptance
A1: From task, slice or milestone, one Run action starts eligible work and opens persistent execution feedback without a second Start/confirmation panel. If blocked, show the reason and actionable target inline. Reuse existing authorization, account readiness, draft-conflict protection, frozen queue scope, duplicate prevention and reconciliation rules. Run does not report completion.
A2: Execution shows a compact sequence of actual events, current task/step, last observed activity and status. Distinguish starting, running, waiting for prerequisite review, stopped, failed, and connection/observation uncertainty. Quiet output is labelled honestly; silence is never proof of failure or continued process health. No fabricated percentage, heartbeat or success. Error includes a concrete next action.
A3: Reuse the existing Execution view and backend run/queue ledger. Concise steps are the default; raw output remains expandable. Status and latest steps survive drawer close/reopen and reload through canonical backend data. No extra dashboard or terminal engine. All polling/subscriptions clean up; drafts, terminal identities, preview and keyboard/focus behavior survive navigation.
A4: Creation controls are easy to find: preserve + New with milestone/slice/task choices and expose clearly labelled Add slice on the milestone and Add task on the slice, including empty states, with understandable disabled reasons. From the agent entry, one quick reference identifies the exact checkout/project, schema source, discovery command and copyable examples to create/update milestone, slice and task, move/reorder tasks, report state and change milestone stage/group/archive. The same writer changes the UI's canonical data; transient UI selection is not persisted progress or process control. Documents describe this distinction explicitly.
A5: CLI exposes bounded data-only schema/help and optionally minimal convenience operations only where existing apply is insufficient. Schemas/examples derive from public Zod contracts, never an independently maintained schema. Fresh revision/digest, actor, unique command ID, returned entity IDs, stale refresh/reconciliation and idempotent replay have explicit steps. Agents need no source search or exploratory failed writes.
A6: A disposable fixture proves a fresh agent can discover commands, add one milestone with one slice and two linked tasks, observe it via the shared snapshot, reorder/change allowed states, and receive useful invalid/stale errors. Runtime fixtures cover silent running, real error, lost connection, review wait, stop/reopen/reload, duplicate Run and retained resources. No live coding task or current progress is changed by these tests.

## Connected contracts and scope
Runtime observations belong in neutral public Harness contracts; backend owns events and truth, transport/client validate the same DTOs, planning UI renders them. Keep current output/status callers compatible. Contract task must settle event bounds, ordering, freshness semantics, missing/legacy data and persistence before dependent implementation; do not infer those fields from terminal prose. Planning Zod contracts remain the command/schema authority. No kernel changes, terminal replacement, deployment, Git operations, new framework or automatic Complete reporting.

Interpretation: the disappearing presentation is the Run/Start confirmation flow shown in the transcript. Existing Execution view is the default runtime location; terminal-style step output describes presentation, not a new terminal session. Revisit only if implementation evidence reveals a materially different target.

## Risks and recovery
Direct Run can accidentally dispatch twice: preserve server idempotency and disable in-flight controls. Preserve data-loss guards and show blockers without reintroducing routine confirmation. Silence and stale observation must remain distinct from process failure. Bounded event data must tolerate old saved runs and reconnect. Revert by capability in reverse dependency order while retaining readable existing ledgers and task definitions. No current tasks are reopened or reassigned.

## Evidence
Planning is source assessment only. Runtime behavior is not implemented or verified by this milestone creation. Tasks declare future checks. Authoritative task definitions are generated task folders referenced by `.agents/plans/catalog.yaml`; SQLite owns reports. The roadmap carries links, not a second status authority.

## User-reported creation target
`#planner-r9-body > div:nth-child(2) > div > section:nth-child(1) > header` was supplied as the difficult-to-find creation area. This is a user selector, not a verified stable identity. Current slice header source offers Actions (⋯) → Add task; expanding reveals + Atomic task. Use semantic labels/data IDs for implementation and probes rather than positional CSS.

## Planning validation
Shared planner accepted the additive milestone and eight tasks at revision 177. Fresh snapshot confirmed existing task definitions preserved, all new task/spec links resolve and dependencies are acyclic. A subsequent attempt to set milestone stage Planned hit the writer busy timeout; no stage update is claimed. Runtime checks remain future work.
