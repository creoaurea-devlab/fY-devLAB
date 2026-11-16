# Maintenance and design routing

For modifying work, read the canonical maintenance rules below and the source rule relevant to the task. Keep these references as the authority; this entry is a project-specific route, not a copied skill library. Declare this local protocol with `--rules .context/protocols/maintenance.md` in the Wisdom agent task. The session CLI automatically hashes local rules.sources configured in project.yaml, including this protocol. The host must read linked sources; the CLI does not follow Markdown links.

## Apply by task

1. Every code/dependency edit: apply all13 [maintenance rules][maintenance-rules]: understand callers, preserve scope/behavior, use reversible steps, reduce mental load, keep one owner per decision, deliberate errors/cleanup, evidence-based debugging and risk-based verification.
2. Refactoring or diagnosis: select the relevant skill from [the skill index][maintenance-skills] and read its actual SKILL.md; use characterization before risky restructuring. Do not run every skill indiscriminately.
3. Responsibilities, interfaces or dependency changes: use [SOLID routing][solid-routing] and read the applicable rule below. Test valid, failure and state-transition contracts; names/typechecks alone do not establish substitutability.
4. Parallel work: settle shared contracts first, declare disjoint exact write scopes, and use one parent writer for shared planning/context.
5. Completion: use current combined tests, caller/architecture evidence and actual interaction checks for the changed behavior. Update canonical planning reports and project memory. Never turn a report, skill profile or a document link into proof of execution.
6. Deployment: preserve active jobs/drafts/session identities; after promotion run `node scripts/verify-deployment.ts`. This verifies served page/assets and live Hood snapshot against the selected artifact and current owned files. Static Hood is loaded at backend activation, so frontend-only replacement can require a controlled backend restart before claiming source freshness.


## What is mechanically checked

`scripts/maintenance.test.ts` checks this routing/source pins and declared direct cross-owner imports. Regression tests check terminal exclusivity, visibility and Retry behavior. `verify-deployment.ts` checks served build/source freshness. The Python configured-rule regressions check automatic loading, missing-file refusal and project path confinement. Source pin checks attest the reviewed text, not whether an agent obeyed it. SOLID, book principles, coherent responsibilities and readable interfaces still require source review and behavior evidence; there is no universal SOLID-compliance boolean.

The Proto root AGENTS index currently links four absent `.agents/implementation.md`, `architecture.md`, `parallel-work.md` and `verification.md` files. This entry routes directly to the available authoritative documents instead of silently claiming those routes work. Proto/Books is a four-book bibliography, Proto/code is explanatory design notes, and Proto/Code=.txt contains only whitespace. They do not define executable checks. The source Proto package remains unchanged.

## Reviewed source references

The digests below pin the texts reviewed for this project. If a source changes, review the change before updating its digest; do not auto-accept policy drift. Keep the Proto sibling directory available for engineering checks. These documents are engineering inputs, not browser/server runtime dependencies.

[maintenance-rules]: ../../docs/rules/sources/Proto/Code-Maintenance-Skills-and-Rules/RULES.md "sha256:9ebe648ef5790a9be8f49afa927b5b011b2b07bf617fea4bd2b5b06285c4d349"
[maintenance-skills]: ../../docs/rules/sources/Proto/Code-Maintenance-Skills-and-Rules/SKILLS-INDEX.md "sha256:21fd71e574934cc7958609d07a7d09284c677bfcd5a1651f75d9a320bdb7db70"
[solid-routing]: ../../docs/rules/sources/Proto/SOLID/AGENTS.md "sha256:2fc05e7ca7e22990a49ee0bcef82e131a8edf0475716d79f35dacb12eafae354"
[single-responsibility]: ../../docs/rules/sources/Proto/SOLID/rules/single-responsibility.md "sha256:e3bee1f1d0c67a8063bfd9ad2aba7421014621698d8805cbecba746023781d76"
[open-closed]: ../../docs/rules/sources/Proto/SOLID/rules/open-closed.md "sha256:bf4c5fe9e5a5319c406f09f2c52051348afa64dab93f3e062bb9e11d9e62162d"
[liskov-substitution]: ../../docs/rules/sources/Proto/SOLID/rules/liskov-substitution.md "sha256:c514624799f16273cb3c544ddee77c4eb056dac37b4ba9d26a16946f04e457a7"
[interface-segregation]: ../../docs/rules/sources/Proto/SOLID/rules/interface-segregation.md "sha256:a42aa1ee4fce2d1f3cd4d82d311e94799a02504b19e19ca8fc825d2797e0799c"
[dependency-inversion]: ../../docs/rules/sources/Proto/SOLID/rules/dependency-inversion.md "sha256:f4a32624028cc22a466d381b02f7f1a92df269a24d10d91216a536ac30ab175d"
[book-reference]: ../../docs/rules/sources/Proto/Books "sha256:b16a8cdaddbe11bf2d460d6baac36cc3e4b3ae4f1edd849af270db159d4a5acd"
[design-notes]: ../../docs/rules/sources/Proto/code "sha256:e8627aa3c4ae5e00e52bddc7cfddde1b56c5a6bd6479284931f5a86400fd04a4"
[empty-code-reference]: ../../docs/rules/sources/Proto/Code=.txt "sha256:e16f1596201850fd4a63680b27f603cb64e67176159be3d8ed78a4403fdb1700"
[proto-index]: ../../docs/rules/sources/Proto/AGENTS.md "sha256:e3a8d28c2bd81a01cfecb0c108f8989427b5f55fe15c4367f2718f702cf11a22"
