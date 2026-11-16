---
name: pragmatic-decoupled-design
description: Use when a requested change spreads across unrelated modules, a dependency makes behavior difficult to replace or test, or the user requests an orthogonality review. Map actual call and data paths, then make the smallest justified boundary improvement. Skip speculative architecture expansion.
---

# Pragmatic Decoupled Design

Respect the requested mode: for a review-only request, report findings without editing. For requested maintenance changes, implement the bounded change and verify it. Follow repository instructions and preserve unrelated user work.

Use this workflow when a concrete maintenance task reveals excessive coupling. It applies the book's ideas about orthogonality and reversible choices to a bounded repository change. Success means a specific future change has a smaller, clearer impact.

## Trace the actual dependency

Read project guidance and inspect the current diff before editing. Identify the behavior the user wants to change and trace its entry point, domain decision, side effects, and callers. Include data flow, configuration access, resource ownership, and error propagation; imports alone do not describe all coupling.

Record a compact map of the modules involved and what each knows about the others. Mark the precise connection responsible for the maintenance difficulty. Examples include a domain calculation that creates its own network client, two independent features sharing mutable state, or a caller that reaches through several objects to read implementation details. Use file and symbol references as evidence.

Describe one realistic change the proposed boundary should make easier. If no relevant change scenario exists, avoid adding an abstraction. A direct call can be the clearest design when there is no useful information to hide.

## Select a modest boundary

Compare the current arrangement with one small alternative. Options include moving a decision to its owner, passing required data explicitly, injecting one existing dependency, or containing provider-specific translation in an adapter. Prefer familiar project conventions. Keep domain values and errors understandable at the boundary. Do not create a generic plugin system, service split, dependency injection framework, or extra deployment unit for an imagined future.

Check the proposed direction of dependency for cycles and platform constraints. Preserve authentication, authorization, transactional scope, resource cleanup, and ownership of retries. An adapter that silently retries a payment or changes exception handling is a behavior change, not merely decoupling. Do not alter those semantics unless the task calls for it.

For a substantial existing interface, migrate a narrow vertical path first. Keep a compatibility route only where actual callers need it, with an explicit removal condition. Avoid leaving two ambiguous owners of the same decision. Keep the work easy to revert using an isolated patch; do not perform repository resets or rewrite history.

## Verify the reason for the change

Run the relevant existing checks for both the boundary and its consumers. Test observable behavior at the boundary when there is meaningful risk, including one relevant failure path. Prefer a small realistic fixture over mocks that simply restate the new internal call sequence. Confirm the example change can now be made without touching the previously unrelated modules.

Inspect the final diff for increased indirection, leaked types, unused adapters, and unintended public API changes. Preserve unrelated working changes.

## Report

State the original coupling, the new owner and dependency direction, the concrete maintenance benefit, and verification evidence. Name remaining limitations. If separation would add more complexity than it removes, explain that and leave the design intact.

## Source basis

- [Pearson/InformIT — original edition description and contents](https://www.informit.com/store/pragmatic-programmer-from-journeyman-to-master-9780201616224)
- [Pearson — original edition sample, tools chapter, and quick-reference card](https://ptgmedia.pearsoncmg.com/images/9780201616224/samplepages/020161622x.pdf)
- [Dave Thomas and Andy Hunt interview — Orthogonality and the DRY Principle](https://www.artima.com/articles/orthogonality-and-the-dry-principle)
