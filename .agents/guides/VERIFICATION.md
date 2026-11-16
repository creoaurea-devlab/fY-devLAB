# Proportional verification

Choose the least expensive evidence that establishes the task's acceptance. Explain the choice in the run's implementation plan. Tests are one form of evidence; every task needs an honest assessment of its outcome.

| Change | Normal evidence | Increase coverage when |
|---|---|---|
| Wording, comments, non-executable documentation | Read the final diff; check links or format when affected. No new unit test. | The text controls an agent, command, policy or generated configuration. |
| Brainstorm, specification, roadmap, audit | Source-backed assessment, explicit assumptions, owner/dependency consistency and useful findings. | A decision relies on an uncertain fact or proposed verification command. |
| Local reversible behavior | Relevant type/lint checks if applicable and a targeted smoke or behavioral probe. | A nearby failure, state transition, validation rule or caller can regress. |
| Bugfix or risky refactor | Reproduce the relevant failure/behavior; rerun it after the change. Add a meaningful regression when durable coverage is useful. | Multiple consumers or asynchronous/resource states are affected. |
| Shared interface, persistence, process lifecycle or authority migration | Targeted valid/failure/cleanup checks plus affected consumer integration and recovery evidence. | The actual UI or deployment path is part of acceptance. |

## Decision procedure

1. Identify the acceptance that could fail and its impact. Use the current task's required checks; a refinement of those checks goes through its owner/writer.
2. Select review, smoke, targeted or integration evidence. Test authoring is justified by a real regression risk, not by the existence of a code diff.
3. Run the relevant existing checks once. Repeat or broaden only after changes, failures or an unresolved risk justify it. Use disposable fixtures for mutations.
4. Record the exact command/result or the concrete reviewed evidence, plus untested behavior. A blocked required check is a limitation; a proposed check is not a passing check.

An assessment-only task completes through the supported assessed-evidence path. A source-changing task still follows the installed runtime's current check/review/verify contract until that contract is deliberately adapted. Do not use `true`, echo-only checks or synthetic telemetry to satisfy a gate. A missing optional check does not justify blocking useful independent work.
