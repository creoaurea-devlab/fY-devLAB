# devLAB deep audit — 2026-11-05

**Verdict: partially compliant.** Capability separation, neutral contracts, source-selected planning, conflict protection and meaningful integration tests are present. The app does not yet fully meet its own rules for draft preservation, ownership authority, retained resources or truthful observations. This audit found **one P1 and eight P2 defects**, each supported by a bounded reproduction or a direct comparison with the active authority. Passing tests do not cover these failures.

This is an audit of the combined current source, including the terminal/preview repair. Audit findings were not silently turned into implementation changes. Prior `handover.md` is retained as a historical observation; its old port/process facts are not treated as current.

## Scope and execution

Parent: Codex, read-only governance/architecture/delivery/complexity review. Independent reviewers: `/root/deep_backend` and `/root/deep_browser`, through the project `wisdohm-orchestrate` workflow. Canonical tasks: `DA-GOV`, `DA-BACKEND`, `DA-BROWSER`, and `DA-REPORT`. Each review has a distinct WISDOHM session. Shared planning and operational memory writes were serialized by the parent; workers had no source write scope. Existing Kanban HANDOVER claims were preserved.

Reviewed local capabilities, public DTO/client contracts, host composition, the installed frozen backend implementations, selected `.agents` runtime and planner, relevant delivery checks and browser ownership. Reviewed independent source editions and recovery archives as provenance, not deletion candidates.

Evidence archive: `/home/creoaurea/.local/state/devlab-november/deep-audit-20261105/`. Its manifest records source/evidence hashes. Findings below identify the code observed; follow-up edits require new owner-scoped tasks.

## P1 — preserve newer edits during save

**F01 · project-view · reproduced.** `plugins/ui-projects/src/workspace.ts:426` unconditionally replaces the cached draft with the older snapshot that began saving.

Trigger: edit `a.ts` to version 1, start Save with the write pending, type version 2, open `b.ts` to stash version 2, then complete the original write and reopen `a.ts`. The observed text is version 1, `dirty=false`, and `hasUnsavedDrafts=false`. Version 2 is lost. The UI permits typing and file navigation while the write is pending; the later active-editor equality guard does not protect the cached draft.

Smallest correction: reconcile the save acknowledgement with the current draft identity/version. Preserve newer text and its dirty state while advancing the expected disk hash. Cover both staying in the file and switching files/projects during save.

Evidence: `browser/editor-save-race.log`, `probes/devlab-browser-audit-repro.ts`, plus the parent's independent rerun `parent/editor-save-race.txt`. The retention assertion **fails as expected**, exit 1; this is defect evidence, not a passing test.

Rule: `.agents/guides/CODE.md` 6–7, validation/state retention and data-loss protections.

## Ownership and observation defects

**F02 · P2 · terminal-service / backend-host · reproduced.** `plugins/terminal-pty/src/index.ts:178` skips the trusted canonical definitions reader when `registryPath` is configured for `default`. `src/profile.ts:31` supplies the legacy `.context/modules/registry.yaml` path. A valid selected-files fixture returned `current-owner` through the trusted reader, while the terminal catalogue returned only `retired-owner` from the legacy registry. Guided/Strict policy consumes this catalogue, so canonical revocation can leave obsolete grants available. The catalogue mismatch was reproduced without launching a shell; an actual forbidden write was not attempted.

Correction: route the configured default project through the selected authority too. Keep any supported legacy fallback behind the same explicit authority selection; fail closed on invalid selected definitions. Test disagreement between valid canonical and legacy inputs.

Evidence: `backend/reproductions.json` → `terminalAuthority`, `probes/devlab-deep-backend-authority-repro.ts`.

**F03 · P2 · source-maps · reproduced by authority comparison.** `scripts/architecture.ts:39` still builds Hood ownership and dependency/public-surface metadata from the legacy registry. The selected canonical `preview-view` declares `project-view`, and canonical `project-view` exposes `adoption.tsx`; the Hood input declares neither. A successful build therefore publishes stale ownership facts under its “Generated compatibility view” label.

Correction: consume the installed selected ownership reader, derive discovery metadata from it, and retain source provenance for each group/edge. Do not create another hand-maintained registry or rewrite immutable editions.

Evidence: `parent/ownership-difference.json`, `source-hashes.json`; compare `.agents/ownership/browser/{preview-view,project-view}.yaml` with `.context/modules/registry.yaml`.

**F04 · P2 · workspace-shell · reproduced.** `plugins/ui-shell/src/traffic.tsx:61` waits for all sources before scheduling the next poll at line 62. A pending claims request prevents subsequent healthy Harness and planner refreshes. Freshness at line 83 is calculated only on render. After advancing the browser clock to 21 seconds, all source counters stayed at two and the board still said “Harness: current”, “Planner: current” and “Live run confirmed”, with no stale warning.

Correction: bound source requests with existing cancellation facilities, allow healthy sources to refresh independently, and update freshness as time passes. Exercise pending requests and expiry, as well as explicit error recovery. This reproduction uses mocked service boundaries in real Chrome; it does not establish an actual live backend outage or grant any lock authority.

