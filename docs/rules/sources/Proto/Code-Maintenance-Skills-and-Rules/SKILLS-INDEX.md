# Skill index

Choose the skill that matches the actual maintenance problem. Use additional skills only when they address a distinct part of the task.

## Clean Code: A Handbook of Agile Software Craftsmanship

| Skill | Purpose |
| --- | --- |
| [Clean Code: Readable Code](skills/clean-code-readable-code/SKILL.md) | Improve names, comments, and local readability safely. |
| [Clean Code: Focused Functions](skills/clean-code-focused-functions/SKILL.md) | Simplify tangled functions without fragmenting the code. |
| [Clean Code: Cohesive Boundaries](skills/clean-code-cohesive-boundaries/SKILL.md) | Reduce a concrete coupling problem with bounded changes. |
| [Clean Code: Errors and Tests](skills/clean-code-errors-and-tests/SKILL.md) | Clarify failure handling and cover meaningful risks. |

**Example requests**

- Use $clean-code-readable-code to improve readability in the requested code, preserving behavior and public contracts.
- Use $clean-code-focused-functions to simplify the specified function while preserving behavior, side-effect order, and useful locality.
- Use $clean-code-cohesive-boundaries to improve the specified module's responsibility and dependencies without an unnecessary architecture rewrite.
- Use $clean-code-errors-and-tests to review the specified failure path, fix supported problems, and verify meaningful behavior with the project's existing tools.

## Refactoring: Improving the Design of Existing Code

| Skill | Purpose |
| --- | --- |
| [Refactoring: Characterize Behavior](skills/refactoring-characterize-behavior/SKILL.md) | Establish behavior before a risky refactor. |
| [Refactoring: Small Safe Steps](skills/refactoring-small-safe-steps/SKILL.md) | Restructure existing code through verified, reversible changes. |
| [Refactoring: Smell Triage](skills/refactoring-smell-triage/SKILL.md) | Rank concrete maintenance problems before choosing a refactor. |
| [Refactoring: Data Boundaries](skills/refactoring-data-boundaries/SKILL.md) | Encapsulate tangled data access without changing contracts. |

**Example requests**

- Use $refactoring-characterize-behavior to identify the behavior this change must preserve and add only the missing checks that materially reduce refactoring risk.
- Use $refactoring-small-safe-steps to perform this refactor in small verified transformations while preserving observable behavior.
- Use $refactoring-smell-triage to identify the highest-value refactoring opportunities in this scope, with evidence and proportionate verification plans.
- Use $refactoring-data-boundaries to simplify this data flow while preserving public shapes, mutation semantics, errors, ordering, and side effects.

## The Pragmatic Programmer: From Journeyman to Master

| Skill | Purpose |
| --- | --- |
| [Pragmatic Single Source of Truth](skills/pragmatic-single-source-of-truth/SKILL.md) | Unify duplicated knowledge without coupling unrelated code. |
| [Pragmatic Decoupled Design](skills/pragmatic-decoupled-design/SKILL.md) | Reduce a proven dependency problem with a small boundary change. |
| [Pragmatic Debug with Evidence](skills/pragmatic-debug-with-evidence/SKILL.md) | Reproduce failures, test hypotheses, and verify the causal fix. |
| [Pragmatic Reproducible Workflow](skills/pragmatic-reproducible-workflow/SKILL.md) | Make an existing build or maintenance procedure repeatable. |

**Example requests**

- Use $pragmatic-single-source-of-truth to find one duplicated business rule in this project and consolidate its ownership with focused verification.
- Use $pragmatic-decoupled-design to trace the dependencies around this change and reduce the coupling that makes it difficult to maintain.
- Use $pragmatic-debug-with-evidence to reproduce this failure, identify its cause through evidence, and verify the smallest effective fix.
- Use $pragmatic-reproducible-workflow to reproduce this project's existing checks and simplify the repeated local procedure with the smallest maintainable change.

## A Philosophy of Software Design

| Skill | Purpose |
| --- | --- |
| [Design Deep Modules](skills/philosophy-deep-modules/SKILL.md) | Simplify interfaces while preserving coherent capability. |
| [Hide Changeable Design Decisions](skills/philosophy-hide-design-decisions/SKILL.md) | Contain volatile knowledge within a clear owner. |
| [Compare Design Alternatives](skills/philosophy-design-alternatives/SKILL.md) | Compare real options before a costly boundary change. |
| [Explain Contracts and Invariants](skills/philosophy-explain-invariants/SKILL.md) | Document the facts future edits must preserve. |

**Example requests**

- Use $philosophy-deep-modules to inspect the requested component, reduce caller complexity, and verify any authorized refactor.
- Use $philosophy-hide-design-decisions to locate leaked implementation knowledge and isolate one changeable decision behind a stable contract.
- Use $philosophy-design-alternatives to compare two viable designs for this consequential change, recommend one, and implement it if implementation is authorized.
- Use $philosophy-explain-invariants to clarify non-obvious contracts, invariants, and design reasons in the requested code, checking each claim against implementation.

