# D — Dependency Inversion Principle

Read when business policy imports infrastructure details or when connecting replaceable implementations.

Martin's DIP puts high-level policy and low-level details behind abstractions: abstractions stay independent of details, and details depend on the abstractions. His original discussion also illustrates abstraction without classes. [Original paper](https://objectmentor.com/resources/articles/dip.pdf).

## Agent rules — local application

1. Define the port in the policy's vocabulary, containing what the consumer needs. Avoid leaking database rows, vendor SDK types, or framework objects into that contract.
2. Keep the contract with its owning capability or an existing neutral contracts module. Keep concrete adapters dependent on it.
3. Select and connect implementations in composition. Policy may invoke an adapter at runtime while its source imports only the contract.
4. Pass a function or object directly when sufficient. A DI container, interface per class, or generic service locator is not a requirement.
5. Keep deliberate direct dependencies on stable utilities and values when they create no policy/detail boundary problem.

## Example and review evidence

Use source dependency direction `workflow → RunStore contract ← SQLite adapter`; composition connects both. The workflow should not import the SQLite implementation.

Inspect imports and contract types, then exercise policy through a lightweight implementation. Passing dependencies as parameters does not invert a boundary if policy still depends on the concrete vendor API.
