# Maintain current context

## One place for each fact

| Information | Authority |
| --- | --- |
| Behavior, commands, dependencies | Implementation, manifests and current checks |
| File ownership and public seams | Selected `.agents/ownership/*/*.yaml` definitions |
| Current project facts and durable decisions | [MEMORY.md](../MEMORY.md) |
| Simplification scope, order, status and acceptance | [Current plan](../../docs/plans/simplification.md) |
| Herdr, WISDOHM 3, Memory Node and compact UI expansion | [Integration plan](../../docs/plans/herdr-wisdohm-memory.md) |
| Old task definitions, sessions and results | Preserved catalogs, SQLite and recovery archives |

Memory is a concise human/agent handoff. It is not an execution ledger or an
automatically synchronized database. Agents update it explicitly as part of work.
Do not duplicate task status in memory or create another progress file.

## Update during the same change

1. Before work, read memory and the applicable plan item. Inspect its source
   links; a remembered fact is a starting point, not proof of current behavior.
2. Change memory when behavior, composition, ownership, operating commands,
   a durable decision or a known limitation changes. Replace outdated facts
   in place. Keep unrelated facts intact; do not append a transcript.
3. Each factual change names its source and observation date. A decision records
   its reason and what would justify reconsideration. Label proposals and unknowns.
4. Update the existing plan row: `planned`, `in progress`, `blocked` or `done`.
   Record a concrete blocker or next action. Mark done only when that item's
   acceptance criteria and relevant checks are satisfied. Later work stays planned.
5. Record check date, exact command, result and meaningful limitations in the
   plan's evidence section. A proposed command is not a result. Do not relabel
   old results as current after changing the code they tested.
6. After canonical ownership edits, run `npm run ownership:sync`; do not hand-edit
   `.context/modules/registry.yaml`. The compatibility projection is derived by the
   trusted reader, and `npm run check` detects drift. When code or ownership changes,
   regenerate the Hood artifact through `npm run check`
   or `npm run build`; it derives groups from canonical YAML. Restart only the owned
   refactored backend when refreshing its built snapshot, then verify served source
   consistency. Never hand-edit generated `dist/architecture.json`.
7. Before handoff, reread the files you will edit to preserve concurrent changes;
   merge only your own updates. Check affected links, ownership and statements
   against source. Report what changed and what remains unverified.

When no durable fact changes, leave memory alone and say so in the handoff.
Keep it short enough to read at startup; detailed evidence belongs beside the
relevant plan item, linked from memory when needed. Store no credentials, raw
terminal output containing private data, or speculative performance claims.

## Boundaries

Maintain this Markdown plan directly. Do not run the removed planner/wisdom CLI,
revive factory tasks, write fabricated SQL receipts, or mutate imported history.
Changes spanning capabilities use sequential bounded steps with declared owners;
a plan does not grant deployment or Git initialization permission.

Historical update instructions are preserved in
[the original snapshot](../../docs/history/updates-before-simplification-20261115.md).
