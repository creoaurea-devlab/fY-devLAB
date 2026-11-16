# Minimal automatic factory

Replace the previous Codex executor, rather than layering another orchestrator on it.
The only execution implementation lives in `src/runtime/`. The host registers it
directly; HTTP/client contracts and the Kanban remain the public interface.

Run a serial `plan → build → check → done` flow. A confirmed failed build or check
enters `repair → check`, with two repairs maximum. Retain partial files. An exhausted
task fails with its evidence, and independent queued tasks continue. Never replay an
uncertain live turn: query its saved thread first. Stop/cancellation takes precedence.
No human approval, manual sign-off, context telemetry or four-group memory receipt
is required for the factory. Existing planner history remains intact.
Tasks without source writes proceed directly from assessment to the focused check.

`.agents/factory/steps/<phase>/` holds a YAML step definition, JSON policy, and Markdown
instructions. Each run snapshots those files and records operational JSON and output
under the selected project's `.agents/factory/runs/`. A single host index contains
references, not a second copy of run state. `step.yaml` remains canonical task intent.

Use the first declared targeted check; use an explicit acceptance assessment for
tasks with no executable checks. Execute checks in the installed Codex sandbox.
Record the actual command, exit status and output. Provider success alone is not proof.
Do not expand permissions on sandbox failure or invent completion evidence.

Implementation scopes: contracts own `packages/contracts/src/harness.ts`; Codex owns
`src/runtime/**`, `.agents/factory/**` and the replaced executor files; planning UI
owns its existing task/queue presentation. Preserve drafts, terminal and preview owners.
Minimum validation: runtime success/repair/stop/restart probes, affected types and one
disposable UI smoke. No whole-repository regression campaign or deployment is required.
