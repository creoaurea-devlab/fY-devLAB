# SOLID research

Researched: 2026-10-28. Scope: primary-source meanings of the five principles and their practical use in this protocol collection. This is background evidence; the folder's agent entry point owns operational guidance.

## Context and method

Martin presents SOLID as guidance for controlling dependencies and separating concerns. His later account treats substitution as an interface-behavior issue, rather than only class inheritance, and emphasizes dependencies across architectural boundaries. These are the author's design arguments, not measurements of productivity or defect reduction. [Robert C. Martin, “Solid Relevance” (2020)](https://blog.cleancoder.com/uncle-bob/2020/10/18/Solid-Relevance.html)

I checked Martin's own explanations and original ISP/DIP articles, plus Liskov and Wing's paper. The practical adaptations below are this collection's recommendations, not additional principles attributed to those authors.

## S — Single Responsibility Principle

Martin describes responsibility through the people or business function requesting changes. A module should answer to one coherent source of change; code that changes for the same reasons belongs together, while independently changing concerns should be separated. His example distinguishes pay calculation, hours reporting, and persistence because different organizational needs govern them. This makes SRP a cohesion and coupling principle. It does not define responsibility by counting methods, lines, or files, and Martin explicitly distinguishes program responsibilities from programmers' bug fixes and refactorings. [Martin, “The Single Responsibility Principle” (2014)](https://blog.cleancoder.com/uncle-bob/2014/05/08/SingleReponsibilityPrinciple.html)

**Application here:** Before splitting a capability, name the independent changes it must absorb. A cohesive module can contain several functions and tests. Separate independently governed policy, presentation, or storage concerns when their coupling causes a concrete problem.

## O — Open/Closed Principle

Martin explicitly corrects an overly absolute reading of his earlier writing: OCP does not prohibit changing existing source code. Closure is strategic, protecting a module against selected kinds of change. When behavior varies in an expected way, the goal is to add that variation with little or no change to existing stable behavior, rather than make sweeping edits across the system. No significant program can be closed against every possible change. The useful question is therefore which variation a boundary should isolate, rather than whether a file may ever be edited. [Martin, “An Open and Closed Case” (2013)](https://blog.cleancoder.com/uncle-bob/2013/03/08/AnOpenAndClosedCase.html)

**Application here:** Add a provider through an established extension contract when that contract already captures the required variation. For a new requirement outside that contract, improve the design directly instead of predicting a universal plugin framework.

## L — Liskov Substitution Principle

Liskov and Wing define subtyping through preserved behavior: properties established for supertype objects must also hold for subtype objects. Compatible method signatures alone are insufficient. Their treatment includes method specifications, invariants, and history properties governing observable state changes. In practical contract terms, a replacement must support the calls the supertype permits and preserve its promised outcomes and state constraints. This is stronger than merely compiling against an interface, but does not require identical internal algorithms or behavior the contract leaves unspecified. [Barbara Liskov and Jeannette Wing, “A Behavioral Notion of Subtyping” (1994), especially §§1 and 5](https://www.cs.columbia.edu/~wing/publications/LiskovWing94.pdf)

**Application here:** A provider that accepts the right TypeScript shape but rejects contract-valid requests, silently changes ordering guarantees, or violates promised state transitions is not an acceptable substitute. Verify shared observable requirements with contract tests; name genuinely different capabilities explicitly.

## I — Interface Segregation Principle

Martin identifies unwanted coupling when clients depend on interface members needed only by other clients. His remedy is cohesive interfaces shaped around distinct client needs. One underlying object may legitimately implement several such interfaces; splitting its implementation is not essential to separating the client dependencies. The original discussion concerns unrelated changes propagating through interface dependencies, illustrated with doors and timer notifications. The criterion is therefore the client's cohesive role, not an arbitrary maximum method count or the smallest interface imaginable. [Martin, “The Interface Segregation Principle” (1996), especially pp. 2 and 5–6](https://objectmentor.com/resources/articles/isp.pdf)

**Application here:** Give a listing screen the read capability it needs rather than a store contract containing administration and mutation operations. Keep operations together when the same client needs them for one coherent task.

## D — Dependency Inversion Principle

Martin states two connected requirements: high-level policy and low-level implementation depend on abstractions, and abstractions remain independent of implementation details. His examples replace direct device dependencies with reader/writer abstractions so the copying policy can be reused. He also explains that a C implementation using standard I/O abstractions achieves the same dependency inversion without classes. The central issue is the direction of dependencies and isolation of policy, rather than a requirement to introduce a particular object-oriented mechanism. [Martin, “The Dependency Inversion Principle” (1996), especially pp. 4–6](https://objectmentor.com/resources/articles/dip.pdf)

**Application here:** Let the workflow capability consume its required store contract; let an adapter implement it and composition select the concrete store. Passing a function or object directly can be sufficient. A DI container is an implementation choice, not evidence that dependencies point in the right direction.

## Anti-bloat synthesis

These are this collection's design recommendations, inferred from the principles and its existing simplicity rules:

1. Start with an observed change, client need, or required boundary before introducing abstraction.
2. Use functions and modules where they express the contract clearly; add classes or plugin machinery for an actual need.
3. Optimize for cohesive capabilities, rather than maximum numbers of files, interfaces, or agents.
4. Keep ordinary direct dependencies when a new abstraction would solve no present policy/detail problem.
5. Validate proposed boundaries through affected callers, behavior checks, and dependency inspection; terminology alone proves little.

## Limits

This research is a focused reading of primary design literature, not an empirical comparison of architectures. Examples for TypeScript, providers, and agent workflows are adaptations; the cited sources do not prescribe this repository's layout. The original Liskov/Wing paper gives formal treatments beyond the practical checklist summarized here. No application code was changed or benchmarked, and no claim is made that applying all five principles mechanically improves every design.
