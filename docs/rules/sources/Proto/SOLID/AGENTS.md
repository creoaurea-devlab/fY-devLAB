# SOLID rules for agents

Read when designing or reviewing responsibilities, extension points, substitutability, client interfaces, or dependency direction. This supplement also governs edits within this folder.

Use SOLID to reduce the cost and risk of a concrete change. Keep the existing task scope and simplicity rules in force; a principle's name alone does not justify another abstraction or file.

## Load by decision

Read every matching rule before making the corresponding design decision. Each rule file owns its principle's operational guidance.

| Decision | Rule |
| --- | --- |
| What belongs together, and who requests changes? | [S — Single Responsibility](rules/single-responsibility.md) |
| Which variation needs an extension point? | [O — Open/Closed](rules/open-closed.md) |
| Can an implementation replace another under the same contract? | [L — Liskov Substitution](rules/liskov-substitution.md) |
| What does each consumer actually need? | [I — Interface Segregation](rules/interface-segregation.md) |
| Which way should policy and implementation dependencies point? | [D — Dependency Inversion](rules/dependency-inversion.md) |

## Application

Before proposing a structural change, identify the concrete coupling problem, the relevant rule, and the smallest remedy. If the current design already meets the need, keep it.

For review, report the affected contract or responsibility and observable evidence. Use the repository's existing verification process; SOLID is design guidance, not a compliance score.

## Research and reuse

Read [RESEARCH.md](RESEARCH.md) when explaining the principles, checking their source meaning, or revising these rules. It records primary-source findings, limitations, and the distinction between historical principles and our local applications.

Copy this folder as a unit when reusing it. In another repository, add an explicit conditional link from that repository's agent instructions.
