# UI persistence and hot reload — source investigation

Investigated 2026-11-04. Scope: locate the newest useful pre-refactor implementation, trace the current edition, and identify integration work. This is research, not activation or a completed feature. Application source, service configuration, running desktops, terminals and historical workspaces were left unchanged. The shared planner snapshot was revision 187; its archived “HOT RELOAD questions” slice contains no atomic implementation tasks, and was not reopened.

## Main finding

The old HOT RELOAD layer exists, and much of its browser design already survives in this checkout. The immediate gap is how the November desktop is launched: it displays the backend's built assets rather than a Vite development frontend. There is also a verified port/workspace mismatch in the retained preview configuration. Reusing the current Vite attachment and retained owners is the smallest integration path.

Compatible CSS/component changes can update without restarting the backend. A feature that changes a server implementation, client/resource owner, public contract or desktop main process needs its own deliberate activation boundary. Neither the old nor current implementation promises universal hot replacement of arbitrary feature code.

## Historical source and chronology

| Edition | Evidence and role |
| --- | --- |
| Original full kernel: `/home/creoaurea/Documents/_CA_DEV_OCTOBER/ca_devLAB/devlab-kernel` | Best original source for the completed layer: `docs/HOT-RELOAD.md`, `docs/plans/hot-reload/`, `scripts/dev-web.mjs`, `scripts/dev.mjs`, `apps/web/src/{main,runtime,contributions}.ts`, `packages/ui-host/`, and the browser/Node acceptance scripts. HMR delivery documents are from October 25, with later preview/layout work through October 27. |
| `/home/creoaurea/Documents/_PROTOCOLS/DevLab` | Another retained full edition. The historical researcher found matching hashes for the key HMR sources. |
| `/home/creoaurea/Documents/_PROTOCOLS/DevLab-Workspace/DevLab-Full` | The newest documented full-copy reference inspected. The [workspace provenance](</home/creoaurea/Documents/_PROTOCOLS/DevLab-Workspace/README.md:4>) records an October 31 checksum-verified copy of the original kernel, including existing Git/data state, excluding duplicate backup trees. It was not independently launched by that copy operation. |
| `/media/creoaurea/Local-Ai/DevLab-Workspace/DevTest-WISDOHM-2.6` | Later minimal-host lineage. Its `src/main.ts`, `src/runtime.ts` and `scripts/dev-ui.mjs` are byte-identical to the current checkout. This is direct evidence that the central retained-owner/Vite design survived. |

The full kernel, `_PROTOCOLS/DevLab` and `DevLab-Full` have the same old Git HEAD (`dd3f821c`, October 16); the HMR delivery is later working-tree content. Git HEAD alone cannot identify the latest HMR edition. The key HMR implementations match across all three. The Full copy's `package.json` differs only in a Wisdom verification command, not its HMR launch commands. It is a reference edition, not a reason to overwrite current files wholesale.

SHA-256 prefixes independently compared during this investigation:

| File | Original full kernel | DevLab-Full | Minimal WISDOHM edition / current |
| --- | --- | --- | --- |
| `scripts/dev.mjs` | `4fe8dbbde49bb46a` | same | absent |
| `scripts/dev-web.mjs` | `9c35edbd6ec36cb3` | same | replaced by `dev-ui.mjs` |
| `docs/HOT-RELOAD.md` | `f508704eecb22a64` | same | absent |
| `apps/web/src/main.ts` / `src/main.ts` | `bf813b14a1fd5aa5` | same | `ea44b74ca09c706d` / same |
| `apps/web/src/runtime.ts` / `src/runtime.ts` | `10151e8024342a2d` | same | `237a88b4b1b26674` / same |
| `scripts/dev-ui.mjs` | absent | absent | `2add39f6f01bb37e` / same |

## What the previous layer actually did

