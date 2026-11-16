# Bounded self healing

Diagnose the root cause before changing files. Capture failure evidence and
increment the request's attempt counter; the host retains the counter, so calling
the router again cannot reset it. Settings define the repair budget.

```bash
python3 .context/router.py next --task bugfix --after VERIFY --outcome fail --attempt 0 --failure-kind task
```

`diagnose_then_preflight` returns to WRITE. Reuse the task route, or enter a
population route for derived memory. Declare any amended writes; honor human
checkpoints; repair the cause; rerun the failed check and affected regressions.
Success resumes VERIFY → CLOSE. Budget exhaustion stops with evidence.

Recoverable within an authorized modifying task: stale maps/indexes (remap first),
core population seals, agent registries/flows, and failures caused by this task's
changes. Automatic population repair also requires `strategy: on_demand`.
Regenerate derived files from their sources; preserve explicit settings and
existing facts. Never silently overwrite unknown content as a recovery shortcut.

Missing/corrupt BOOT, index, settings, loader, role authority, unresolved
authorization, or permissions: stop normal work. Use `--failure-kind authority`.
Only an explicit recovery task may restore these. Never repair by removing a
gate, changing protected paths, raising retry limits, deleting user work, claiming
approval, or weakening a failing test. Read-only tasks diagnose and report.

After verified repair, record one concise reusable lesson if it prevents a repeat.
Do not store raw logs, secrets, repeated gate receipts, or speculative memories.
