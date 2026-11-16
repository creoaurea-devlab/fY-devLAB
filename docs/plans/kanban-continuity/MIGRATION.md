# Data and historical-fidelity migration

## Inputs and identity

Unchanged imported prototype schema2 is reference data; its sample has3 modules,8 entities,4 rule versions,5 releases,8 cards,7 edges and13 events. Treat it as demo content. The previous local board is a legacy card array; its old Done state has no trusted release evidence. DevTest's execution schema has a different meaning and cannot be replaced by either input.

Proposed production schema is explicitly versioned; do not call it unchanged prototype-v2 after adding exact dependency-release pins/source identities/receipt links. Preserve stable IDs where valid, report regenerated nested IDs and origin mappings, and never silently assign an ambiguous source release or UI parent. Per-capability semantic version, project CAS revision and draft proof revision remain distinct.

## Safe path

1. Export a complete current-project backup and parse an isolated candidate; keep journal-only export clearly labeled insufficient for restoration.
2. Bound bytes/record counts/string lengths and validate all nested records, namespace/collection-scoped IDs, enums/dates/versions, project/module/owner refs, UI parents/cycles, live dependency cycles, release↔card consistency, source ownership, rule key/version uniqueness and snapshot contents. Reject executable payloads as data; never evaluate expressions or import task commands into the host writer.
3. Produce a preview/report: project replacement scope, warnings, invalid links, demo/manual/trusted provenance and unresolved historical pins. Legacy Done becomes unverified Review; preserve old text/history but no invented reviews/releases/proof. Align WIP/prerequisite state conservatively.
4. Ask for the actual destructive replacement confirmation inside the future UI; use expected revision/digest. Cancel, malformed, stale, over-limit or failed storage leaves the current canonical project and unsaved state intact.
5. Commit the validated version with migration provenance and embedded event atomically; demonstrate restart and full roundtrip. No merge/branch auto-reconciliation is claimed. Re-import command idempotency is not the same as user choosing a separate second import.

## Historical correctness corrections

Prototype release snapshots copy dependency edges but omit targetReleaseIds; context export later reads live targets. Production must snapshot the exact released target IDs and full pinned rule definitions. If old imported data lacks a historical target pin, preserve unknown and block trust-sensitive use; never fill it with today's target while calling it historical truth. Historical rule rendering reads its snapshot even if the global rule record was changed/imported inconsistently.

Differentiate parentReleaseId (where the draft came from) and supersedesReleaseId (which current baseline it replaces). A stale-base branch can be reviewed as an explicit delta; it does not overwrite accepted current work silently. Variant new UI IDs require parent-ID remapping; flattening all parents is not a validated hierarchy migration. Clear variant write paths and runtime leases until explicit assignment.

## Transaction and recovery rules

Planning owns canonical Continuity metadata; browser localStorage is a preference cache only. State+domain event/release snapshot updates commit together with tested CAS/idempotency, locking and durable replacement. Multi-file task-publication intents need recoverable correlation and explicit reconciliation, not a claimed atomic filesystem transaction. Failed writes never leave green memory-only state.

Reset is only an explicit demo/selected-project action behind backup/confirmation. Never reset all app .data, erase accepted history as a release operation, or drop another project's records. Roll back through a reviewed data backup/migration; accepted-history corrections and proposed reversions append new work, not destructive journal edits.

Identity scope: the same stable UI/rule/decision ID intentionally recurs in an entity, draft and historical snapshot. Reject duplicates within the declared namespace/collection, not across immutable copies. UI parent resolution permits explicit host roots (workspace/shell/topbar/inspector); variant mapping changes internal IDs and preserves valid external roots. Unknown roots are migration warnings/errors, not silently flattened.

Draft dependency pins are selected/captured explicitly. Pin changes bump draft revision and stale proof; baseline advance does not silently repin a consumer. Release revalidates the pinned versions and freshness. Material-change/review/evidence/receipt arrival semantics are fixed in K003/K004; receipt arrival cannot invalidate itself.
