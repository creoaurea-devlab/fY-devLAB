# Refactor Workflow

Use for structural improvement that should preserve observable behavior.

1. Name the structural problem, intended invariant, and behavior that must not
   change. Establish a focused baseline before editing.
2. Map callers, consumers, public surfaces, data boundaries, and generated files.
   Separate required compatibility work from unrelated cleanup.
3. Plan reversible stages. Delegate only disjoint stages that do not depend on
   an unmerged shared contract.
4. Change the smallest coherent boundary. Preserve APIs and serialized shapes,
   or explicitly classify and document an authorized migration.
5. Re-run the baseline and affected tests after each meaningful stage; compare
   externally visible output when tests cannot fully prove equivalence.
6. Remove transitional code only after consumers are verified, update material
   architecture facts, and report preserved invariants and residual risk.
