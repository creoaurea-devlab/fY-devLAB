# S — Stable surfaces, useful alignment and canvas terminals

Status: **implementation in progress; first stability fixes verified**. Reviewed
2026-11-16 in `_devLAB-refactored`. The user authorized quick wins and development /
surface stability after the audit. S1, S2 and S4 have the bounded implementation
recorded below; broader acceptance stays open. No live backend restart, Git,
deployment, CLI upgrade or historical planner execution is part of this pass.

## Outcome and boundaries

Changing project or surface must feel deliberate: return to the same Workflow,
Build canvas or terminal selection, without a delayed operation taking the user
elsewhere. Background terminal output, a warning, file discovery and compatible
UI refresh must not select a project or steal focus. Canvas terminals remain a
supported surface. Herdr adds its own view through H0–H2; it does not replace them.

Users can arrange connected nodes into readable spatial groups, resize canvas
terminals with the mouse, and adjust terminal text using small minus/plus buttons
in the existing header. The node catalogue becomes compact icons and short labels;
both left panels receive yellow resize lines with usable pointer and keyboard
targets. The compact work remains U2, with its left-panel tasks specified here.

Keep Cordis, one authority per state fact, public plugin interfaces, current shell
policies and the existing stores. No navigation framework, event bus, second PTY
owner, replacement terminal emulator or background updater. No new task directory
per atomic action: this one document is the human-maintained task record. Original
projects, live terminal processes, previews, draft text and concurrent standalone
factory/Agentic work are outside the write scope.

## Audit: what is established

Evidence: [runnable probe](surface-stability/audit.mjs),
[observations and source hashes](surface-stability/audit.json),
[browser/owner run](surface-stability/audit.log),
[overlap screenshot](surface-stability/align-overlap-before.png).
The browser loaded current source through a private Vite server, with isolated
browser storage and temporary backend/project data. No live user terminal or
browser was controlled. Assertions below describe observations, not repaired behavior.

| ID / priority | Finding and evidence | Source / limit |
| --- | --- | --- |
| F1 / high | **Reproduced navigation race.** With a workflow save delayed, request another project, then select the current project again. The older request still wins; `busy` becomes false while it is pending. | Real `createProjectWorkspace` + `createCanvasWorkspace`, only the persistence response delayed. `plugins/ui-projects/src/workspace.ts` issues its generation after awaiting save and returns early for the current ID. This proves a race, not the exact cause of the user's live return to DevLab. |
| F2 / high | **Reproduced terminal surface loss.** A → Terminals, B → Workflow, return to A: Workflow appears instead of Terminals. Both terminal IDs/PIDs remain unchanged. | `plugins/ui-shell/src/view.tsx` keeps output visibility/tab flags globally; `terminals.tsx` separately stores per-project expanded/selection preferences. Process survival does not establish presentation continuity. |
| F3 / medium | **Reproduced Build viewport reset.** Zoom 1.44, switch to Workflow, return to Build: zoom 1.0 and a new graph DOM. | Shell conditionally mounts Build; `plugins/ui-projects/src/build.tsx` also keys Hood by project and frames on first mount. The package keeps graph selection/expansion internally. Selection/caret reset risk is source-backed; the probe directly measured viewport and DOM, not every selection kind. |
| F4 / medium | **Reproduced overlapping alignment.** Two 500px-wide terminals are placed 280 canvas units apart. At zoom .55 the rectangles overlap by 121 screen pixels. | Shell `alignSelected` ignores dimensions, edges and grouping; `layout` also uses a fixed grid. See screenshot. Its red preview configuration notice is expected for these intentionally unconfigured throwaway projects. |
| F5 / medium | **Missing requested controls.** Canvas terminal has zero resize handles and zero font zoom buttons. Width/height numeric fields already exist; xterm font is fixed at 11px. | `plugins/ui-canvas/src/view.tsx` uses NodeResizer only for Browser nodes and copies resize dimensions only for that type. `plugins/ui-terminal/src/view.tsx` constructs xterm with `fontSize: 11`. |
| F6 / needs capture | **Live blinking and Codex warnings remain unclassified.** The current command resolves to standalone Codex 0.169.0; the backend PATH also resolves the same local entry. A Snap launcher and other app-bundled Codex processes coexist. | Read-only local executable/PATH inventory. Multiple installations are not evidence that DevLab launched the wrong one. Exact warning text and the incident's event sequence were requested; no private terminal history was copied. No upgrade or warning suppression performed. |
| F7 / medium | **Navigation identity can disagree with presentation.** Root category is local shell state; active project has another owner. Startup project selection is asynchronous, and development/preview callbacks can navigate later. | `src/workspace.ts`, `src/shell.tsx`, shell `selectRoot` and project explorer callbacks. These are additional paths to cover, not proven causes of the live incident. Preview source navigation already checks target/server generations; preserve those guards. |

