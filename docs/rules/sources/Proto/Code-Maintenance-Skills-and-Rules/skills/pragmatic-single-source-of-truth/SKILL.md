---
name: pragmatic-single-source-of-truth
description: Use when the same business rule, schema, validation policy, or configuration fact must be updated in several places, or when the user requests a DRY review. Trace semantic ownership before consolidating. Skip purely cosmetic similarity and unrelated code cleanup.
---

# Pragmatic Single Source of Truth

Respect the requested mode: for a review-only request, report findings without editing. For requested maintenance changes, implement the bounded change and verify it. Follow repository instructions and preserve unrelated user work.

Use this workflow to remove one demonstrated source of conflicting knowledge. It is an original maintenance procedure inspired by the book's discussion of DRY, rather than a transcript of that discussion.

## Establish the rule

Read repository instructions, the working diff, relevant entry points, and existing tests. Start with the user's reported maintenance pain. Write the rule as a sentence, such as: a booking becomes chargeable only after confirmation. Locate implementations, schemas, configuration, generated files, and explanatory documentation that depend on that rule. Use targeted searches; avoid scanning unrelated areas simply to increase a duplication count.

Make a small ownership table containing the fact, current owner, dependent consumers, and evidence of drift or coordinated edits. Two matching expressions are not enough: confirm that they represent the same decision and should change together. Distinct pricing rules may happen to calculate the same result today. Retain separate implementations when their owners or expected evolution differ.

## Choose the smallest consolidation

Prefer an existing domain module, validated configuration source, or schema. State why that location owns the decision. Check whether every consumer can depend on it without an import cycle, platform incompatibility, or inappropriate access to privileged data. A browser must never receive server credentials just because a shared configuration file seems convenient.

Choose one bounded mechanism: call the existing owner, introduce a small domain function, derive a value instead of storing it twice, or use the repository's existing generation process. Compare the maintenance cost of the mechanism with the actual drift problem. Do not add a generator, cross-package framework, dependency, or service merely to eliminate a few repeated lines. Independent expected values in tests can provide a useful external check; do not make tests calculate their expectations through the implementation under test.

## Apply and verify

Preserve public contracts and behavior unless the user requested a rule change. Migrate each identified consumer, then remove obsolete representations only after tracing references. Update nearby documentation that would otherwise become incorrect. Treat generated files according to the repository's existing convention.

Run existing checks for the affected consumers. When the change addresses a real drift risk, add or adapt a focused behavioral test covering a boundary where the old copies could disagree. For generated outputs, rerun the existing generator and confirm a second run introduces no unexpected diff. Do not invent a new test suite for a trivial rename.

Inspect the final diff for unrelated edits, newly introduced coupling, and accidental changes to defaults. Leave user edits intact.

## Report

Give the authoritative location, migrated consumers, behavior preserved or intentionally changed, and concrete verification results. Mention any similar code deliberately left separate and the reason. If no semantic duplication was established, report that finding without manufacturing a refactor.

## Source basis

- [Pearson/InformIT — original edition description and contents](https://www.informit.com/store/pragmatic-programmer-from-journeyman-to-master-9780201616224)
- [Pearson — original edition sample, tools chapter, and quick-reference card](https://ptgmedia.pearsoncmg.com/images/9780201616224/samplepages/020161622x.pdf)
- [Dave Thomas and Andy Hunt interview — Orthogonality and the DRY Principle](https://www.artima.com/articles/orthogonality-and-the-dry-principle)
