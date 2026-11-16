---
name: philosophy-hide-design-decisions
description: Use when storage details, vendor formats, configuration rules, serialization, or lifecycle assumptions are repeated across components and changes require coordinated edits. Find the decision's owner and reduce external knowledge without hiding required domain policy.
---

# Hide Changeable Design Decisions

Respect the requested mode: for a review-only request, report findings without editing. For requested maintenance changes, implement the bounded change and verify it. Follow repository instructions and preserve unrelated user work.

Use a likely maintenance change to find implementation knowledge that has spread beyond its proper owner. The conceptual starting point is Ousterhout's discussion of information hiding in [Modular Design](https://web.stanford.edu/~ouster/cgi-bin/cs190-winter18/lecture.php?topic=modularDesign); the following procedure is an original coding workflow.

## Scope the decision

Read local instructions, the requested feature or bug, and relevant code. Choose one concrete decision whose change would cause avoidable work: a provider response format, storage encoding, retry classification, cache key structure, or deployment-specific lookup. Prefer evidence from current code and the user's request over invented future requirements.

State what callers actually need to accomplish. Keep externally meaningful policy visible, including permission requirements, user-visible consistency guarantees, and explicitly selected business rules. A decision belongs inside a boundary only when callers can safely stop knowing its representation.

## Map and contain the knowledge

1. Search definitions and uses with repository search. Include tests, schema files, configuration, and serialization code when relevant. Build a small map of each location that knows the chosen fact and how it uses it. Identical strings alone are not enough; distinguish coincidental text from shared semantics.
2. Name one owner and explain why its responsibility fits. Choose an existing module when practical. Avoid inventing a generic utility package merely to relocate code.
3. Define the owner's contract using domain operations or stable values. For a provider integration, callers might receive a domain result while provider-specific codes stay inside the adapter. Specify unavoidable errors and material side effects rather than pretending the dependency cannot fail.
4. Move knowledge and its associated logic together. Update all authorized consumers consistently. If old interfaces must survive, use an explicit compatibility adapter and identify its future removal condition; do not maintain divergent implementations.
5. Check whether the proposed split merely follows execution stages. Parsing, validation, and persistence may need separate responsibilities, but a shared format must still have one authoritative definition.

## Verify the boundary

Run a search after editing for the specific representation that should have become private. Investigate each remaining occurrence instead of treating an empty search as the sole success criterion. Public protocol fixtures and migration data may legitimately retain it.

Run focused existing checks. For a consequential compatibility change, exercise an alternative valid representation or provider response and confirm callers behave through the same contract. Add such a test only when it protects a real risk. Inspect failure translation so diagnostics retain enough context without exposing sensitive data.

## Limits and output

Do not erase helpful types, expose untyped catch-all objects, centralize unrelated constants, or create an oversized module. Sharing a dependency does not mean all consumers should be merged. Do not change a persisted format or public API without an explicit migration strategy within the authorized task.

Report the decision, its owner, consumer obligations removed, and verification evidence. Include any remaining intentional leaks with a concrete compatibility reason. If implementation was not requested, deliver the knowledge map and a bounded proposal instead of editing.