Existing defenses were also checked: ten project/draft and terminal lease tests
passed. The existing terminal lifecycle browser check at 1440px passed, including
hidden launch/input/resize refusal, same-surface xterm/preview/PID retention,
explicit retry and bounded recovery. It does not cover F1–F3. Passing lock tests
do not establish complete filesystem or cross-project security.

## Behavior contract

### Navigation, ownership and retention

1. The newest explicit navigation intent wins. Assign its identity before any
   await; reselecting the current project cancels older pending navigation.
   Source/preview/development navigation and startup restoration use this same
   authority. An old completion cannot change project, root category, group, file,
   active view, error, focus or busy state belonging to a newer intent.
2. Save failure keeps the current project and its drafts, presents an actionable
   error and never falls back to DevLab/default. Failed inspection leaves an
   explicit unavailable state for the requested target; do not silently substitute
   another project. Deleted saved targets require a visible choice.
3. Extend the existing project/view owner rather than storing the active view in
   competing shell booleans and terminal preferences. Remember active surface,
   last canvas mode, output drawer state and selected terminal IDs per project.
   Root category is derived/reconciled with committed project identity. Add the
   Herdr surface only when H1 installs it; disconnected functionality is not a tab
   that silently falls back to another surface.
4. Workflow retains selected nodes/edges and viewport. Build retains graph
   selection, expansion, viewport and file editor selection/caret/scroll as well
   as draft text. Preserve each visited project's state when another is active.
   First-open framing applies once, never on ordinary return or poll completion.
   Use retained mounts where the installed Hood public interface lacks a state
   export; do not patch `node_modules` or import its private state. Hidden retained
   views must pause measurement/input and avoid growing polling work without bound.
   Each retained Build instance binds its own project ID; multiple retained views
   must not all read the mutable active-project snapshot as their identity.
5. Per-window restoration stores only validated presentation bookmarks in the
   existing browser storage, scoped by host/edition and project ID. It must not
   let another window's active selection take over this one. Keep durable graph
   geometry in CanvasWorkspace and terminal layout preferences in their existing
   owner. Selected node IDs are not ownership grants. No terminal output, secrets,
   unsaved editor contents or broad access rights enter the bookmark.
6. Ordinary surface switches preserve drafts and resource identity. Deliberate
   reload restores safe view bookmarks; it cannot be advertised as unsaved-text
   crash recovery. Explicit URL project selection has first-load priority, but
   a slow startup response cannot override subsequent user navigation.
7. Identity is project ID + node ID + actual session/generation, never pane index,
   display label or current global project. Only the visible active presentation
   may send input, resize or launch. Hidden views may observe retained output but
   cannot acquire those privileges. Invalid/stale ownership remains refused.
8. Separate terminal application output (including Codex notices) from transport
   status, lost process ownership and app errors. A warning never triggers
   navigation, a forced reload, an automatic update or replacement of a live shell.
   Reproduce and classify F6 before modifying environment/reconnect behavior.

### Align and group

- Keep one compact primary action: **Align & group selection**; disable below two
  eligible nodes with a reason. The existing whole-canvas Layout command can use
  the same implementation with all eligible nodes. On Build, use its existing
  graph layout action; never mutate a hidden Workflow selection from another view.
- A group here is a **spatial cluster of connected selected nodes**. It does not
  change ownership, execution, edges, parent IDs or add persistent container nodes.
  Connected components keep their relationship order; disconnected terminals are
  neatly tiled. Explicit semantic groups would be a separate requirement.
- Use current measured dimensions with saved-size fallbacks. Lay out connected
  components with the already installed Dagre dependency and pack their bounding
  boxes with a consistent gap. Handle cycles deterministically, keep mixed-sized
  terminals apart, respect any preserved parent coordinates and never silently
  reparent imported nodes. Unsupported layouts are left unchanged with a reason.
- Move only the requested selection, leave unrelated nodes fixed and account for
  their occupied rectangles. Keep edges and IDs byte-equivalent. Maintain viewport,
  selection and terminal sessions. A repeated command is stable; one Undo restores
  the whole arrangement. Report the number arranged/groups without a new toolbar;
  respect reduced motion and do not animate repeated terminal PTY resizes.

