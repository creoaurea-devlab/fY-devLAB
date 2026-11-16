# DevLab simplification plan

Created: 2026-11-15. Edition: `_devLAB-refactored`; copied independently from
`../_devLAB/` on the user’s instruction, without Git. Scope: retain the current development workspace while making
ownership, dependencies and maintenance easier to understand. This is the current
engineering plan, maintained directly under the
[update rules](../../.agents/protocols/updates.md). It is not registered with the
disconnected product planner and does not dispatch agents.

Further compact UI and Herdr / WISDOHM 3 / Memory Node integration work is tracked
in the [integration plan](herdr-wisdohm-memory.md). The lean boot invariants are
mandatory there too; this file retains the completed refactor and its evidence.

## Outcome and constraints

Keep projects/editing, canvas, real terminals, previews, Hood and rules inspection.
Keep the existing kernel and public plugin model. Reduce mixed responsibilities,
duplicate rules and misleading guidance. A successful refactor explains one
responsibility more clearly and preserves its observed behavior; shorter files
alone are not success. Performance claims require a reproducible measurement.

Preserve dirty editor buffers, canvas revisions, preview iframe identity, terminal
ownership/confinement, cancellation, cleanup and meaningful failures. Keep browser
and server dependencies separate. No framework replacement, new execution engine,
planner reconnection, dependency upgrade, Git initialization or deployment is part
of this plan. Existing user data, prototypes and recovery archives stay preserved.

## Baseline

Source inspected on 2026-11-15: [backend profile](../../src/profile.ts),
[UI catalog](../../src/contributions.ts), [workspace owners](../../src/workspace.ts),
[HTTP transport](../../plugins/transport-http/src/index.ts),
[workspace shell](../../plugins/ui-shell/src/view.tsx),
[rules reader](../../plugins/rules-local/src/read-memory.py),
[commands](../../package.json), [Vite configuration](../../vite.config.ts).

The prior 2026-11-14 scan counted 18,033 local application-source lines in 85 files,
including CSS, excluding tests, scripts, generated outputs and vendor sources.
The host itself had 1,168 lines across eight files; the packaged kernel had 325.
Declared package dependencies were acyclic. These are dated observations, not
size budgets or proof of all resolved import boundaries.

## Work order and status

Run bounded steps sequentially. Record exact new paths under the owning capability
before implementation. Shared-contract changes precede their consumers. The owners
below refer to `.agents/ownership/<group>/<id>.yaml`; support from `verification`
owns test changes and `planning-protocol` owns plan/memory updates.

| ID | Status | Depends on | Outcome / next action |
| --- | --- | --- | --- |
| S0 | done | — | Current plan, memory, update rules and entry documentation are connected; links and ownership validated. |
| S1 | done | S0 | Current editable-source boundary guards, reviewed guidance pins and retained-feature baseline. |
| S2 | done | S1 | Terminal protocol/stream handling extracted; transport retains admission and disposal. |
| S3 | done | S1, S2 | Settings/icon presentation extracted; shell state, keyboard and retained mounts stay in place. |
| S4 | done (assessment) | S1, S3 | Keep the cohesive reader: shared path/bounds policy crosses formats; no demonstrated maintenance benefit from another split. |
| S5 | done (assessment) | S2–S4 | Fresh isolated build verified; no dependency removal or performance claim justified. |
| H1 | done | S1 | Seven stacked anatomy layers, Dagre drill-down, plugin/source views and responsive browser checks. |
| H2 | done | H1 | Source graph minimap clipping corrected; shared sizing now maintained by H3. |
| H3 | done | H1 | Build canvas projection handles omitted host layers; graph loading, minimap gestures and draft retention verified. |
| QA1 | done (investigation only) | H3 | Five evidenced issues; fixes remain open. Prioritize duplicate-path draft loss, unreadable initial Build framing and clipped narrow navigation. |
| RT | done | H3, R5 | Root runtime composition, startup switches, registry routing and an excluded component laboratory; check/build and focused discovery checks passed. |
| RT1 | done (staged only) | RT | Implemented and verified runtime inventory/selection/rewind, read-only search and local diagnostics in 11 owner tasks. User explicitly requested no merge; production destinations remain unchanged. |

| RT2 | in progress | RT1 | Full unchanged DeepSeek Harness Runtime through an isolated native host, registry federation, per-package switches/tests and replacement canvas node; verified source/staging backup saved before implementation. |
| RT3 | done (active) | RT2 | Backed up, merged and activated by explicit request. Eleven DevLab plugins and native registry federation are live; 15 terminal identities, 18 projects and five preview URLs retained/restored. |

## S0 — Current guidance and memory

Owners: `coordination/planning-protocol`, `coordination/governance-runtime`,
`delivery/delivery-config`. Scope: `AGENTS.md`, `README.md`, `.agents/README.md`,
`.agents/BOOT.md`, `.agents/MEMORY.md`, this plan, the common work/maintenance/update
protocols, `CODE.md`, historical plan notice and affected ownership entries.

Acceptance: startup finds one current plan and memory file; rules say exactly when
to update each; current instructions contain no active removed planner commands;
prior README/update instructions are preserved byte-for-byte in `docs/history/`;
new files have one owner and matching compatibility entries. Runtime behavior
is unchanged. Validate local links, owner uniqueness/dependencies and `npm run check`.

## S1 — Check actual boundaries before changing them

Owners: `verification/verification`, then `delivery/delivery-config` for command
wiring, with `coordination/planning-protocol` for ownership/history classification.
Inspect `scripts/maintenance.test.ts`, `scripts/disconnection.test.ts`, selected
ownership YAML, `.context/modules/registry.yaml` and package exports/imports.

1. Replace obsolete maintenance-test assumptions with current source checks using
   the existing TypeScript tooling. Do not invoke the historical planner reader.
   Resolve imports against public exports; cover cross-plugin private imports,
   cycles and browser-reachable server modules, including re-exports/dynamic imports
   where statically resolvable. Report unresolved cases explicitly.
2. Distinguish intentionally historical ownership paths from current files without
   rewriting old task digests or broadening terminal write scopes. Keep any
   compatibility projection derived from selected ownership rather than a second
   independently edited definition.
3. Exercise focused retained behavior with disposable state. Wire only relevant,
   passing checks into normal maintenance; report pre-existing failures separately.

Acceptance: seeded cycle/private-import/browser-server violations are rejected;
the current resolved graph passes or has explicit actionable findings. Draft and
resource-owner baseline results are recorded. No new test framework is needed.
The retired planner is never a dependency of current checks.

## S2 — HTTP transport with explicit internal responsibilities

Primary owner: `backend/http-transport`. Scope starts at
`plugins/transport-http/src/index.ts`; proposed private module:
`plugins/transport-http/src/terminals.ts`, registered to the same owner.
Existing sibling `projects.ts`, `servers.ts`, `browser.ts` and `rules.ts` show the
local route-handler pattern. Keep the public plugin entry unchanged.

Move terminal request dispatch and stream lifecycle behind a small explicit
interface. Keep host/origin checks, body bounds, error mapping and server disposal
in the transport owner. Keep project-operation admission shared across terminal
creation, server starts and thread deletion; do not duplicate its state per route.
Do not merge the two event-stream implementations merely because they look similar.

Acceptance: valid/invalid terminal requests, origin denial, replay cursors,
backpressure, disconnect cleanup and shutdown retain their behavior. Concurrent
start/delete requests remain coordinated. Add targeted HTTP coverage where the
existing terminal service tests do not cover this seam. Run disconnection checks
and relevant terminal lifecycle checks against private fixtures.

## S3 — Workspace UI without moving lifetime ownership

Primary owner: `browser/workspace-shell`; host composition remains under
`browser/workspace-ui`, retained owners under `browser/browser-bootstrap`.
Start at `plugins/ui-shell/src/view.tsx` and its existing `terminals.tsx`,
`servers.tsx`, `workspace-focus.ts`; inspect `src/shell.tsx` and `src/workspace.ts`.

Choose one cohesive responsibility, such as workflow controls or inspection-modal
presentation, and extract it within the plugin with explicit props/callbacks.
Keep project/canvas/preview lifetimes and cross-view selection at their existing
owner. Preserve component identity, DOM placement, keyboard handling and focus
restoration. Avoid a generic event bus, new global state store or utility dumping ground.

The preview's `@devlab/ui-projects/adoption` dependency is declared and public.
Change it only if callers show a useful seam; settle a neutral contract first,
then update its consumers in separate bounded steps. Do not treat every plugin
dependency as spaghetti.

