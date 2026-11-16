# TRAFFIC — agent and file ownership board

## Outcome and authority

Add a read-only **TRAFFIC** tab beside Workflow, Build canvas, Terminals and Whiteboard. An agent or operator can see the selected project's execution, held file claims, waiting work and review work before choosing another task. The existing WISDOHM claim writer remains the collision guard; this board never starts work, takes or releases a claim, moves a task, or implies that viewing a lane grants permission.

The board has one source per fact. `.agents/state/memory.sqlite` owns WISDOHM sessions and exact `claims(path, task_id=session id)`. The canonical planner owns task definitions, slices, owners and reported Running/Review. Harness `activity()` owns confirmed Codex run and queue state across projects. A reported Running task is not proof of a live agent. A claim is a reserved path until its owning session releases it, even if its last update is old. Session `updated_at` records the last governance write, **not a heartbeat**. Unknown liveness stays unknown; never clear a claim because it appears stale.

## Existing source evidence

- `plugins/codex-harness/src/service.ts` and `packages/contracts/src/harness.ts` expose `activity()` with running/reconciliation runs and running/blocked/reconciliation batches. The current Harness deliberately admits one task at a time; this view does not change that scheduler.
- `.agents/runtime/store.py` inserts exact path claims atomically, rejects overlapping path prefixes, and releases claims only at a terminal session. `.agents/runtime/session.py` writes `updated_at` on session transitions. `AGENTS-VIEW-SPEC` already records the active-agent follow-up; do not reopen completed Harness/Process tasks or overwrite Running/Review handoffs.
- `plugins/rules-local/src/read-memory.py` reads the selected project's SQLite as data through an installed trusted reader. Its existing Rules memory graph samples only 32 claims, so polling the full Rules snapshot cannot honestly serve an all-claims traffic board.
- `plugins/ui-shell/src/view.tsx` owns the existing top workspace view buttons and retained stages. `src/shell.tsx` already passes the public `ApplicationClient`; no root or kernel change is needed.

## Smallest useful behavior

Use four compact lanes: **Running** (Harness confirms a live run), **Reserved** (WISDOHM claim held, liveness unconfirmed unless linked to that run), **Waiting** (blocked/handover/reconciliation queue or session), and **Review** (planner reported Review, clearly labeled as a report). Show only evidence-backed cards and deduplicate a Harness run and its `harness-<run id>` session. Each card shows agent/session identity, task and slice when resolvable, owner, phase, last recorded update, and claimed paths behind an accessible disclosure. Show exact claimed paths and the owning session before another agent edits them. A brief header shows counts, last successful observation, source errors and any truncation. Project changes clear old project cards immediately.

The board is project-scoped for WISDOHM and planner facts. Harness activity can show another project with an explicit project label; it must not be mistaken for this project's claim state. An agent without a WISDOHM session/claim or Harness run cannot be detected by these sources, so the board states that limitation. All agents must still route, start their own session and pass the existing `agent check`/claim gate before source edits.

## Read contract and failure behavior

Extend the existing Rules service with a small `activity(projectId)` read method and a strict, bounded `AgentTrafficSnapshot` DTO. The trusted installed reader resolves the selected project through `ProjectCatalog`, reads one consistent SQLite snapshot, and returns only `projectId`, `observedAt`, source status, bounded nonterminal session summaries (`id`, canonical step ID when present, `owner`, `stage`, `updatedAt`, claimed exact paths), total counts and `truncated`. It never returns full session bodies, receipts, prompts, secrets or arbitrary project file contents; it never imports selected-project Python. A missing, unsupported or corrupt authority yields an explicit unavailable/invalid result, not an empty “no agents” claim. Bounds must expose truncation rather than silently omit owners. Keep the current Rules snapshot and write gates unchanged.

Expose this through a GET-only, project-ID-validated Rules HTTP route and parsed browser client method. The UI reads that DTO, existing `harness.activity()`, and the canonical planner workspace. If one source fails, show its last successful observation as stale with the error; do not merge stale data into a “safe to start” verdict. Refresh while the tab is visible, on return to the tab and on manual request. Fence late responses by project/request identity and dispose timers on hide/unmount. Keep editor, preview, Whiteboard and terminal trees mounted through tab switches and compatible HMR.

At 1440 and 820 CSS-pixel widths, use compact text and counts, not a dense graph or draggable cards. A visible status label accompanies color. Native buttons and disclosure controls retain keyboard focus and meaningful names; the tab does not capture typing or terminal keys. No extra dashboard framework, store, scheduler, database or provider connector is needed. Follow the Ponytail principle of reusing current facilities while retaining validation and accessibility; keep the visible working set small for the user's ADHD preference.

## Owner-scoped implementation sequence

The parent coordinator registers these canonical tasks through the shared planner, confirms active claims and serializes shared metadata. Proposed exact writes and checks are future work, not completed evidence.

| Task | Owner and exact writes | Needs | Observable result and proportional evidence |
| --- | --- | --- | --- |
| `TRAFFIC-CONTRACT` | `service-contracts`: `packages/contracts/src/rules.ts` | none | Strict DTO and optional Rules service method; `tsc --noEmit`. |
| `TRAFFIC-OWNERSHIP` | `governance-runtime`: `.agents/ownership/browser/workspace-shell.yaml`, `.agents/ownership/verification/verification.yaml` | none | Register the new `plugins/ui-shell/src/traffic.tsx` and `scripts/traffic-browser.py` paths with one owner each; route those exact paths and run architecture/ownership validation. |
| `TRAFFIC-READ` | `rules-service`: `plugins/rules-local/src/index.ts`, `plugins/rules-local/src/snapshot.ts`, `plugins/rules-local/src/read-memory.py` | `TRAFFIC-CONTRACT` | Bounded read-only sessions/claims from the selected root; focused valid, missing, corrupt, truncation and no-write fixtures in `scripts/rules.test.ts` through the verification owner. |
| `TRAFFIC-HTTP` | `http-transport`: `plugins/transport-http/src/rules.ts` | `TRAFFIC-CONTRACT`, `TRAFFIC-READ` | GET-only project-scoped route rejects duplicate/extra/path/write inputs; HTTP fixture through verification owner. |
| `TRAFFIC-CLIENT` | `browser-client`: `packages/client/client.ts` | `TRAFFIC-CONTRACT`, `TRAFFIC-HTTP` | Parse the bounded DTO through the existing client; `tsc --noEmit`. |
| `TRAFFIC-UI` | `workspace-shell`: `plugins/ui-shell/src/view.tsx`, `plugins/ui-shell/src/traffic.tsx`, `plugins/ui-shell/src/devlab.css` | `TRAFFIC-OWNERSHIP`, `TRAFFIC-CLIENT` | TRAFFIC top tab, four honest lanes, project/fetch fencing and retained sibling stages; typecheck and real browser acceptance. |
| `TRAFFIC-VERIFY` | `verification`: `scripts/rules.test.ts`, `scripts/host.test.ts`, `scripts/traffic-browser.py` | all above | Check actual claim overlap and missing/truncated authority, HTTP denial, keyboard/820 layout, source-error and view/HMR retention in disposable fixtures; then combined build/architecture. |

The parent may combine adjacent tasks only when one writer still owns every exact path and checks remain meaningful. `TRAFFIC-READ` and `TRAFFIC-HTTP` share a contract but not source writes; `TRAFFIC-UI` waits for the public client seam. Do not run `TRAFFIC-VERIFY` concurrently with implementation because it owns shared test files. Source review for this specification is assessment evidence only.
