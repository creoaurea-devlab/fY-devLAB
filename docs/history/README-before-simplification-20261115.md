> Current state (2026-11-09): planning and agent execution are disconnected. Extracted source and recovery archive: `../devLAB-planning-runtime-standalone/`. DevLab retains projects, editor, canvas, terminal, preview and rules inspection. Run `npm run check` and `npm run build`. Older planning/runtime descriptions below are historical and do not describe an active service.

# DevTest — WISDOHM2.6 and Prototyping

An independent local software-factory foundation with fourteen backend capabilities, public contracts, retained workspace/preview/editor/terminal owners, Planning and source-backed ownership inspection. The original DevTest and the WISDOHM release remain unchanged. No Git operations were performed.

## Run

Requires Linux x64, Node24.18.x, Python3 with PyYAML, GCC and dpkg-deb. Existing terminal setup checks pinned native dependencies and confinement support.

```sh
export TMPDIR=/dev/shm
npm ci
npm run build
PORT=4312 npm start
```

The November service uses **http://127.0.0.1:4312/** for its backend and built UI. Its managed Vite frontend uses **http://127.0.0.1:4313/**, as declared in `devlab.preview.json`. Port 4311 belongs to a separate workspace. Run commands from this checkout; build/test scratch can use `TMPDIR=/dev/shm` and `DEVLAB_BUILD_DIR` without changing source authority.

For UI development, start the backend above, then run `npm run prototype` (or choose **UI preview → Server → Start**). This uses the existing project-server owner to start Vite against the verified physical workspace. Open `http://127.0.0.1:4313/` for the full workspace; the prototype command prints the isolated element URL. A desktop development launcher must open the Vite origin too. The backend must be restarted deliberately once after changing its allowed frontend origin; a frontend attachment never restarts it automatically.

Compatible CSS/TSX changes retain the existing root, workspace drafts, preview and terminal sessions. Owner/client implementation changes require a deliberate browser reload; backend source changes require a controlled backend restart. Save/checkpoint first: retained in-memory drafts are not crash recovery. See the [source investigation](docs/plans/audit-remediation-20261103/UI-HOT-RELOAD-RESEARCH.md) for persistence boundaries and historical provenance.

## Prototyping

In UI preview choose **Server → Start**, then **View → Kanban A/B/C**. **Inspect → Prototyping** opens real Source/Style/Design guide and copies a source-bound UI-agent brief. Saved CSS/compatible TSX changes refresh the isolated element while the main workspace and terminals stay mounted. Existing viewport, split/focus/fullscreen controls remain compact. Or run `npm run prototype` against the running4311app. See [the operating guide](docs/protocols/prototyping.md). The layout comparisons are read-only and dev-only; user design verdict is pending.

## Rules, ownership and governance

Open **Rules Board** next to Pop the Hood. Search/filter selected-project guidance, inspect reviewed source pins, memory population and separate command result/freshness. Refresh reads only; commands are copied for deliberate execution. The native modal preserves drafts, previews and terminal identities. Kernel view offers the same board through a panel opener.

`.context/modules/registry.yaml` is the sole source ownership/dependency/public-seam authority. The copied2.6 runtime reads that registry directly on ownership checks; project.yaml ownership remains empty. Terminal Off/Guided/Strict policies retain their established semantics. Pop the Hood derives actual source/runtime wiring and ownership groups.

Active agent entry: `AGENTS.md` → `.wisdohm/BOOT.md`. Use the local runtime so mandatory pinned maintenance/SOLID inputs and canonical ownership remain active:

```sh
npm run wisdom -- db status
npm run wisdom -- db memory
```

SQLite `.wisdohm/memory.sqlite` owns operational sessions/facts/history. Product planning remains `.context/state/tasks.json` and `progress.json`, edited through `node scripts/planner.ts`. Legacy operational files and checkpoints are historical import/rollback sources. Source/config still own implementation/policy facts.

The supported deployment, deliberate local adaptations and explicit administrative population are documented in `docs/rules/WISDOHM-MIGRATION.md` and `docs/rules/WISDOHM-ADAPTATIONS.json`. Bootstrap records are IMPORTED under the user's waiver; real context/verification/review guards remain mandatory for normal authoring. No automatic per-edit memory watcher or native telemetry integration is claimed.