Acceptance: dirty drafts survive project/view changes; failed deletion retains
selection; canvas undo/save still works; switching views and collapse/reopen retain
terminal sessions and preview documents. Run owner tests and a disposable browser
smoke for focus and retained mounts before marking this item done.

## S4 — Bounded read-only rules inspection

Primary owner: `backend/rules-service`. Inspect
`plugins/rules-local/src/read-memory.py`, `snapshot.ts` and the plugin README.
The reader handles source validation, legacy/current formats, SQL evidence and
memory graph projection. Identify the smallest independently testable responsibility
before extracting; retain a cohesive reader if splitting would just add indirection.

Any helper must remain trusted installed host code under the same capability.
Preserve Python isolation, read-only SQLite, symlink/path restrictions, byte/row/time
limits, cancellation and visible partial/malformed-data outcomes. Project files
remain data. No project-selected imports or new storage format.

Acceptance: focused reader tests retain no-write guarantees, missing/corrupt database
distinctions and bounded graph/freshness reporting. Record the measured maintenance
benefit; if there is none, mark the investigation done with a reason to retain the code.

## S5 — Package footprint and measured optimization

Owners: `delivery/delivery-config`, `delivery/ui-development`,
`delivery/source-maps` as applicable; confirm actual owner paths before edits.
Review `package.json`, `vendor/` catalogs, `vite.config.ts`, `scripts/architecture.ts`.

Trace active dependency consumers before proposing removals. Source archives with
recovery/provenance value are not unused application trash. Build into a new
`DEVLAB_BUILD_DIR` for comparison. Existing `dist/` deliberately keeps earlier
chunks for open workspaces; cleanup requires an explicit retention/recovery design.

Acceptance: fresh isolated build succeeds, artifacts identify current composition,
and retained features still work. Compare like-for-like bundle sizes/startup or the
specific slow interaction on the same environment before claiming a speedup.
Do not add an optimization if evidence shows no useful gain.

## Verification selection

These commands exist; commands not listed under results below remain candidates,
not promises of current passing coverage. Read fixture setup before running them.

| Area | Focused command / additional evidence |
| --- | --- |
| Types and removed features | `npm run check` |
| Drafts, selection, deletion failures | `node --test scripts/project-workspace.test.ts` |
| Project confinement and isolated copies | `node --test scripts/project-development.test.ts` |
| Terminal behavior and process ownership | `node --test scripts/terminal.test.ts scripts/terminal-lease.test.ts scripts/terminal-confinement.test.ts` |
| Rules reader and read-only HTTP | `node --test scripts/rules.test.ts` |
| Frontend attachment and lifecycle | `node --test scripts/dev-ui.test.ts scripts/prototype.test.ts` |
| UI mounts, focus, actual preview/terminal retention | Disposable browser scenario; preserve existing user sessions |

Run the smallest relevant set after each change, plus boundary checks once S1
establishes them. A failing historical test is an investigation, not permission
to restore removed features or weaken an assertion. Record partial work honestly.

## Evidence and handoff

- 2026-11-14 prior scan: source/package comparison, acyclic declared dependencies,
  passing type/disconnection checks, eight live backend plugins and retired routes
  returning 404. No complete browser test or fresh build was run in that scan.
- 2026-11-15 S0: `npm run check` passed after the documentation/ownership changes:
  TypeScript and both disconnection tests passed (2/2).
- 2026-11-15 S0: `python3 /tmp/devlab-simplification-tcmmfttc/verify-context.py`
  passed. This one-off local audit checked 55 current-document links, exactly one
  owner for all 18 changed/added files, acyclic owner dependencies, matching three
  affected compatibility entries, byte-identical historical snapshots and
  preservation of prior ownership paths/public seams. The script is temporary
  inspection evidence, not an installed project command or ongoing enforcement.
- S0 limitations: no application implementation refactor or measured performance
  improvement, fresh build, complete browser verification or planner execution.
  Generated Hood snapshots were not rebuilt; their source copies can lag these
  documentation changes until the next deliberate build.

## Refactored edition — implementation and evidence

The user selected a separate saved folder and explicitly declined Git. The source
fingerprints and omitted runtime/history directories are in
[copy provenance](../refactor-provenance.json). The original is preserved. New
runtime data and ports (4322 backend, 4323 development UI) belong to this edition.

- S1: `scripts/boundaries.test.ts` now checks current editable source and canonical
  ownership without reading historical planner reports. It rejects seeded cycles,
  private imports and browser Node imports, resolves literal dynamic imports and
  re-exports, checks local runtime cycles and browser reachability. Third-party
  installed runtime internals remain outside this static guard. Historical missing
  paths are not reinterpreted as active tasks. The old maintenance test now reads
  the actual guidance-pin file and retains its stale-artifact regression checks.
- S2: `plugins/transport-http/src/terminals.ts` owns the existing terminal HTTP and
  both SSE protocols. The router retains the same stream disposal set, shared
  start/delete admission, origin policy, JSON limits and error mapping. No process
  owner or public service signature changed. Router length: 314 lines after extraction.
- S3: `plugins/ui-shell/src/controls.tsx` owns icon/settings presentation. Shell
  state, keyboard handling, terminal/preview mounts and inspection focus stay in
  `view.tsx` (780 lines). Hood separately owns dialog navigation, plugin inspection,
  graph projection/layout and the new anatomy view. No global event bus was added.
- S4: inspected `Reader` path validation, multiple source formats and SQL graph
  methods. Splitting these shared constraints without a specific change would add
  coordination overhead. Retained implementation unchanged; 13 rules tests pass.
  Its pre-existing invalid legacy-authority report remains visible in both editions;
  missing historical SQLite in this independent copy is reported honestly.
- S5: a fresh `dist` built successfully, using existing pinned dependencies.
  Installed modules are about 216 MiB; the independent source/dependency/build copy
  is about 260 MiB before its own runtime data. These are footprint observations,
  not a like-for-like speed benchmark. The build retains the existing mixed
  static/dynamic contracts-import warning. No speedup or payload reduction claimed.
- H1: `scripts/architecture.ts` derives six owner groups plus installed/unassigned
  source from canonical YAML and analyzed package source. The overview is stacked
  by responsibility; inner dependencies use Dagre. Actual declared/import edges are
  bundled, never replaced by invented dependencies. File inspection stays read-only.

Observed 2026-11-15:

1. Before extraction: `node --test scripts/terminal.test.ts scripts/terminal-lease.test.ts scripts/terminal-confinement.test.ts scripts/project-workspace.test.ts` — 29/29 passed.
2. After extraction: the same command plus `scripts/rules.test.ts` — 42/42 passed.
   Includes SSE reconnect/multiplexing, shutdown, PTY persistence, Strict confinement,
   draft/deletion races and no-write rules/path/corruption checks; disposable state.
3. `npm run check` — TypeScript plus eight anatomy, boundary, disconnection and
   maintenance checks passed. The generated graph preserves source coverage,
   unique/closed schema references and nonoverlapping node rectangles.
4. `npm run build` — passed. `setup:terminal` reported tmux 3.4 and Strict-ready
   Landlock ABI 8 with offline policy. The original build was not modified.
5. `DEVLAB_BUILD_DIR="$PWD/dist" TERMINAL_LIFECYCLE_EVIDENCE_DIR=/tmp/devlab-refactor-terminal-lifecycle /usr/bin/python3 scripts/terminal-lifecycle-browser.py` — passed at 1440 and 820.
   Verified terminal/preview identity retention, hidden input/resize ownership,
   collapsed sessions, retry/recovery, zero JavaScript errors and fixture cleanup.
   The default `python3` lacked Playwright; the installed system Python was used.
6. Original source fingerprint comparison — all 169 recorded source files unchanged.

7. `node scripts/anatomy-browser.mjs` — passed: layer/owner/file drill-down,
   dependency selection, search and refresh retention, source/plugin tabs, failure
   and retry, 1440/820/390 layouts, canvas draft and settings-tab retention, no page
   errors. Browser testing caught a controlled-node measurement regression; explicit
   dimensions shared with Dagre fixed it. Evidence: `/tmp/devlab-refactor-screenshots/`.

8. `node --test scripts/dev-ui.test.ts scripts/prototype.test.ts` — 8/8 passed:
   frontend attachment, origin checks, owned HTTP/HMR/SSE shutdown, port collisions
   and prototype launch guards. This does not certify every live HMR editing flow.
9. Final document/provenance audit — 49 relative links valid, 28 changed files owned
   exactly once, all 169 original source fingerprints unchanged.

10. `DEVLAB_URL=http://127.0.0.1:4322 node scripts/verify-deployment.ts` — passed:
    served assets and built/live snapshot agreed; all 812 source records found
    locally matched their current files. This command is a read-only check, not a
    deployment. Repeated after final documentation regeneration.

