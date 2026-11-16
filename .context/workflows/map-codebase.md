# Workflow: Map Codebase

Enter through the target `.context/BOOT.md` and follow its gates first.

Invocation: `/map-codebase [target-directory] [--paths p1,p2]`

Mapping is evidence collection only. It writes seven documents under the target
repository's `.planning/codebase/`; it does not populate `.context/`.

## Procedure

1. Resolve and normalize the target. Default to the current project folder.
2. Reject nonexistent targets, path traversal, and targets outside the
   authorized workspace.
3. Read existing map metadata. Reuse current evidence or remap changed facts
   according to the task and population strategy.
4. For incremental mode, validate repo-relative scopes and inspect only those
   paths plus dependency manifests needed to interpret them.
5. Run four discovery passes:
   - technology → `STACK.md`, `INTEGRATIONS.md`
   - architecture → `ARCHITECTURE.md`, `STRUCTURE.md`
   - quality → `CONVENTIONS.md`, `TESTING.md`
   - concerns → `CONCERNS.md`
6. When delegation is authorized and the passes are independent, use agents
   with disjoint output files. Otherwise run them sequentially.
7. Every factual claim cites repository-relative paths. Mark uncertainty.
8. Stamp each document with mapping time, scope, and Git commit when available.
9. Validate all seven outputs and return paths plus line counts only.

Never require a specific agent runtime, package manager, framework, or GSD
binary. Never delete an existing map without user approval.


After reviewing all seven outputs, preview `python3 .context/router.py index-codebase`.
Declare `.planning/codebase/index.json` and `.context/state/events.jsonl` in a
fresh `map_codebase` preflight, then use `--apply --contract <host-contract>`.
This captures map hashes and the current source hash; it does not prove factual
claims. The agent must verify the mapped evidence before creating the index.
The router appends this phase's event; do not append another index event.
