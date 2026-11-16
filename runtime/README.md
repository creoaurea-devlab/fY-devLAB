# DevLab runtime

All backend runtime composition, runtime-specific plugins, upstream hosting and
registry adaptation live in this folder. The installed DevLab Cordis kernel owns
DevLab plugin lifecycle. An owned child runs the unchanged DeepSeek Cordis kernel;
the two exchange discovery data through the registry adapter, not service objects.

```text
runtime/
  launch.ts                 single supervisor for both hosts
  server.ts                 DevLab boot/shutdown and persisted startup selection
  index.ts                  DevLab capability composition
  plugins.json              default DevLab plugin switches
  registry-router.ts        main registry adapter, optional upstream federation
  plugins/
    control.ts              DevLab selection, diagnostics, settings rewind
    workspace-search.ts     bounded search through admitted projects
  deepseek/
    host.ts                 loopback control API and native host lifetime
    adapter.ts              isolated worker, native selection/rewind/probes
    worker.ts               unchanged upstream Cordis loader and plugin instances
    catalogue.ts            pinned package/platform/provenance metadata
    registry-router.ts      native inventory → neutral registry contract
    install.ts              isolated pinned dependency installation/source builds
    panel.html              native package controls
    README.md               native operation and limits
```

Shared browser-safe DTOs stay in `packages/contracts`, HTTP/client/UI callers in
their existing packages. Existing product plugins and the installed kernel keep
their public seams. `_LAB` is reference source excluded from Build/Hood discovery,
Vite and TypeScript; it is never loaded as a DevLab plugin.

## Integrated source

The user authorized source promotion on 2026-11-16 after a fresh verified backup.
This runtime combines RT1 controls/search and RT2 native Harness. The merge record
selects one disjoint task per destination; earlier overlapping editions remain
provenance. Source integration does not restart an existing host or discard drafts.

From this checkout with dependencies and built UI:

```sh
node runtime/launch.ts --port 4345 --harness-port 4344 \
  --data /absolute/path/to/isolated-state \
  --source /absolute/path/to/_LAB/deepseek-harness \
  --release /absolute/path/to/installed-deepseek-release
```

`npm run start:runtime -- ...` calls the same entry. Defaults: DevLab 4322,
Harness 4340, data in `.data`. The launcher does not install dependencies. It waits
for native readiness before connecting the DevLab registry, refuses occupied
ports and owns only the children it started. Shutdown closes DevLab first, then
Harness. A startup failure closes previously started children. An unexpectedly
exited child stops the combined session. `--without-harness` starts DevLab alone
and clears inherited upstream federation. Save drafts before closing a session.

For independent hosts, `DEVLAB_DEEPSEEK_ORIGIN=http://127.0.0.1:4340 npm start`
connects only the registry. The externally started host keeps its own owner.
`DEVLAB_DATA_DIR` selects DevLab state; it does not change project source roots.

## Switches and rewind

DevLab has eleven selectable factories: its current nine (including Herdr) plus `runtime-control`
and `workspace-search`. `plugins.json` is the default; the control API persists
validated overrides in `<data>/runtime-plugins.json`. Hood → Plugins exposes
selection, diagnostics and search. DevLab switches apply at next startup, with
missing-dependency refusal and revision checks. Runtime management protects its
own control and HTTP providers from being disabled through that API.

Native Harness controls at its own origin apply per-package selection live in
its owned context. They use separate revision checks and settings rewind. Test
runs create disposable workers and leave live selection unchanged. Package count
is not active plugin count; libraries, bundles, private packages and unsupported
platforms have distinct outcomes. A native dependency removed at runtime may
leave its consumers pending, as reported by upstream Cordis.

Each settings Rewind restores only its immediately previous saved selection.
Source backup/restore is separate; see the RT3 merge backup and recovery checkpoint in the
project simplification plan. Neither operation restarts the user's other hosts.

## Registry path and verification

`deepseek/registry-router.ts` projects package inventory and live entries into
public registry descriptions. `registry-router.ts` wraps the existing
`registry-map` provider and forwards them to DevLab's main architecture service.
The graph uses `deepseek:` IDs and plugin instances use `deepseek/` IDs. An
unreachable upstream preserves the host snapshot with an explicit stale status.
Source and execution authority remain with their owners. Browser clients never
import native runtime code.

```sh
npm run build
npm run check
DEVLAB_DEEPSEEK_SOURCE=/absolute/upstream \
DEVLAB_DEEPSEEK_RELEASE=/absolute/release npm run check:runtime
```

The native lane refuses missing paths rather than silently skipping. It covers
real activation, on/off, settings persistence/rewind, invalid input, isolated
probes, federation, both-host startup/shutdown and occupied-port cleanup.
