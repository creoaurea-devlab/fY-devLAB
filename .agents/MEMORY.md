# DevLab project memory

Last reviewed: 2026-11-16. Edition: `_devLAB-refactored` (independent copy). Public MIT publication as `creoaurea-devlab/fY-devLAB` was authorized on 2026-11-16; see the publication evidence in the simplification plan. This is a source-backed handoff; recheck affected
facts before editing. [Update rules](protocols/updates.md) define maintenance.
Work order, status and check results live in the applicable plan:
[simplification](../docs/plans/simplification.md) or
[Herdr / WISDOHM 3 / Memory Node](../docs/plans/herdr-wisdohm-memory.md).

## Current product and architecture

- Retained capabilities: projects, source editor, canvas, terminals, previews,
  Hood and read-only rules inspection. Planning, execution and Whiteboard are
  disconnected. Sources: [profile](../src/profile.ts),
  [UI catalog](../src/contributions.ts), [disconnection checks](../scripts/disconnection.test.ts).
- The source profile selects eleven plugins: canvas-store, project-local, terminal-pty,
  rules-local, herdr-runtime, project-server, preview-inspector, registry-map,
  transport-http, runtime-control and workspace-search. All eleven are active after the authorized restart; five previews were restored
  at their existing URLs (2026-11-16).
  `runtime/server.ts` owns startup/shutdown; `runtime/index.ts` owns composition/grants
  and reads `runtime/plugins.json` startup switches. `src/server.ts` and
  `src/profile.ts` are compatibility entries (2026-11-16).