### Canvas terminal controls and compact panels

- Reuse the installed NodeResizer. Give a selected terminal visible edge/corner
  handles and usable hit targets. Pointer capture, Escape/cancel, touch and canvas
  zoom must work; dragging a header still moves the node, dragging a handle resizes,
  and text selection inside the terminal remains text selection. Retain numeric
  fields as the keyboard alternative. Clamp to supported min/max sizes, preserve
  prior expanded dimensions on collapse, and commit one coherent undo/save action.
- Minus/plus controls sit inside the existing terminal header. Proposed text range:
  8–24px, 1px steps, default 11px; boundary buttons disable and accessible labels
  announce the new size. Reset lives in the existing actions menu. Text size is
  distinct from canvas zoom, pane dimensions and Herdr pane zoom.
- Store text preference per project/node in the existing terminal presentation
  preferences and pass it through neutral options to canvas/dock renderers. Update
  xterm's option in place; never add font size to the effect that creates/disposes
  the terminal. Refit the visible owner once after settling, preserve scrollback,
  selection and PID, and never send a hidden owner's PTY resize.
- U2's left panel slice uses one small icon + short readable label per catalogue
  item. Descriptions move to an accessible tooltip/details affordance. Preserve
  drag/drop and keyboard creation; remove claims of active delegation while that
  capability is disconnected. No tiny unreadable text or icon-only mystery buttons.
- Both the project explorer and node catalogue get a thin yellow divider with a
  larger invisible hit area, resize cursor, visible keyboard focus and separator
  labels. Arrow keys resize, Home/End reach limits, and double-click/keyboard reset
  restores the default width. Keep independent widths/collapse states, constrain
  the sum to preserve usable canvas space and use the existing drawer behavior at
  narrow widths. A collapsed handle remains discoverable. Colour is not the only cue.

## Slices and ordering

The 33-task table remains the acceptance contract. S1, S2 and S4 are **in progress**
with the implementation evidence below; the remaining implementation slices are planned.
S0 records the completed audit, whose baseline findings remain preserved.
H0 can proceed independently; H1 integration must use the stable presentation
contract from S1–S3. H2 retains its W1 policy dependency. U2 keeps its broader Hood
and drawer scope, with left-panel acceptance delegated to S7. Do not duplicate
these tasks in the disconnected historical planner.

| Slice / status | Depends on | Demonstrable outcome |
| --- | --- | --- |
| S0 **done** | None | Source-backed audit, disposable reproductions, preservation checks and this reviewed task breakdown. F6 stays open. |
| S1 in progress | S0 | Delayed saves/startup/old callbacks cannot override the latest navigation intent; root category, project and focus agree. |
| S2 in progress | S1 | A → B → A and Workflow ↔ Build ↔ Terminals restore each project's selected surface, graph/editor selection and viewport. Project/surface reload bookmarks and terminal pane preferences verified below; graph/editor reload recovery remains open. |
| S3 planned | S1, S2 | Terminal surfaces retain identity through switches; warning/flicker sources are classified with no hidden input/resize or automatic update. |
| S4 in progress | S2 | Align/group handles mixed node sizes, connections, unrelated obstacles, cycles and one-step Undo without overlaps. |
| S5 planned | S2, S3 | Canvas terminal mouse resizing works at multiple canvas zooms, with keyboard alternative and retained PTY. |
| S6 planned | S3, S5 | Header minus/plus changes text size in place and keeps canvas/dock preference consistent. |
| S7 planned | S2, S5 | Compact catalogue and two yellow side-panel dividers work with independent saved widths and accessible narrow drawers. |
| S8 planned | S1–S7 | Current surfaces pass the combined retention, ownership, focus and usability matrix at 1440/820/390. |
| S9 planned | S8, H1, H2 | Separate Herdr and canvas terminal views pass the same applicable boundary/retention cases; explicit detach and external ownership stay truthful. |

Implementation priority: **S1 → S2 → S3**, then H1 may build on those boundaries
while S4–S7 remain independent presentation work in the stated dependency order.
This is a sequence for bounded work, not authorization to launch parallel agents.

## Atomic tasks

Every task reads the [common rules](../../../.agents/protocols/rules.md),
[work loop](../../../.agents/protocols/work.md), this behavior contract, its declared
ownership YAML and the current contents of its write paths. Extra reads below are
exact caller/contract paths. Writes list product/test files only: the planning
owner records the resulting evidence/status here at handoff. Do not edit across
owners; complete these children sequentially. Preserve existing task IDs.

