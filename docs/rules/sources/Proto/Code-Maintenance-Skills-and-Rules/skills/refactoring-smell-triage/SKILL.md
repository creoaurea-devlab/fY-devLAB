---
name: refactoring-smell-triage
description: Assess a named module, change set, or maintenance hotspot for evidence-backed refactoring opportunities. Use when the user asks what to clean up or where complexity is slowing changes. Review first; implement only when the task also authorizes fixes. Do not trigger as a blanket style gate for all coding work.
---

# Triage maintenance smells with evidence

Respect the requested mode: for a review-only request, report findings without editing. For requested maintenance changes, implement the bounded change and verify it. Follow repository instructions and preserve unrelated user work.

This original workflow turns recognizable code symptoms into a small, useful maintenance decision. A smell is a reason to investigate; it is not proof that code is wrong or permission to redesign the repository.

## Inspect a concrete scope

Read repository instructions and the user's target. Inspect relevant code, callers, tests, and existing abstractions. Check recent local history when available and useful for understanding change frequency or repeated fixes. Avoid requesting broad access merely to obtain a score.

Look for repeated business decisions, concepts scattered across modules, branches that mix unrelated responsibilities, parameter groups that recur together, functions that repeatedly reach into another module's representation, or indirection that adds no useful concept. Use search to verify the pattern beyond its first occurrence. A large function, plain data object, or repeated syntax can be appropriate; do not impose universal size thresholds.

## Establish the maintenance consequence

For each candidate, identify the actual cost: the same rule must be updated in several places; a caller must understand internal storage; a change crosses unrelated responsibilities; or the normal path is difficult to locate. Distinguish observed facts from inference about future work.

Check whether apparently similar code represents the same domain rule. Two coincidentally similar operations may evolve independently and should not automatically share an abstraction. Likewise, extracting tiny helpers can increase navigation and obscure the complete operation. Include leaving the code as it is among the valid outcomes.

## Rank useful options

Return no more than five material findings for an ordinary review. Rank them using evidence about change likelihood, failure impact, dependency reach, and effort. Qualitative priority is sufficient; do not manufacture precise technical-debt scores. For each finding, provide the relevant path or symbol, a concise maintenance consequence, the smallest promising transformation, and its verification need.

Prefer a bounded refactor that supports the current task over speculative infrastructure. Name the behavior that would need protection, including return values, public interfaces, order-sensitive processing, errors, mutation, and external effects. Flag uncertainty when dynamic consumers or absent tests prevent confidence.

## Act only within the requested scope

If asked to review, deliver findings without changing production files. If the task also authorizes improvement, implement the highest-value bounded change with small steps and focused feedback. Do not require fresh approval for an already authorized reversible change.

Keep defect reports separate from structural findings. A known bug requires its own expected behavior and functional patch; do not hide it in a refactoring. Add tests only for concrete uncovered risks and avoid tests that assert private structure. Finish when the selected maintenance cost is reduced; do not expand into repository-wide polishing.

Deliver findings or the completed change, evidence and verification results, plus any deferred issue that materially affects the decision. An evidence-backed report of no worthwhile refactoring is an acceptable result.

Source basis: [Code Smell](https://martinfowler.com/bliki/CodeSmell.html), [Data Clump](https://martinfowler.com/bliki/DataClump.html), and [catalog](https://refactoring.com/catalog/).