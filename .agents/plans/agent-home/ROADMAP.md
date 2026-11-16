# Agent-home migration roadmap

Read current intent and reports through the selected shared planner. This document describes execution order, not status. Parent-only CAS import applies the reviewed pending-task refinements; the import proposal is retained outside the project and does not become another live task store.

| Task | Owner | Prerequisites | Outcome |
|---|---|---|---|
| [AR-09](steps/AR-09/SPEC.md) | `service-contracts` | None | Define one file-based agent/step contract and proportional evidence model |
| [AR-10](steps/AR-10/SPEC.md) | `governance-runtime` | AR-09, AGH-01 | Load agent definitions and grouped ownership through one runtime interface |
| [AR-11](steps/AR-11/SPEC.md) | `planning-service` | AR-10, AGH-02 | Write one task per folder through the existing planner interface |
| [AR-12](steps/AR-12/SPEC.md) | `planning-tools` | AR-11 | Expose the same agent-home writer through the existing CLI |
| [AR-13](steps/AR-13/SPEC.md) | `planning-protocol` | AR-12, AR-14, AR-15, AR-16, AR-17 | Activate file definitions after a reviewed migration and restore rehearsal |
| [AR-14](steps/AR-14/SPEC.md) | `terminal-service` | AR-10 | Resolve terminal ownership from the selected grouped definition snapshot |
| [AR-15](steps/AR-15/SPEC.md) | `project-service` | AR-10 | Resolve project-copy ownership from the selected definition snapshot |
| [AR-16](steps/AR-16/SPEC.md) | `codex-harness` | AR-11, AR-10, AGH-02 | Build every Codex dispatch from agent-home definitions and real claims |
| [AR-17](steps/AR-17/SPEC.md) | `rules-service` | AR-09, AR-10, AGH-02 | Observe agent-home definitions and operational evidence without executing project code |
| [AR-20](steps/AR-20/SPEC.md) | `wisdom-service` | AR-10, AR-13, AGH-03 | Package the portable agent home with one selected runtime |
| [AR-21](steps/AR-21/SPEC.md) | `verification` | AR-12, AR-13, AR-14, AR-15, AR-16, AR-17, AR-20, AGH-03 | Prove the combined file-authority migration and retire competing definitions |
| [AGH-01](steps/AGH-01/SPEC.md) | `verification` | AR-09 | Create contract and migration fixtures for the shared definitions |
| [AGH-02](steps/AGH-02/SPEC.md) | `governance-runtime` | AR-10 | Store reported workflow state independently from definition projections |
| [AGH-03](steps/AGH-03/SPEC.md) | `governance-runtime` | AR-13 | Relocate the control runtime and policy into the agent home |

## Dispatch

AR-09 is the safe first entry after exact-path registration. AGH-01 fixtures and AR-10 loader follow settled contracts. After AR-10, AR-14 terminal discovery, AR-15 project discovery and AGH-02 operational storage can run with disjoint source scopes. AR-11/12 wait for report storage; AR-16 can run once AR-11 and shared resolver exist.

AR-17 stages trusted dual-source/dual-path observation before activation. AR-13 waits for AR-12/14/15/16/17 parity and coordinates activation; AGH-03 moves control runtime afterward. AR-20 then packages the selected layout, preserving setup responsibilities. AR-21 owns combined evidence, test expectation updates and recovery proof. Shared-file changes are serialized: AR-10 → AGH-02 → AGH-03 for existing runtime files; AR-12 → AR-13 for CLI/authority coordination.

TH-17, TH-32 and existing active/review work retain their IDs/scopes; this roadmap does not complete or replace them. Before expanding a reused task, re-read its canonical definition/report and route exact paths. Shared test updates stay with verification; request bounded substeps instead of editing another owner’s tests.

## Release of old copies

Retire each old definition representation only after its actual consumers agree on the selected source generation. Keep provenance immutable, statuses honest and a tested restore path. An old path may remain a forwarding entry or generated view, but never another editable definition authority.
