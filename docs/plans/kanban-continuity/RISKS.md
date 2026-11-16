# Risks, decisions and implementation gates

| Gate / decision | Evidence and recommended resolution |
|---|---|
| Current ownership coverage | Existing terminal work produces unclassified script paths during audit (first setup-terminal.mjs, later terminal-fixture.ts). K001 must freeze/read current state and reconcile actual owner coverage before feature execution; do not work around the gate. |
| Canonical task status | tasks.json has definitions and no status. Full’s Planea writer has a different schema/trust model. K002 ratifies target-local definitions/receipts plus separate Continuity metadata; no duplicated status truth. |
| Historic pins | Prototype snapshots lack exact dependency release IDs and can read live rule detail. M01/M04/M06 add explicit snapshot pins; unresolved old imports remain unknown, not retroactively verified. |
| Trusted proof | Manual reference fields and demo baselines cannot establish actual tests ran. Source-bound evidence/check/receipt validation is a release prerequisite; absent executor means unavailable controls. |
| Persistence | Prototype change() mutates memory before localStorage failure and cross-tab stamps miss races. One server writer with CAS/idempotence/crash recovery is required before real writes. |
| Shared files and terminal work | Current main/profile/contracts/shell/transport and packaging are moving. One integration writer, fresh hashes and combined terminal/preview regressions; preserve all unrelated work. |
| Drawer constraints | Observed251px drawer cannot contain full-page prototype unchanged. One root/header, Planning-owned sizing and bounded internal scrolling must be tested; no detached header, global CSS or duplicate shell. |
| Data import/reset | Legacy Done/prototype proofs are unverified. Deep validation, preview, backup, selected-project confirmation and atomic replacement; no automatic sample import. |
| Scope/agent security | Declared paths/context export are not enforcement. Reuse canonical ownership; no model grants itself locks or executes imported commands. Terminal confinement/agent execution remain separately verified capabilities. |
| Optional extensions | Similarity, upgrades, revert, saved views, Git/CI and agent adapters are explicitly M08 proposals. No credentials, external account, Git initialization or conversation threads assumed. |

## Product choices that do not block this planning deliverable

Recommended initial policy is prototype WIP2, existing host look/tokens, full prototype functional parity with production correctness fixes, local single-user runtime, manual context export, and no external integrations. Confirm configurable WIP/large-scale targets/provider choices when those tasks are scoped. Do not stall source investigation for decisions already inferable from the archive.

## Reversibility

Keep reference files immutable and import hashes intact. Isolate candidate tests/data. Acquire source packages as reviewed local overrides without touching originals. Roll back matched schema/data/code through tested backups; never delete accepted records/events to simulate revert or overwrite another agent's changes. Interrupted publication/receipt/provider states are explicit recovery states. A policy/schema mismatch fails read-only before any write.

Final planning check (2026-10-31T12:59:33.452684+00:00): proposal validator passed with47tasks/40required/7deferred. Target registry and installed-target validation remain blocked at observed unowned `packages/client/terminals.ts`; earlier checks found other terminal paths as concurrent work evolved. No unrelated repair or false project pass is claimed. Existing source maps/seals are not re-attested to an unreconciled source state.
