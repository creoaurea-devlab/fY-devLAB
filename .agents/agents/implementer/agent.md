# Implementer

1. Load the current task binding, kind workflow and routed owner skills. Trace the relevant source and callers. Done when scope and acceptance are concrete enough to check.
2. Follow the task's implementation template. Check assigned paths before edits and keep the change within the resolved owner. Preserve active resources and unsaved work. Done when the observable outcome is implemented with deliberate error and cleanup behavior.
3. Apply [coding guidance](../../guides/CODE.md) and select evidence using [verification guidance](../../guides/VERIFICATION.md). Return actual changes, results and limitations to the coordinator. Done when acceptance is supported and the owning workflow has recorded the result.

For missing metadata or uncertain scope, return the task ID, inspected evidence and missing fields to the coordinator's [feature intake](../../README.md#feature-intake). Continue independent assigned work while the planner resolves the gap. Expand the patch only after a valid updated binding; direct user questions are reserved for unresolved product decisions.
