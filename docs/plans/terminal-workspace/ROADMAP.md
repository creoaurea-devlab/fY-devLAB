# Terminal workspace delivery roadmap

Design: [SPEC.md](SPEC.md). Dependency/coverage map: [graph.json](graph.json). Target execution authority remains `.context/state/tasks.json` plus existing agent receipts; no `.planea` migration or duplicate status machine is installed. Candidate scopes must be resolved and registered at T02 before concurrent implementation.

## M1 — Real terminals with truthful ownership policy
T01 native/Strict feasibility → T02 public contracts/source ownership → T03 service/policy wiring. This delivers real independent terminals and an honest mode boundary. First safe action: private native/Strict probes; current app remains unchanged. Unsupported Strict must fail closed.

## M2 — Terminal workspace UI
T04 horizontal Shift-selection dock → T05 expanded workspace/layout/reorder → T06 rename/ownership/forks. T07 backend persistence may proceed in parallel with M2 only after shared contracts are settled and write scopes do not overlap.

## M3 — Durability and acceptance
T07 independently owned tmux/policy-safe persistence → T08 combined UI/runtime/security/performance checks and controlled promotion. Browser detach, backend restart and reboot promises are verified separately. No provider threads/Agent API in this delivery.

## Delivery gates
- Settle the Strict mechanism before encoding or displaying an enforcement promise.
- One writer publishes contracts, source copies, package/lock/catalog and shared memory; backend/UI workers use disjoint files afterwards.
- Preserve xterm/session identity and one resize/input owner through every layout change; retain the existing transport unless measured evidence requires more.
- Every task needs actual checks and matching state/changelog updates; a planned test command is not passing evidence.
- Promote only a verified isolated candidate; keep the prior live build and saved data available for rollback.

## Implemented task breakdown
Concrete capability-scoped definitions now live in `.context/state/tasks.json`: contracts, UI contracts, client, transport, native confinement, persistent service, renderer, shell, canvas, distribution, profile, bootstrap, Hood and acceptance. The design graph remains a traceability view, not duplicate execution status. Landlock/seccomp resolved the failed namespace approach. Shared SSE resolved the measured browser connection-pool blocker. Delivery evidence and current state record actual checks and live promotion.

## App-aligned refinement
User-authorized A12/A13 reuse the existing capability task chain: UI contract → renderer → shell/canvas → combined acceptance. Remove the manual Start/Stop chrome, keep visible sessions ready, and promote the retained panel to a true main Terminals surface with native app bars. The isolated candidate builds and types/runtime checks pass; actual browser/error/geometry/load acceptance and controlled live promotion are recorded separately when verified. Original host copies and Herdr sources remain unchanged.

Refinement verified/promoted 2026-10-31T14:31:52.684504+00:00: both widths passed real interaction/error/pending-fork owner-switch+reload/pressure, full UI regression8groups and live state preservation.16runtime/native+7memory tests passed. Current receipt: ../../evidence/terminal-workspace/chrome/delivery.json.

## Toolbar/preview follow-up
A14 is verified and promoted as frontend assets: public initial-ratio contract → localized retained preview view → shell composition → both-width acceptance/preservation. Current receipt: ../../evidence/terminal-workspace/preview-layout/delivery.json. The existing backend snapshot remains with the unchanged host until the separate concurrent Planning activation.

A14 verified/promoted 2026-10-31T15:29:11.000800+00:00:30runtime/native+7memory checks, both-width full/focused terminal/preview browser acceptance,8-group Full UI regression and3live shell/host continuity passed. Current receipt: ../../evidence/terminal-workspace/preview-layout/delivery.json. Backend was kept running; concurrent Planning deployment is separate.
