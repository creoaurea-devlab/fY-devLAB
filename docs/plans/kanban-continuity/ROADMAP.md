# Milestones, slices and atomic tasks

Design graph/coverage authority: [PLAN.json](PLAN.json). Execution remains target-local after K002 exact-scope registration.47 tasks:40 required and7 deferred;20 slices/8 milestones. All are unexecuted proposals. Task documents include exact candidate reads/writes, matching checks/probe readiness, evidence and rollback.

## M01 — Authority and contracts

**S01**

- [K001 — Freeze target baseline and reconcile readiness](milestones/M01/slices/S01/K001.md) — depends on none; owner integration.
- [K002 — Decide canonical facts and register executable scopes](milestones/M01/slices/S01/K002.md) — depends on K001; owner integration.

**S02**

- [K003 — Versioned Continuity records and validation](milestones/M01/slices/S02/K003.md) — depends on K002; owner service-contracts.
- [K004 — Typed commands, read models and lifecycle contracts](milestones/M01/slices/S02/K004.md) — depends on K003; owner service-contracts.

## M02 — Durable Planning service

**S03**

- [K005 — Atomic project metadata store and recovery](milestones/M02/slices/S03/K005.md) — depends on K004; owner planning-service.

**S04**

- [K006 — Planning provider, client and transport wiring](milestones/M02/slices/S04/K006.md) — depends on K005; owner integration.
- [K007 — Project observation and command generation fences](milestones/M02/slices/S04/K007.md) — depends on K006; owner integration.

## M03 — Singular drawer and Board

**S05**

- [K008 — One drawer root and cohesive header](milestones/M03/slices/S05/K008.md) — depends on K004, K007; owner workspace-shell.
- [K009 — Shared navigation, scope and presentation state](milestones/M03/slices/S05/K009.md) — depends on K008; owner planning-ui.

**S06**

- [K010 — Unified inspector lifecycle and dirty protection](milestones/M03/slices/S06/K010.md) — depends on K008; owner integration.
- [K011 — Board projection, summaries and search](milestones/M03/slices/S06/K011.md) — depends on K009, K010; owner planning-ui.
- [K012 — Guarded lane movement and accessible drag](milestones/M03/slices/S06/K012.md) — depends on K011, K005; owner planning-service.

## M04 — Work, blueprints and rules

**S07**

- [K013 — New capability and scoped draft work](milestones/M04/slices/S07/K013.md) — depends on K005, K010; owner planning-service.
- [K014 — Exact-source branching and variant isolation](milestones/M04/slices/S07/K014.md) — depends on K013, K003; owner planning-service.

**S08**

- [K015 — Overview projection and record read modes](milestones/M04/slices/S08/K015.md) — depends on K014, K010; owner planning-ui.
- [K016 — Behavior and acceptance blueprint editor](milestones/M04/slices/S08/K016.md) — depends on K014, K010; owner planning-ui.
- [K017 — Stable UI contract references and source links](milestones/M04/slices/S08/K017.md) — depends on K016; owner planning-service.
- [K043 — History: exact-source and current-baseline comparison](milestones/M04/slices/S08/K043.md) — depends on K015; owner planning-ui.
- [K044 — Archive and restore guarded work](milestones/M04/slices/S08/K044.md) — depends on K015; owner planning-ui.
- [K045 — Validate and edit declared ownership scope](milestones/M04/slices/S08/K045.md) — depends on K016; owner planning-ui.
- [K046 — Append blueprint decisions with rationale](milestones/M04/slices/S08/K046.md) — depends on K016; owner planning-ui.

**S09**

- [K018 — Create and pin exact formula versions](milestones/M04/slices/S09/K018.md) — depends on K016, K003; owner planning-service.
- [K019 — Append rule revisions with explicit consumers](milestones/M04/slices/S09/K019.md) — depends on K018, K014; owner planning-service.
- [K020 — Safe rule detail and historical rendering](milestones/M04/slices/S09/K020.md) — depends on K018; owner planning-ui.

## M05 — Knowledge graph and journal

**S10**

- [K025 — Typed relationships and revision propagation](milestones/M05/slices/S10/K025.md) — depends on K005, K014; owner planning-service.
- [K026 — Focused graph projections and layout](milestones/M05/slices/S10/K026.md) — depends on K025, K020, K009; owner planning-ui.
- [K027 — Graph interaction, fit and inspector dispatch](milestones/M05/slices/S10/K027.md) — depends on K026, K010; owner planning-ui.

