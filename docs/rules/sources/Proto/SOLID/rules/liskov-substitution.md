# L — Liskov Substitution Principle

Read when implementing, replacing, or changing a subtype or provider of a shared contract.

Liskov and Wing define subtyping through behavior: properties established for the supertype must remain valid for its subtypes. Compatible method signatures alone are insufficient; invariants and history properties also matter. [Original paper](https://www.cs.columbia.edu/~wing/publications/LiskovWing94.pdf).

## Agent rules — local application

1. State the contract's valid inputs, promised outputs and errors, invariants, and allowed state transitions.
2. Accept every contract-valid call. A replacement must not add hidden setup requirements or stronger preconditions.
3. Preserve promised results, failure semantics, and state guarantees. Respect cancellation, ordering, and retry behavior when the contract specifies them.
4. Exercise each replacement through the shared consumer contract. Types and successful compilation do not demonstrate behavioral compatibility.
5. If an implementation cannot provide a promised capability, narrow its advertised contract or coordinate a contract change. Avoid implementation-specific exceptions in ordinary consumers.

## Example and review evidence

If `find(id)` promises `null` for an absent run, a replacement store must preserve that outcome rather than throw an undocumented error.

Check valid, missing, failing, and relevant stateful sequences. Implementations may differ in behavior the contract deliberately leaves unspecified; the rule preserves promises rather than requiring identical internals.
