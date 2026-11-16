# Task folders

> Historical planner documentation, retained after the 2026-11-09 extraction.
> The commands and execution claims below are inactive. Current simplification
> work uses [the Markdown plan](../../docs/plans/simplification.md) and
> [update rules](../protocols/updates.md); do not resume this catalog.

Each current task has exactly one `steps/<task-id>/` folder containing `step.yaml` and an `IMPLEMENT.md` link to the [shared implementation template](../templates/implementation.md). The [catalog](catalog.yaml) owns hierarchy and references; it does not repeat task bodies or status.

Use `node scripts/planner.ts --root . snapshot` and the same revision/digest-checked writer used by the UI. The selected authority is recorded in `authority.yaml`: full step files own definitions in file mode; legacy input is accepted only during explicit migration. Operational SQLite owns reported progress and execution evidence.

`workspace/` retains existing task IDs/specifications. `agent-home/` contains the migration [specification](agent-home/SPEC.md) and [roadmap](agent-home/ROADMAP.md). A folder is an implementation entry, not a request to reopen completed work. Running/Review handoffs and active exact-file claims remain controlling.

## Shared writer

Read `node scripts/planner.ts --root /absolute/project snapshot`; submit `apply --file /path/to/command.json` with its current revision/digest, a UUID command ID, actor and validated operation. UI, HTTP and CLI use this same writer. A stale input requires fresh reconciliation. Replaying an ID with a different payload fails.

Preserve existing task IDs, unrelated definitions and Running/Review handoffs. Imports carry intent only and never grant permissions or execution evidence. Status reports bind the current definition digest, actor, time, note and reported provenance. Reported Complete is an assessment of workflow status; trusted verification comes from runtime receipts. Commands in a specification are data and require appropriate execution authorization.

The writer journals files and SQL reports under a stable root lock, detects external edits and retains recovery state on conflict. Archives preserve original aggregates; migration descriptors reject cached legacy writers. Workflow events retain the latest 1,000 entries and replay retains 100 command IDs; export before older history is needed. Never remove a lock file to clear a conflict. In a Strict terminal, submit reports through the trusted host; planning does not widen confinement.

Before changing a Running/Review task definition, record an explicit attributed handoff through the shared writer with a meaningful note. Retained reports continue to block conflicting work when external edits make them stale. Changing reported state does not release execution claims; resume or explicitly close their owning session.
