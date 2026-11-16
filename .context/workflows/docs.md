# Documentation Workflow

Use for user, operator, contributor, or API documentation changes.

1. Identify the audience, task, authoritative source, and documentation surface.
2. Verify commands, paths, configuration names, defaults, and behavior against
   current code or executable help; do not preserve a stale claim for style.
3. Write the smallest complete explanation in the repository's local voice and
   structure. Separate required steps from optional guidance.
4. Preserve security boundaries: use placeholders for secrets and private data,
   and call out destructive or production-affecting actions before commands.
5. Validate links, examples, snippets, and formatting with available tooling;
   directly inspect rendered structure when no documentation test exists.
6. Report the authoritative evidence used, validation result, and any behavior
   that remains intentionally undocumented or uncertain.