This refactor is complete in the separate folder. Full application/security
certification and a measured performance benchmark are outside this evidence.
Future changes follow the update rules and focused checks; no further extraction
is scheduled without a concrete maintenance need. The proposed second pass below
responds to the subsequent request for actual code/file reduction.



## H2 — Pop the Hood minimap clipping

Status: done. This separate minimap defect was found during investigation; the
user's final clarification identified Build canvas as the failing view (H3).
Owners: `browser/hood-view` and `verification`. Workflow canvas source remained
byte-identical to its pre-investigation source; the initial Workflow-minimap
change and test were reverted.

Cause: the portable Hood skin constrained the minimap frame to 150×90 (148×88
usable pixels after borders), while React Flow drew an intrinsic 200×150 SVG.
The frame's overflow clipping hid part of the overview and its pointer area.
The initial scoped Hood CSS sized that frame to its content and made the SVG
a block. H3 moved the same correction into shared host styles for both consumers.
Installed package files and source graph layout are unchanged; no library fork,
dependency upgrade or DOM event shim was introduced.

Evidence on 2026-11-15:

- `node scripts/hood-minimap-browser.mjs` failed before the fix with
  `Hood minimap clips its drawing: {"width":148,"height":88,"drawingWidth":200,"drawingHeight":150}`.
- The same regression passed after correction at widths 1440, 820 and 390:
  full drawing visible; actual drag pans the graph; wheel zoom changes the zoom;
  hide/reopen works; no browser page errors. Each run uses a disposable backend
  and browser context. Screenshots: `/tmp/devlab-hood-minimap-evidence/`.
- `npm run build` and `npm run check` passed (types and all eight checks).
- Both original workspace-canvas files match the pre-investigation backup exactly.

Delivery: updated static frontend assets are served on 4322. The user's active
browser was not forced to reload and the backend was not restarted, preserving
its sessions and previews. Reload after saving drafts to pick up the new frontend.
The regenerated architecture artifact is on disk; the backend's cached source
snapshot updates on its next safe restart. No claim of live Hood source-snapshot
consistency is made while that intentionally retained backend is running.

## H3 — Build canvas graph projection

Status: done. Owners: `browser/project-view`, `browser/workspace-ui`,
`browser/hood-view`, `verification` and `coordination/planning-protocol`.
Changes use existing owned files; no packages, files or runtime layers were added.

Reproduction: Build canvas showed zero blocks and `Architecture unavailable` with
`Missing registry parent`. H1 placed `group:external` under `layer:installed` in
the host artifact. The project adapter retained external dependencies but omitted
host ownership layers, leaving that group's parent outside its projected graph.

Correction: `plugins/ui-projects/src/workspace.ts` promotes retained external roots
to the project root when their host parent is outside the projection. Child links,
imports, symbols, validation and the original host snapshot remain intact. The
same browser investigation confirmed minimap clipping in Build canvas. Its sizing
correction now lives once in `src/style.css`, replacing the Hood-only override.

Evidence on 2026-11-15:

- `node --test scripts/project-workspace.test.ts`: the new projection regression
  failed with `Missing registry parent` before correction; all five tests passed
  afterward, including existing draft/deletion/selection safeguards.
- `node scripts/hood-minimap-browser.mjs`: after the graph fix, the Build minimap
  failed with frame 148×88 versus drawing 200×150. After sharing the sizing rule,
  Build and Hood both passed at 1440, 820 and 390: graph loads, full minimap drawing,
  drag pan, wheel zoom and hide/reopen. Build also retains an unsaved editor draft
  through Workflow/Build switching. No page errors; disposable backend/browser
  state. Screenshots: `/tmp/devlab-hood-minimap-evidence/build-minimap-*.png`.
- `npm run build` and `npm run check` passed; the latter includes all eight
  type/boundary/anatomy/disconnection/maintenance checks. The existing mixed
  static/dynamic contracts-import build warning remains unchanged.
- A separate read-only browser context on the active host at 4322 rendered Build
  graph nodes without `Architecture unavailable` or page errors. Its served index
  and entry assets matched the new build byte-for-byte.

Delivery preserves the running backend and existing user tabs. Save drafts and
reload to adopt the changed project owner. The backend's cached inspection snapshot
still reflects its previous startup; regenerated source evidence is on disk for
the next safe restart. No whole-app performance claim follows from this bugfix.

## QA1 — Report-only app investigation

2026-11-15 user request: investigate Build canvas showing text instead of nodes and
identify other issues. Investigation complete; no implementation fixes or test
changes were made. Owners for follow-up: `browser/project-view` (draft safety,
Build framing and directory validation), `browser/canvas-ui` (capability catalog),
`browser/workspace-shell` (narrow toolbar), with verification support.

[Report, reproductions and screenshots](../../.gstack/qa-reports/run-20261115-app-investigation/qa-report.md)
record five findings: duplicate New file can lose an existing unsaved draft;
Build opens 98 styled cards at about 7% zoom; Chromium Browser is offered despite
being unavailable; the 390px toolbar clips primary navigation; and Chrome ignores
the directory field's invalid pattern. The draft loss and unavailable browser were
replayed. Tiny graph framing was reproduced on the running and isolated backends.
A completely unstyled/text-only graph was not reproduced. H3's graph-loading and
minimap evidence remains valid for its narrower acceptance, not these new cases.

Checks on 2026-11-15: `node --test scripts/project-workspace.test.ts scripts/anatomy.test.ts scripts/disconnection.test.ts`
passed 9/9; `./node_modules/.bin/tsc --noEmit` passed. Browser project creation,
ordinary file save and Workflow/Build draft retention passed using disposable
state. No full build/check or generated artifact refresh was needed for report-only
work. Actual live terminals, preview startup, complete accessibility and performance
were not tested. The isolated backend/browser were closed; its state was removed.
The live backend and user tabs were preserved. Fixes remain unimplemented.


## R — Proposed second pass: Ponytail reduction

Status: **done**. Implementation authorized after the saved Cordis checkpoint. Requested 2026-11-15.
This extends the existing plan; historical completion and QA1 evidence above stay
intact. The approved work is saved in this independent edition, with no Git or deployment.
The review draft is recorded here rather than published as ready-to-run tracker
issues. The disconnected product planner remains disconnected.

### Problem and intended result

The first pass improved locality but increased local application source. The user
wants fewer files, fewer repeated decisions and less code to understand, while
retaining projects, editing, Workflow/Build, terminals, previews, ownership anatomy,
Dagre navigation and read-only rules inspection.