Evidence: `browser/traffic-hung-source.log`, `probes/browser-app/traffic-probe.mjs`.

Rule: one authority per fact and generated discovery (`CODE.md` 4); actionable failures and truthful evidence (`CODE.md` 6, protocols/rules 9).

## Resource and filesystem defects

**F05 · P2 · terminal-service · reproduced.** `plugins/terminal-pty/src/index.ts:279` restores only `(await persistence.load()).slice(-64)` although creation is uncapped. One preserved running tmux shell followed by 64 newer exited histories produced 65 saved records, 64 restored records, a still-living shell, and `TERMINAL_NOT_FOUND` for that active shell. It disappears from inspection/close and project deletion guards. The existing uncapped test uses nonpersistent mode and misses restart behavior.

Correction: retain every live owner; if exited history needs a bound, apply it separately from active sessions and expose any truncation explicitly. Test more than 64 histories across restart with an older live shell.

Evidence: `backend/reproductions.json` → `terminalRestore`, `probes/devlab-deep-backend-terminal-repro.ts`. Owned fixture PID 426261 was stopped and its `/proc` entry independently verified absent. No user shell was touched.

**F06 · P2 · project-service · reproduced.** `plugins/project-local/src/fork.ts:58` excludes certain filenames/extensions but traverses `secrets/` directories. A real disposable development fork copied both `secrets/credentials.json` and `nested/secrets/token.txt`, contrary to the physical-copy contract at line 52 and configured `**/secrets/**` protection. This duplicates protected material into runnable development trees. Only sentinel values were used; cross-user disclosure was not demonstrated.

Correction: honor declared protected paths during source copying, including nested directories, before traversal/publication. Preserve legitimate source and the existing no-link/no-operational-state rules.

Evidence: `backend/reproductions.json` → `forkSecrets`, `probes/devlab-deep-backend-fork-repro.ts`.

**F07 · P2 · installed @devlab/store-sqlite · reproduced.** `node_modules/@devlab/store-sqlite/source/src/worker.ts:17` opens the supplied path, then chmods and initializes it at lines 20–31 without rejecting a symlink/alias. A fixture `data/runs.sqlite` symlink to an unrelated database was accepted: the target gained `runs` and `events`, `user_version=1`, and permissions 0600. Its sentinel table remained. This requires a preexisting storage symlink; no remote exploit was demonstrated.

Correction: validate the physical regular-file identity before opening/migration and align locking with that identity. Deliver a versioned local replacement/promotion through the package owner; do not patch `node_modules` or overwrite the frozen archive.

Evidence: `backend/reproductions.json` → `storeSymlink`, `probes/devlab-deep-backend-store-repro.ts`; installed package and archive hashes are recorded.

Rule: retained resource ownership/cleanup, trust-boundary validation and source/data protection (`CODE.md` 6–7, project entry 3 and 6).

## Editing and verification defects

**F08 · P2 · whiteboard-ui · reproduced.** `plugins/ui-whiteboard/src/view.tsx:86` applies React Flow position changes only to local rendered nodes. The retained document is updated only by pointer `onNodeDragStop` at line 95. In real Chrome, ArrowRight moved a saved note from x=80 to x=85 while the document stayed at x=80 and `dirty=false`; changing selection reset the rendered note to x=80. Save and undo cannot retain the keyboard movement.

Correction: commit supported position changes through the existing document/edit mechanism, with an appropriate gesture undo boundary. Verify keyboard moves, pointer moves and multiple selected nodes. Multi-node drag is a secondary source-supported concern, not an independently reproduced finding here.

Evidence: `browser/whiteboard-keyboard.log`, `probes/browser-app/whiteboard-probe.mjs`; zero page errors.

**F09 · P2 · verification · reproduced.** `scripts/verify-deployment.ts:26` ignores `ENOENT` for every recorded artifact source. A private HTTP/build fixture whose artifact declares missing `src/owned.ts` passed verification with `sourceFilesChecked=0`.

Correction: distinguish any deliberately virtual archived source records from expected physical source records using existing provenance. Missing expected source must fail with the path. Add a deleted-source negative case beside the existing changed-source check. Do not merely require a nonzero count: a partially missing source set would still be accepted.

Evidence: `parent/deployment-deleted-source.json` and retained reproduction code. No live service or build was modified by the probe.

Rule: accessibility/retained state (`CODE.md` 7) and honest combined verification (`CODE.md` 9, proportional verification).

## Rules and quality assessment

| Area | Assessment | Evidence / limit |
| --- | --- | --- |
| Capability ownership and kernel size | Largely follows the rule | Host composition remains in `src/profile.ts`; product behaviors live in capability packages. Canonical direct dependency/public seam check passes. F02/F03 leave authority consumers inconsistent. |
| Neutral browser/server contracts | Follows in the reviewed seams | Client/public DTOs are separate from filesystem/subprocess implementations. Package verification, TypeScript and import ownership checks pass; this is not proof against every possible dynamic import. |
| Planning, staff, sessions and gates | Present and usable | Selected file definitions, distinct roles/owners, scoped sessions/claims and assessed versus executed evidence are implemented. Advisory telemetry stays unknown. Existing Running/Review handoffs were preserved. |
| Preservation and cleanup | Does not fully follow | F01, F05 and F08 violate draft/resource retention. Disposable regression fixtures were cleaned; actual restart activation remains separately gated. |
| Source/data trust and evidence freshness | Does not fully follow | F02–F04, F06–F07 and F09 demonstrate authority, filesystem or observation gaps despite successful positive-path checks. |

