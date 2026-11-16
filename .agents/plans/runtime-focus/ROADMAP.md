# Runtime focus roadmap

Canonical definitions and reports live in the shared planner. All new tasks start pending; this document does not own status.

[Specification](SPEC.md)

## RT-S1 — Direct Run and runtime progress

- [RT-CONTRACTS](../workspace/steps/RT-CONTRACTS/step.yaml): Define truthful compact runtime observation contracts. Prerequisites: none. Acceptance and rollback: SPEC.md; exact scope and checks: linked task.
- [RT-SERVICE](../workspace/steps/RT-SERVICE/step.yaml): Persist concise execution events and honest runtime state. Prerequisites: RT-CONTRACTS. Acceptance and rollback: SPEC.md; exact scope and checks: linked task.
- [RT-HTTP](../workspace/steps/RT-HTTP/step.yaml): Expose validated runtime steps through existing Harness routes. Prerequisites: RT-SERVICE. Acceptance and rollback: SPEC.md; exact scope and checks: linked task.
- [RT-CLIENT](../workspace/steps/RT-CLIENT/step.yaml): Validate runtime observations in the browser client. Prerequisites: RT-HTTP. Acceptance and rollback: SPEC.md; exact scope and checks: linked task.
- [RT-UI](../workspace/steps/RT-UI/step.yaml): Make Run direct with persistent compact execution feedback. Prerequisites: RT-CLIENT. Acceptance and rollback: SPEC.md; exact scope and checks: linked task.

## RT-S2 — Fluent Kanban agents

- [RT-CLI](../workspace/steps/RT-CLI/step.yaml): Expose a discoverable Kanban command and schema quick view. Prerequisites: none. Acceptance and rollback: SPEC.md; exact scope and checks: linked task.
- [RT-GUIDE](../workspace/steps/RT-GUIDE/step.yaml): Publish agent Kanban recipe and linked local skill entry. Prerequisites: RT-CLI. Acceptance and rollback: SPEC.md; exact scope and checks: linked task.

## RT-S3 — Combined verification

- [RT-VERIFY](../workspace/steps/RT-VERIFY/step.yaml): Verify direct Run, runtime feedback and agent Kanban recipe together. Prerequisites: RT-UI, RT-GUIDE. Acceptance and rollback: SPEC.md; exact scope and checks: linked task.

Implementation preflight rechecks current ownership and Running/Review claims. Do not implement other milestone work or restart live queues. Restore changed files by capability in reverse dependency order; retain operational ledgers.
