---
name: clean-code-errors-and-tests
description: Review or improve a specified error path or fragile test area when the user requests reliable maintenance, clearer failures, or regression coverage for a substantive change. Use for swallowed errors, ambiguous failure results, lost cleanup, or tests that fail to protect an important behavior. Do not run a generic testing overhaul or add tests for trivial presentation edits.
---

# Errors and tests

Respect the requested mode: for a review-only request, report findings without editing. For requested maintenance changes, implement the bounded change and verify it. Follow repository instructions and preserve unrelated user work.

This is an original Codex maintenance workflow inspired by *Clean Code* (Robert C. Martin, 2008). Adapt failure handling to the language and the established project contract.

## Trace a real failure path

Read the operation, its callers, and the existing test setup. Determine what counts as success, expected rejection, unavailable data, cancellation, and unexpected failure. Track how each outcome reaches its caller and whether state or resources have already changed. Review transaction boundaries, open handles, timers, subscriptions, and partially completed work where relevant.

Identify a concrete defect or maintenance risk. Examples include returning success after an exception, confusing an empty result with an unavailable service, discarding an error's cause, or catching cancellation as a retryable failure. Do not invent problems solely because the project uses result values instead of exceptions.

## Define the intended outcome

Use repository conventions and caller expectations. Keep expected domain outcomes distinct from unexpected failures when the existing API supports that distinction. Preserve compatibility of error codes, response shapes, status codes, and externally consumed messages unless the user has authorized a change.

Add enough context to diagnose the operation without exposing tokens, credentials, private payloads, or unnecessary personal data. Preserve the original cause where supported. Avoid logging the same failure at every layer. Place recovery where the code has the information and authority to recover; otherwise propagate the failure according to the established contract.

Do not add retries merely to make a test pass. Check idempotency, retry limits, and partial success before modifying retry behavior. Ensure cleanup happens on success, failure, and cancellation through the language's normal resource-management mechanisms.

## Verify behavior that matters

Choose checks from the actual failure risk: a caller receives the expected failure, a resource closes, a transaction rolls back, a retry stops, or a side effect happens at most once. Prefer deterministic fixtures and existing test tools. Use controlled doubles at external boundaries when needed; avoid mocks that reproduce every implementation step.

For a substantive bug, first reproduce it with the smallest meaningful check if feasible, then verify the correction. Cover representative success and failure paths touched by the change. Do not demand arbitrary coverage percentages, one assertion per test, or a particular testing ideology. Keep related assertions together when they describe one observable outcome.

Run the focused tests and applicable type checks. Distinguish pre-existing failures and unavailable dependencies from failures caused by the patch. Do not broaden testing without a concrete unresolved risk.

## Report

State the failure behavior before and after, the observable guarantees verified, and any path that remains untested. Include actual commands or concise test results. Do not claim that passing unit tests proves production reliability.

## Source basis

- [Pearson: Clean Code, first edition — overview and detailed table of contents](https://www.pearson.com/en-us/subject-catalog/p/clean-code-a-handbook-of-agile-software-craftsmanship/P200000009044?view=educator)
