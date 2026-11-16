---
name: clean-code-readable-code
description: Improve names, comments, and local presentation when the user specifically requests readability cleanup or a Clean Code review of identified files. Use for ambiguous identifiers, misleading comments, and hard-to-scan local structure. Do not trigger for every coding task, architecture redesign, broad formatting migrations, or functional changes.
---

# Readable code

Respect the requested mode: for a review-only request, report findings without editing. For requested maintenance changes, implement the bounded change and verify it. Follow repository instructions and preserve unrelated user work.

This is an original Codex maintenance workflow inspired by *Clean Code* (Robert C. Martin, 2008), not a quotation or a claim that every recommendation is universally appropriate.

## Establish the reading problem

Read repository instructions, the requested files, and nearby callers before editing. Identify the concrete misunderstanding a future maintainer could have: an ambiguous unit, two names for one domain concept, a stale explanation, or a condition whose meaning requires mental translation. Prefer the repository's existing vocabulary over a personal naming style.

Inspect the working tree and preserve unrelated edits. Separate internal symbols from externally observable names: exported members, JSON keys, database fields, CLI flags, telemetry events, URLs, persisted settings, and names discovered dynamically. An apparent rename may be a contract change even when the compiler accepts it.

## Make a bounded improvement

Choose the smallest area that resolves the observed confusion. Use symbol-aware rename support when available, otherwise search references and inspect each affected occurrence. For example, rename a private duration variable to include its actual unit only after tracing where that unit is produced and consumed. Do not guess semantics from the old name.

Rewrite a complicated expression into a named local value only when its name communicates a stable idea. Avoid adding layers that force readers to jump between files for a simple operation. Keep comments that explain constraints, trade-offs, protocol quirks, safety invariants, or surprising behavior. Remove a comment only after verifying it is redundant, obsolete, or false; update public documentation when an authorized change makes it inaccurate.

Use the project's existing formatter on the changed scope. Do not reformat the entire repository, switch formatting rules, or replace whole files to improve a few lines. Generated code should normally be fixed through its generator or left outside this cleanup.

## Verify proportional to the risk

Review the diff for accidental literal changes and unrelated churn. For internal renames, run an available type check or compile check when it can detect missed references. Search old names and review remaining matches, including configuration and templates. Use existing focused tests if reference resolution, reflection, or changed conditions create a real behavior risk. Do not add tests for punctuation, comments, or a proven mechanical local rename.

Stop when the specific reading problem is resolved. If an exported rename would break compatibility, keep the external spelling and improve the local explanation, or present the migration separately.

## Report

Return the concrete readability improvement, the affected files, and the checks actually performed. State any unresolved naming ambiguity or contract limitation. Avoid presenting a readability preference as a proven defect.

## Source basis

- [Pearson: Clean Code, first edition — overview and detailed table of contents](https://www.pearson.com/en-us/subject-catalog/p/clean-code-a-handbook-of-agile-software-craftsmanship/P200000009044?view=educator)
