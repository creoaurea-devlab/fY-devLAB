---
name: philosophy-deep-modules
description: Use when a component exposes excessive configuration, repetitive call sequences, or shallow wrapper layers, or when the user requests a simpler API. Assess the burden on real callers and improve one coherent boundary. Do not apply to trivial naming edits or as a mandate for larger classes.
---

# Design Deep Modules

Respect the requested mode: for a review-only request, report findings without editing. For requested maintenance changes, implement the bounded change and verify it. Follow repository instructions and preserve unrelated user work.

Apply Ousterhout's idea of substantial capability behind an economical interface. This is an original workflow for coding agents, informed by [Modular Design](https://web.stanford.edu/~ouster/cgi-bin/cs190-winter18/lecture.php?topic=modularDesign).

## Establish the scope

Read repository instructions and identify the component implicated by the user's task. Inspect its public exports, representative callers, configuration, and existing checks. Respect whether the request authorizes implementation or only review. Preserve unrelated local work.

Describe one concrete caller difficulty before proposing a change. Suitable evidence includes repeated initialization sequences, flags callers cannot choose confidently, or repeated cleanup logic. Do not use file length, class count, or parameter count alone as proof.

## Investigate and change

1. Trace two actual uses through the boundary, preferably a common success case and a failure or cleanup case. Record what each caller must know: ordering, defaults, resource ownership, state transitions, and failure handling. Separate domain choices callers should own from mechanics the component could own.
2. Write a short intended contract before editing. State the operation, observable result, necessary inputs, side effects, and lifecycle. Check whether a maintainer could use it without opening several implementation files.
3. Compare the existing call sequence with a proposed sequence. Remove only obligations the component can reliably fulfill. For example, a task executor might own process cleanup after cancellation while the caller still chooses the task and cancellation policy.
4. Implement the smallest coherent improvement. Keep public compatibility where required, update authorized internal callers, and avoid accumulating transitional wrappers with no retirement plan. Retain separate components when their ownership, lifecycle, or dependencies differ.
5. Review the new implementation for hidden coupling. A shorter call site is insufficient if it conceals global state, unpredictable network calls, or a broad object that owns unrelated responsibilities.

## Verify

Run the repository checks that exercise the changed contract. For lifecycle changes, inspect or test relevant cancellation, repeated invocation, and resource release. For an API change, search for every affected caller and check types or compilation where available. Add a focused behavior test only when an important contract lacks coverage.

Compare before and after using concrete observations: removed caller steps, facts no longer required, and any new obligations. Report failed or unavailable checks accurately. Do not claim an interface is better solely because code moved.

## Limits and output

Depth is not permission to create a god module, suppress real errors, or conceal material side effects. Keep business policy explicit when it legitimately belongs to callers. Small functions remain useful when they provide a clear concept; arbitrary size targets are not the objective.

Return a concise explanation of the caller problem, the chosen boundary, changed files, and verification. In review-only work, provide specific recommendations with call-site evidence. For implementation, include a remaining limitation only when it affects use or future changes.