Verification shorthand: **T** = types/build and applicable source boundary checks;
**O** = public-owner tests; **B** = real disposable browser interaction, including
success/refusal/cleanup. Each row gives the behavior that must be demonstrated;
none is a claimed result. Reuse current test files rather than introducing a runner.

| Task | Owner | Exact writes | Extra reads | Prerequisite / observable acceptance |
| --- | --- | --- | --- | --- |
| S1.1 | ui-contracts | `packages/ui-contracts/src/index.ts` | `plugins/ui-projects/src/workspace.ts`, `src/workspace.ts`, `src/shell.tsx` | S0; define minimal navigation result/intent semantics for present callers; no new service. T. |
| S1.2 | project-view | `plugins/ui-projects/src/workspace.ts` | `packages/ui-contracts/src/index.ts` | S1.1; issue intent before save, current-ID cancellation, no stale busy/error/selection, preserve failed-save drafts. O. |
| S1.3 | workspace-shell | `plugins/ui-shell/src/view.tsx` | `packages/ui-contracts/src/index.ts`, `plugins/ui-projects/src/workspace.ts` | S1.2; root/category transition commits only for the current result; no silent default fallback. B. |
| S1.4 | browser-bootstrap | `src/workspace.ts`, `src/main.ts` | `packages/ui-contracts/src/index.ts` | S1.2; startup/deep-link restoration cannot supersede later interaction; preserve compatible HMR owners. O/B. |
| S1.5 | workspace-ui | `src/shell.tsx` | `packages/ui-contracts/src/index.ts`, `plugins/ui-preview/src/server-state.ts` | S1.2; late development-fork completion/rollback cannot select a project after a newer intent; use public navigation seam. B. |
| S1.6 | verification | `scripts/project-workspace.test.ts`, `scripts/hood-minimap-browser.mjs` | `src/workspace.ts`, `src/shell.tsx`, `plugins/ui-shell/src/view.tsx` | S1.2–S1.5; original F1 fails before correction/passes after, slow-start and save-failure cases pass. O/B. |
| S2.1 | ui-contracts | `packages/ui-contracts/src/index.ts` | `plugins/ui-shell/src/view.tsx`, `plugins/ui-shell/src/terminals.tsx`, `plugins/ui-projects/src/build.tsx` | S1; define single project presentation record and explicit last canvas/output state; retain neutral contracts. T. |
| S2.2 | project-view | `plugins/ui-projects/src/workspace.ts`, `plugins/ui-projects/src/build.tsx`, `plugins/ui-projects/src/editor.tsx` | `packages/ui-contracts/src/index.ts`, `node_modules/@creoaurea/pop-the-hood/dist/react.d.ts` (read only) | S2.1; retain Build state and editor selection/caret/scroll per project through the public host composition. B. |
| S2.3 | workspace-shell | `plugins/ui-shell/src/view.tsx`, `plugins/ui-shell/src/terminals.tsx` | `packages/ui-contracts/src/index.ts` | S2.1–S2.2; remove competing active-view flags, restore A's terminals after visiting B, suspend hidden interactions without discarding retained views. B. |
| S2.4 | browser-bootstrap | `src/workspace.ts`, `src/main.ts` | `packages/ui-contracts/src/index.ts` | S2.3; per-window bookmark restoration with schema/project validation, no cross-window selection takeover or secrets; save guards remain. O/B. |
| S2.5 | verification | `scripts/project-workspace.test.ts`, `scripts/hood-minimap-browser.mjs`, `scripts/terminal-lifecycle-browser.py`, `scripts/terminal-restart-browser.mjs` | `plugins/ui-projects/src/build.tsx`, `plugins/ui-shell/src/view.tsx` | S2.2–S2.4; reproduce/close F2/F3, preserve Workflow selection, editor drafts/caret and preview identity; deleted target/storage failure paths. O/B. |
| S3.1 | planning-protocol | `docs/plans/herdr-wisdohm-memory/surface-stability.md`, `docs/plans/herdr-wisdohm-memory/surface-stability/warning-evidence.json` | `plugins/terminal-pty/src/index.ts`, `plugins/ui-terminal/src/view.tsx` | S0; record exact redacted warning, executable/version, ownership mode, event order and restart/replay counters. If unavailable, mark F6 unverified; do not invent a cause. |
| S3.2 | workspace-shell | `plugins/ui-shell/src/terminals.tsx`, `plugins/ui-shell/src/view.tsx` | `packages/ui-contracts/src/index.ts`, `plugins/ui-terminal/src/view.tsx` | S2; stable presentation keys/retained active-project state; one visible input/resize owner after switching. B. |
| S3.3 | terminal-view | `plugins/ui-terminal/src/view.tsx` | `plugins/ui-terminal/src/input.ts`, `packages/ui-contracts/src/index.ts` | S3.1, S3.2; repair only reproduced attach/replay/focus defects; preserve recovery and retry rules. Application output cannot navigate. No speculative environment patch. B. |
| S3.4 | verification | `scripts/terminal-lifecycle-browser.py`, `scripts/terminal-preview-browser.py` | `plugins/ui-terminal/src/view.tsx`, `plugins/ui-shell/src/terminals.tsx` | S3.2–S3.3; cross-project switch under output/resize, disconnect/replay, synthetic warning, retained IDs/PIDs and no replayed input. B. |
| S4.1 | ui-contracts | `packages/ui-contracts/src/index.ts` | `plugins/ui-shell/src/view.tsx`, `plugins/ui-canvas/src/workspace.ts` | S2; expose a small canvas arrange command/result; layout behavior belongs to canvas, not shell. T. |
| S4.2 | canvas-ui | `plugins/ui-canvas/src/workspace.ts`, `plugins/ui-canvas/src/view.tsx`, `plugins/ui-canvas/package.json` | `packages/ui-contracts/src/index.ts`, `package.json` | S4.1; dimension-aware connected-component/Dagre arrangement, preserve edges/IDs/unselected positions, deterministic packing, one Undo; declare the already pinned dependency. O/B. |
| S4.3 | delivery-config | `package-lock.json` | `plugins/ui-canvas/package.json`, `package.json` | S4.2; synchronize only the existing Dagre peer/dependency declaration; no version upgrade or new dependency. T. |
| S4.4 | workspace-shell | `plugins/ui-shell/src/view.tsx` | `packages/ui-contracts/src/index.ts` | S4.2; wire existing buttons/shortcut to the public command; correct surface/selection eligibility and concise outcome/Undo affordance. B. |
| S4.5 | verification | `scripts/hood-minimap-browser.mjs`, `scripts/terminal-lifecycle-browser.py` | `plugins/ui-canvas/src/workspace.ts`, `plugins/ui-shell/src/view.tsx` | S4.3–S4.4; F4 regression, connected/cyclic/mixed-size/single/empty/unknown nodes, obstacles, repeatability and one Undo; no PID changes. O/B. |
| S5.1 | canvas-ui | `plugins/ui-canvas/src/view.tsx`, `plugins/ui-canvas/src/workspace.ts`, `plugins/ui-canvas/src/canvas.css` | `packages/ui-contracts/src/index.ts`, `plugins/ui-terminal/src/view.tsx` | S2, S3; terminal handles and dimension commit use the existing resize path; zoom-aware pointer capture, keyboard fields, cancellation and one Undo. B. |
| S5.2 | terminal-view | `plugins/ui-terminal/src/view.tsx` | `plugins/ui-canvas/src/view.tsx` | S5.1; preserve renderer/session while fitting, coalesce visible PTY sizes, reject stale/hidden resize; no new resize manager. B. |
| S5.3 | verification | `scripts/terminal-lifecycle-browser.py` | `plugins/ui-canvas/src/view.tsx`, `plugins/ui-terminal/src/view.tsx` | S5.1–S5.2; corner/edge resize at .5/1/2 canvas zoom, min/max/cancel/collapse/reload, text selection, one Undo and same PID. B. |
| S6.1 | ui-contracts | `packages/ui-contracts/src/index.ts` | `plugins/ui-shell/src/terminals.tsx`, `plugins/ui-canvas/src/view.tsx` | S5; typed font-size/presentation callback options with bounded defaults; no process permission fields. T. |
| S6.2 | terminal-view | `plugins/ui-terminal/src/view.tsx` | `packages/ui-contracts/src/index.ts` | S6.1; font option updates live xterm and visible fit, without disposing/replaying or altering canvas zoom. B. |
| S6.3 | workspace-shell | `plugins/ui-shell/src/terminals.tsx`, `plugins/ui-shell/src/view.tsx` | `packages/ui-contracts/src/index.ts` | S6.1; one per-project/node text preference in existing terminal preferences, usable from canvas and dock; compatibility with old saved preferences. O/B. |
| S6.4 | canvas-ui | `plugins/ui-canvas/src/view.tsx`, `plugins/ui-canvas/src/canvas.css` | `packages/ui-contracts/src/index.ts` | S6.2–S6.3; compact −/+ controls in the existing header, keyboard labels and limits, reset in existing menu. B. |
| S6.5 | verification | `scripts/terminal-lifecycle-browser.py` | `plugins/ui-terminal/src/view.tsx`, `plugins/ui-shell/src/terminals.tsx` | S6.2–S6.4; bounds/reset, canvas-dock consistency, saved preference, retained selection/scrollback/PID, no hidden resize. B. |
| S7.1 | workspace-shell | `plugins/ui-shell/src/view.tsx`, `plugins/ui-shell/src/devlab.css` | `packages/ui-contracts/src/index.ts`, `plugins/ui-projects/src/projects.css` | S2, S5; project explorer yellow separator, independent constrained width and keyboard/reset behavior through existing drawer layout. B. |
| S7.2 | canvas-ui | `plugins/ui-canvas/src/view.tsx`, `plugins/ui-canvas/src/canvas.css` | `plugins/ui-shell/src/devlab.css` | S7.1; compact catalogue icon/label, second yellow separator, truthful descriptions, retained drag/drop and accessible expanded details. B. |
| S7.3 | verification | `scripts/hood-minimap-browser.mjs`, `scripts/terminal-lifecycle-browser.py` | `plugins/ui-shell/src/view.tsx`, `plugins/ui-canvas/src/view.tsx` | S7.1–S7.2; independent divider drag/keyboard/collapse, narrow drawer focus/Escape, no clipped labels or terminal resize from hidden surfaces. B. |
| S8.1 | verification | `scripts/hood-minimap-browser.mjs`, `scripts/terminal-lifecycle-browser.py`, `scripts/terminal-preview-browser.py` | `src/profile.ts`, `src/workspace.ts`, `plugins/ui-shell/src/view.tsx` | S1–S7; combined matrix below; source gates/build, exact evidence and cleanup. F6 must be classified or explicitly remain open; no blanket stability claim. T/O/B. |
| S9.1 | verification | `scripts/terminal-lifecycle-browser.py`, `scripts/terminal-preview-browser.py` | `packages/ui-contracts/src/index.ts`, `docs/plans/herdr-wisdohm-memory.md` | S8, H1, H2; real disposable Herdr attach/detach/parity checks. H0/H1 must name installed adapter owner/paths before this task starts; no invented integration files. B. |

