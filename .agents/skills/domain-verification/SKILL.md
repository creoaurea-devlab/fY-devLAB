---
name: pragmatic-debug-with-evidence
description: Use for a reproducible bug, inconsistent runtime behavior, failing check, or repeated unsuccessful fixes. Establish expected versus observed behavior, test one hypothesis at a time, and verify the causal correction. Skip purely stylistic refactors and unrequested performance investigations.
---

Pinned project-local source: `docs/rules/sources/Proto/Code-Maintenance-Skills-and-Rules/skills/pragmatic-debug-with-evidence/SKILL.md` (sha256:a5951e8b3372dadd4d1926433b407e91fbe947975f63f63028d980fdb44876c6). Original edition retained.


# Pragmatic Debug with Evidence

Respect the requested mode: for a review-only request, report findings without editing. For requested maintenance changes, implement the bounded change and verify it. Follow repository instructions and preserve unrelated user work.

Use this workflow to turn a symptom into a verified correction. It is an original debugging procedure inspired by the book's emphasis on deliberate investigation and checking assumptions. The target is a causal explanation supported by an observable reproduction.

## Establish the failure

Read repository instructions, recent relevant changes, the user's reproduction, and existing diagnostic output. Capture expected behavior, observed behavior, exact input, environment, and the narrowest known failing path. Avoid copying credentials, personal records, or unnecessary production data into logs or fixtures. Separate observed facts from assumptions.

Run the smallest safe reproduction using existing project commands. Record the command, outcome, and relevant error. If a failure depends on unavailable infrastructure, inspect the integration boundary and reproduce locally with a representative fixture where possible. State any fidelity limits; a simulated failure is not proof of the production cause.

Check whether the failure predates the current changes without discarding or overwriting user work. Do not conclude that a compiler, library, network, or operating system is at fault merely because the stack trace ends there. Inspect the values and contracts at the last boundary the project controls.

## Test an explanation

Write one leading hypothesis with a predicted observable result. Identify the cheapest experiment that could disprove it. Use focused logging, an assertion, a debugger, a minimized fixture, or a targeted test already supported by the environment. Prefer reading and isolation before modifying several parts of the program.

Change one relevant condition per experiment and record whether the result supports or rejects the hypothesis. Explain the failing path in plain language, from input to incorrect state to symptom. For asynchronous bugs, include event order and ownership of shared state. For data problems, inspect normalization, null handling, units, and boundary values as appropriate.

If evidence contradicts the explanation, revise the hypothesis. Avoid cycling through speculative patches, adding broad exception suppression, increasing timeouts indiscriminately, or upgrading dependencies to see whether the problem disappears. Dependency upgrades require a demonstrated connection and must remain within the requested scope.

## Fix and prove

Apply the smallest change that corrects the identified cause. Keep unrelated cleanup separate. Remove temporary instrumentation unless it has a justified ongoing diagnostic purpose and follows project logging conventions.

Run the original reproduction after the fix. Where practical and meaningful, retain a regression test that fails against the old behavior and passes with the correction. Confirm a nearby valid case still behaves correctly and run required project gates. Distinguish executed tests from reasoning and checks that were blocked. Stop expanding the test run when the concrete risk is sufficiently covered.

## Report

Give the symptom, supported cause, correction, reproduction result, and remaining uncertainty. If a causal fix cannot be established, provide the strongest evidence gathered and the next discriminating experiment. Never label a speculative workaround as a verified resolution.

## Source basis

- [Pearson/InformIT — original edition description and contents](https://www.informit.com/store/pragmatic-programmer-from-journeyman-to-master-9780201616224)
- [Pearson — original edition sample, tools chapter, and quick-reference card](https://ptgmedia.pearsoncmg.com/images/9780201616224/samplepages/020161622x.pdf)
- [Dave Thomas and Andy Hunt interview — Orthogonality and the DRY Principle](https://www.artima.com/articles/orthogonality-and-the-dry-principle)
