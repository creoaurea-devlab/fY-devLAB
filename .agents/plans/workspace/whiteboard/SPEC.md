# Whiteboard — human planning on a retained canvas

Requested 2026-11-04 in voice: add this to the user's plan. Add Whiteboard beside Workflow, Build canvas and Terminals. Keep the Obsidian-like surface minimal: add readable notes and simple diagram nodes, connect them, group them and hide/show content on the same board. This request ends at a populated plan; implementation is pending. The preceding request for visible agents and parallel owner-scoped execution is recorded as a separate specification item.

## Existing source and references

- `plugins/ui-canvas/src/view.tsx` uses React Flow, but its fixed catalog contains agent/browser/terminal nodes. Unknown types preserve their data and show an unsupported renderer. Do not turn planning cards into executable workflow nodes.
- `plugins/ui-shell/src/view.tsx` owns the existing Workflow / Build canvas / Terminals controls and retains major surfaces. `src/runtime.ts` and `src/main.ts` retain domain owners through accepted HMR; `src/contributions.ts` is refreshable catalog data.
- `packages/client/client.ts` exposes rooted project read/write. `packages/contracts/src/projects.ts` supplies expected-hash writes. `plugins/project-local/src/index.ts` already admits `.json` text files; `.canvas` writes are not currently admitted. No new file-service endpoint is needed for the initial native board document.
- Existing dependencies include `@xyflow/react` and `@dagrejs/dagre`. Reuse them for this canvas and one explicit layout command, preserving the existing canvas implementation.
- Saved Obsidian workspace metadata and Canvas structures were inspected read-only as references; live Obsidian UI was not inspected. Its CLI is disabled. Local `json-canvas` skill describes text/file/link/group nodes and labeled edges. Use the minimal interaction vocabulary; native JSON Canvas import/export and live vault synchronization are deferred. Never modify the user's vault.

## Observable behavior

One Whiteboard per selected project initially. The main view chooser adds Whiteboard, with a single compact Add menu (Note, Shape, Group), connect, group/ungroup, hide/show, layout, undo/redo and save controls. Notes hold explanations, planning text or specification excerpts. Nodes can be created, moved, resized, edited, selected and deleted; edges connect valid nodes and may have labels/arrows. Explicit selection and group commands provide a keyboard alternative to drag-only editing.

Groups initially have one level: group selected non-group nodes; move members together; ungroup without deleting members. Individual nodes and groups can be hidden and restored from a discoverable list; hidden content is retained in the document. Edges to hidden members are hidden in the view and restored with their nodes. Deletion is separate from hiding; undo restores nodes and their connections together. No nested group hierarchy is required initially.

Manual placement is authoritative. The Layout command uses existing Dagre for visible diagram nodes; it does not automatically rearrange the board on typing, hidden-state changes or HMR. Preserve group membership and dimensions; layout is one undoable edit. Pan/zoom, selection and predictable fit behavior keep large boards navigable.

Editing updates the diagram immediately. Ctrl/Cmd+S and Save persist through the current project file API. A visible dirty/saving/error state distinguishes live edits from durable saved data; do not claim unsaved edits survive crashes. Leaving the Whiteboard section retains its owner, current draft, selection and viewport. Switching project selects that project's board, with separate cached owners; never save one project's board into another. Browser unload guards cover all dirty/saving owners, including hidden boards. Compatibility with browser reload/crash means restoring the last successfully saved document.

## Connected contracts

`packages/ui-contracts/src/index.ts` owns browser-neutral `WhiteboardDocument`, node/edge DTOs, `WhiteboardWorkspaceState`, `WhiteboardWorkspace` and optional `UIPluginProps` hooks. No implementation imports enter the neutral package. Define these contracts before parallel implementations.

The document has `schemaVersion: 1`, a title, stable node IDs and edge IDs, node type (`note`, `shape`, `group`), finite position and dimensions, text/label/color, optional group membership, hidden flags and viewport. Reject unknown versions, duplicate IDs, dangling edges, invalid/missing groups, nested groups, nonfinite geometry and oversized content. Bound the UTF-8 serialized document to the existing 131072-byte project write limit. Malformed input retains the current last-valid board and never silently overwrites the source. Raw HTML/script execution is excluded.

