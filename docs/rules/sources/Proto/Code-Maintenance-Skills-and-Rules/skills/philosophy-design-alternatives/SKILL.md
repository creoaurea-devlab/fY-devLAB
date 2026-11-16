---
name: philosophy-design-alternatives
description: Use for consequential choices about module ownership, public interfaces, state management, or persistence where changing course later would be costly. Compare genuinely different viable approaches against the current requirements. Skip routine edits and avoid turning every coding task into an architecture exercise.
---

# Compare Design Alternatives

Respect the requested mode: for a review-only request, report findings without editing. For requested maintenance changes, implement the bounded change and verify it. Follow repository instructions and preserve unrelated user work.

Use a short design comparison when the user's task has a meaningful structural choice. This workflow applies the alternative-design principle listed in Ousterhout's [CS 190 discussion of the book](https://web.stanford.edu/~ouster/cs190-winter24/lectures/aposd/) to practical coding work.

## Decide whether comparison is useful

Inspect the repository's instructions, existing design, and the requested behavior. Trigger this workflow when the choice changes who owns important state, creates a public contract, introduces a durable representation, or substantially affects maintenance. A rename, straightforward bug fix, or established project convention usually needs no comparison.

State the decision in one sentence. Separate fixed requirements from uncertain assumptions. Use the existing implementation as the baseline when there is one. Do not reopen decisions explicitly settled by the user without a concrete conflict.

## Develop and assess options

1. Create two viable options that satisfy the same current requirement. They should differ in responsibility, interface, or data ownership, rather than only syntax. If the current approach is viable, it can be one option. Avoid constructing an obviously bad option to make a preference look justified.
2. Sketch the smallest useful API or data flow for each. Include one real caller and the main failure or cleanup path. A temporary code sketch is appropriate when prose hides an uncertainty; a new framework or complete implementation of both options is usually unnecessary.
3. Compare on task-relevant dimensions: caller knowledge, location of state, impact on existing consumers, testing practicality, failure visibility, and migration effort. Include performance only when a requirement or measurement makes it material. Use a compact table and plain language rather than invented numerical scores.
4. Walk one likely maintenance change through both options. Name the files or responsibilities it would affect. For example, assess adding a second transport or changing persistence while keeping the domain operation stable. Mark the scenario as an assumption when the user has not requested it.
5. Choose the simpler sufficient design and state its principal tradeoff. If uncertainty could reverse the decision, investigate that specific uncertainty with a narrow read, experiment, or check. Ask for user input only when a missing product decision materially blocks the result.

## Implement and verify

For an implementation request, continue into the chosen change without requiring routine design approval. Preserve compatibility and unrelated work. Use the project's existing build, type, and behavior checks as appropriate, and add targeted coverage only for uncovered risks.

Verify that the realized code still matches the selected ownership and contract. A design note is not evidence that the implementation works. Record any change of direction caused by actual code or runtime evidence.

## Limits and output

Keep the investigation proportionate. Do not create speculative features to justify an architecture, rewrite unrelated modules, or repeat the comparison after the important uncertainty is resolved.

Return the decision, a compact comparison, the chosen tradeoff, and verification results. Keep a durable decision record only when it will help future maintainers understand a consequential choice; place it according to project conventions.