# Shared code maintenance rules

Apply these rules proportionately to the requested task and the repository's conventions. They synthesize the 16 included skills and do not replace the user's instructions or project requirements.

## Working rules

1. **Understand before changing.** Read project instructions, the working diff, target implementation, callers, and relevant checks. Trace the concrete problem instead of inferring behavior from names alone.
2. **Respect the requested scope.** For review-only work, return findings. For authorized fixes or refactoring, complete the bounded change. Preserve unrelated edits and existing public contracts.
3. **Preserve observable behavior during refactoring.** Include return values, errors, ordering, mutation, identity, serialization, side effects, asynchronous execution, and resource ownership where relevant. Separate intentional bug fixes from structural changes.
4. **Use small, reversible transformations.** Give each change one understandable purpose. If a new failure appears, isolate the latest change before adding more edits. Never discard the user's work to recover.
5. **Optimize understanding, not size metrics.** Use names, functions, and module boundaries that reduce the knowledge a maintainer needs. Avoid arbitrary line limits, extraction quotas, and needless wrappers.
6. **Consolidate knowledge by meaning.** Share a business rule when it has one genuine owner and consumers should change together. Similar syntax or equal constants alone do not justify a common abstraction.
7. **Keep responsibilities coherent.** Put changeable implementation decisions behind a useful interface. Make dependency direction and ownership clear. Avoid speculative frameworks, oversized modules, and pass-through layers without a purpose.
8. **Make failure handling deliberate.** Preserve meaningful error signals, causes, cancellation, cleanup, and transaction semantics. Check idempotency and partial success before changing retries. Do not turn failure into apparent success.
9. **Debug with evidence.** Reproduce the symptom, distinguish facts from assumptions, test one causal hypothesis at a time, and rerun the original reproduction after the fix.
10. **Verify concrete risks.** Reuse existing project checks and required gates. Add focused coverage for substantive uncovered behavior. Do not test trivial comment edits, duplicate the implementation in assertions, or pursue coverage numbers without a reason.
11. **Keep procedures reproducible.** Follow the existing runtime, package manager, lockfiles, and task commands. Automate demonstrated repetition. Keep unrelated dependency upgrades, deployment changes, and production operations outside the task.
12. **Document non-obvious meaning.** Explain contracts, units, boundaries, ownership, invariants, and known rationale close to the code. Verify comments against execution paths and avoid invented historical explanations.
13. **Finish with evidence.** Report what improved, the relevant compatibility decisions, checks actually run, and material remaining uncertainty. Stop when the maintenance objective is met and sufficiently verified.

## Resolve apparent conflicts

| Tension | Decision rule |
| --- | --- |
| Focused functions versus deep modules | Extract a coherent concept when it reduces mental effort; keep related detail together when extraction creates extra navigation. A simple interface can legitimately hide a substantial implementation. |
| DRY versus independent concerns | Consolidate one shared decision, not coincidentally matching code. Different owners, units, or change schedules are evidence that similar logic should remain separate. |
| Clear failures versus fewer error cases | Simplify error contracts only through justified semantics within the authorized change. Preserve real failures, cleanup, and diagnostic context; do not suppress errors to make an interface appear simpler. |

## A practical maintenance sequence

Inspect the requested scope and baseline. Choose the relevant skill from [SKILLS-INDEX.md](SKILLS-INDEX.md). Make the smallest useful improvement, verify the changed risk, and report evidence.

For a review, use `refactoring-smell-triage`. Before a risky structural change with uncertain behavior, use `refactoring-characterize-behavior`. Use `refactoring-small-safe-steps` to execute the refactor. Use the naming, function, data, debugging, or design skills when their specific problem appears. This is a selection guide, not a requirement to run every skill.
