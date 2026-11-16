# Existing-plan remediation roadmap

Current migration intent for AR-09/10/11/12/13/14/15/16/17/20/21 is refined in the [agent-home plan](../../../.agents/plans/agent-home/ROADMAP.md). Their original audit entries below are historical scope context; the canonical task and new specification govern dispatch.

`.context/state/tasks.json` owns intent and dependencies; `progress.json` owns reported workflow. All122 existing definitions/reports are preserved.27 new regression/migration tasks extend `AUD-M1` and `WIS27-M1` under existing goals; eight audit addenda reuse existing IDs. See [reconciliation](RECONCILIATION.md). The earlier independent SQL proposal is archived. SQL owns scope/claims/execution evidence, not another product roadmap.

## Dispatch sequence

Begin with existing **TH-01**. It already owns deferred Harness/terminal reconciliation. TERM-TRANSPORT is running; TERM-CLIENT and thread repair are in review. No worker may infer their release from empty SQLite claims. The canonical dependencies guard new shared-file work.

| Audit document | Canonical task | Owner | Canonical prerequisites / disposition |
|---|---|---|---|
| [AR-01](milestones/M1-foundation/slices/S1-preflight/AR-01.md) | `TH-01` | `planning-protocol` | Existing-task addendum; TH-01 reviews scope/handoff |
| [AR-02](milestones/M1-foundation/slices/S1-preflight/AR-02.md) | `AR-02` | `delivery-config` | TH-01 |
| [AR-03](milestones/M1-foundation/slices/S2-startup/AR-03.md) | `AR-03` | `verification` | AR-02 |
| [AR-04](milestones/M1-foundation/slices/S2-startup/AR-04.md) | `TERM-SERVICE` | `terminal-service` | Existing-task addendum; TH-01 reviews scope/handoff |
| [AR-05](milestones/M1-foundation/slices/S2-startup/AR-05.md) | `AR-05` | `rules-service` | AR-03 |
| [AR-06](milestones/M1-foundation/slices/S2-startup/AR-06.md) | `AR-06` | `wisdom-service` | AR-03 |
| [AR-07](milestones/M1-foundation/slices/S2-startup/AR-07.md) | `AR-07` | `backend-host` | TERM-SERVICE, AR-05, AR-06 |
| [AR-08](milestones/M1-foundation/slices/S2-startup/AR-08.md) | `AR-08` | `verification` | AR-07 |
| [AR-09](milestones/M2-authority/slices/S1-contracts/AR-09.md) | `AR-09` | `service-contracts` | AR-08 |
| [AR-10](milestones/M2-authority/slices/S1-contracts/AR-10.md) | `AR-10` | `governance-runtime` | AR-09 |
| [AR-11](milestones/M2-authority/slices/S2-consumers/AR-11.md) | `AR-11` | `planning-service` | AR-10 |
| [AR-12](milestones/M2-authority/slices/S2-consumers/AR-12.md) | `AR-12` | `planning-tools` | AR-11 |
| [AR-13](milestones/M2-authority/slices/S2-consumers/AR-13.md) | `AR-13` | `planning-protocol` | AR-12 |
| [AR-14](milestones/M2-authority/slices/S2-consumers/AR-14.md) | `AR-14` | `terminal-service` | AR-10, TERM-SERVICE |
| [AR-15](milestones/M2-authority/slices/S2-consumers/AR-15.md) | `AR-15` | `project-service` | AR-10 |
| [AR-16](milestones/M2-authority/slices/S2-consumers/AR-16.md) | `AR-16` | `codex-harness` | AR-11, AR-10 |
| [AR-17](milestones/M2-authority/slices/S2-consumers/AR-17.md) | `AR-17` | `rules-service` | AR-09, AR-05, AR-13 |
| [AR-18](milestones/M2-authority/slices/S2-consumers/AR-18.md) | `TH-32` | `source-maps` | Existing-task addendum; TH-01 reviews scope/handoff |
| [AR-19](milestones/M2-authority/slices/S2-consumers/AR-19.md) | `TH-04` | `delivery-config` | Existing-task addendum; TH-01 reviews scope/handoff |
| [AR-20](milestones/M2-authority/slices/S2-consumers/AR-20.md) | `AR-20` | `wisdom-service` | AR-10, AR-06, AR-13 |
| [AR-21](milestones/M2-authority/slices/S3-integration/AR-21.md) | `AR-21` | `verification` | AR-12, AR-13, AR-14, AR-15, AR-16, AR-17, TH-32, AR-20, AR-08 |
| [AR-22](milestones/M3-lifecycle/slices/S1-backend/AR-22.md) | `TH-05` | `codex-harness` | Existing-task addendum; TH-01 reviews scope/handoff |
| [AR-23](milestones/M3-lifecycle/slices/S1-backend/AR-23.md) | `TERM-SERVICE` | `terminal-service` | Existing-task addendum; TH-01 reviews scope/handoff |
| [AR-24](milestones/M3-lifecycle/slices/S1-backend/AR-24.md) | `TERM-TRANSPORT` | `http-transport` | Existing-task addendum; TH-01 reviews scope/handoff |
| [AR-25](milestones/M3-lifecycle/slices/S1-backend/AR-25.md) | `AR-25` | `http-transport` | TERM-TRANSPORT |
| [AR-26](milestones/M3-lifecycle/slices/S2-browser/AR-26.md) | `AR-26` | `browser-client` | AR-21, TERM-CLIENT |
| [AR-27](milestones/M3-lifecycle/slices/S2-browser/AR-27.md) | `TERM-CLIENT` | `browser-client` | Existing-task addendum; TH-01 reviews scope/handoff |
| [AR-28](milestones/M3-lifecycle/slices/S2-browser/AR-28.md) | `AR-28` | `browser-bootstrap` | AR-21 |
| [AR-29](milestones/M3-lifecycle/slices/S2-browser/AR-29.md) | `AR-29` | `preview-view` | AR-21 |
| [AR-30](milestones/M3-lifecycle/slices/S2-browser/AR-30.md) | `AR-30` | `planning-ui` | AR-21 |
| [AR-31](milestones/M3-lifecycle/slices/S2-browser/AR-31.md) | `AR-31` | `workspace-shell` | AR-21 |
| [AR-32](milestones/M3-lifecycle/slices/S3-setup-ui/AR-32.md) | `AR-32` | `project-view` | AR-21 |
| [AR-33](milestones/M3-lifecycle/slices/S3-setup-ui/AR-33.md) | `AR-33` | `rules-ui` | AR-32, AR-17 |
| [AR-34](milestones/M3-lifecycle/slices/S4-integration/AR-34.md) | `AR-34` | `verification` | TH-05, TERM-SERVICE, AR-25, TERM-CLIENT, AR-28, AR-29, AR-30, AR-31, AR-33, AT-ca8e439f-e6c7-40fb-91ad-48c00e03fcc0 |
| [AR-35](milestones/M4-closeout/slices/S1-combined/AR-35.md) | `AR-35` | `planning-protocol` | AR-34 |