S0's executed work belongs to `planning-protocol`: this document, the evidence
directory, parent-plan links and project-memory facts. Existing verification
programs were executed, not edited. Future implementation tasks use the active
work loop; old factory-oriented templates are not instructions to resume an executor.

## Acceptance and evidence policy

Use the same project IDs with deliberately colliding node labels across projects,
plus distinct IDs, so a test cannot pass through labels accidentally matching.
Check ordinary return, rapid/overlapping navigation, delayed save/read/list,
stale failure/success, compatible HMR, intentional reload, storage unavailable,
deleted targets, hidden panels, focus overlays and multi-window activity.

For each relevant case assert project/surface identity, selected node/session/file,
viewport/scroll/caret, dirty text, live terminal ID/PID, number of creates/attaches,
input and resize owner, output replay/reset count, iframe identity and focus.
Do not validate stability using screenshots alone. Screenshots at 1440/820/390
support density, labels, handles and overlap; event/owner assertions prove behavior.
Exercise Off/Guided/Strict refusal separately from UI retention; an external Herdr
server is never labelled Strict solely because its client is in a Strict PTY.

Source changes run `npm run check`, `npm run build` and the affected existing
behavior checks. Public-owner failures get regression coverage through existing
files. Prototype/plan changes use source and link review. A new source or test
file requires an earned responsibility and its canonical owner update first;
the implementation does not get permission to grow a framework to pass this plan.

