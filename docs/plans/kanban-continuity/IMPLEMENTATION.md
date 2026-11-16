# First operable planning increment

Authorized by the user after the proposal. Core source/config/context/plans backup: `../_backups/DevTest-core-20261031T150209Z/core.tar.gz` with304 verified members and SHA256 manifest, no changed files during backup. User data/dependencies are outside the core archive.

This increment implements the user’s clarified priority: Milestones → Slices → Atomic Tasks in the existing Planning drawer, full-screen drawer mode, hierarchy/Kanban/recent journal, guarded edits and JSON import/export. `.context/state/tasks.json` stays the definition authority; `.context/state/progress.json` is canonical reported workflow progress, with definition-digest invalidation. Actual execution/verification receipts remain separate and reported completion is labeled. No check strings execute.

`.context/protocols/plan.md` is provider-neutral and routed from AGENTS. HTTP and `node scripts/planner.ts` use the same project writer, CAS/idempotency, kernel lock and recoverable two-file commit. Markdown progress is human handoff, not another status store. No autonomous memory hook or specific agent API is claimed.

New Planning service/UI modules have explicit ownership and public contracts. Shared entry edits are additive; the only shell change owned by this increment is the Planning-only drawer height branch; terminal rendering and confinement implementations remain owned by the separate terminal work. Native edit dialogs guard the small forms by making background project navigation inert. The richer prototype capability/release/rule/blueprint/knowledge-graph roadmap remains future work; none is marked complete from this first increment.

Acceptance and live promotion passed combined real checks; detailed results belong to docs/evidence/kanban-continuity/delivery.json. Existing terminal task records are preserved. Canonical task entries KAN-* describe actual scoped work, not all47 future proposal candidates.

Browser acceptance showed the inherited251px panel clipped all task bodies. A root-owned one-branch Planning-only default height (`min(58vh,560px)`) was added to ui-shell view.tsx after fresh source hash check; terminal/server branches are byte-preserved. The fullscreen component remains one retained unit; no terminal implementation is rewritten. Registered as KAN-SHELL and verified by the same private browser suite.

Delivery 2026-10-31T15:55:18.075147+00:00: final31 combined checks (15 planner), both-width15-group real Planning acceptance, contrast/focus, and live2project/2canvas/3shell preservation passed. Final own-property import-order regression fixed. Source scope and limitations are recorded in docs/evidence/kanban-continuity/delivery.json. Richer proposal status is unchanged.

Final live visual review added a normal-mode canvas pointer-hit regression and fixed the existing scoped stacking selector for visible Planning. Final31tests and15browser groups at each width pass; assets/Hood promoted without another backend restart.
