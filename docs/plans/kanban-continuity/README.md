# Kanban Continuity implementation plan

**Implementation has started:** the first operable M/S/AT JSON planner is described in [IMPLEMENTATION.md](IMPLEMENTATION.md). The proposal/audit below is historical design context; richer Continuity workflows remain staged.

**Target:** `/home/creoaurea/Documents/_PROTOCOLS/DevLab-Workspace/DevTest/`. **Deliverable:** extracted reference, app/prototype investigation and a reviewable implementation proposal. No product implementation or activation is performed by this planning task.

Start with [SPEC](SPEC.md), [ROADMAP](ROADMAP.md) and [integration/ownership](INTEGRATION.md). [PLAN.json](PLAN.json) is the single design/dependency/coverage manifest; milestone/slice/task Markdown explains it. Actual execution remains under the target's `.context/state/tasks.json` and trusted task-bound receipts after K002 registration. This plan does not install `.planea`, replace project authority or create a second task-status database.

The reference is [the extracted prototype](../../../tobeimplemented/CA_devLAB_Kanban_v2_Continuity/README.md), with16 byte-verified original files and [import hashes](../../../tobeimplemented/CA_devLAB_Kanban_v2_Continuity/IMPORT.json). It remains separate from shipped code. All3 delegated audits, browser observations and screenshots are saved in [evidence](evidence/).

## Proposed delivery

| Milestone | Result | Atomic tasks |
|---|---|---|
| M01 | Readiness, target authority and connected contracts | K001–K004 |
| M02 | Durable Planning service, API and project-safe observation | K005–K007 |
| M03 | One cohesive drawer unit, navigation, inspector and Board | K008–K012 |
| M04 | Capabilities, exact-source changes, blueprints, UI and rules | K013–K020, K043–K046 |
| M05 | Typed knowledge graph, focused navigation and journal | K025–K028 |
| M06 | Delivery tasks, trusted evidence, snapshots and context export | K021–K024, K029 |
| M07 | Safe portability, recovery, accessibility, scale and promotion | K030–K035, K047 |
| M08 | Separately scoped future production improvements | K036–K042 |

There are47 candidate atomic tasks in20 slices:40 required delivery tasks and7 explicitly deferred ideas. All41 source-backed prototype features are mapped, plus the requested singular-unit/layout, authority, durability and evidence requirements. Run `python3 -B docs/plans/kanban-continuity/validate_plan.py` to check this proposal’s graph, coverage, files and extraction integrity.

## Important current facts

Live Planning is unavailable at the observed4310 build: the contribution exists but `client.planning` and its provider are not selected. The requested nested header/body exists only in packaged source at that state. Full's existing Planning backend is useful reference but requires a different Planea authority and is not a drop-in activation.

Current terminal work is changing shared source files. Target validation was already blocked by unclassified terminal script paths during baseline investigation. K001 must obtain a coherent baseline and reconcile ownership before implementation. No unrelated source/config was repaired by this planning task. See [SOURCE-AUDIT](SOURCE-AUDIT.md) and [RISKS](RISKS.md).

First safe entry: K001 readiness/source-baseline and private verification harness, then K002 authority/scopes. Product commands, imports, agent execution, Git and live deployment are not authorized by the presence of this plan.

Final planning check (2026-10-31T12:59:33.452684+00:00): proposal validator passed with47tasks/40required/7deferred. Target registry and installed-target validation remain blocked at observed unowned `packages/client/terminals.ts`; earlier checks found other terminal paths as concurrent work evolved. No unrelated repair or false project pass is claimed. Existing source maps/seals are not re-attested to an unreconciled source state.