### Actual execution, 2026-11-16 (Europe/Vilnius)

- `node docs/plans/herdr-wisdohm-memory/surface-stability/audit.mjs` completed:
  F1–F4 reproduced, F5 absent controls counted, zero browser JS errors, two fixture
  terminal processes removed, temporary data removed, 17 inspected source/manifest
  hashes unchanged. This is an audit result, not a green regression suite.
- `node --test scripts/project-workspace.test.ts scripts/terminal-lease.test.ts`:
  **10 passed**; [log](surface-stability/baseline-tests.log).
- `DEVLAB_BUILD_DIR="$PWD/dist" TERMINAL_LIFECYCLE_EVIDENCE_DIR=/tmp/devlab-surface-lifecycle /usr/bin/python3 scripts/terminal-lifecycle-browser.py --width 1440`:
  **passed**, zero JS errors, four fixture terminal processes gone;
  [report](surface-stability/lifecycle.json). This check used the existing built UI;
  the adversarial audit above used current Vite source. No rebuild was needed for
  this documentation/audit-only change, and no full app/security certification is claimed.
- Two initial browser probe attempts addressed the wrong/closed Build zoom
  control. The corrected probe opens the existing Layout drawer before using its
  zoom button. [Attempt 1](surface-stability/audit-attempt1.log) and
  [attempt 2](surface-stability/audit-attempt2.log) are retained; they are harness
  failures, not product findings. The first lifecycle invocation omitted its
  required build-directory variable and exited before starting a fixture;
  [setup log](surface-stability/lifecycle-setup-attempt.log) is retained.