- Cordis microkernel flow is retained, reverified 2026-11-15:
  [server](../runtime/server.ts) creates `@devlab/kernel`, then starts the selected
  [profile](../runtime/index.ts). The pinned kernel adapter (325 source lines) uses
  Cordis `Context`, injection, plugin fibers and disposal effects; it adds declared
  dependency ordering, capability admission, leases and compatible replacement.
  Cordis is pinned at `4.0.0-rc.11-creo.bc9a344` in the
  [dependency manifest](../package.json). Kernel source/build and both pinned
  archives match the original edition byte-for-byte. Detailed verification lives
  in [the saved checkpoint](../docs/plans/simplification.md#checkpoint--cordis-retained-and-operations-saved).
- [src/workspace.ts](../src/workspace.ts) retains project, per-project canvas and
  preview owners. [src/main.ts](../src/main.ts) keeps owners across compatible HMR,
  warns before losing drafts and requires deliberate reload for owner changes.
  In-memory retention does not provide crash recovery.
- Service contracts live in `packages/contracts`; browser contracts in
  `packages/ui-contracts`; HTTP client in `packages/client`; behavior in `plugins`.
  The inactive adoption wizard and its preview-to-project dependency were removed
  on 2026-11-15. Assessed evidence remains exported from the rules contract; retired
  execution schemas were removed. Sources: `plugins/ui-preview/src/pane.tsx`,
  `packages/contracts/src/rules.ts`, package manifests.
- Browser automation is not enabled in the current browser client, even though
  its UI package remains registered for saved nodes and enabled adapters. Creation
  follows `client.browsers`; saved Browser nodes retain their supported payload.
  Sources: `src/main.ts`, `plugins/ui-canvas/src/view.tsx` (2026-11-15).

## Runtime composition and component laboratory

Preimplementation added 2026-11-16: [`_preimp/`](../_preimp/README.md) holds one
task folder with canonical owner/destinations, plan, sandboxed HTML prototype,
staged source and recovery originals. The existing project service owns creation,
revision-bound review and resumable filesystem promotion; no Git, executor,
dependency or runtime plugin was added. Preview's **Prototype** drawer edits these
files; the normal preview stays mounted. Build and the generated registry derive
owner/destination links and bounded source snapshots. Source:
`plugins/project-local/src/preimp.ts`, `plugins/ui-preview/src/prototype.tsx`,
`scripts/architecture.ts`. Staging is excluded from Vite serving/watching and
TypeScript roots; production imports are checked. CSP blocks fetch/resources/forms
and isolates origin/storage; it is not OS/network containment or a ban on iframe
self-navigation. Promotion is atomic per file, not across the whole task.
The initial `compact-node-catalog` task is a proposal with unchanged production
copies, not completion of S7. [Implementation/evidence](../docs/plans/herdr-wisdohm-memory/preimplementation.md)
records checks and limits. Backend methods were activated by the controlled
restart on 2026-11-16; adopt changed browser owners by deliberately reloading after saving drafts.

- Source moved on 2026-11-16: [runtime](../runtime/README.md) owns backend boot,
  startup plugin switches and [registry routing](../runtime/registry-router.ts).
  The router forwards selected manifests and kernel health to the existing
  `registry-map` provider; Cordis remains the lifecycle/admission authority.
  Switches apply at the next startup; UI contribution toggles remain separate.
- [`_LAB/`](../_LAB/README.md) holds reference components, excluded from project
  discovery/Build, generated Hood source, TypeScript input, Vite serving/watching
  and project forks. DeepSeek Harness was cloned there at
  `39163dd30f703a79079e2d2446545cff3c453738`. Its unchanged packages are now
  installed in the isolated `.data/deepseek-runtime/releases/` prefix for RT2/RT3.
  [Research](../runtime/RESEARCH.md) records proposed modules and the Cordis version
  mismatch. Only explicit reviewed adapters may be promoted into composition;
  no executor or planner was reconnected. Reconsider direct upstream adoption only
  after dependency and lifecycle compatibility evidence. Runtime composition was
  activated by the controlled backend restart on 2026-11-16.

- Runtime controls/search and native Harness integration were promoted on
  2026-11-16 after explicit user approval. Fifteen disjoint service-reviewed tasks
  merged 36 destinations, including refreshed client/HTTP adapters that preserve
  newer Herdr subscriptions and cleanup. `runtime/` now owns composition,
  switches, control/search, native hosting and registry adaptation. Public
  contracts and UI consumers retain their existing seams. Source:
  [runtime guide](../runtime/README.md), [launcher](../runtime/launch.ts),
  [registry adapter](../runtime/registry-router.ts).
- `npm run start:runtime` supervises DevLab and native Harness; ordinary `npm start`
  starts DevLab only and can federate an independently owned host through
  `DEVLAB_DEEPSEEK_ORIGIN`. `DEVLAB_DATA_DIR` selects private DevLab state. The
  authorized restart on 2026-11-16 activated the combined launcher through
  `~/.config/systemd/user/devlab-refactored.service.d/30-runtime.conf`.
  DevLab 4322 now has 11 active plugins and federates 403 packages from Harness
  4340. Native selection was preserved (five entries active). UI 4323 kept its
  process; 15 terminal PID/start/ownership identities, 18 projects and five
  preview URLs survived/restored. No browser reload or terminal input was sent.
  Candidate hosts 4341/4344/4345 retain separate owners.
  [Activation evidence and service recovery](../.recovery/runtime-activation-20261116T103258Z/README.md).
- [Fresh source backup](../../devLAB-version-backups/before-runtime-merge-20261116T090501Z/README.md)
  preserves 1,866 pre-merge files with verified hashes and a restore-to-new-folder
  helper. Promotion journals retain originals; older overlapping task editions
  are superseded and must not be promoted on top of this set. Settings rewind
  and source recovery are separate. [RT3](../docs/plans/simplification.md#rt3--consolidated-runtime-candidate)
  owns actual verification evidence and the user's superseding merge approval.
  Full upstream feature coverage remains incomplete: pending/failed package probes,
  platform gaps and two missing generated client exports are documented. Prior
  personal DSH profile migration/partial repair remains disclosed in the previous
  [recovery notes](../.recovery/runtime-consolidated-20261116T064914Z/README.md).

## Standalone software factory

The authorized factory is implemented in [`_projects/software-factory/`](../_projects/software-factory/README.md)
(2026-11-15). Its [canonical plan](../_projects/software-factory/PLAN.json) tracks 9 milestones,
20 slices and 60 tasks with evidence. It preserves description → app intent → feature intents
→ specs → atomic plan, one coordinator, per-step editable engines, scoped Memory Node,
Intelligence and WISDOHM adapters, and Sandcastle-owned PTYs. The standalone host now admits explicitly selected local app folders through authenticated browsing and displays Codex login status; state is outside source at `~/.local/state/software-factory`. Standalone host: 5198;
deterministic demonstration: 5199. [Verification](../_projects/software-factory/evidence/verification.json)
records 84 passing tests, public type checks, real browser flows and a separate live Codex pilot.

Optional Cordis and canonical ownership adapters are implemented and tested. They are not
installed into this live profile; existing planning/execution disconnection and process owners
remain unchanged. Publication needs the host writer lease or an explicit exclusive source root.
Native mode is not filesystem confinement; Bubblewrap is unavailable on this machine.

## Durable decisions

| Decision | Reason and reconsideration condition |
| --- | --- |
| Preserve the Cordis microkernel and public plugin flow in the independent copy; Git publication separately authorized 2026-11-16. | Reconfirmed 2026-11-15. Simplify capability implementations and unused callers while retaining Cordis lifecycle, declared dependencies, admission and cleanup. The smaller reference hosts use the same kernel with incomplete features. Reconsider only for an explicit architecture change and verified equivalent behavior. |
| Simplify one responsibility at a time. | Preserve observable behavior and retained owners. Introduce shared abstractions only for a demonstrated common rule or current consumer need. |
| Maintain context directly in Markdown. | The planner/executor was extracted. No new scheduling service, SQL writer or automatic memory agent is needed for the requested plan. Reconsider only for an explicit product requirement. |
| Apply Ponytail and deep-module deletion tests to the second pass (2026-11-15). | Reuse existing modules and dependencies; remove only proven inactive paths while preserving safety and retained behavior. Candidate scope and consumer/policy decisions live in [the plan](../docs/plans/simplification.md#r--proposed-second-pass-ponytail-reduction). Reconsider an abstraction only for a concrete caller need or actual variation. |
| Retain old build chunks while workspaces may use them. | `vite.config.ts` sets `emptyOutDir: false` because open clients can request earlier lazy chunks. Cleanup needs a separate lifecycle and recovery design. |
| Boot and continue under mandatory lean invariants (2026-11-15). | [BOOT](BOOT.md) requires checkout/owner/write-scope/resource/verification preflight; [rules](protocols/rules.md) retain Cordis, one authority per fact, earned abstractions and retained owners. The user requests shrinkable UI with merged contextual bars and drawers. Existing source checks enforce a subset; Markdown alone cannot guarantee agent compliance. Reconsider a constraint only through an explicit source-backed architecture/policy change. |

The smaller reference hosts are `../devLAB-backuops/OK_CLEAN_AGAIN/` and
`../devLAB-backuops/protocols-devlab-reusable-bundles--2026-11-08_13-50-37/DevTest2/`.
Their local host source was identical at inspection. The 290-line host count
excludes roughly 22,000 lines of packaged source; it is not total complexity.
The scan covered mounted project locations, not unmounted partitions.

## Operation and preservation

- Per-project bootstrap context added 2026-11-16: all 18 current project roots
  have `AGENTS.md` and `.agents/DEVLAB.md`; 19 missing files were created and all
  17 pre-existing instruction files retained identical hashes. The introduction
  explains DevLab, project boundaries, bootstrap and preservation rules without
  claiming an installed executor. `project-local/src/template.ts` owns shared
  creation/Open Folder provisioning; existing instructions are never replaced.
  `terminal-pty/src/index.ts` adds an instruction-only startup notice; default cwd
  remains the project root and explicit confined subfolders remain supported.
  Source/tests are verified; the live backend was not restarted, so new automatic
  provisioning and the notice take effect after restart. [Evidence](../docs/plans/herdr-wisdohm-memory.md#per-project-bootstrap-context--2026-11-16).

- Project catalog restoration/grouping, 2026-11-16: 14 previous-edition folders
  were reopened through the existing `/api/projects/open` service; the refactored
  catalog now has 18 entries. These are shared source folders at their original
  paths, with new catalog identities; old canvas documents and terminal records
  were not migrated. `plugins/ui-projects/src/view.tsx` owns collapsible CURRENT /
  POOL and custom groups, drag move/reorder and native keyboard move selectors.
  Presentation lives in browser-local `devlab:project-groups:v1`; catalog entries
  persist in `.data/project-roots.json`. Moving a row never selects its project.
  [Implementation evidence](../docs/plans/herdr-wisdohm-memory.md#project-catalog-restoration-and-groups--2026-11-16).

- Use [README](../README.md) and `package.json` for commands. This workspace uses
  backend 4322 and frontend 4323; the server fallback is 4322. Source: `runtime/server.ts`, `devlab.preview.json`.
- App/backend restart preservation verified 2026-11-16: terminal-pty's existing
  independent tmux owner retains shell PID, environment, cwd and jobs; persisted
  records reconnect the same project/node owner. `src/main.ts` now bookmarks the
  selected project, canvas mode and output surface in each tab URL; the existing
  terminal preferences retain selected panes and split sizes. No second owner or
  state store was added. [Restart evidence](../docs/plans/herdr-wisdohm-memory/surface-stability.md#terminal-restart-preservation--2026-11-16)
  covers disposable backend restarts and browser reload, not machine reboot/logout.
  History remains bounded (tmux capture: 2,000 lines; replay ring: default 1 MiB).
  Uncertain input is never replayed automatically. Sources:
  `plugins/terminal-pty/src/persistence.ts`, `plugins/terminal-pty/src/index.ts`,
  `plugins/ui-terminal/src/input.ts`, `plugins/ui-shell/src/terminals.tsx`.
- Linux top-bar activation changed 2026-11-15: `~/.local/state/devlab/desktop/config.json`
  selects this checkout and the separate `~/.local/state/devlab/refactored/profile`.
  Existing desktop shell is reused; the drawer explicitly selects the new window and
  protects the original. Local user services `devlab-refactored.service` and
  `devlab-refactored-ui.service` are enabled. On 2026-11-16 the manual backend was
  gracefully stopped and the backend user service started: all eight plugins ready,
  11 terminals retained the same PID/start identity/ownership, 18 projects retained,
  and two previews restored at their original URLs. Original backend and frontend
  identities were unchanged; no browser reload or terminal input was sent. The
  updated default project scan passed with 1,363 entries. [Restart evidence](../docs/plans/herdr-wisdohm-memory/server-restart/verification.json).
  Later login startup exposed a cycle: the backend unit's `After=default.target`
  blocked both refactored services and timed out the drawer. Removed that one
  ordering directive on 2026-11-16; both services became ready and repeated drawer
  show reused one visible window. Source: `~/.config/systemd/user/devlab-refactored.service`;
  [recovery evidence and limits](../docs/plans/herdr-wisdohm-memory.md#d0-startup-cycle-recovery--2026-11-16).
- Selected `.agents/ownership/*/*.yaml` files own capability boundaries.
  `.context/modules/registry.yaml` is a compatibility projection and is still
  passed to terminal policy code. Run `npm run ownership:sync` after editing canonical
  definitions; `npm run check` rejects projection drift. The existing trusted reader
  generates it atomically. Default-host policy still hashes compatibility file bytes;
  canonical-reader policy hashes normalized segments, so switching parsers is deferred.
  Existing running/saved scopes remain unchanged; new policies use the new revision.
  Sources: `.agents/data/definitions.py`, `plugins/terminal-pty/src/index.ts` (2026-11-15).
- Historical databases, recovery and live state remain in `../_devLAB/`. They were
  not cloned into this edition. [Copy provenance](../docs/refactor-provenance.json)
  records omissions and original-source fingerprints; this edition owns fresh `.data/`.
- Preserve `.data/`, `.recovery/`, `vendor/`, prototypes, drafts and live processes.
  Detached source remains in `../devLAB-planning-runtime-standalone/`.
  Do not edit installed package copies or run the removed planner/wisdom CLI.

## Refactored responsibilities and verification limits

- [Terminal HTTP handling](../plugins/transport-http/src/terminals.ts) owns dispatch,
  replay and stream cleanup. Transport retains origin checks, shared project admission,
  body bounds, error mapping and disposal. Kernel/process ownership is unchanged.
- [Workspace controls](../plugins/ui-shell/src/controls.tsx) render shortcuts, diagnostics and icons;
  the shell retains state, keyboard handling, mounts and resource owners.
- Compact terminal presentation updated 2026-11-15: [terminals.tsx](../plugins/ui-shell/src/terminals.tsx)
  merges dock workspace actions into the first selected pane's 28px header. Its
  disclosure stores only per-project `controlsCollapsed` presentation state; pane
  keys, shell owners, effective policies and renderer placement stay unchanged.
  Empty selection retains New terminal. [U1 evidence](../docs/plans/herdr-wisdohm-memory.md#u1-implementation-evidence--2026-11-15)
  records the backup, measured layout gain, retained behavior and verification limits.
- Preview controls compacted 2026-11-16: `plugins/ui-preview/src/pane.tsx`
  replaces the Server disclosure's duplicate Start/Stop rows with a direct
  per-project Start ↔ Stop button and a small Server options chevron. Existing
  shared server commands retain cancellation/stale-response fencing. Pane toolbar
  is 28px and Group/Panes is 24px; tested Server/View/Inspect/Tools drawers are 33px, with
  inline close, keyboard/Escape focus return and retained iframe/draft/terminal
  identity. Full Tools explanation remains in its title/accessibility text.
  `preview.css` owns sizing; no new dependency or product file.
  [U2 evidence](../docs/plans/herdr-wisdohm-memory.md#u2-preview-controls--2026-11-16)
  records scoped checks and limits. Broader U2/S7 work remains open.
- Fullscreen/dock recovery fixed 2026-11-16: pane fullscreen delegates through
  neutral `PreviewViewOptions.fullscreen` to the shell's existing root owner,
  keeping the original bottom Terminal/Servers rail and dock inside fullscreen.
  Editing surfaces hide while their output slot stays mounted; visible dock input
  remains active. Both fullscreen owners bound requests/exits to four seconds,
  settle from actual browser state and protect late/foreign ownership. Duplicate
  pane requests no longer produce the pending warning. The retained iframe and
  terminal PIDs survived actual native fullscreen and dock switching in the
  disposable browser. Drawer focus return now respects a later user focus intent.
  Sources: preview `fullscreen.ts`, `layout.tsx`, `pane.tsx`; shell
  `workspace-focus.ts`, `view.tsx`; `packages/ui-contracts/src/index.ts`.
  [Evidence and limits](../docs/plans/herdr-wisdohm-memory/fullscreen-dock/verification.json).
- First surface stability fixes, 2026-11-16: project navigation now rejects stale
  save/completion results and initializes the URL project before the first render.
  Explicit surface choices cancel pending project switches. The project owner
  remembers output selection; Build keeps visited project views/snapshots so
  ordinary project/surface changes retain viewport and editor text selection.
  CanvasWorkspace owns dimension-aware arrangement with one Undo; connected
  grouping remains planned. Sources: project workspace, runtime, shell, Build and
  canvas workspace implementations. [Milestone S](../docs/plans/herdr-wisdohm-memory/surface-stability.md)
  records tests, backup, remaining work and the need to save drafts/reload once to
  adopt changed owners. No live backend restart was performed. Canvas terminal
  resize/text controls, graph/editor reload recovery and Herdr remain unfinished; exact live
  Codex warning/blink cause is still unverified.
- Hood separates dialog navigation, plugin inspection, pure graph projection/layout
  and anatomy presentation. [Architecture generation](../scripts/architecture.ts)
  derives layer membership from ownership YAML. Seven overview blocks expand into
  owners and files; Dagre positions dependency graphs inside layers. Installed kernel
  and unassigned source are explicitly separated from locally owned source.
- Build canvas projects host analysis onto its own file tree. Dependency groups
  whose host-only parents are omitted become project roots; retained child links
  and import edges stay intact. [Project workspace](../plugins/ui-projects/src/workspace.ts)
  enforces this without mutating the host snapshot. Observed 2026-11-15: the previous
  projection rejected the new ownership layers with `Missing registry parent`.
- Build canvas and Pop the Hood share the minimap sizing correction in
  [host styles](../src/style.css), keeping the full SVG and pointer area visible.
  `scripts/hood-minimap-browser.mjs` checks both views with disposable server state,
  including graph loading, drag/wheel navigation and Build/Workflow draft retention.
- The 2026-11-15 reduction fixes QA1's draft collision, unreadable initial Build
  framing, unavailable Browser creation, clipped primary navigation and folder pattern.
  Build starts with directory blocks and focuses the project once at readable scale;
  later zoom/pan remains user-controlled. Its public Hood toolbar slot uses React Flow
  APIs without changing the packaged renderer. Sources: [Build](../plugins/ui-projects/src/build.tsx),
  [project commands](../plugins/ui-projects/src/workspace.ts), [browser checks](../scripts/hood-minimap-browser.mjs).
  Detailed results and remaining limits are in [R evidence](../docs/plans/simplification.md#r--implementation-evidence).
- `npm run check` regenerates the artifact and runs types plus structural and runtime
  checks, including backend selection, registry forwarding and `_LAB` exclusions.
  [Boundary guards](../scripts/boundaries.test.ts) cover editable source, literal
  dynamic imports, re-exports, declared owner cycles, private imports and browser
  reachability into local server code. Installed third-party runtime internals and
  computed loader behavior are outside this static guard; builds/behavior checks
  provide additional evidence. This is not a security certification.
- Boundary checks use the data-only ownership reader; the maintenance test reads reviewed guidance
  pins. It no longer calls the disconnected planner reader.
- Read-only rules inspection still reports the pre-existing legacy authority as
  invalid because old runtime loaders were removed. The original reports this too;
  the copy additionally reports missing operational SQLite. Do not fabricate records
  or reconnect an executor to make those labels green. Current Markdown memory and
  canonical ownership definitions remain the engineering entry points.
- Historical ownership paths can be absent. Generated compatibility follows
  canonical `rules-ui` and omits three already removed paths. The 27 original
  owner IDs and remaining original-file grants are preserved. On 2026-11-16,
  standalone browsing added four scoped owners (Browser, Agentic, automation
  contracts and desktop composition) and new verification paths, for 31 owners;
  existing terminal policies were not changed. Source: `.agents/ownership/`.
- Memory direction updated 2026-11-15: use the separate implemented
  `../_ai-engineering/memory/memory-node` as the integration candidate. Its small
  Python interface owns governed SQLite/FTS5 storage, scope-bound tools, review,
  erasure and context. Source: its README, API, architecture and current tests.
  NEWMEMORY remains research/proposed design; WISDOHM-3 still describes a different
  legacy memory integration. Their earlier reproduced failures are historical evidence,
  not automatic findings against the new Memory Node. No new memory or WISDOHM runtime
  is connected to DevLab. The [integration plan](../docs/plans/herdr-wisdohm-memory.md)
  owns compatibility, host-bound project authorization and UI acceptance.
- Herdr local runtime implemented and exercised 2026-11-16: the dedicated
  [Cordis adapter](../plugins/herdr-runtime/README.md) pins Herdr 0.9.3/protocol 22
  and owns one contained server per project, private state/sockets and a retained
  real TUI through the existing terminal service. Bubblewrap confines processes,
  files/environment and network; `/workspace` is the only project mount and
  networking is offline. This shares the host kernel. General desktop sessions
  are never adopted. Exact text/Enter/Interrupt, pane controls, agent status and
  event-driven snapshot recovery are available; WISDOHM editing remains separate.
  User approved installing `/usr/local/libexec/devlab-herdr-bwrap` and its dedicated
  AppArmor profile. The global namespace restriction remains enabled. Real tests
  prove boundary refusal, cleanup and backend/SIGKILL recovery to the same server;
  1440/820/390 browser checks use the actual TUI. Main-backend activation is pending
  because its five active preview owners must be deliberately restarted/restored.
  [Evidence and limits](../docs/plans/herdr-wisdohm-memory.md#herdr-local-runtime-implementation--2026-11-16).
- Agentic browsing implementation authorized and exercised 2026-11-16:
  [`apps/automation-desktop`](../apps/automation-desktop/README.md) launches a
  separate native Electron host using the same installed Cordis kernel, with
  Browser and Agentic feature factories. Splits get private persistent Chromium
  partitions, durable session/profile IDs and host-bound Memory Node namespaces.
  Agentic runs in an owned Node child over authenticated private IPC; Memory Node
  owns all SQL through its public Python API. No new dependency, kernel, memory
  engine, paid provider or original-checkout change was introduced.
  The current provider performs fake read-only inspection only; personal
  remember/update/recall/context/forget, stale-version refusal and erasure/retry
  behavior are exercised. Interrupted runs require explicit new execution.
  [`plugins/browser`](../plugins/browser/src/index.mjs) uses Electron debugger CDP
  and Puppeteer's real frame/session topology; observed-ref dispatch/OOPIFs were
  verified on fixtures. It is a limited spike, not the full Nanobrowser layer.
  [The browsing plan](../docs/plans/herdr-wisdohm-memory/agentic-browser.md) owns
  acceptance, exact tests and limitations. DevLab's eight-plugin live profile,
  terminals, editor and previews remain disconnected from these features and were
  not restarted. Packaging needs dependency approval; real-provider execution,
  review/history/compaction UI, native DevLab embedding and durable action recovery
  remain unfinished. Parent M0–M2 consume this same Agentic memory adapter.
- No measured speedup or bundle-size reduction is claimed. Keep the cohesive rules
  reader until a concrete maintenance benefit justifies another extraction.
- The live backend at 4322 and user tabs were preserved during this pass. New assets
  and inspection evidence are built on disk; its cached Hood snapshot reflects startup
  until a safe restart. Save drafts before reloading to adopt changed browser owners.