1. **Separate frontend and backend lifetimes.** Attached Vite owned its frontend listener/watcher; the external Node host retained PTYs, project servers and browser work. Quitting the attached frontend/desktop left the backend alive. Owned development was a distinct mode that could close its own backend resources. Backend edits rebuilt artifacts and reported `restart-required`; they did not silently restart the host. See [operation/lifetime rules](</home/creoaurea/Documents/_PROTOCOLS/DevLab-Workspace/DevLab-Full/docs/HOT-RELOAD.md:21>).
2. **Keep one root and domain runtime.** `import.meta.hot.data` retained the React root, project/editor owner, per-project canvas owners and preview owner. Refreshable contribution data was separate from these long-lived instances. Owner/client implementation changes announced `reload-required` while existing owners continued running. See [old bootstrap](</home/creoaurea/Documents/_PROTOCOLS/DevLab-Workspace/DevLab-Full/apps/web/src/main.ts:24>).
3. **Publish a validated UI catalog.** Candidate catalogs were fully checked before publication. Stable IDs, disabled-contribution retention and symbol-token disposers protected existing registrations. Failed panels could recover on a valid registry revision. See [old registry](</home/creoaurea/Documents/_PROTOCOLS/DevLab-Workspace/DevLab-Full/packages/ui-host/src/index.ts:18>) and [panel boundary](</home/creoaurea/Documents/_PROTOCOLS/DevLab-Workspace/DevLab-Full/apps/web/src/shell.tsx:16>).
4. **Keep terminal delivery independent of component effects.** A client/session-keyed queue survived view refresh, with one write in flight. An ambiguous acknowledgement blocked input instead of replaying a possible command. Detaching a renderer flushed pending input and released its observation; it did not kill the shell. See [terminal input owner](</home/creoaurea/Documents/_PROTOCOLS/DevLab-Workspace/DevLab-Full/plugins/ui-terminal/src/input.ts:16>).
5. **Fence preview messages and distinguish refresh capabilities.** Frame/origin/project/server-generation/nonce/DOM-epoch checks refused stale inspection messages. Vite projects used framework HMR; static previews required an explicit reload; unverified adapters remained unknown. Same-generation source edits were separate from dependency/descriptor changes. See [historical contract](</home/creoaurea/Documents/_PROTOCOLS/DevLab-Workspace/DevLab-Full/docs/HOT-RELOAD.md:27>) and [investigation source map](</home/creoaurea/Documents/_PROTOCOLS/DevLab-Workspace/DevLab-Full/docs/plans/hot-reload/RESEARCH.md:7>).

The old delivery also contains useful desktop behavior: close-to-hide, an independent attached frontend, explicit quit/unsaved-work handling, strict port/readiness checks, and a persistent selected browser profile. These are desktop lifecycle features, not durable draft storage.

## What already exists in the current checkout

| Capability | Current authority and significance |
| --- | --- |
| Retained root/runtime and accepted catalog | [src/main.ts](../../../src/main.ts:18) reuses `hot.data.session`; accepts contributions; rejects bad catalogs; signals owner reloads. [src/runtime.ts](../../../src/runtime.ts:8) owns project, canvas and preview instances and exact cleanup. |
| Refreshable composition | [src/contributions.ts](../../../src/contributions.ts:15) registers current capability packages separately from runtime creation. [src/shell.tsx](../../../src/shell.tsx:16) has revision-based error recovery. Installed `@devlab/ui-host/source/src/index.ts:42` validates before one catalog publication. |
| Managed attached Vite | [scripts/dev-ui.mjs](../../../scripts/dev-ui.mjs:80) owns only frontend HTTP/HMR/watcher resources, probes backend readiness with the actual frontend Origin, proxies API traffic, and closes owned sockets without closing the backend. |
| Existing preview entry | [devlab.preview.json](../../../devlab.preview.json:4) declares explicit attachment; [scripts/prototype.mjs](../../../scripts/prototype.mjs:17) requests the resource owner's managed preview and checks the selected physical workspace hash. `autoStart` is false. |
| View/resource retention | [preview layout](../../../plugins/ui-preview/src/layout.tsx:396), [preview collapse](../../../plugins/ui-preview/src/view.tsx:222), [shell drawers](../../../plugins/ui-shell/src/view.tsx:433) and [terminal panes](../../../plugins/ui-shell/src/terminals.tsx:214) retain hidden trees and stable identities. |
| Input and observer continuity | [terminal input](../../../plugins/ui-terminal/src/input.ts:16) retains queues through HMR. [terminal SSE](../../../packages/client/terminals.ts:10) multiplexes presentations with independent replay cursors. [preview observers](../../../plugins/ui-preview/src/server-state.ts:165) share owners across refresh. |
| Guarded source writes | [project editor](../../../plugins/ui-projects/src/workspace.ts:408) saves using `expectedHash`; canvas owner preserves conflicting local changes rather than silently discarding them. |
| Refresh-aware reset effects | [Kanban](../../../plugins/ui-kanban/src/view.tsx:66) compares actual project identity before clearing filters/disclosures. The [UI design protocol](../../../docs/protocols/ui-design.md:17) explicitly warns that Fast Refresh can rerun effects even when dependency values stay unchanged. |