**S11**

- [K028 — Journal, impact and context navigation](milestones/M05/slices/S11/K028.md) — depends on K025, K026, K015, K043; owner planning-ui.

## M06 — Delivery, evidence and release

**S12**

- [K021 — Task links and revision-bound delivery progress](milestones/M06/slices/S12/K021.md) — depends on K004, K016, K006; owner planning-service.
- [K022 — Evidence records and source-bound verification](milestones/M06/slices/S12/K022.md) — depends on K021; owner planning-service.

**S13**

- [K023 — Manual review and actionable release gates](milestones/M06/slices/S13/K023.md) — depends on K022, K025; owner planning-service.
- [K024 — Immutable release snapshot and continuation](milestones/M06/slices/S13/K024.md) — depends on K023, K014, K020; owner planning-service.

**S14**

- [K029 — Agent context export with honest capability status](milestones/M06/slices/S14/K029.md) — depends on K021, K024, K017; owner planning-service.

## M07 — Portability and shipping acceptance

**S15**

- [K030 — Project backup and validated replacement import](milestones/M07/slices/S15/K030.md) — depends on K005, K024; owner planning-service.
- [K031 — Legacy and prototype schema migration](milestones/M07/slices/S15/K031.md) — depends on K030; owner planning-service.
- [K032 — Storage failure and concurrency recovery UI](milestones/M07/slices/S15/K032.md) — depends on K030, K007; owner planning-ui.
- [K047 — Confirmed selected-project demo reset](milestones/M07/slices/S15/K047.md) — depends on K032; owner planning-ui.

**S16**

- [K033 — Responsive and accessible single-unit acceptance](milestones/M07/slices/S16/K033.md) — depends on K012, K015, K020, K027, K028, K029, K032, K019, K031, K043, K044, K045, K046, K047; owner planning-ui.
- [K034 — Measured scale and retained lifecycle acceptance](milestones/M07/slices/S16/K034.md) — depends on K033; owner verification.

**S17**

- [K035 — Combined integration, provenance and controlled promotion](milestones/M07/slices/S17/K035.md) — depends on K034, K024; owner integration.

## M08 — Deferred production extensions

Deferred after required parity and separately scoped/authorized.

**S18**

- [K036 — Rank existing capability and rule candidates](milestones/M08/slices/S18/K036.md) — depends on K035; owner planning-service.
- [K037 — Consumer upgrade work proposals](milestones/M08/slices/S18/K037.md) — depends on K035, K019, K025; owner planning-service.

**S19**

- [K038 — Revert proposal from an older release](milestones/M08/slices/S19/K038.md) — depends on K035, K024; owner planning-service.
- [K039 — Saved graph focus and command navigation](milestones/M08/slices/S19/K039.md) — depends on K035, K027; owner planning-ui.

**S20**

- [K040 — Optional source-control provenance adapter](milestones/M08/slices/S20/K040.md) — depends on K035; owner planning-service.
- [K041 — Optional CI evidence ingestion adapter](milestones/M08/slices/S20/K041.md) — depends on K035, K022; owner planning-service.
- [K042 — Optional structured agent execution adapter](milestones/M08/slices/S20/K042.md) — depends on K035, K029; owner planning-service.

## Parallel delivery and publication

M01 settles connected contracts/authority first. One integration writer acquires package sources/manifests, publishes local overrides and owns locks/catalog/registries. M03 shell work and M04 domain changes can proceed only against those agreed contracts and disjoint files. M05 projections and M06 proof/release helpers may proceed in separate scopes; shared schema/store changes remain serial. K002 decomposes cross-owner outcomes into exact parent/child implementation scopes. M07 verifies combined state; K035 depends on every required task, including rule revisions, migration, history, scope, decisions and reset.

## First safe entry

K001 captures fresh exact target/source/session baseline, reconciles existing owner-coverage readiness with the terminal delivery owner and adds private fixture smoke harness. No Kanban feature writes proceed through a failed readiness gate. K002 then registers concrete executable source/authority scopes under the existing target registry; this proposal alone does not authorize implementation.
