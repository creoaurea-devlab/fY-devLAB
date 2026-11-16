---
name: philosophy-explain-invariants
description: Use when maintainers must infer ordering, ownership, units, concurrency, boundary semantics, or design rationale from implementation, or when comments conflict with behavior. Write focused documentation backed by code evidence. Do not generate comments for every statement or assert unverified guarantees.
---

Pinned project-local source: `docs/rules/sources/Proto/Code-Maintenance-Skills-and-Rules/skills/philosophy-explain-invariants/SKILL.md` (sha256:67fcf3757b560a93f050ed3818de93f04a89574ca1c3e49412a2718ae72ec19c). Original edition retained.


# Explain Contracts and Invariants

Respect the requested mode: for a review-only request, report findings without editing. For requested maintenance changes, implement the bounded change and verify it. Follow repository instructions and preserve unrelated user work.

Clarify the facts a maintainer needs to preserve while editing the requested code. This original workflow draws on the role of comments described in Ousterhout's [Writing Comments lecture](https://web.stanford.edu/~ouster/cgi-bin/cs190-winter18/lecture.php?topic=comments).

## Inspect before describing

Read the relevant implementation, callers, tests, types, and repository documentation rules. Determine whether the task authorizes code changes or only documentation. Locate ambiguous units, ownership, allowed states, ordering, range boundaries, failure behavior, and concurrency assumptions.

Distinguish observed behavior from intended guarantees. A comment that sounds plausible is insufficient evidence. Existing tests may show a case but do not necessarily establish a universal contract. If behavior is inconsistent, identify the conflict rather than documenting one path as authoritative.

## Write useful explanations

1. List the small number of facts that a future edit could accidentally violate. For each, point to the code or contract that supports it. Examples include a task having only one active worker, a timestamp using milliseconds, or a resource being released by one named owner.
2. Separate public usage information from implementation reasoning. Put necessary usage facts near the exported operation or type; put a non-obvious algorithmic reason near the relevant implementation. Preserve project documentation conventions.
3. State conditions precisely. Explain when an invariant must hold, including permitted intermediate states where relevant. For asynchronous work, identify the transition that establishes or restores it. Do not imply that a value remains constant forever simply because it is stable at an API boundary.
4. Document rationale only when known. If a historical reason cannot be established from code or available project history, describe the current constraint rather than inventing the author's intent.
5. Remove or correct misleading repetition in the edited area. Prefer one authoritative explanation with a reference over several copies that can diverge. Where a clearer name or type removes ambiguity within scope, consider that small improvement.
6. For a new interface, draft its contract before implementing the body. If it requires many exceptions or hidden prerequisites, inspect the design itself; comments cannot repair an incoherent contract.

## Verify

Read each new statement against relevant execution paths, including boundaries and failures. Run documentation tooling or type checks when the edit affects examples, symbols, or signatures. Pure comment edits ordinarily need no new tests.

When documentation reveals a correctness risk and implementation is authorized, add a focused check or assertion only if appropriate to the project's behavior and error handling. Do not silently turn an undocumented assumption into a breaking runtime requirement.

## Limits and output

Avoid restating syntax, narrating obvious assignments, manufacturing performance claims, or filling every function with boilerplate. Do not delete valuable rationale merely because the surrounding code has clear names. Keep sensitive operational details and secrets out of examples.

Return the important contract or invariant clarified, where it now lives, and how it was checked. Mention unresolved ambiguity explicitly and identify what evidence would settle it.