---
name: refactoring-small-safe-steps
description: Execute a requested behavior-preserving restructuring of existing code using small reversible transformations and proportionate verification. Use for extraction, renaming, moving responsibilities, or simplifying control flow. Do not trigger for a new feature, an intentional behavior change, or a general architecture discussion.
---

# Execute a refactor in small safe steps

Respect the requested mode: for a review-only request, report findings without editing. For requested maintenance changes, implement the bounded change and verify it. Follow repository instructions and preserve unrelated user work.

Use this original workflow when a concrete structural improvement is authorized. Its objective is easier modification with preserved behavior, not a cosmetic rewrite or an arbitrary reduction in line count.

## Establish a bounded target

Read local instructions, inspect the working tree, and understand the affected callers and tests. State the present maintenance problem and the observable improvement: fewer duplicated rules, clearer responsibility, or an easier upcoming change. Choose the smallest affected module boundary. Preserve unrelated user changes.

Record the relevant behavior contract, including results, ordering, exception behavior, API signatures, serialization, mutation, persistence, events, and side-effect sequencing. Understand resource ownership and asynchronous execution when touched. If baseline coverage leaves a concrete risk, establish a focused check before changing structure. Do not create tests for a mechanical low-impact edit when existing verification is sufficient.

## Decompose the transformation

Choose a short sequence of independently understandable steps. For example, introduce an explanatory local name, extract a cohesive calculation, migrate its internal callers, then remove the obsolete helper. Each intermediate state should remain usable and buildable. Use semantic tooling when available, but inspect its output for generated files, dynamic references, exports, and framework conventions.

Keep each step limited to one structural intention. Avoid mixing dependency upgrades, formatting across unrelated files, behavior repairs, or performance experiments into the same patch. If a discovered defect is in scope, make its functional change separately with an explicit expectation; otherwise record it without silently altering it. Preserve externally used names unless a compatibility strategy is part of the authorized task.

## Verify after meaningful steps

After each step that could alter execution, inspect the diff and run the smallest reliable check covering its risk. For a simple rename, type checking and affected tests may suffice. For a branch or loop change, check evaluation order, short-circuit behavior, floating-point accumulation where relevant, and side effects. Do not replace a loop with a fashionable construct if equivalence or readability becomes harder to establish.

When a new failure appears, stop layering edits. Compare with the baseline, isolate the most recent transformation, and correct or undo only your own relevant changes. Do not reset the user's work or weaken assertions to make the result green. Keep a local checkpoint only when useful; commits and publication follow the task's existing authorization.

## Finish at the maintenance objective

Run required repository gates plus checks proportionate to the changed boundary, then inspect the final diff for accidental behavior changes and unused compatibility scaffolding. Stop once the target is clearer and sufficiently verified.

Report the maintenance improvement, changed scope, observed verification results, and any unresolved limitation. State intentional functional changes separately, if any were requested. Do not claim complete equivalence from passing tests alone.

Source basis: [official book overview](https://martinfowler.com/books/refactoring.html), [refactoring workflows](https://martinfowler.com/articles/workflowsOfRefactoring/fallback.html), and [catalog](https://refactoring.com/catalog/).