Current code is modular enough to repair these in existing capabilities. The principal problem is incomplete state/authority invariants and missed negative cases, not a need for another orchestration framework. No rewrite is justified by this audit.

## Complexity-only pass

`delete:` Remove the obsolete manual-setup guidance adapter in `src/preview-client.ts` and its import/override in `src/main.ts`; use the existing `api.servers` value. The preview capability now owns setup. Reconcile owner/discovery references in the follow-up; preserve historical snapshots. Whole-tree symbol/string search found one live function consumer; the similarly named HMR cache in `server-state.ts` is a separate variable. This is a cleanup candidate, not a claim that the whole preview service is dead.

`net: -17 source lines, -0 dependencies possible.`

No broad framework/dependency deletion was justified. Frozen package editions, forwarding compatibility and recovery archives have explicit preservation requirements and were not counted as removable bloat.

## Checks actually executed

| Check | Result | What it establishes |
| --- | --- | --- |
| `DEVLAB_BUILD_DIR=/tmp/devlab-terminal-preview-repair/build npm run check` | PASS: 164 Node tests; Python suites 17 + 11 + 18 + 10 = 56 tests | Standard package, contracts, host, planning, rules and governance regressions on the current private build. Python emitted ResourceWarnings; they did not fail checks and are not a claim of no resource leaks. |
| `tsc --noEmit` | PASS | Combined types, including the corrected canonical ownership verification reader. |
| Private Vite build + `scripts/architecture.ts` | PASS; 16 backend manifests, 760 source records | Build/composition compatibility. F03 shows that success alone does not establish current ownership semantics. |
| Harness connection/service tests | PASS; 43 cases | Additional embedded tests outside the root `scripts/*.test.ts` glob. No live Codex login/model turn. |
| Project/client/Whiteboard focused tests | PASS; 10 cases | Reviewer command retained in evidence. Some overlap standard checks; counts are not summed into a misleading unique total. |
| Terminal + Wisdom repair tests | PASS; 29 cases | Off ownership behavior, fail-closed assigned modes, safe preview-only setup and preservation. Overlaps standard suite. |
| `scripts/terminal-preview-browser.py` with `/usr/bin/python3` | PASS at 1440 and 820 | Terminal fit/errors/Retry, preview prepare/apply/start, project fencing, retained identities, unchanged foreign rules/memory and six fixture terminal process cleanups; zero JavaScript errors. |

The first broad run used the stale default `dist` and found the maintenance gate still consuming the legacy registry. The gate was corrected under `TP-CANONICAL-CHECK`; all standard checks above then passed against the current private artifact. Those earlier failures are retained as diagnosis, not hidden or presented as current failures.

Adverse audit probes deliberately demonstrate failures in scenarios absent from passing tests. Full test success is therefore consistent with the findings.

## Delivery state and limits

Terminal layout and preview-only preparation repairs are implemented and verified in disposable real-host/browser integration. The new build and original user service files are archived at `/home/creoaurea/.local/state/devlab-november/terminal-preview-20261105/`; no unrelated source or retained claim was replaced.

**Backend activation is pending** the additional saved-state checkpoint for the already-running Kanban preview at `http://127.0.0.1:33082/`. The user already confirmed Creative Agent Studio at `http://127.0.0.1:27707/` is saved/closed. A fresh inventory found the second preview, so that answer cannot be assumed to cover it. Both will restart when the backend restarts. The staged activation preserves the frontend PID and existing tmux owners, then restores both previews. This audit does not claim those live activation checks have run.

No new whole-app acceptance run was performed for every capability. UI audit failures used targeted real Chrome components and explicit service mocks; backend failures used disposable kernels/filesystems. Live model execution, suspend/resume, power-loss recovery, adversarial native sandbox and filesystem race testing remain untested. Reviewed-without-a-new-demonstrated-finding areas are recorded in the reviewer assessments; they are not certified defect-free.

No Git repository exists in this checkout. The report/evidence are saved; no Git initialization or Git commit has occurred. The project explicitly preserves source editions and does not infer Git initialization from migration work.

## Follow-up order

1. Fix F01 with save-in-flight draft retention tests before relying on the editor for unsaved work.
2. Repair F02/F03 from one selected ownership reader; verify default Guided/Strict revocation and Hood agreement together.
3. Repair retained terminal/Whiteboard behavior (F05/F08), protected fork/storage boundaries (F06/F07), then TRAFFIC freshness and deployment negative checks (F04/F09). Use distinct owner scopes; keep the frozen source archive immutable.

This ordering is a recommendation, not new source-write authorization or a fabricated completed plan.