Use Matt Pocock's deep-module/deletion test and
[Ponytail's smallest-complete-change discipline](https://raw.githubusercontent.com/DietrichGebert/ponytail/main/skills/ponytail/SKILL.md):
first question the need, then reuse this codebase, standard/platform facilities,
and installed dependencies. Add implementation only for behavior still missing.
A module earns its seam through actual variation or useful depth. Prefer locality
and leverage over another interface. Retain error handling, validation, resource
cleanup, accessibility and protections against data loss.

Planning adaptation: existing Markdown is the configured engineering record for
this task. Use the specification and dependency-slicing ideas of `to-spec` and
`to-tickets`; do not install a tracker, publish tickets, create another task store,
or run the archived skills' setup commands. The architectural review used a fresh
read-only reviewer as that skill requests. No implementation was delegated.

### Measured starting point and deletion evidence

Read-only source count on 2026-11-15, under `src`, `plugins`, `packages`:

| Edition | Executable source | CSS | Native C | Total |
| --- | --- | --- | --- | --- |
| Original | 75 files / 14,923 lines | 9 / 2,933 | 1 / 177 | 85 / 18,033 |
| Refactored | 80 files / 15,181 lines | 9 / 2,946 | 1 / 177 | 90 / 18,304 |

Count physical lines of `.ts`, `.tsx`, `.js`, `.mjs`, `.py`, `.css`, `.c`, `.h`;
exclude `node_modules`, `dist`, `__pycache__`, scripts/tests, generated artifacts,
Markdown and metadata. Without native C, the comparable counts are 17,856 and
18,127 lines: +271 lines and +5 files. Earlier rounded chat counts used this scope.
Pinned/vendor source and dependency footprint must be reported separately, so
moving code into packages or archives cannot masquerade as a runtime reduction.

Source-backed candidates, not achieved savings:

- **delete:** inactive adoption implementation, 278 lines, plus its exclusive
  Wisdom contract, 65 lines. The client supplies no `wisdom`; the view returns null.
  Removing its two callers can also remove the preview-to-project adoption seam.
- **delete:** retired planner contract module, 203 lines. Its assessed-evidence
  schema still has a rules consumer and must survive. Around 180 lines may be
  removable after an export/consumer audit; this is an estimate, not a net result.
- **reuse:** ownership has 27 canonical YAML definitions and 27 compatibility
  entries in a 692-line projection. A semantic comparison found only `rules-ui`
  path drift. Generation can eliminate duplicate maintenance; it does not itself
  delete the stored projection or reduce application lines.
- **delete:** unavailable Browser creation and disabled provider-key controls.
  Saved Browser nodes remain valid data. Contribution/dependency removal is
  conditional on preserving their inert rendering and checking preview consumers.
- **delete:** two one-line Hood re-export files have no located runtime consumers.
  This is at most two source lines and two files; check exports, string references,
  owned metadata and fixtures before removal. It is a small cleanup, not the main win.

Evidence sources: `plugins/ui-projects/src/adoption.tsx`, its two callers in project
explorer and preview pane; `packages/contracts/src/wisdom.ts`, `agent-definitions.ts`,
`rules.ts`; `packages/client/client.ts`; `scripts/disconnection.test.ts`;
`src/main.ts`, `src/contributions.ts`; `plugins/ui-shell/src/controls.tsx`;
`plugins/ui-hood/src/graph.ts`, `layout.ts`; `.agents/ownership/*/*.yaml` and
`.context/modules/registry.yaml`. Confirm current consumers immediately before deletion.

### Intended ownership and anatomy

Keep the current topology: the small kernel owns lifecycle/admission; backend
modules own filesystem/process actions; the client crosses the browser/server
seam; browser owners retain project drafts, per-project workflow state and preview
sessions. Views consume those owners. Diagrams derive from declared ownership and
analyzed imports rather than a second manually maintained map.

Build and Hood source inspection **already share** the portable graph renderer.
Anatomy adds the requested ownership-level aggregation and drill-down. Preserve
that distinction and Dagre. No new graph engine, universal store, event bus,
capability registry, kernel replacement or plugin framework is proposed.

### User outcomes

1. Reopening an existing path through New file preserves the user's unsaved text.
2. Build opens with readable blocks; expansion and Fit all are deliberate actions.
3. Workflow, Build, Terminals and Settings remain reachable at narrow widths.
4. Creation menus offer capabilities that the current client can actually use.
5. Configured previews still start; unconfigured previews explain the missing setup.
6. Existing terminal sessions retain their identity and isolation policy.
7. Ownership declarations are edited once, with compatibility explicitly derived.
8. Hood retains stacked ownership blocks, real connections and source drill-down.
9. Each completed reduction records deleted/new lines and files plus retained behavior.

### Proposed slices and real blockers

Every row ends with independently verifiable behavior. The authorized implementation
is recorded below; current status and evidence supersede the original proposal.
Owners are selected YAML IDs;
`verification` supports each implementation row and `planning-protocol` maintains
this record and memory.

| ID | Status | Blocked by | Deliverable and owner |
| --- | --- | --- | --- |
| R0 | done | None | Protect duplicate-path drafts and correct directory-field validation in existing project commands/forms. `project-view`. |
| R1 | done | None | Readable initial Build framing and reachable narrow navigation. `project-view`, `workspace-shell`; `hood-view` only if its existing presentation is affected. |
| R2 | done | None | Remove the null-rendering adoption/setup flow and its exclusive Wisdom contracts/callers/styles. `project-view`, `preview-view`, `ui-contracts`, `service-contracts`, `delivery-config`. |
| R3 | done | None | Retire unused planner contracts while retaining assessed evidence beside its rules consumer. `service-contracts`. |
| R4 | done | None | Gate unavailable Browser creation using existing client capability data; simplify disconnected provider controls. `canvas-ui`, `workspace-shell`; contribution/package removal also uses `browser-bootstrap`, `workspace-ui`, `delivery-config`. |
| R5 | done (projection; parser retained) | None | Remove duplicate ownership maintenance using the trusted reader; evaluate default-host terminal policy migration separately. `governance-runtime`, `terminal-service`, `backend-host`, `rules-service`, `delivery-config`. |
| R6 | done | R0–R5 | Remove only proven unused re-exports/exclusive styles and record final size/behavior evidence. `hood-view` plus the owner of each proven unused path. |

Recommended working order is R0, R1, R2, R3, R4, R5, R6. R0 is the safety priority;
R2 is the first substantial deletion candidate. R0–R5 have no artificial technical
blocking edges: the order is a risk/prioritization choice. R6 follows R0–R5 because
its remaining-consumer audit and final comparison depend on their final shape.

### Slice acceptance and verification seams

**R0 — One draft owner.** At `ProjectWorkspace`'s existing interface, duplicate
New file must reject before mutation or reopen the retained draft. Existing disk
content, cached drafts, selection and async reads survive. Preserve backend
expected-hash/create-only protection. Verify duplicate active, cached and new-file
drafts, dirty drafts in another project, a genuinely new path, and backend conflict
handling. Extend `scripts/project-workspace.test.ts` and replay QA1 F1 in a disposable
browser project. F5 gets a valid native input constraint plus backend rejection;
removing invalid-pattern console output alone is insufficient.

**R1 — Progressive graph disclosure.** First try the portable renderer's existing
initial-depth/expansion controls. Start at a compact module level; preserve saved
view intent when available and keep Fit all explicit. Do not rewrite layout before
this proves inadequate. Proposed acceptance: representative host and small-project
initial views show identifiable card titles at at least 10 CSS pixels, without
requiring wheel zoom. This is a proposed product threshold to review, not an
accessibility certification. Check 1440/820/390 layouts; narrow headers expose all
primary actions through the existing compact navigation or scrolling. Reuse the
Build/Hood browser probe, adding readiness/readability and navigation assertions.
Retain source selection, minimap gestures and draft retention.

**R2 — Remove an inactive path completely.** Audit editable, installed and dynamic
consumers of the public adoption/Wisdom exports. If a supported consumer exists,
retain the required seam and revise this slice rather than deleting it silently.
Otherwise remove implementation, both callers, exclusive styles, exports and
exclusive types together. Configured preview startup, source inspection, project
creation and preview/terminal identities remain. Unconfigured previews keep a clear
existing error/next step; do not reconnect the removed setup executor. Update
ownership and dependency declarations with the last caller removal. Verify types,
disconnection, preview lifecycle and both configured/unconfigured preview states.

**R3 — Preserve the live rules contract.** Move only the assessed-evidence schema
and any required validators/types next to its rules consumer, preserving accepted
and rejected input behavior and any supported public export. Audit removed symbols
across tests, fixtures, installed packages, config and computed/string references.
Historical tests for the removed runtime are provenance, not a reason to revive it;
retained contract checks must still run. Verify rules tests, type checks and current
boundary/disconnection checks. Schema validation is not a deletion target.

**R4 — Existing capability data controls creation.** Use the actual client adapter
availability instead of inventing new flags or a capability registry. Retain saved
Browser payloads and an explicit unavailable state; continue to load, save, export
and undo graphs containing them. Remove a contribution/dependency only after proving
that fallback and checking other consumers. Replace disabled key-management rows
with the existing shortcuts/diagnostics surface and a concise availability statement
where needed; no credential subsystem is added. Verify unavailable and available
adapter cases, stored Browser-node round-trip, ordinary Terminal creation, settings
keyboard/focus behavior and narrow layouts.

**R5 — One ownership authority, explicit compatibility.** First prefer deterministic
projection through the existing trusted data reader; do not add another ownership
parser or runtime watcher. A generated file may remain for current consumers.
Default-host terminals currently take a separate compatibility-registry branch;
switching them to canonical ownership is a policy migration, not cosmetic cleanup.
Compare resolved file sets, owner IDs and revision/change behavior before switching.
The known removed `rules-ui` paths must be resolved explicitly. Existing running and
saved terminal policies remain immutable. Preserve legacy-format inspection and
external-project compatibility while they have consumers. Verify ownership, leases,
Off/Guided/Strict confinement, persistence/reconnect and read-only rules. Retire the
legacy path only when all relevant consumers and policy-equivalence evidence allow
it; keeping it is an acceptable outcome with documented reason.

**R6 — Deletion proof and handoff.** Search every proposed deletion across source,
exports, dynamic/string references, tests/fixtures and active configuration. Keep
historical fingerprints/evidence intact. Remove only exclusive dead styles and
proven unused files; code moved elsewhere is not a saving. Record before/after
application, CSS, native, tests, metadata/generated and packaged-source counts
separately. Each reduction slice must show a net decrease in maintained executable
code, files or independent facts, named explicitly. Correctness/readability fixes
may add code and are reported separately; no arbitrary percentage target is promised.

For implemented source changes, run the existing `npm run check` and `npm run build`
plus the affected behavior checks above. New checks are justified by the named
regression; do not create another test framework or duplicate existing coverage.
Use disposable server/browser state. Refresh the owned backend's inspection
snapshot only at a safe checkpoint and verify served source consistency then.

### Decisions retained and review points

Keep the kernel, public plugin seams, browser/server separation, real terminal
isolation, draft protections, preview ownership, supported graph payloads and
read-only rules. Keep archives, originals, user data and live processes intact.
No whole-app rewrite, generic framework, dependency upgrade or blind flattening of
files. Moving archived material out of view may help navigation but is reported as
organization, never as code deletion.

The recommended scope retires compatibility with the disconnected adoption/setup
and planner execution surfaces only where no supported live consumer remains.
It preserves inspection of their history. Review that product choice, the R1
readability threshold and any R5 ownership-policy difference before implementation
of those affected decisions. Other rows remain independently actionable when a
later implementation request arrives.

Planning evidence on 2026-11-15: read current source and QA1, counted application
files/lines, compared all 27 ownership entries, traced shared graph rendering and
received a separate read-only deletion review. Local skill sources were the archived
Matt Pocock `codebase-design`, `improve-codebase-architecture`, `to-spec`, `to-tickets`
and Ponytail audit/review; current Ponytail core was read from the upstream link
above. No glossary/ADR/tracker files were found at the current project's root.
No application source, packages, ownership policy or runtime state changed during
this planning pass. No new build or behavioral pass is claimed by this plan.

Plan-only validation on 2026-11-15: checked relative links in plan/memory, all 16
referenced owner IDs, seven planned rows and dependency ordering; all 169 recorded
original-source fingerprints remain unchanged. The temporary architecture report
has four before/after candidates and was rendered with installed Playwright/Chrome
at 1440 and 390 widths without horizontal overflow, using its offline CSS fallback.
Report: `/tmp/architecture-review-20261115-124005.html` (temporary review aid; this
plan remains authoritative). Only this plan and its existing memory decision were
updated in the project. Application build/tests were not rerun for prose changes.


## Checkpoint — Cordis retained and operations saved

Saved 2026-11-15 in `_devLAB-refactored`, on the user's request to update memory
and commit the operations. “Commit” is recorded as a filesystem/document checkpoint
under the established no-Git instruction; no repository was initialized or committed.
The completed first-pass work, H2/H3 fixes, QA1 findings and proposed R0–R6 reductions
are preserved in this document. The second-pass entries remain planned; this
checkpoint does not execute them or mark their acceptance complete.

Architecture invariant: `src/server.ts` instantiates `@devlab/kernel` and starts
`src/profile.ts`. The pinned adapter constructs Cordis `Context`, registers plugin
fibers with declared injection, and registers cleanup through Cordis effects.
Capability modules provide behavior; the adapter retains ordering, admission,
leases, replacement and disposal. R0–R6 preserve this flow.

Verification actually performed on 2026-11-15:

- Read the installed kernel source/build and package manifests. Cordis version:
  `4.0.0-rc.11-creo.bc9a344`. Both kernel artifacts and the kernel/Cordis archives
  are byte-identical to the original edition.
- A disposable, in-memory Node probe imported the installed `Kernel` and supplied
  two fixture plugins in reverse dependency order. Assertions passed: provider
  activated before consumer; declared service access worked; ready state showed
  two plugins and two Cordis runtimes; closing completed both disposal callbacks.
  This probe opened no listener and created no project, terminal or preview state.
- Read-only `GET http://127.0.0.1:4322/api/health` returned `ready`, with all eight
  selected plugins active. The live backend and user tabs were not restarted.
- Kernel source SHA-256:
  `e56b2e28d3d7904f6bd9232fb04a6a583e54d13e526f6cb0ea19a18f74543bf9`.
  Installed kernel build SHA-256:
  `3c1588c771f1a2b36e83238f0821ebb59947ccbdd21ff297f522690c109644e8`.

Only existing memory and plan documents changed for this checkpoint. Checked
relative links and original-source preservation after saving. No full application
build or behavioral suite was rerun for this documentation update; the isolated
kernel probe and live health read establish the narrower claims above.


## R — Implementation evidence

Implemented 2026-11-15 in `_devLAB-refactored` after authorization to proceed and
run tests/evaluations. No Git, deployment, dependency upgrade or live backend restart.
The preceding plan/checkpoint sections retain their dated historical context.

### Changes and decisions

- **R0:** `newFile` rejects existing paths and cached drafts before mutating the editor;
  Chrome folder validation now accepts absolute paths and rejects relative ones.
  The draft regression failed before correction and passes afterward.
- **R1:** Build initially hides file nodes and opens directory-level blocks. A small
  component in Hood's public toolbar slot uses public React Flow APIs to focus the
  project once after initial fit. It schedules after the transition callback, keeping
  later user zoom/pan untouched. No packaged renderer was modified. The first attempt
  with fewer cards alone failed at 4.16px title text; the corrected browser checks
  require at least 10px. Narrow primary navigation wraps and remains reachable.
- **R2:** Deleted the inactive 278-line adoption view, its 65-line Wisdom contract,
  callers, exclusive styles, public exports and preview-to-project package dependency.
  Preview setup now describes the missing `devlab.preview.json` instead of offering
  a disconnected wizard. The folder dialog no longer promises removed initialization.
- **R3:** Deleted the 203-line planner contract module after auditing exported names
  across editable code, installed packages, tests and configuration. Preserved the
  assessed-evidence schema/type beside its live rules consumer and public index export.
  Historical planner records remain provenance and are not loaded/executed.
- **R4:** Existing `client.browsers` controls palette creation and drop admission.
  Saved Browser rendering and the browser contribution/package remain for retained
  graphs and enabled adapters. Removed disabled credential rows; existing shortcuts
  and diagnostics remain. No credential service or capability registry was introduced.
- **R5:** `npm run ownership:sync` derives compatibility through the existing trusted
  reader and atomically replaces the generated file. A maintenance check rejects
  drift. All 27 owner IDs remain; only five deleted source paths and three already
  absent `rules-ui` paths were removed. No new path grants or remaining existing-file
  scope changes were found. The default-host terminal parser remains: byte-hashed
  compatibility revisions differ from canonical segment revisions, so parser migration
  has not been claimed equivalent. Existing saved/running policies are not rewritten;
  new policies use the updated compatibility revision. Legacy inspection is retained.
- **R6:** Removed the two unused Hood re-export files and seven exclusive credential/
  footer style rules. Updated current ownership/configuration with deletions while
  preserving historical fingerprints. No new application source file was added.

### Size accounting

Physical lines, same extensions/scope as the baseline above; generated output,
metadata, tests and vendored source are not counted as application savings.

| Scope | Before this pass | After this pass | Net |
| --- | --- | --- | --- |
| Application executable source | 80 files / 15,181 lines | 75 / 14,589 | −5 files / −592 lines |
| Application CSS | 9 / 2,946 | 9 / 2,879 | −67 lines |
| Native C | 1 / 177 | 1 / 177 | unchanged |
| Application total | 90 / 18,304 | 85 / 17,645 | **−5 files / −659 lines** |
| Verification/delivery scripts | 48 / 10,245 | 48 / 10,337 | +92 lines |
| Trusted definition reader | 1 / 557 | 1 / 575 | +18 lines |
| Generated compatibility ownership | 692 lines | 681 | −11 lines; 27 duplicated maintenance entries eliminated |

Compared with the original edition, application source now has the same 85-file
count and 388 fewer lines. R0/R1 are correctness/readability additions, not deletion
savings; R5 reduces independent facts despite adding generator/check code. Combining
application, scripts and the reader yields 549 fewer maintained executable/style
lines for this pass. Metadata: active compatibility project paths −5 lines; root
manifest +1; lockfile line count unchanged. Local manifests/ownership follow removed
exports/dependencies; no installed dependency lock records changed. All 35 existing
vendor archives are byte-identical to the original. Bundled dependency code was not
moved or reduced; no bundle-size, startup-speed or memory-use improvement is claimed.

### Checks and evaluations

Recorded results below apply to this pass, with disposable state for mutations.
Final build/check and browser evaluations completed successfully before handoff.

- `npm run build`: types, existing terminal setup, Vite build and architecture
  generation pass. The existing mixed static/dynamic contracts-import warning remains.
- `npm run check`: all nine disconnection, boundaries, anatomy and maintenance checks
  pass, including the generated ownership projection comparison.
- `node --test scripts/project-workspace.test.ts scripts/rules.test.ts scripts/terminal.test.ts scripts/terminal-lease.test.ts scripts/terminal-confinement.test.ts`:
  44/44 passed. After adding the retained-schema regression,
  `node --test scripts/rules.test.ts` passed 14/14 (the earlier rules count was 13).
  This is 45 distinct focused tests plus nine structural checks, not 67 distinct tests.
- `node scripts/hood-minimap-browser.mjs`: all six Build/Hood cases pass at 1440,
  820 and 390 widths: loading, full minimap, drag pan, wheel zoom and hide/reopen.
  Build initial title text measures about 12px, with primary navigation visible,
  shortcuts/Escape working and drafts retained across Workflow/Build. The 1440 case
  also rejects a duplicate New file without losing text, validates absolute versus
  relative folder paths, and verifies missing-preview configuration guidance with
  a routed unconfigured server response. No page errors. Narrow editor overlays are
  not forced open behind another control; cached-draft collision is covered by the
  owner regression. Screenshots: `/tmp/devlab-hood-minimap-evidence/`.
- A one-off comparison against the backed-up original schema passed 19 accepted,
  missing-field, malformed and execution-shaped cases, including identical diagnostics.
- `node --input-type=module < /tmp/devlab-reduction-capability-probe.mjs`: disposable
  bundled browser fixture passes unavailable/available Browser creation, rejects an
  unavailable Browser drop, and checks ordinary
  Terminal creation, and supported Browser payload load/edit/undo/redo/save/reload/JSON
  round-trip. Zero page errors. Earlier SSR attempts were unsuitable because this
  client-only view has no server snapshot; the actual browser probe is the evidence.
- `DEVLAB_BUILD_DIR="$PWD/dist" TERMINAL_LIFECYCLE_EVIDENCE_DIR=/tmp/devlab-reduction-terminal-lifecycle /usr/bin/python3 scripts/terminal-lifecycle-browser.py`:
  passed at 1440 and 820. Existing session/PID and input/resize ownership, hidden/collapsed
  launch protections, explicit retry, preview identity/DOM retention, reconnect and
  process cleanup passed. Configured preview starts in this disposable fixture.
- Original-source preservation: all 169 recorded fingerprints match. Installed kernel
  source/build and pinned kernel/Cordis archives match the original byte-for-byte.
  Live read-only health at 4322 remains ready with all eight plugins active.

The second-pass backup is `/tmp/devlab-reduction-before-_engjq6s`; temporary evidence
logs use `/tmp/devlab-reduction-*`. These are local review aids, not durable execution
records or new project runtime dependencies. No full accessibility audit, real enabled
browser automation session, load benchmark or exhaustive platform matrix is claimed.
The live backend and user tabs remain intact; new built assets are on disk. Save drafts
before reloading changed browser owners. Its cached Hood source snapshot awaits a safe
backend restart; current-source/live-snapshot parity is not claimed for that process.

### Share package and fresh evidence — 2026-11-15

User requested a Lithuanian LinkedIn draft, four simultaneous project UIs,
fullscreen views, node connections, ownership/Cordis explanations and memory
integration context. Completed captures on a disposable current-source host with
independent Creative Lab, SPEC, VectorCraft and Web-for-something copies. Original
user projects, tabs and running hosts were preserved. No application refactor,
Git operation, deployment, publication or planner reconnection was part of this step.

- Fresh `npm run build` passed; `npm run check` passed 9/9; the existing five-file
  focused Node test command above passed 45/45 together. This is 54 distinct tests.
- Captured ten real UI screenshots. Verified native workspace fullscreen,
  individual enlargement, four previews, retained counter state, local VectorCraft
  gradients, both SVG exports and two manually connected edges persisted in a graph.
- Read NEWMEMORY and WISDOHM-3 sources. The portable memory baseline passed 14
  tests (one live-database test excluded); adverse probes reproduced eight unresolved
  problem families. Integration is proposed, not installed or certified by these tests.
- Saved the Lithuanian post, caption/function guide, gallery, SVG outputs and
  exact evidence in [the share package](../share/devlab-2026-11-15/gallery.html).
  [Detailed report](../share/devlab-2026-11-15/evidence-report.md) owns this step's
  commands, observations and limitations. Project memory records only the durable
  integration boundary; test results are not duplicated there.


## RT — Runtime composition and component laboratory

Requested 2026-11-16. Owners: `backend-host` (`runtime/index.ts`, `server.ts`,
`registry-router.ts`, `plugins.json`, README/research and compatible `src/` entries),
`project-service` (discovery/fork exclusions), `source-maps` (runtime staging and
LAB omission), `delivery-config` (Vite/TypeScript/ignore/README/check configuration
and `_LAB/README.md`), `verification` (runtime tests, discovery/fork tests and
runtime boundary scanning), `governance-runtime` (affected ownership definitions),
`planning-protocol` (this plan and memory). No unrelated source or process owner
was transferred. The user explicitly requested the nested Git clone; the DevLab
root still has no Git repository.

### Implemented scope

- Backend boot/composition now live in `runtime/`; established `src/` imports and
  `npm start` remain compatible. Existing feature factories remain in their public
  capability packages. The installed Cordis kernel, grants and lifecycle are reused.
- `runtime/plugins.json` selects plugins on the next startup; all existing eight
  default on. Unknown/non-boolean selection fails composition. HTTP injection
  follows selection; disabled services retain existing `503` responses. Cordis
  refuses unmet dependencies before activation. Live toggling/UI controls are proposed.
- The registry router forwards selected manifests and fresh kernel health to the
  existing architecture registry. Source/ownership stays in the generated artifact.
  No new registry cache, global mutation authority or arbitrary DTO bus was added.
- `_LAB/deepseek-harness` is a full clean clone at
  `39163dd30f703a79079e2d2446545cff3c453738` (root version `0.2.2-rc.3`, MIT).
  Source review covers architecture, concrete inventories, tool scopes, model
  adapters and candidate package documentation. No upstream install/build/execution.
  `runtime/RESEARCH.md` owns the source-backed proposals and compatibility finding:
  upstream `@deepseek-ai/cordis` 4.1.0 differs from DevLab's pinned Cordis adapter.
- LAB is omitted before project-tree traversal and fork copying, absent from Hood
  staging and ownership-derived source, explicitly excluded by TypeScript, denied
  by Vite and ignored by its watcher, and listed in root `.gitignore`.
- Architecture's root is normalized before the existing `_preimp` scanner call.
  Reproduction: the URL-derived trailing-slash root was refused as `Project root
  changed`; `realpath`-normalized input returned zero tasks. Caller normalization
  fixes the input without weakening that scanner's identity check. Unrelated
  `_preimp` implementation/tests were preserved.

Dependency shape: `src` compatibility entries → runtime composition → existing
public factories/contracts. Runtime does not depend on UI implementation or `_LAB`.
Boundary scanning now includes runtime source and rejects resolved imports into `_LAB`. Current runtime is three TypeScript
files / 102 physical lines, plus four compatibility-entry lines and ten selection
JSON lines. This is an explicit functionality addition, not a source-size or
performance reduction. No dependency/package-lock change or kernel replacement.

### Verification — 2026-11-16

- `npm run ownership:sync`: passed; compatibility projection regenerated from
  canonical definitions. Existing concurrent ownership additions were retained.
- `npm run check`: passed, TypeScript + generated architecture + 12/12 tests.
  The new tests cover default composition, malformed switches, missing dependency
  refusal without activation, selected manifest/health forwarding, source/LAB
  absence, project-tree omission, HTTP unavailability and registry disposal.
- `node --test scripts/project-development.test.ts`: passed 5/5, including normal
  nested Vite operation, direct/raw/absolute/alias LAB denial, source isolation and
  root/nested LAB omission from forks.
- Early checks exposed unrelated in-progress `_preimp` test typing errors; its
  separate writer corrected those before the passing full check. Our runtime test
  initially expected 404 for disabled endpoints; source confirms the established
  service-unavailable contract is 503, now asserted without changing HTTP handlers.
- `npm run build`: passed, terminal setup, TypeScript, Vite and architecture generation.
  Existing mixed static/dynamic contracts-import warning remains.
- Relative-link review passed in the five changed entry/research/memory documents.
  Runtime artifact source-parity and LAB-absence assertions passed. Final artifact
  regeneration follows this evidence update; no live backend restart.

Limitations: no new model/tool/MCP/agent executor or live backend toggle is
implemented. No upstream behavior/test claim follows from source inspection.
The real backend, user terminals, previews and drafts were not restarted or
reloaded; its cached architecture remains the startup snapshot until a deliberate
safe restart. Existing browser contribution state is independent of backend
selection. The automation desktop and disconnected planning runtime remain intact.


## RT1 — Staged runtime inspection, search and rewind

Authorized 2026-11-16 with explicit **do not merge** and a rewind requirement.
Completed as staged implementation, not production integration. No promote call,
merge journal, Git initialization, dependency install, deployment or live restart.

### Strategy, owners and preserved scope

Contracts → runtime adapters → composition → HTTP/client seams → Hood controls →
isolated verification. Existing Cordis lifecycle/admission and project roots own
resources. Future model/MCP/agent execution is outside this milestone.

Eleven canonical-owner tasks under `_preimp/`: `runtime-contracts`,
`runtime-ui-contracts`, `runtime-control`, `runtime-search`, `runtime-composition`,
`runtime-http`, `runtime-client`, `runtime-hood`, `runtime-verification`,
`runtime-delivery` and `runtime-baseline`. Each task has exact destinations,
service-created base hashes and preserved originals. Two new owner declarations
name the proposed runtime-control/search sources; related definitions add their
exact public seams and test paths. They do not register or activate code.
Direct edits are limited to those declarations, generated compatibility, staging,
this plan/memory and `.recovery/` evidence.

All **20 production destination preimages**, including absent additions, match
checkpoint hashes. All 11 tasks remain staged and have no merge.json. The live
4322 health read remains ready with its original eight plugins. Terminal,
preview, browser and editor owners were not restarted or reloaded.

### Implemented behavior in the candidate

- `runtime-control` projects saved versus running selection and fresh kernel health.
  Settings live in the host data directory, never in source. Revision checks,
  serialization, a cooperating-writer lock and atomic per-file publication protect
  changes. Future composition derives HTTP injection through the same factory
  function; dependency validation uses that future selection. Management protects
  its control/HTTP services. Interrupted locks are not stolen automatically.
- A persisted one-level predecessor supports configuration rewind. It changes only
  next-startup settings; active services stay running. A fresh host reads the saved
  selection through the explicit startup reader. Restart behavior is tested.
- `workspace-search` uses the existing admitted project service; it does literal
  case-insensitive matching with bounded results (100 maximum, UI requests 30),
  500 files, 2 MiB text and four concurrent calls. Private/reference/staging paths
  and non-editable files are excluded. Dispose aborts pending calls and awaits the
  existing project read owner. No new filesystem or subprocess owner is introduced.
- Local diagnostics retain at most 100 transient operation/outcome/duration/count
  records, with no query text, source content or network exporter.
- Public typed HTTP/client seams feed the existing Hood plugin detail area with
  collapsible controls/search/diagnostics. Host settings are clearly host-scoped;
  child projects use their own admitted search scope. Stale saves are not replayed.

Dependency shape: composition → public runtime factories → contracts and injected
project/control services; transport and browser consume public contracts. Source
boundaries remain acyclic. No direct imports from staging or LAB are added.
This adds behavior; no source-size, speed or memory reduction is claimed.

### Actual evidence — 2026-11-16

The reproducible runner is
`.recovery/runtime-plugins-20261116T034456Z/verify-candidate.py`.
It creates a separate temporary source and physical installed-dependency copy,
overlays the 20 staged destinations, and never publishes them back.

- `python3 .recovery/runtime-plugins-20261116T034456Z/verify-candidate.py`: passed.
  Its actual commands: `npm run build`, `npm run check` (20/20), and
  `node scripts/runtime-plugins-browser.mjs` (1440, 820 and 390px). The existing
  mixed static/dynamic contracts import warning remains. Durable results/logs and
  screenshots live beside the runner in `verification.json`, `verification.log`
  and `browser-evidence/`.
- Eight substantive service tests cover saved/live separation, unknown/stale/
  concurrent writers, dependency/self-disable refusal, revision-guarded settings
  rewind, literal/bounded search, project/path refusal, capped diagnostics,
  concurrency limits, pending-work shutdown and next-startup application.
- Browser flows verify dependency refusal, save/rewind, search, diagnostics without
  query leakage, stale-save recovery, retained query across Hood tabs, Escape and
  horizontal fit. No page errors observed. Existing terminal/preview retention
  was not re-exercised; their production source/owners remain untouched.
- Staging rewind audit: 42 preserved staged files, 32 changed. Default dry run
  passed; a later-edit probe refused before any file changed; restoration and
  idempotence passed on `/tmp/runtime-rewind-test-ngpfvx_b`. The command restores
  staged edits only, preserves task metadata and production, and retains redo copies.
  Evidence: `.recovery/runtime-plugins-20261116T034456Z/rewind-evidence.json`.
- Main workspace `npm run check`: passed TypeScript, generated artifact and 12/12
  existing checks; its profile still selects eight plugins. Log: recovery `main-check.log`.
- Final preservation audit: all 20 production preimages and all task base hashes
  match, all 11 service-created tasks remain staged, and no merge journals exist.
  Eleven scoped service `review` calls report zero conflicts; `reviews.json`
  records review revisions without calling promote. Changed memory/recovery links
  resolve, and the staging rewind dry run still passes.
- Proposed source size for affected application TS/TSX/CSS paths: 1280 → 1655
  physical lines (+375); verification paths: 70 → 315
  (+245). These are candidate additions, not production changes.
  Exact scope and configuration/doc counts are in recovery `size.json`.
- Final artifact regeneration follows this evidence update; the live backend
  remains untouched and retains its startup snapshot.

### Delivery boundary and rewind

[Recovery instructions](../../.recovery/runtime-plugins-20261116T034456Z/README.md)
explain the separate configuration and staging rewind paths. From the root,
`python3 .recovery/runtime-plugins-20261116T034456Z/rewind.py` is a read-only dry run;
`--apply` deliberately restores only unchanged staged edits. It refuses a merge
journal or later edits instead of overwriting them. Atomicity is per file, not a
multi-file transaction; redo copies support manual recovery.

At the RT1 handoff, promotion was not authorized. The later explicit user approval
and RT3 promotion evidence below supersede this staging boundary; runtime activation
remains separate from source promotion.


## RT2 — Native DeepSeek Harness Runtime (in progress)

New authorization on 2026-11-16: use all upstream Harness plugins as-is with
adapters, a separate registry router, individual on/off/testing, and replace the
Hermes Agent canvas concept with DeepSeek Harness Runtime. Preserve the previous
no-merge boundary; execute the new host independently rather than restarting or
replacing the installed DevLab kernel. Historical planners remain disconnected.

Before implementation, a verified 2,293-file / 36,082,512-byte source+staging+
recovery archive was saved at
`../devLAB-version-backups/before-deepseek-all-20261116T041933Z/`.
Its manifest and SHA256SUMS verify the archive. Live `.data`, installed packages,
references and live process state are excluded and remain in place.

Five new exact-owner tasks: deepseek-upstream-runtime, deepseek-runtime-contracts,
deepseek-registry-adapter, deepseek-runtime-canvas and deepseek-runtime-verification.
The new deepseek-runtime owner grants only eight runtime source/asset files.
Contracts, registry composition, existing canvas code and checks retain their
canonical owners. Original source/task hashes and existing RT1 work are preserved.

Source inventory at `39163dd30f703a79079e2d2446545cff3c453738`: 403 workspace
packages (397 public, six private), distinct from plugin instances. Four public
packages require another OS/CPU. In the isolated `.data/deepseek-runtime/releases/`
prefix, published packages are installed with scripts/optional payloads disabled;
nine unpublished host-compatible packages are compiled from unchanged source into
separate source-build folders. No installed package source is hand-edited.
Third-party notices and dependency licenses remain separate from the repository MIT
license; redistribution is not certified by the repository's top-level license.

A native Cordis context successfully activates unchanged upstream services and
supports disposal/disable. The owned HTTP control host listens on 127.0.0.1:4340.
A first 403-package isolated matrix completed; dependency/configuration and
browser-carrier outcomes remain separate from activation. RT3 completed adapter
composition checks, browser checks and source promotion. Full upstream feature
coverage and distribution review remain unfinished; no all-green claim is made.


## RT3 — Consolidated runtime candidate

Authorized 2026-11-16: integrate the runtime layers and registry adapter under
`runtime/`. It was initially delivered as a reviewed, unmerged candidate. The
user subsequently explicitly authorized backup and source merge; see the promotion
evidence below. RT2's full upstream feature coverage remains in
progress. No historical executor or planner was reconnected.

`runtime/launch.ts` supervises DevLab and native Harness, waits for IPC readiness,
wires registry federation, supports `--without-harness`, and closes owned children
on shutdown or startup failure. The folder contains boot/composition, default
switches, control/search plugins and native catalogue/worker/adapter/host/installer/
panel. Public contracts, HTTP/client and UI consumers retain established owners.
The installed kernels retain lifecycle authority; browser/server dependencies
remain separate and acyclic. `_LAB` stays unchanged and excluded from discovery.

Concurrent Herdr work changed shared source during verification. Fresh service-
owned tasks preserve those additions; an intermediate type-only Herdr patch became
unnecessary when concurrent source incorporated it. That task is not selected.
The final candidate retains the current nine default DevLab factories plus
controls/search (11). Disposable launcher/browser fixtures disable terminal-
dependent Herdr and terminal/server resources. These checks launch no Herdr session.

The final selection is 15 disjoint tasks and 36 destinations, each supplied by
exactly one selected task. Older RT1/RT2 and intermediate editions are provenance;
do not promote their overlapping files alongside this set. All selected source
preimages and materialized staged hashes matched at the preservation audit.
Later promotion must revalidate source hashes, as concurrent editing continues.

### Evidence and limits — 2026-11-16

- Candidate `npm run build`: TypeScript, Vite and registry generation passed with
  11 default manifests. Existing mixed static/dynamic import warning remains.
- Candidate `npm run check`: 20/20, including ownership/boundaries/disconnection,
  selection/rewind, search bounds, refusal and cleanup. Repeated after the current
  Herdr source snapshot changed; no root source was overwritten.
- `DEVLAB_DEEPSEEK_SOURCE=<pinned clone> DEVLAB_DEEPSEEK_RELEASE=<isolated release>
  npm run check:runtime`: 7/7. Real native activation, disable/rewind/persistence,
  invalid modules/expressions, isolated probe cleanup, federation and stale state,
  combined startup/shutdown, without-Harness and occupied-port cleanup passed.
- `DEVLAB_DEEPSEEK_ORIGIN=http://127.0.0.1:4344 node scripts/deepseek-runtime-browser.mjs`
  and `node scripts/runtime-plugins-browser.mjs`: both passed at 1440/820/390px,
  with zero page errors. Actual UI actions covered native off/rewind/probe, invalid
  JSON, canvas node/link, Hood registry, DevLab switches, stale-writer refusal,
  search and retained view. Fixed native header buttons remaining disabled after
  a completed action. Herdr UI itself is outside this runtime verification lane.
- Historical RT2 matrix: 403 packages = 150 active, 175 pending, 63 library,
  10 unavailable and five failed. This is default-fixture probe evidence, not a
  fresh all-feature certification of RT3. Nine unpublished builds preserve source;
  client-ui-session-status lacks two generated Typert exports. Provider/browser
  hosts, fixtures and platform payloads remain gaps. No paid model call was made.
- Recovery extracts verified archives only into new directories. Settings Rewind
  is revision-bound and independent for each host. Neither is an automatic
  production rollback or a multi-file promotion transaction.
- Earlier RT2 `dsh web --help` inspection used a personal default DSH_HOME and
  migrated the existing web profile before native startup failed. Removed bundle
  selection was restored; newer ACP and user patch data were retained. Earlier
  generated root-config bytes were unavailable, so full restoration cannot be
  asserted. Evidence: `.recovery/deepseek-runtime-default-profile-repair/repair.json`.

[Recovery, reproduction, logs and screenshots](../../.recovery/runtime-consolidated-20261116T064914Z/README.md) include
the exact selected task mapping, source archive and read-only service reviews.
Preview: `http://127.0.0.1:4345`; native controls: `http://127.0.0.1:4344`.
The prior full source-version backup and RT1 recovery remain preserved. No source
promotion, Git initialization, deployment or restart of earlier owners occurred.

RT3 final audit: main workspace `npm run check` passed 12/12 after metadata
updates. All 15 selected service reviews reported no conflicts; 36 destination
preimages matched. Source rewind restored and verified 161 files in a new
directory and refused an existing destination. The archive was also materialized
at `.data/runtime-integrated-20261116/`; all selected sources match byte-for-byte.


### RT3 promotion — 2026-11-16

User instruction: “ok just backup and merge it”. This supersedes the earlier
no-merge instruction for the selected runtime source. This is filesystem task
promotion in the existing checkout, not Git initialization, deployment or a
live-process restart.

A fresh source/staging backup was created before edits and verified against every
manifest hash: 1,866 files, 33,296,935 compressed bytes. Live state/dependencies,
reference sources, generated output, earlier recovery and separate projects stay
in place. The restore helper checks archive and per-file hashes and refuses an
existing destination.

The current client and HTTP entry had newer Herdr event subscriptions and project
cleanup/admission handling. Fresh `runtime-merge-client` and `runtime-merge-http`
tasks preserve those changes by three-way reconciliation. No source/hash conflict
was bypassed. The refreshed candidate built and passed 20 standard plus seven
native integration checks before promotion.

All 15 tasks were reviewed through the live project's `/api/projects/default/preimp`
service, then promoted through that same source writer with their reviewed revisions.
All 36 destinations were verified byte-for-byte against staging. Completed task
journals and original `.base` files remain; older overlapping editions remain
superseded. The promoted runtime README describes integrated source and startup.

Post-promotion `npm run build`, `npm run check` (20/20) and explicit-source/release
`npm run check:runtime` (7/7) passed against the actual root checkout. Native
feature limitations in RT2 remain; merging source does not certify all plugins.

[Backup, restore helper, promotion receipts and verification logs](../../../devLAB-version-backups/before-runtime-merge-20261116T090501Z/README.md)
record the precise selection and recovery. Runtime state and existing backend/UI
process identities are retained. Activation of changed backend owners remains a
separate controlled restart after saving drafts.

Final post-merge browser verification: both runtime browser scripts passed at
1440/820/390px with zero page errors using disposable DevLab state and the
separately owned native review host. All 15 merge journals are complete and all
36 destination contents still match staging. Backend/frontend service PIDs and
the eight-plugin live health snapshot match their pre-merge values.


### RT3 controlled activation — 2026-11-16

User instruction: “ok run the restart”. The existing backend user service now
starts the merged runtime launcher through a backed-up `30-runtime.conf` drop-in.
The original process-only kill policy remains. `systemd-analyze --user verify
 devlab-refactored.service` passed. The old backend and identified native host
were gracefully stopped; no broad process kill or unrelated host restart occurred.

The restarted launcher owns DeepSeek at 4340 and DevLab at 4322. Health verifies
all 11 DevLab plugins active. `/api/architecture` includes 403 native package
entries without stale status; `/api/runtime` reports 11 factories directly and
through the unchanged frontend proxy at 4323. The native selection revision and
entry states match before restart (five active); no switch was reset.

Live retention checks passed: all 15 running terminal IDs keep their shell PID,
Linux start identity and ownership; all 18 project IDs remain; five previously
ready previews were restored at exactly their original URLs, each HTTP 200.
The UI service keeps PID 22813 and separate review hosts are preserved. No browser
tab was reloaded and no terminal input was sent. In-memory browser drafts were
not inspected; retaining the UI process avoids forcing their reload.

[Activation backup, before/after inventory and service recovery](../../.recovery/runtime-activation-20261116T103258Z/README.md)
record the complete evidence. No source change or additional dependency install
was required. The earlier full source backup and merge journals remain intact.

## Public MIT publication — 2026-11-16

Separately authorized by the user: initialize Git and publish this source as
`creoaurea-devlab/fY-devLAB`, public, under MIT. This supersedes the refactor's
no-Git constraint for this publication only. Release metadata owns LICENSE,
THIRD_PARTY_NOTICES.md, package license metadata, README and .gitignore;
planning-protocol owns this evidence and the memory update. No application
behavior, dependency graph, runtime selection or live owner changed.

Publication excludes runtime data, recovery, caches, local projects, staged tasks
and historical workstation captures/raw evidence exports; local originals remain.
Archived first-party UNLICENSED metadata predates the explicit MIT release;
third-party licenses remain applicable.

Checks: `npm run check` passed (20 tests), and `npm run build` passed on
2026-11-16. Staged-file credential-pattern scan, including tarball contents,
found only CSS custom-property false positives. This is a bounded pattern scan,
not proof that every historical document contains no personal information.
Clean publication snapshot: `npm ci`, `npm run build` and `npm run check`
all passed (20/20 tests) in an independent temporary directory, without local
projects, staged tasks or workstation data. `npm audit --json` reported four
high findings: Vite, Zod and transitive attribution to the pinned pop-the-hood
and registry-map packages. No dependency changes were made. Initial import
whitespace review found existing trailing whitespace/EOF blanks; preserved.
Publication status: prepared and verified for public push to
https://github.com/creoaurea-devlab/fY-devLAB. Remote verification is reported
at handoff; this evidence does not claim a completed push.
