---
name: clean-code-focused-functions
description: Refactor an identified function when the user asks to simplify tangled control flow, mixed responsibilities, or hidden side effects. Use when a function is difficult to understand for a concrete reason. Do not activate solely because a function exceeds a line count, and do not use for a new feature or a repository-wide extraction campaign.
---

# Focused functions

Respect the requested mode: for a review-only request, report findings without editing. For requested maintenance changes, implement the bounded change and verify it. Follow repository instructions and preserve unrelated user work.

This is an original Codex maintenance workflow inspired by *Clean Code* (Robert C. Martin, 2008). Treat focus and readability as design judgments, not numerical rules.

## Read the function as a contract

Inspect the requested function, its direct callers, and relevant existing tests. Write a short internal inventory of inputs, outputs, mutations, external calls, exceptions or result errors, and ordering requirements. Include asynchronous boundaries, cancellation, resource ownership, and transaction scope where present. Distinguish accidental complexity from necessary algorithmic detail.

Describe the specific problem before changing code. Examples include validation interleaved with persistence, a flag selecting unrelated operations, repeated policy checks that drift, or deeply nested branches hiding exit conditions. A long but coherent algorithm may already be the best representation.

## Compare a small set of changes

Consider local naming, guard clauses, a small helper, or separating computation from an existing effect boundary. Choose the change that reduces what a reader must keep in mind without scattering the operation. Prefer a helper whose name states a domain operation and whose parameters expose what it needs. Keep a short operation inline when extraction merely renames syntax.

Before moving a statement, check evaluation order and execution count. A guard clause can change cleanup, logging, or transaction behavior; an extracted callback can change captured variables and exception handling. Preserve these details unless the user explicitly requested a behavior change. Treat fixing a newly discovered bug as a separate, explained change instead of quietly folding it into cleanup.

Do not introduce a configuration object just to hide a confusing signature. First determine whether the inputs form a real concept. Likewise, do not replace simple branching with a class hierarchy or generic strategy framework without demonstrated maintenance benefit. Avoid fixed maximum function lengths, argument counts, and nesting thresholds.

## Implement and verify

Apply one bounded transformation at a time. Keep public signatures stable unless a compatible, authorized migration is part of the task. Preserve useful comments about invariants and explain any non-obvious dependency that remains.

Use existing focused tests that exercise the changed branches or effect order. If the change carries meaningful risk and a crucial observable behavior has no coverage, add the smallest regression or characterization check supported by the repository. Do not install a testing framework merely for this refactor. Run compilation or type checks when relevant, then review the diff and compare the before-and-after call path.

Stop when the original difficulty is removed; do not keep extracting because additional helpers are possible.

## Report

Explain which responsibility or branch became easier to follow, why the chosen boundary helps, and what behavior was checked. Mention remaining uncertainty, especially around unexercised external effects. Report actual evidence rather than claiming that shorter code is automatically cleaner.

## Source basis

- [Pearson: Clean Code, first edition — overview and detailed table of contents](https://www.pearson.com/en-us/subject-catalog/p/clean-code-a-handbook-of-agile-software-craftsmanship/P200000009044?view=educator)
