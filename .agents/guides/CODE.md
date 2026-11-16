# Code guidance

Apply this guidance when a task changes source. Resolve its current owner and task scope before editing; load domain guidance only for the affected capability.

1. Trace the current behavior through its real caller. State the intended observable change and preserve the surrounding contract.
2. Make the smallest complete change. Reuse the project's language, installed dependencies and existing runtime facilities. Introduce an abstraction when a present caller or variation needs it.
3. Keep product behavior in its capability. Keep the kernel/composition small; use neutral public interfaces and declared acyclic dependencies. Browser code consumes public DTOs; server code owns filesystem, subprocesses and credentials.
4. Give each fact one authority. Reference canonical task definitions, ownership and shared policy. Generate discovery views where needed; make generated outputs identifiable and reproducible.
5. Keep related decisions together. Names should describe behavior; functions should expose useful outcomes and meaningful errors. Prefer a clear local implementation over unnecessary wrappers or configurable frameworks.
6. Validate at actual trust seams. Preserve actionable failures, cancellation, resource cleanup, safe paths and data-loss protections. Register cleanup with the resource owner.
7. Preserve live editor drafts, mounted preview/terminal identities, accessibility and keyboard behavior. Load the UI design protocol for changed interactions; verify the affected failure and retention cases.
8. Refactor from evidence. Capture behavior where restructuring could alter it. Separate intentional behavior changes from structural changes so the result is reviewable.
9. Choose verification from [VERIFICATION.md](VERIFICATION.md). Add a regression test when it protects a meaningful failure; concise source review is sufficient for low-risk prose. Never invent a passing result or weaken an assertion to close a task.
10. Return the result, exact changed files, actual verification and material limitations. Record current source-linked facts and workflow progress through their existing writers.
11. Simplify around a named responsibility or demonstrated coupling. Keep state and cleanup with their owner; pass explicit inputs and callbacks across public seams. Avoid imports into another plugin's private files, global mutable registries, catch-all utility modules and wrappers with no present caller need. File length alone does not justify a split. For every refactor, explain which responsibility or dependency became easier to understand and verify the behavior it must preserve.

A task may span several capabilities as an outcome. Its implementation children each have one owner and disjoint writes; the parent checks their combined contract.
