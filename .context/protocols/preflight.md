# Preflight declaration

Before any mutation display the router's compact declaration, plus the exact
working folder, reads, assumptions, and proposed verification when not already
visible. The JSON result is the machine contract. Minimal example:

```text
PREFLIGHT task=bugfix agent=backend modules=api write=src/api.py risk=low verify=python3 -m unittest tests.test_api
```

Create it without mutation:

```bash
python3 .context/router.py preflight --task bugfix --role backend --read src/api.py --write src/api.py --verify 'python3 -m unittest tests.test_api'
```

Every write is one canonical project-relative file. Include new files, generated
outputs, map/index changes, memory, and events. Fixed route ceilings still apply.
Risk: low/medium/high; destructive operations and production changes are high.
The router validates paths and dependency hashes; the host validates task
authorization, assumptions, actual checks, and risk-specific permissions.

In human mode `status: waiting_for_human` blocks mutation. The host presents the
exact proposal and supplies its approved `approval_key` through `--approval`;
regenerate the same preflight. New files, changed policy/role, or new assumptions
change the key and invalidate old approval. A before-close key additionally binds
the verification evidence and checkpoint. Never synthesize approval yourself.

Keep contracts in host memory or private temporary files, outside durable
repository memory. Host-controlled files/tokens are essential for enforcement.
Validate immediately before each write or host-controlled transaction. New
authority/configuration requires a fresh declaration for subsequent operations.
Every modifying delegated worker has its own disjoint contract.

## Planned indexed tasks

Use the state/index.json task pointer, not ad hoc untracked feature work. An atomic task names one module/plugin and exact files, checks and dependencies. `orchestrate start` derives the contract; `orchestrate check` guards each mutation. Register missing ownership or split cross-module tasks before editing.