- F6 remains open pending exact warning and incident evidence. The source-backed
  state fixes do not need an invented Codex diagnosis. No live reproduction,
  process restart, library upgrade, ownership-policy rewrite or product source
  edit occurred in this audit. Source and plan checks must be refreshed when
  implementation begins; these observations are a baseline, not future proof.
- [Plan validation](surface-stability/plan-validation.json): all 33 task IDs unique,
  exact write paths belong to declared canonical owners, current read paths/local
  links exist, and the slice/Herdr/WISDOHM/memory dependency graph is acyclic.
  The existing 17 inspected source/manifest hashes still match the audit baseline.


## First implementation — quick wins, 2026-11-16

Scope: sequential changes by `ui-contracts`, `project-view`, `browser-bootstrap`,
`workspace-ui`, `workspace-shell`, `canvas-ui`, `preview-view` and `verification`.
Only their existing files were edited. `planning-protocol` owns this status and
its evidence. Backup of affected files (including later-added callback paths):
`../_devLAB-refactored-backups/surface-quick-wins-20261116/` relative to the repo.
The earlier complete project backup also remains available. No live process owner
or effective terminal policy was replaced.

Delivered behavior:

- Project selection assigns its intent before waiting for a save, returns false
  when superseded, keeps pending busy state accurate, and suppresses stale errors.
  Selecting the current project or explicitly changing surface supersedes a pending
  switch. Failed current saves retain the project/draft and expose the error.
- Runtime starts with the URL-selected project identity, removing the late startup
  switch. This corrected an additional reload/fast-Terminals-click failure found
  by the unchanged lifecycle test during implementation.
- Root category derives from actual project metadata. Development completion and
  rollback use a captured navigation revision; explorer/preview-source continuations
  stop on a superseded selection. These callback changes were source-reviewed and
  type-checked; the full development-fork UI failure matrix remains in S1.6.
- Output selection now belongs to each project in the existing project owner.
  A → B → A restores Terminals. Compatible live views retain fallback flags until
  their older owner is deliberately reloaded; no forced document reload is issued.
- Build retains a separate mounted view and frozen snapshot per visited project,
  with a project-bound public source client. Viewport, graph DOM and editor text
  selection survive switching. Hidden Build callbacks cannot navigate another
  project. Active visited snapshots continue to update. Reload/crash recovery and
  the complete hidden-view/HMR resource matrix are not claimed.
- Align/Layout delegate to CanvasWorkspace's optional public arrange command.
  It uses measured/saved rectangles and avoids unselected obstacles, preserving
  IDs, edges, viewport and one-step Undo. Selection alignment is disabled on Build
  and below two selected nodes. This is dimension-aware grid placement, **not yet
  the connected-component/Dagre grouping required by the complete S4 slice**.
- Explicit Workflow/Build clicks keep keyboard focus on the clicked button;
  closing the output with Escape still restores its opener.

Completed acceptance in this pass: S1.1/S1.2's navigation seam and original race,
S1.4's late-startup path, S2's ordinary surface/project round trips, and S4's overlap
regression. Other portions of S1/S2/S4 remain in progress rather than marking all
33 tasks done. No new application file, dependency, kernel or state store was added.

Verification and final limits are recorded in [the evidence report](quick-wins/verification.json).
The [browser probe](surface-stability/audit.mjs) accepts `SURFACE_AUDIT_VERIFY=1`
and `SURFACE_AUDIT_OUTPUT` to assert the fixes while preserving the original audit
JSON/log/screenshot. Run from this checkout:

