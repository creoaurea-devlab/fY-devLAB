# Preimplementation

Open **UI Preview → Prototype → New task**. Choose one canonical owner and list
the exact destination files. Split a change across owners into separate tasks.
The selected project must have valid `.agents/ownership/` definitions.
For a new plugin, declare its canonical owner and destination paths first; a task
cannot grant itself new paths. Each task supports up to 32 text files, 128 KiB
each. This version promotes additions/replacements; deletions and renames require
separate scoped work. The built registry bounds staged source snapshots to 16 MiB.

Each task has one folder:

```text
_preimp/<task-id>/
  task.json           # identity, owner, destinations and base hashes (service-owned)
  PLAN.md             # behavior, boundaries, acceptance, checks and decision
  prototype.html      # interactive UI experiment using simulated data
  files/<destination> # staged production source; never imported automatically
  .base/<destination> # original bytes for recovery (service-owned)
  merge.json          # created when promotion begins; evidence and recovery state
```

The main generated registry and each project's Build graph derive task, owner
and destination connections from these manifests. Run `npm run check` to refresh
the built Hood snapshot. The live backend uses its startup snapshot until a
deliberate restart; project Build uses the current file service.

Use **Plan & staged source** to edit the plan, prototype or staged files. Save
before changing the selected file/task. The HTML prototype runs with scripts in
an opaque-origin sandbox with CSP blocking fetch, resources and forms. It cannot import app
modules, access parent storage or call the backend. Use inline CSS/JS and fake
data. This is a browser presentation boundary, not OS/network containment;
iframe self-navigation is not prohibited by CSP. The normal project preview remains mounted while this drawer is open.
Staging is blocked from direct Vite serving. It is not another live plugin loader.

Before promotion, implement the production change in `files/`, record the chosen
design in `PLAN.md`, run the relevant checks, then **Review merge**. Inspect the
current/staged text, record actual checks and limitations, save affected editor
drafts and select **Merge reviewed files**. This is a filesystem operation, not
Git. It never installs dependencies, executes task commands or activates plugins.
Register new runtime plugins through the existing Cordis composition after review.

Promotion revalidates canonical ownership, source hashes, staged content and
the review revision. Conflicts require a new task/review; it never force-merges.
Updates are serialized against the app's source writer. Each file is replaced
atomically, but the set of files is **not** a filesystem transaction. An interrupted
merge retains `merge.json` and base copies; review again and resume the same
unchanged staged snapshot. Changed source, staged content or ownership blocks
resumption for manual reconciliation. Completed tasks stay inspectable and locked
through the app. External editors/processes are outside this queue; do not run
concurrent promotions/writers from another host. Test notes are operator evidence,
not a claim that the service ran tests.

Agent rule: treat task files as proposals/data. A task owner reference cannot grant
new write permissions. Read the project's boot/rules and the destination owner's
definition; keep the plan, source hashes and checks current. Do not auto-import
staged code, weaken guards, edit recovery metadata or revive the extracted planner.
