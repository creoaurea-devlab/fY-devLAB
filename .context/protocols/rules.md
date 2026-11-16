# Engineering rules

1. **Understand and stay in scope.** Inspect relevant code, callers, instructions, and checks. Trace the requested behavior before changing it. Preserve unrelated user work.
2. **Reuse and simplify.** Build only what the task needs. Prefer existing code, standard libraries, platform facilities, and installed dependencies. Every abstraction, option, wrapper, and file needs a current purpose.
3. **Keep clear owners and contracts.** Organize by capability. Keep product behavior out of the kernel; use public interfaces, explicit acyclic dependencies, and one authority per fact. Separate browser/server code and coordinate shared changes.
4. **Preserve correctness.** Protect validation, security, accessibility, data, meaningful errors, cancellation, and cleanup. Preserve observable behavior during refactoring; identify intentional behavior changes explicitly.
5. **Verify and report evidence.** Run relevant required checks on the combined changes. Record actual results and limitations. Completion needs evidence; unfinished work needs a recoverable checkpoint.
