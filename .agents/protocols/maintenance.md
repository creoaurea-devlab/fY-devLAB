# Maintenance

Read the owning capability segment in `.agents/ownership/<group>/<capability>.yaml`. Load additional guidance only when the change needs it. Group folders organize navigation; they do not grant broader writes.

For source changes, use [CODE](../guides/CODE.md) and [VERIFICATION](../guides/VERIFICATION.md). For UI interactions, also use `docs/protocols/ui-design.md`. Keep public contracts neutral, dependencies acyclic and browser/server code separate. Settle shared contracts before concurrent work and keep writes disjoint.

Preserve source editions, imported history, user drafts and live resource owners. Record actual checks and limitations; old reports do not prove current execution. Do not expand permissions or weaken a boundary after a failure.

Keep source-backed [project memory](../MEMORY.md) and the
[current simplification plan](../../docs/plans/simplification.md) current using
[update rules](updates.md). Update affected facts as part of the same change.

Reviewed source pins are retained in [maintenance sources](../guides/MAINTENANCE-SOURCES.md); consult them when relevant rather than loading them for every task. Deployment requires separate authorization.