Local `@devlab/ui-shell`, `ui-kanban` and `ui-preview` packages are symlinked to their editable plugin folders. The UI host is a packaged dependency. Changes to vendored/package sources therefore have a different integration path from ordinary plugin TSX/CSS edits.

## Verified current launch mismatch

Read-only process, socket, service-file and HTTP observations on November 4:

| Observation | Result |
| --- | --- |
| `~/.config/systemd/user/devlab-november.service` | `PORT=4312`; runs this checkout's `src/server.ts`. Backend PID observed: `3456833`. |
| November Electron target | `http://127.0.0.1:4312`; desktop wrapper still comes from the old kernel edition. |
| GET `/` on 4312 | Built HTML with no `/@vite/client`; GET `/@vite/client` returned 404. No current `scripts/dev-ui.mjs` process was observed. |
| Current descriptor | Backend is hard-coded to 4311; frontend requested port is 4312. That frontend port is already occupied by the November backend. |
| GET `/api/projects` | 4312 default workspace ID equals this root's SHA-256: `b0c05c43d85466f3151bacc1d9a8ae752e22f757baa1b6c4686bd83b6c864043`. Port 4311 returned a different workspace ID (`0fa22776…`) and belongs to the separate recovery evaluation host. |
| Origin admission | GET 4312 `/api/health` with Origin 4312 returned 200; with proposed Origin 4313 returned 403. The allowlist must be aligned deliberately before attaching another frontend. |

Consequences: editing source cannot refresh the current desktop through Vite because it is displaying built assets. Starting the retained descriptor is also wrong for this running session. The prototype helper's workspace check should refuse the mismatched backend rather than start a preview against the wrong project. That refusal follows source inspection; the mutating start operation was not attempted.

An initial configuration/activation change may require one controlled backend restart because [profile.ts](../../../src/profile.ts:25) captures the allowed frontend origin at startup. After that, compatible UI edits should leave the backend PID and sessions stable. Do not work around the mismatch by rewriting browser Origin or attaching to the other workspace.

## Persistence boundaries

| State | Compatible HMR | Full document reload / process exit |
| --- | --- | --- |
| Project editor drafts, unsaved canvas graph, undo state | Retained by existing runtime owners | Memory-only state is not a durable recovery mechanism; save/checkpoint first. |
| Component search, open cards, temporary forms | Usually retained for compatible component identity; actual scope-reset effects still matter | No general restore contract. |
| Preview grouping/layout, viewport and split preferences | Retained by owner and view state | Selected presentation preferences are stored; iframe document state is not serialized. See [workspace storage](../../../plugins/ui-preview/src/workspace.ts:142), [preferences](../../../plugins/ui-preview/src/preferences.ts:33). |
| Main prompt and theme | Retained | Prompt uses sessionStorage; theme uses localStorage. This does not cover file drafts. See [shell prompt](../../../src/shell.tsx:63). |
| Live terminal session | Backend-owned; views can reconnect | Distinguish browser reconnection from backend/process recovery. Keeping a PTY does not preserve every xterm DOM/selection detail. |
| Pending terminal input | Session-keyed queue survives compatible refresh | Uncertain acknowledgement must not replay automatically; unloading while pending is guarded. |

