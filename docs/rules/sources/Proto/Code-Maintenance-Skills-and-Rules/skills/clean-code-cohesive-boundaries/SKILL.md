---
name: clean-code-cohesive-boundaries
description: Improve a named module or dependency boundary when the user requests maintainability work and there is concrete evidence of mixed responsibilities, repeated external integration details, or a change spreading across unrelated components. Do not trigger for every class, small data object, or speculative future extensibility.
---

# Cohesive boundaries

Respect the requested mode: for a review-only request, report findings without editing. For requested maintenance changes, implement the bounded change and verify it. Follow repository instructions and preserve unrelated user work.

This is an original Codex maintenance workflow inspired by *Clean Code* (Robert C. Martin, 2008). Optimize the work needed to understand and safely change the actual system.

## Find the coupling that costs something

Read repository guidance, the target component, direct consumers, and relevant integration code. Identify one concrete reason changes are spreading: vendor response details repeated in feature modules, storage decisions leaking into domain behavior, unrelated responsibilities sharing mutable state, or a component constructing dependencies during normal operation.

Sketch the relevant dependency direction in a few lines or a small table. Record public imports, exported types, constructor behavior, lifecycle ownership, and the data crossing the boundary. Check whether apparent duplication represents the same policy or only similar syntax. Avoid merging concepts that happen to look alike but change for different reasons.

## Choose the smallest useful boundary

Evaluate a local extraction, moving an existing helper, narrowing an exposed interface, or a small adapter around an unstable dependency. Justify the chosen option with the observed maintenance problem. An adapter should translate a real mismatch or isolate a meaningful external contract; do not create pass-through wrappers for every library call.

Prefer existing project organization and dependency injection conventions. Avoid introducing a new service container, framework, event bus, repository layer, or inheritance tree for a local issue. Preserve useful plain data structures. Do not require object-oriented patterns in code that is naturally functional or procedural.

If moving code, preserve initialization order, singleton semantics, transaction ownership, disposal, cache lifetime, and thread or request scope. Keep exports and external data formats compatible. When compatibility would require a larger migration, implement the useful compatible portion and describe the remaining migration rather than silently widening the task.

## Change and verify incrementally

Move or introduce one boundary at a time. Search import sites and inspect both runtime and type-only dependencies. Check for new cycles and for direct access that bypasses the intended boundary. Keep unrelated file layout and formatting changes out of the diff.

Run existing focused tests at the seam that changed. For an integration adapter, verify request construction, response mapping, and failure propagation with the repository's existing test facilities when those behaviors are affected. Use compiler or type checks to catch missed consumers. Do not add tests that merely assert an internal helper was called; assert an observable result or contract.

Review whether consumers now need less knowledge. If the new abstraction adds navigation without reducing responsibilities or dependency knowledge, simplify it or leave the original design.

## Report

Describe the concrete coupling reduced, the resulting responsibility split, and compatibility decisions. List validation performed and any integration behavior still unverified. Keep speculative future architecture outside the completed change.

## Source basis

- [Pearson: Clean Code, first edition — overview and detailed table of contents](https://www.pearson.com/en-us/subject-catalog/p/clean-code-a-handbook-of-agile-software-craftsmanship/P200000009044?view=educator)
