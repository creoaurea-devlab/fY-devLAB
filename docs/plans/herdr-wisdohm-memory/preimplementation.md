# Preimplementation layer

Requested 2026-11-16. Independent checkout: `_devLAB-refactored`; no Git.
Existing surface-stability milestones remain open. This capability stages work;
it does not restore the disconnected planner/executor.

| Slice | Owner | Exact writes | Acceptance | Status |
| --- | --- | --- | --- | --- |
| P1 | service-contracts, project-service (sequential) | `packages/contracts/src/{index,projects,preimp}.ts`, `plugins/project-local/src/{index,preimp}.ts` | One folder/task, canonical owner and exact paths; base copies, conflict detection, reviewed promotion and resumable journal; no code execution | done |
| P2 | http-transport, browser-client | `plugins/transport-http/src/{projects,index}.ts`, `packages/client/client.ts` | Project-scoped validated public command; dedicated sandbox document endpoint with strict response policy; existing app origin/body/CSP controls | done |
| P3 | preview-view, delivery-config | `plugins/ui-preview/src/{pane,prototype}.tsx`, `preview.css`, `vite.config.ts`, `tsconfig.json` | Compact Prototype drawer, plan/source editor, isolated HTML; normal preview retained; staged code excluded from Vite serving/watching and TypeScript roots | done |
| P4 | source-maps, project-view | `scripts/architecture.ts`, `plugins/ui-projects/src/workspace.ts` | Main registry and Build preserve task → owner and staged → destination links; no runtime registration | done |
| P5 | verification, planning-protocol | `scripts/preimp.test.ts`, `scripts/preimp-browser.mjs`, `scripts/boundaries.test.ts`, `_preimp/README.md`, this plan, parent plan, `.agents/MEMORY.md` and `.agents/protocols/rules.md` | Disposable success/refusal/recovery checks, real browser prototype/retention flow, no production imports from staging, types/build, evidence and limits | done |

Canonical ownership additions are limited to the new source/test/readme files and
the source-maps → project-service public dependency. Regenerate the compatibility
projection; no manual edits to its generated contents. No dependencies or backend
plugins are added. Original bytes are in
`../_devLAB-refactored-backups/preimp-20261116/manifest.json`.

Decisions: one existing project service owns filesystem behavior; one existing
preview contribution owns presentation. Task manifests are the single staging
catalog. The registry derives links, and YAML remains the authority for ownership.
Prototype HTML is a simulation, separate from production source. Promotion uses
an explicit content review, preserves base files and does not assert a transaction
across files or control external writers. Live processes are preserved.

## Verification — 2026-11-16

- `node --test scripts/preimp.test.ts scripts/project-workspace.test.ts scripts/project-development.test.ts scripts/project-thread-delete.test.ts`: **23 passed**. Covers staging without source mutation, new nested files, canonical ownership, traversal/symlink/metadata refusal, stale review/source/ownership conflicts, partial creation preservation, interrupted promotion/resume, HTTP origin/body controls, duplicate graph edge prevention and retained project behavior.
- `npm run build`: **passed**, no added dependency/backend plugin. Later backend-only registry metadata changes were rechecked with types/artifact generation in `npm run check`.
- `npm run check`: **12 passed**, including boundary, anatomy, ownership projection, disconnection and current runtime selection checks. An earlier run encountered a concurrently added runtime route expectation failure; the latest current-source run is green. This change did not alter that test expectation.
- `node scripts/preimp-browser.mjs`: **passed at 1440/820/390**. Real UI task creation, editing, prototype interaction, reviewed promotion, parent/storage/fetch denial, retained ordinary iframe and prototype state, no page errors/overflow, and Vite staging refusal. The first browser run exposed inherited app CSP blocking prototype scripts; the dedicated sandbox document endpoint fixed it without relaxing the app policy.
- A disposable Node/Playwright probe read the main registry's staged source and owner connections, opened the real initial catalog prototype without starting its app preview, exercised keyboard resizing, and loaded Build. Production catalog files still equal their staged originals. See `preimplementation/registry.json` and `compact-node-catalog.png`.

Evidence: [verification.json](preimplementation/verification.json),
[browser results](preimplementation/browser.json),
[desktop screenshot](preimplementation/prototype-1440.png),
[mobile screenshot](preimplementation/prototype-390.png),
[merge review](preimplementation/merge-review.png).
The initial CSP failure screenshot is retained as investigation history, not success evidence.

## Shape and limits

Three new feature source files (362 lines including comments at inspection) own
one contract, one filesystem capability and one preview component. Existing client,
transport, registry and project graph adapters were extended; no new store, kernel,
framework, dependency or backend plugin. Test code and the staged catalog copies
are counted separately from product source; this is added functionality, not a
claim of line reduction or speedup.

One owner/task; at most 32 text additions/replacements of 128 KiB each. New plugins
need canonical owner/path declarations before staging. Deletions, renames and a
full production-module overlay runtime are not provided. Prototype HTML uses fake
state, inline scripts/styles and no app imports. CSP blocks fetch/resources/forms;
iframe self-navigation is not an OS-level networking boundary. Changed source,
staged bytes or ownership refuses promotion/resumption. Multi-file promotion has
base copies and a resumable journal, not a cross-file filesystem transaction or a
lock on external processes. Operator test notes do not execute tests or prove them.

The `_preimp/compact-node-catalog` proposal links to S7; no catalog implementation
was merged. The preserved live backend still needs a controlled restart and the
browser a reload to adopt this capability. No live terminal/editor/preview was
stopped or reloaded by this work. Save drafts before activation. Historical planner
and other integration slices remain disconnected/planned as recorded separately.
