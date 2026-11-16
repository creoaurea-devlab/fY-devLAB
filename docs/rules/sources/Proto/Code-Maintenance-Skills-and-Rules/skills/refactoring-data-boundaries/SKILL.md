---
name: refactoring-data-boundaries
description: Refactor an identified tangle of record access, recurring parameter groups, mixed parsing/calculation, or behavior located far from its data. Use when reorganizing existing internal data responsibilities. Do not trigger for database migrations, public API redesigns, new validation policy, or routine data transfer objects that already serve a clear purpose.
---

# Refactor data boundaries without contract drift

Respect the requested mode: for a review-only request, report findings without editing. For requested maintenance changes, implement the bounded change and verify it. Follow repository instructions and preserve unrelated user work.

This original workflow reorganizes internal data responsibilities when callers currently carry unnecessary knowledge. It is suitable for an existing maintenance problem, not a mandate to replace every record with a class.

## Trace ownership and representation

Read local instructions and inspect the working tree. Trace the selected data from input through calculation to output, including callers, serializers, persistence, caches, and test fixtures. Identify who creates it, who mutates it, and who observes those mutations.

Record the existing contract: public keys, missing versus null values, defaults, units, precision, ordering, identity, aliasing, exception types, and side-effect timing. Consider lazy getters, repeated reads, asynchronous work, and framework serialization if they exist in the selected path. A copied object and a shared reference are not interchangeable merely because their initial fields match.

## Select one boundary improvement

Choose the least elaborate change that addresses the demonstrated problem. Options include placing access behind a small function, grouping arguments that represent one concept, moving a calculation to the module that owns its inputs, or separating interpretation of raw input from computation on an explicit intermediate value. Follow the repository's functional or object-oriented conventions.

Before adding a type or object, give its responsibility a concrete name and identify which callers become simpler. Keep a straightforward transfer record when it is already the appropriate boundary. Avoid new generic repositories, broad class hierarchies, or speculative validation frameworks.

## Migrate in compatible increments

Introduce the internal boundary while preserving the current external representation. Update a small set of internal callers, verify, and continue until the targeted access pattern is consistently handled. Keep adapters only while they have actual consumers, then remove obsolete local paths.

Do not silently add validation, normalize strings, change date handling, reorder collections, alter rounding, or reject inputs previously accepted. Those are functional decisions and need separate expectations and changes when authorized. Report known defects as defects; characterization of the current system must not present them as desirable requirements.

Treat database schema changes, persisted-format migrations, and published API changes as distinct work. This skill alone does not authorize them. If the requested task includes such work, separate its migration and compatibility plan from the internal refactoring.

## Verify the boundary

Run relevant existing tests before and after the change. Add a focused case only where a concrete risk lacks coverage: round-trip serialization, shared-reference mutation, absence versus explicit null, ordered output, or a failure after a write. Assert observable outcomes rather than helper names or implementation call counts, unless the interaction itself is a required external contract.

Inspect the final diff for duplicated normalization, leaked internal types, and unnecessary conversion layers. Run required gates and stop once the selected boundary is simpler and adequately checked. Report which responsibility moved, which external contract was preserved, observed verification results, and any remaining uncertainty.

Source basis: [Encapsulate Record](https://refactoring.com/catalog/encapsulateRecord.html), [Data Clump](https://martinfowler.com/bliki/DataClump.html), [Move Function](https://refactoring.com/catalog/moveFunction.html), and [Split Phase](https://refactoring.com/catalog/splitPhase.html).