Changing component keys/types or removing a mounted subtree can reset state. HMR persistence and durable recovery are separate requirements. This matches [React's state identity model](https://react.dev/learn/preserving-and-resetting-state) and [Vite 6's HMR data/cleanup contract](https://v6.vite.dev/guide/api-hmr). The pinned [React plugin 4.7.0](https://github.com/vitejs/vite-plugin-react/blob/plugin-react%404.7.0/packages/plugin-react/README.md#consistent-components-exports) requires compatible exports for component refresh; incompatible export changes propagate invalidation.

## Integration recommendations

1. **Activate the surviving path first.** Choose one backend identity and a distinct frontend origin; align service launch, `devlab.preview.json`, backend admission and Electron target. Reuse `startFrontend` and the existing project-server owner. The current UI already has the central retention mechanism.
2. **Preserve the three activation cases.** CSS/compatible TSX and validated catalog changes refresh; owner/client/incompatible changes request deliberate browser reload; server implementation changes require controlled backend activation. Keep backend-source watchers from restarting PTYs automatically.
3. **Make deferred activation visible.** Current `src/main.ts:72` emits `devlab:reload-required` and logs a warning; no consumer was found in current source or the installed UI package sources searched. Treat a compact visible status and save/checkpoint action as an integration gap. Source-level detection must not claim all new code is active when old owner instances remain running.
4. **Specify durable recovery separately if wanted.** Reuse existing hash/revision conflict protections, but do not describe in-memory retained owners as crash-safe draft restoration. Any durable draft feature needs an explicit format, project identity, conflict and recovery policy.
5. **Reuse the old acceptance cases, adapted to current fixtures.** Require real CSS and compatible TSX edits; unchanged outer document, editor draft, preview document, backend PID and PTY identity; invalid catalog recovery; owner reload status; ambiguous terminal input; repeated-update listener/resource cleanup. Also verify the actual desktop frontend origin, not just an isolated preview.

Current owner routing: `delivery-config` owns package scripts/Vite/preview descriptor; `ui-development` owns the frontend launcher; `backend-host` owns `src/profile.ts` and server startup; `browser-bootstrap` owns retained root/runtime; `workspace-ui` owns contributions and root shell; individual UI plugins own their views. The desktop launcher/service is outside this checkout and needs its own explicit integration scope. These findings do not change ownership or reopen existing Running/Review tasks.

## Evidence and limits

Historical [T185 acceptance](</home/creoaurea/Documents/_PROTOCOLS/DevLab-Workspace/DevLab-Full/docs/HOT-RELOAD.md:41>) records isolated browser/Node/Electron checks, 100 accepted TSX updates with retained owners/drafts/PTY, and measured CSS/TSX latency. Those are historical workload observations, not a performance guarantee or a new run here. The old [verification harness](</home/creoaurea/Documents/_PROTOCOLS/DevLab-Workspace/DevLab-Full/scripts/verify-hot-reload.py>) and [browser harness](</home/creoaurea/Documents/_PROTOCOLS/DevLab-Workspace/DevLab-Full/scripts/browser-hot-reload.py>) are reusable test references.

Current retained [Rules UI HMR evidence](../../evidence/wisdohm-ui/hmr/acceptance.json) records unchanged search/editor/iframe/PTY across two compatible TSX changes. [Kanban evidence](../../evidence/kanban-disclosures/hmr/browser.json) records CSS/TSX refresh and retained disclosures at 1440/820 widths. These artifacts were inspected, not regenerated.

Fresh verification for this investigation: `node --test scripts/dev-ui.test.ts` passed (exit 0; five test cases). It checks attachment validation, actual Vite modules, Origin preservation, HMR/SSE/socket cleanup, port collision, cancellation and frontend SIGTERM with the external backend left alive. All 34 local report links resolved. The suite does not exercise current full-app component retention or the live desktop. No application restart, source-edit stimulus, deployment, data migration or Git mutation was performed.
