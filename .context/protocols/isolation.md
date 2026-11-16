# Modules and files isolation

1. Read the relevant module registry entries and affected callers. Declare all
   files needed for the smallest complete change, including shared integration
   files. The router reports matched modules. Missing registry entries remain
   an evidence gap to resolve when material to the task.
2. Exact write sets enforce file isolation. Role ownership guides routing; it
   does not confer permission. No write-directory prefixes, wildcards, traversal,
   protected secrets, or symlink writes. Reads through escaping symlinks also fail.
3. The orchestrator assigns disjoint worker files. Shared integration/config,
   dependency locks, and events have one writer. Serialize context population
   and event appends. Module names alone cannot prevent overlapping files.
4. Before the host executes a mutating tool, call:

   ```bash
   python3 .context/router.py check-scope --contract /tmp/task-preflight.json --path src/api.py --other-write src/ui.py
   ```

   `--other-write` lists exact active claims owned by other workers. The host
   supplies a complete claim set and owns its concurrency lock; the CLI supplies
   no process-wide lock. Paths and policy must be unchanged between check/write.
5. Scope expansion requires redeclaration. Preserve preexisting work. Prefer a
   separate Git worktree for parallel changes; use actual baseline diffs for
   reconciliation. Never discard user edits or roll back the whole repository.

An unchecked shell can write any accessible path. Hard enforcement requires the
host to intercept writes, patches, shell mutations, generated artifacts, and
delegated tools. A final diff check detects violations after the fact; CI cannot
replace a tool interceptor. See the package manual for integration steps.

## Indexed operations

`orchestrate start/check` adds cooperative atomic file claims in a shared external session and validates one-module workers against YAML authority. Parent grants bound child scope; receipts bind result checks and output fingerprints. Keep shared memory updates in orchestrator reconciliation. This mechanism cannot intercept an arbitrary unchecked external tool.
