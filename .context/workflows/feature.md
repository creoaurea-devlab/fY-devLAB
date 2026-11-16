# Feature Workflow

Use for new user-visible behavior, capabilities, or supported contracts.

1. State acceptance criteria and locate or create the feature specification.
   Resolve material ambiguity before committing to an incompatible design.
2. Identify affected modules, public surfaces, ownership, and dependencies from
   the registry and repository evidence.
3. Choose the smallest end-to-end slice. Delegate only independent packages
   with disjoint write sets and explicit verification.
4. Implement within the preflight contract, including validation, error states,
   accessibility, or compatibility behavior that the affected boundary needs.
5. Verify the focused behavior and relevant integration surface, then run the
   configured broader check proportionate to risk.
6. Reconcile the acceptance criteria, register changed module surfaces, apply
   material context updates, and report evidence plus remaining limitations.

Before the first implementation write, register the feature and its goal/milestone/slice/atomic tasks. Split workers by module/plugin and explicit interfaces. Missing UI/consumer wiring blocks feature completion. Follow the canonical rules in protocols/rules.md.