The WhiteboardWorkspace exposes subscribe/snapshot, validated edit commands, undo/redo, save, reload and dispose, plus dirty/saving state. `createWhiteboardWorkspace(projectId, projects)` is exported by `@devlab/ui-whiteboard`; it loads `whiteboard.json` at the selected project root. Save uses its last-read SHA as expectedHash, or null for a confirmed missing file. Distinguish a genuinely missing file from permission/network errors. Conflict retains the draft and presents deliberate reload/retry; late read/save responses are fenced by project/operation identity. If a newer edit arrives during save, acknowledge the saved revision without clearing the newer draft's dirty flag.

Register the plugin with stable ID `ui-whiteboard` and existing `panel` slot, avoiding changes to the packaged UI-host slot enum. The root composition selects it by ID. `src/runtime.ts` owns a lazy map of WhiteboardWorkspace instances by project; `getWhiteboard(projectId)` is stable and all created owners are disposed once. The root Shell accepts an optional provider and injects the current project's owner into the plugin. `UIPluginProps` supplies optional `whiteboardWorkspace` and `renderWhiteboard` hooks. The workspace shell owns view selection and retained mounting only; business editing and persistence remain in the plugin. Avoid changing ProjectWorkspace's flow/build mode semantics just to add this presentation.

## Failure, accessibility and retention acceptance

- A1: Whiteboard is reachable beside existing views; other workflow, project, preview, editor and terminal behaviors continue to work. Missing plugin/capability gives an actionable unavailable state.
- A2: Create/edit/move/resize notes/shapes, connect and label edges, group/ungroup, hide/show and delete/undo work. Hidden groups/edges restore intact; deletion never masquerades as hiding.
- A3: Save and reopen restore the last saved board, positions, groups, hidden flags and viewport for the exact project. Unsaved boards survive view switches and compatible HMR. Project switches and late responses cannot retarget data.
- A4: Invalid/version-mismatched/oversized documents, missing capabilities, read failures and write conflicts preserve current data and report actionable errors. Save acknowledgements cannot discard newer edits. Clear/delete require explicit action and meaningful undo/data-loss protection.
- A5: Keyboard creation, selection, edit, group/hide/show, undo, save and focus return work without intercepting typing in notes or terminals. Controls have accessible names and visible focus; collapsed content is not keyboard-traversable.
- A6: An actual compatible TSX/CSS refresh retains the Whiteboard document/draft, board owner and external editor/preview/PTY identities. Disposal closes listeners and timers once. Owner implementation changes remain deliberate reload boundaries.
- A7: Local ownership and source wiring validate; browser/server dependencies stay separate and acyclic. No new kernel, backend source watcher, provider connection, unrestricted generated code or Obsidian vault mutation.

## Verification policy and rollout

Use focused document and workspace tests for commands, group/hide/undo invariants, bounds, CAS conflicts, response ordering and disposal. A disposable real-browser probe verifies keyboard interaction, save/reopen, view/project switches and compatible refresh retention. Future commands in task files are planned checks, not evidence already executed. Run integration types/build/architecture after combining the source; fix or report unrelated baseline failures separately. Existing HMR launch activation remains a distinct pending operation; the Whiteboard plan does not authorize losing drafts or relabel historical tests as fresh evidence.

## Active-agent follow-up

The user also requested orchestration across bounded tasks/slices and a visible active-agents view. First assess existing Harness activity/queue APIs, runtime sessions/claims and UI. Populate an independent specification that distinguishes an actually executing agent from reported Running, Review or imported history. Show task/slice, owner, execution identity, phase, waiting reason and freshness where observable; unknown remains unknown. Reuse current task IDs when overlapping existing Harness/Process work, preserve active handoffs, and settle exact disjoint writes before parallel dispatch. This planning item does not start agents or promise parallel execution support already exists.