```sh
node --test scripts/project-workspace.test.ts
npm run check
npm run build
SURFACE_AUDIT_VERIFY=1 SURFACE_AUDIT_OUTPUT="$PWD/docs/plans/herdr-wisdohm-memory/quick-wins" node docs/plans/herdr-wisdohm-memory/surface-stability/audit.mjs
DEVLAB_BUILD_DIR="$PWD/dist" TERMINAL_LIFECYCLE_EVIDENCE_DIR=/tmp/devlab-quick-lifecycle /usr/bin/python3 scripts/terminal-lifecycle-browser.py
node scripts/hood-minimap-browser.mjs
```

Adoption: save drafts and reload the refactored window once to install the changed
browser workspace owners. Existing owners deliberately survive source updates.
The running backend and its cached Hood snapshot were not restarted. No Codex
upgrade/warning suppression occurred; F6 is still unclassified. S3, S5–S9 and the
remaining compact-panel/Herdr work are not represented as implemented.

## Terminal restart preservation — 2026-11-16

User request: preserve terminal work after the backend restart needed to activate
current source. This bounded S2.4 implementation restores presentation at startup;
the existing tmux service remains the only shell owner. S2 stays **in progress**:
graph/editor reload recovery and the complete deleted-target, unavailable-storage
and multi-window matrix are still open. S3/F6 warning classification is unchanged.

Scope: `browser-bootstrap` changed `src/main.ts` and `src/workspace.ts`;
`project-view` changed `plugins/ui-projects/src/workspace.ts`. `verification`
extended the existing project workspace test and added the disposable
`scripts/terminal-restart-browser.mjs`; its canonical ownership entry and generated
compatibility projection were updated. `planning-protocol` owns this evidence and
the memory update. Backup: `../_devLAB-refactored-backups/terminal-restart-20261116/`.
No kernel, grants, terminal process code, dependency or product source file was added.

- The tab URL records selected project, Workflow/Build mode and terminal/server
  output. Only allowed mode/output values initialize the project owner, before
  rendering; the existing project service validates project availability. The
  observer works with a retained HMR session and skips standalone element views.
  History failures leave the current view usable; no second storage authority or
  cross-window selection broadcast was introduced.
- The existing terminal preferences already retain pane selection, order, sizes
  and orientation. Independent tmux retains the shell process, environment, cwd,
  running children and input already delivered to the shell. Startup reattaches
  to recorded identities rather than spawning replacement shells.
- Read-only live inspection found 11 running sessions, 11 saved records and
  matching PID/start identities and tmux sockets. No input or signals were sent
  to them. These legacy owners did not have the newer independent systemd scope;
  the real backend was a manual process while its user unit was inactive.
  A future controlled activation must identify that process, not blindly restart
  an inactive unit against the occupied port. No live backend/window restart was
  performed in this change.

Verification (all executed in `_devLAB-refactored`):

```sh
node --test --test-name-pattern='independent tmux owner|SIGKILL backend crash|Systemd service stop|restart retains|temporary owner inspection' scripts/terminal.test.ts
node --test scripts/project-workspace.test.ts
npm run ownership:sync
npm run check
npm run build
node scripts/terminal-restart-browser.mjs
```

Results: **5 terminal restart tests**, **13 project workspace tests**, **12 source
and runtime checks**, type check and build passed. The browser test passed with two
disposable terminals: unchanged shell PIDs/identities, a background heartbeat job
running while the backend was offline, retained environment/cwd/output, one
partially typed command executed exactly once, selected project/terminal surface,
both selected panes and custom split orientation/sizes restored after reload.
No duplicate shells; fixture processes and temporary data were cleaned up.

[Evidence report](terminal-restart/verification.json),
[browser assertions](terminal-restart/browser.json),
[before restart](terminal-restart/before-restart.png) and
[after restart](terminal-restart/after-restart.png) preserve the result. Logs are
beside the report. An initial browser assertion compared raw serialized preference
objects; reload adds omitted defaults. The corrected assertion compares every
explicitly chosen value and sets a nondefault orientation/size. This was a test
expectation correction, not a product failure.

Limits: app/backend restart is covered, **machine reboot or logout is not**.
Scrollback is bounded by the existing tmux capture (last 2,000 lines) and replay
ring (default 1 MiB), not an unlimited transcript. Input whose delivery is uncertain
is never replayed automatically; the partial-command test covers text already
delivered to the shell, not new typing during an outage. Unsaved editor drafts
retain their existing unload guard and are not made crash recoverable by this
change. Save drafts before deliberately reloading to adopt changed workspace
owners. Original services and the user's 11 live sessions remained untouched.