## Verification and recovery

New Project and Open Folder initialize WISDOHM and populate initial project facts. Existing empty stock installations can be completed through **Project preparation → Initialize WISDOHM**. For standalone use, run `npm run wisdom:setup -- --target /absolute/project` to review, then apply the returned proposal SHA. See the [project setup protocol](plugins/wisdom-tool/SETUP.md) for repair, CLI commands and the distinction between initial imported facts and verified agent work.

`npm run check` includes runtime/native/API checks and active2.6/legacy-governance regression tests; `npm run build` checks types and generates frontend/Hood artifacts. Browser harnesses use disposable private projects/processes. `npm run verify:deployment` checks served assets, current source and live Hood snapshot. Actual commands, results and limitations are in `docs/evidence/rules-board/delivery.json`.

Full source/data/dependency archives, SHA256 manifests and verified restore receipts are in the adjacent physical `Backups/` directory. SQLite uses online backup. This edition's original copied live-terminal metadata was parked in `.recovery/copied-live-terminal-metadata`; its fresh terminal state cannot recover original app shells. Immutable legacy migration provenance is in `.recovery/wisdohm26-import`.

Matching pins and passing checks do not prove universal rule/SOLID compliance or perfect code. Rules inspection is bounded and cooperative receipts are not signed attestations. Terminal Linux/security/scale limits remain documented in `.planning/codebase/CONCERNS.md`; no provider Agent API was added. Free system-disk capacity before a production release.

### Codex task harness MVP

Planning has visible **Run** buttons on milestone, slice and atomic task cards, plus **Connect Codex** in the confirmation/inspector. Complete the Codex-managed browser login using the displayed link, save conflicting editor drafts, then confirm one task. The inspector polls live output, supports **Stop**, and retains the result. A successful Codex turn requests **Review** through the canonical planner; it never verifies completion. Read-only previews cannot launch runs.

Use **Run** on a slice or milestone card to confirm a whole queue. The server freezes its task set and definitions and runs one eligible task at a time; completed/in-review tasks are skipped. Tasks end in Review, not Complete: dependent work waits until a human reviews prerequisites and reports them Complete in Kanban. The queue rechecks automatically. For a stopped or failed queue, **Restart queue** opens a fresh confirmation using the current plan and a new command identity; previously reviewed/completed work is skipped. Uncertain outcomes cannot blindly restart. **Stop queue** prevents pending starts and interrupts the active task; an uncertain outcome requires reconciliation. Queue progress and output appear above the board and survive page reloads. Changes to queued definitions halt dispatch rather than silently changing scope.

The host launches the installed `codex app-server` lazily over stdio. It uses existing Codex credentials, model and skill configuration. Runtime compatibility was checked against CLI 0.166.0. The MVP explicitly uses workspace-write access with permission escalation disabled; declared task paths are validated and included in instructions, but they are not an OS-level per-file sandbox. Save drafts before dispatch. No tokens are sent to the browser or stored in planning JSON.

Wiring: `ApplicationClient.harness` → validated `/api/harness/*` routes → `HarnessService` → `plugins/codex-harness`. The public contract lives in `packages/contracts/src/harness.ts`; backend factory selection is in `src/profile.ts`; the compact inspector is `plugins/ui-kanban/src/harness.tsx`. The kernel is unchanged. Set `DEVLAB_CODEX_HARNESS=0` to omit the backend factory/routes while keeping planning usable. To remove the integration, remove that factory/package dependency and the optional client/inspector wiring.

Results are stored under `.data/harness/attempts.json` (100 attempts and 100 queues maximum). A restarted or uncertain run requires manual reconciliation with its Codex thread before another run; do not blindly retry or delete history while work may be active. After checking/terminating the corresponding Codex threads, stop the host and archive its ledger before resetting it. Stop waits for Codex acknowledgement; a disconnected request is not proof work stopped. Tests use disposable protocol fixtures; a real signed-in coding run must be validated by the operator. See [Codex app-server](https://developers.openai.com/codex/app-server).
