# Standalone Browser + Agentic development host

Linux development slice, verified 2026-11-16. This launches a separate Electron
window with native Chromium views. It does not start or restart the DevLab server,
edit original checkouts, or reconnect the retired executor.

Browser owns panes, persistent private Chromium partitions, split layout and
deterministic control. Agentic owns independent sessions and immutable private
Memory Node workers. Both are composed through the existing Cordis-backed kernel.
The default provider is **fake read-only inspection, $0**. It cannot execute a
general task, generate images, or claim that a task was completed.

## Launch on the inspected workstation

From `_devLAB-refactored`, set the installed runtime locations:

```sh
export AUTOMATION_ELECTRON=/tmp/devlab-electron-runtime-54PiIm/electron
export AUTOMATION_PUPPETEER=/home/creoaurea/Documents/DEV_FOCUS/DEV_NOVEMBER/gogogoogle/pool/Seo.googleauto.etc/_archive/SEOTOOLS/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js
export MEMORY_NODE_ROOT=/home/creoaurea/Documents/DEV_FOCUS/DEV_NOVEMBER/_ai-engineering/memory/memory-node

pnpm exec node apps/automation-desktop/launch.mjs
```

These are explicit local runtime inputs, not built-in source paths. The Electron
executable currently lives in `/tmp`; after its removal, point the variable to an
equivalent installed runtime. Missing runtimes fail readiness. The tested pin is
Electron 44.9.3 / Chromium 152.0.7977.167 / Puppeteer 25.4.0, external Node 24.18.0,
Electron Node 24.22.0 and Python 3.13.13 with SQLite FTS5. Rerun AB0 before changing
the pin. Nothing here installs a dependency or generates a lockfile.

Default persistent data: `~/.local/share/devlab-automation/`. Use
`--data=/absolute/new/path` for a separate installation. Never select an existing
DevLab, Electron, or Memory Node data directory. Normal startup reopens this
host's panes and the same session/profile identities; it never resumes a run.
`--browser-only` selects Browser alone and needs no Memory Node configuration.
`--scale=2` selects the tested high-density presentation. `--allow-loopback`
explicitly permits localhost navigation for development fixtures; it is off by
default. No debugging port is opened; Electron uses its debugger API internally.

Type an HTTP(S) address and choose Go. The pane's ⋮ menu has Back, Forward, Reload,
Split right/down, Move, Maximize/restore and Close. Splits are independent; the
four-pane limit is explicit. Drag a split separator or use its arrow keys. Narrow
windows retain pages and offer the pane picker. Task & memory follows selection;
closing the drawer keeps the sessions alive. Stop affects that session only.

Remember stores a personal memory. Refresh recalls it; Edit uses its current
version, and Forget erases it through Memory Node. Mutations use stable request
IDs at the worker seam. Model/tool arguments cannot select grants, namespaces,
database paths or another profile. Local OS processes with the same filesystem
rights remain outside this application access boundary.

## Verify with disposable data

With the variables above set:

```sh
pnpm exec node --test --test-concurrency=1 scripts/agentic-memory-binding.test.mjs scripts/agentic-sessions.test.mjs scripts/agentic-channel.test.mjs scripts/agentic-boundaries.test.mjs scripts/agentic-browser-native.test.mjs scripts/agentic-standalone.test.mjs
pnpm run check
pnpm run build
```

The standalone test launches fresh, reopens, launches Browser-only, checks scale 2,
and rejects missing memory readiness. The native fixture exercises same-process
and out-of-process frames, observed-node mouse dispatch, stale refs, iframe
navigation, screenshot, Stop during approval and debugger detach/cleanup.
It never uses Puppeteer selectors, a WebSocket or a public CDP endpoint.

Manual disposable smoke: create a temporary directory, then run
`pnpm exec node apps/automation-desktop/launch.mjs --data=/that/disposable/directory --smoke`.
The smoke writes records and screenshots there, then exits. It requires an
explicit data root. Do not use it with personal data.

## Limits and remaining work

- This is source-based development launch, not a portable installer. It consumes
  the existing installed kernel/Cordis plus explicitly configured Electron,
  Puppeteer and Memory Node. Separate dependency/lockfile approval is pending.
- DevLab's live backend/client profile remains unchanged. Its native embedding
  adapter is not implemented; a normal web tab cannot acquire native privileges.
- Ref control is a limited feasibility implementation, not the full Nanobrowser
  layer. DOM depth, frames, targets and commands are bounded; incomplete captures
  are marked partial. Shadow DOM, broad site coverage, masking in vision, complete
  input methods and the final Ask/Auto/sensitive policy need further work.
  Every exposed fixture click is host-gated; the production inspection provider
  receives no click, script, upload, file-path or devtools tool.
- Popups, downloads and device permissions are denied. Navigation blocks literal
  private/local destinations by default. DNS rebinding, complex redirects,
  WebSockets/blob compatibility and broader remote-page hardening are not proven.
- Personal remember/update/recall/context/forget work. Shared review, history and
  compaction UI, existing DevLab Memory node UI and evaluated promotion remain
  unfinished. The core Memory Node implementation is not duplicated or modified.
- Deadlines and tool counts bound the fake provider; interrupted runs reopen as
  interrupted. The durable intent/result ledger, real-provider cost accounting,
  fairness, steer/pause, uncertainty recovery and 30-minute soak are unfinished.
- No paid model/image request has been made. Real-provider evaluation needs an
  explicit provider and spending allowance. Redistribution needs Memory Node
  licensing confirmation and complete dependency notices.

Status and detailed acceptance remain in the
[implementation plan](../../docs/plans/herdr-wisdohm-memory/agentic-browser.md).