## Parallel and shared-write boundaries

After TH-01 and prerequisites, separate owners can work on isolated Python snapshot handling, population, and verification-owned fixtures. Existing TERM-SERVICE owns persistence/descendant acceptance; use its reviewed substeps rather than new competing terminal tasks.

Contracts precede ownership consumers. Governance projection, planner, terminal, project, source-map and bundle changes proceed only after their listed canonical prerequisites. Product SQL cutover is separately reviewed; the existing CAS writer stays active.

Independent lifecycle/browser owners can run in parallel after integration prerequisites. Serialize shared HTTP transport files behind TERM-TRANSPORT, browser client files behind TERM-CLIENT, and setup composition before controls. Verification owns shared test scripts; AR-03 → AR-08 → AR-21 → AR-34 remains its ordered lane.

The parent alone reconciles shared planning/registry/memory. `owner-profiles.yaml` duplicates no paths. `.context/modules/registry.yaml` is an exact-file compatibility projection of SQL ownership for current app consumers. New discoveries return to the owner before scope expansion. All existing pending overlapping tasks share that same owner lane and real source claims.

## Validation

Run `python3 docs/plans/audit-remediation-20261103/validate.py --root . --require-registered`. It checks canonical task links, DAGs, owner scopes, document links and serialized audit overlaps. Validation does not execute implementation checks, report completion or authorize handoffs. First execution action remains TH-01’s scoped reconciliation, not an unreviewed AR alias.
