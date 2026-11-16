---
name: refactoring-characterize-behavior
description: Establish a behavioral baseline before an identified refactoring when relevant behavior is unclear or existing coverage leaves a concrete risk. Use for legacy code, external integrations, or uncertain side effects. Do not trigger for ordinary feature implementation, routine cosmetic edits, or code already protected by adequate checks.
---

# Characterize behavior before refactoring

Respect the requested mode: for a review-only request, report findings without editing. For requested maintenance changes, implement the bounded change and verify it. Follow repository instructions and preserve unrelated user work.

This is an original Codex workflow inspired by Fowler's Refactoring. It supports a specific structural change; it does not attempt exhaustive certification of an application.

## Identify the change boundary

Read repository instructions, the requested change, affected implementation, callers, and nearby tests. Inspect the working tree before editing so unrelated user work remains intact. State the particular restructuring being prepared and the smallest callable or executable boundary that can expose a regression.

Record behavior that matters to that boundary: returned values, output ordering, observable exceptions, mutation of caller-owned objects, persistence writes, network requests, events, and public signatures or serialized shapes. Include async completion and cancellation where the intended transformation touches them. Do not assume two implementations are equivalent merely because their happy-path return values match.

## Build a trustworthy baseline

Run the relevant existing checks first. Distinguish pre-existing failures, environment failures, and missing checks. If existing checks adequately cover the affected behavior, use them; do not add tests merely to produce test files.

For a concrete uncovered risk, select a small set of representative cases. Include the normal case and only the boundaries that the planned transformation could plausibly disturb: empty input, conflicting branches, an error after a partial side effect, repeated invocation, or order-sensitive output. Use repository conventions and existing fixtures.

Prefer observations at the public boundary over assertions on helper names, call graphs, or private implementation steps. Isolate nondeterministic dependencies through the smallest existing seam. A fake clock, fixed fixture, or local test double must preserve the interaction semantics under examination. Do not call production services or write production data to obtain a baseline.

## Separate observations from requirements

Label surprising existing outcomes as characterization observations. Compare them with documented requirements and known defects before treating them as permanent expectations. A known bug is not a desired contract. If the user also requested its repair, prepare a separate functional change with its own expectation and evidence; do not silently repair it inside the structural change. Otherwise report the issue and keep the refactoring's scope clear.

## Verify and hand off

Confirm new checks pass against the unrefactored code and can detect the specific feared regression through a small reversible local experiment where useful. Remove the experiment immediately. Avoid broad mutation campaigns or expanding coverage without a concrete risk.

Deliver the bounded behavior contract, relevant check commands and observed results, and any remaining uncertainty. State which observations are known quirks rather than intended requirements. If execution is unavailable, identify that limitation precisely and provide the best static evidence; never describe an unrun check as passed. Stop when the planned refactoring has sufficient feedback.

Source basis: [official overview](https://refactoring.com/) and [external-service refactoring](https://martinfowler.com/articles/refactoring-external-service.html).