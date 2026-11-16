# 40 fundamentals for maintaining good code

Ten practical fundamentals per book. These are concise paraphrases, not book excerpts. The accompanying skills are original maintenance workflows.

## Clean Code: A Handbook of Agile Software Craftsmanship

**Author:** Robert C. Martin

The pictured book is the original 2008 edition. Fundamentals are concise paraphrases; the skills are original, book-inspired Codex workflows, not quotations or a reconstruction of the book.

1. **Names reveal intent.** Use domain language that makes purpose clear.
2. **Focused functions.** Give each function a coherent job.
3. **Consistent abstraction.** Keep implementation detail from obscuring an operation's purpose.
4. **Visible effects.** Make state changes apparent to callers.
5. **Remove meaningful duplication.** Keep shared rules in one maintained place.
6. **Useful comments.** Explain reasoning and constraints; avoid narrating obvious code.
7. **Consistent presentation.** Follow team formatting so structure is easy to scan.
8. **Cohesive design.** Group related responsibilities and control dependency boundaries.
9. **Clear failures.** Handle errors explicitly while keeping ordinary logic readable.
10. **Maintained tests and code.** Keep tests understandable and improve code incrementally.

**Sources**

- [Pearson: Clean Code, first edition — overview and detailed table of contents](https://www.pearson.com/en-us/subject-catalog/p/clean-code-a-handbook-of-agile-software-craftsmanship/P200000009044?view=educator)

## Refactoring: Improving the Design of Existing Code

**Author:** Martin Fowler, with Kent Beck

Second edition (2018), visibly identified on the pictured cover. The fundamentals are concise paraphrases; the Codex workflows are original applications, not book excerpts.

1. **Preserve observable behavior.** Improve internal structure while keeping the externally relied-on results and interactions intact.
2. **Make small transformations.** Build substantial improvements from steps small enough to understand, verify, and undo individually.
3. **Keep reliable feedback.** Use focused automated checks to notice regressions while the structure changes.
4. **Investigate smells.** Duplication, long functions, and data clumps are clues to examine, not automatic rewrite orders.
5. **Name the underlying intent.** Extract and rename expressions or functions when the resulting name explains a useful concept.
6. **Put behavior near its data.** Move functions or fields when their current placement causes unnecessary dependency and navigation.
7. **Encapsulate representation.** Provide a boundary around records or collections so callers need less knowledge of their storage.
8. **Group related values.** Model recurring groups of arguments as meaningful concepts when they travel and change together.
9. **Separate processing phases.** Distinguish stages such as interpreting input and performing calculations with an explicit intermediate representation.
10. **Make decisions easier to follow.** Simplify conditional structure when equivalent expressions or guard clauses make the normal path clearer.

**Sources**

- [Refactoring — official book page](https://martinfowler.com/books/refactoring.html)
- [Refactoring — definition and overview](https://refactoring.com/)
- [Catalog of Refactorings](https://refactoring.com/catalog/)
- [Workflows of Refactoring](https://martinfowler.com/articles/workflowsOfRefactoring/fallback.html)
- [Refactoring code that accesses external services](https://martinfowler.com/articles/refactoring-external-service.html)
- [Code Smell](https://martinfowler.com/bliki/CodeSmell.html)
- [Data Clump](https://martinfowler.com/bliki/DataClump.html)
- [Extract Function](https://refactoring.com/catalog/extractFunction.html)
- [Move Function](https://refactoring.com/catalog/moveFunction.html)
- [Encapsulate Record](https://refactoring.com/catalog/encapsulateRecord.html)
- [Split Phase](https://refactoring.com/catalog/splitPhase.html)
- [Replace Nested Conditional with Guard Clauses](https://refactoring.com/catalog/replaceNestedConditionalWithGuardClauses.html)

## The Pragmatic Programmer: From Journeyman to Master

**Author:** Andrew Hunt and David Thomas

The original edition pictured, published in 1999. Fundamentals use topics verified in the original publisher contents and sample, rather than additions exclusive to the 2019 edition. Skills are original practical applications, not book extracts.

1. **Own the outcome.** Take responsibility for problems and offer workable options.
2. **Repair small decay.** Address damaged code before neglect becomes normal.
3. **Keep knowledge authoritative.** Give each business rule one owner; similar-looking code need not share meaning.
4. **Separate independent concerns.** A change in one concern should disturb as few others as possible.
5. **Preserve reversibility.** Keep expensive technology decisions replaceable where that has practical value.
6. **Build a working slice early.** Connect a narrow path through the system to check assumptions.
7. **Debug deliberately.** Reproduce failures and challenge assumptions before changing code.
8. **Make contracts explicit.** State valid inputs, promised outputs, and invariants.
9. **Version and automate repeatable work.** Keep changes recoverable and routine procedures reproducible.
10. **Test behavior that matters.** Use feedback to expose defects, including recurrence of fixed bugs.

**Sources**

- [Pearson/InformIT — original edition description and contents](https://www.informit.com/store/pragmatic-programmer-from-journeyman-to-master-9780201616224)
- [Pearson — original edition sample, tools chapter, and quick-reference card](https://ptgmedia.pearsoncmg.com/images/9780201616224/samplepages/020161622x.pdf)
- [Dave Thomas and Andy Hunt interview — Orthogonality and the DRY Principle](https://www.artima.com/articles/orthogonality-and-the-dry-principle)

## A Philosophy of Software Design

**Author:** John Ousterhout

The pictured edition cannot be established from the cover alone. These fundamentals use the author's public material covering the second edition (2021); the skills are original applications, not book excerpts.

1. **Reduce complexity.** Make changes require less context, fewer dependencies, and fewer coordinated edits.
2. **Invest in lasting design.** Fix structural friction during useful work instead of accumulating expedient patches.
3. **Build deep modules.** Offer substantial capability through an interface that is easy to understand.
4. **Hide design decisions.** Keep changeable implementation knowledge with one owner so callers do not depend on it.
5. **Generalize the interface modestly.** Cover current needs with coherent operations; avoid speculative features and unnecessary special cases.
6. **Give layers distinct purposes.** A new layer should introduce a useful abstraction, not just forward the same calls.
7. **Absorb shared complexity.** Solve recurring caller problems inside the responsible module when that simplifies the whole system.
8. **Simplify error contracts carefully.** Remove needless failure cases through sound semantics while preserving meaningful failure signals.
9. **Compare consequential designs.** Explore alternatives before committing to a costly interface or module boundary.
10. **Document hidden meaning.** Explain contracts, invariants, and rationale; use early documentation to expose confusing designs.

**Sources**

- [Author's book page and second-edition notes](https://web.stanford.edu/~ouster/cgi-bin/aposd.php)
- [John Ousterhout — Modular Design, CS 190](https://web.stanford.edu/~ouster/cgi-bin/cs190-winter18/lecture.php?topic=modularDesign)
- [John Ousterhout — Writing Comments, CS 190](https://web.stanford.edu/~ouster/cgi-bin/cs190-winter18/lecture.php?topic=comments)
- [Discussion of A Philosophy of Software Design, CS 190 (2024)](https://web.stanford.edu/~ouster/cs190-winter24/lectures/aposd/)
- [John Ousterhout — Error Handling, CS 190](https://web.stanford.edu/~ouster/cgi-bin/cs190-spring15/lecture.php?topic=errorHandling)
- [John Ousterhout — Introduction, CS 190](https://web.stanford.edu/~ouster/cgi-bin/cs190-winter19/lecture.php?topic=intro)

