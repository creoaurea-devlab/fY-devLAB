# fY-devLAB

A local development workspace with projects, source editing, canvas, terminals,
previews and read-only rules inspection. A small Cordis kernel manages backend
plugin lifetimes; browser contributions use retained workspace owners.

Planning, agent execution and Whiteboard were disconnected on 2026-11-09.
Their preserved source is in `../devLAB-planning-runtime-standalone/`.

This independent copy was made from `../_devLAB/` on 2026-11-15 without Git.
Original user data, terminal owners, recovery and historical databases remain there;
this edition starts with its own empty `.data/`. [Copy provenance](docs/refactor-provenance.json)
records exclusions and original source fingerprints.

Open **Pop the Hood → App anatomy** for seven stacked responsibility layers.
Open a layer for its Dagre dependency graph, then an owner for its files. Select
blocks to trace connections; the source graph and plugin registry remain available.
These diagrams describe ownership, not a process sandbox.

Terminal docks use one compact contextual header. Its arrow hides/restores workspace
controls without closing the shell; the actions menu retains ownership settings.
Shift-click terminal tabs to show panes together.

## Start and verify

Use Linux x64 and Node 24.18.x. Python 3 with PyYAML supports rules inspection;
GCC and dpkg-deb support the existing terminal setup.

For a fresh installation:

```sh
npm ci
npm run build
npm run check
PORT=4322 npm start
```

The backend and built UI use `http://127.0.0.1:4322/`. The source fallback is 4322; the original edition uses separate ports.

For UI development, attach a frontend to the running backend:

```sh
node scripts/dev-ui.mjs --backend http://127.0.0.1:4322 --port 4323
```

Open `http://127.0.0.1:4323/`. The same frontend configuration is in
[devlab.preview.json](devlab.preview.json). Attachments own their frontend only;
backend changes require a deliberate restart after saving drafts.

On this Linux workstation, the existing DevLab top-bar drawer now selects this
edition with its own desktop profile. Local user services provide ports 4322/4323;
the original window remains protected. Activation details, backup and the proposed
compact UI / Herdr / WISDOHM 3 / Memory Node work are in the
[integration plan](docs/plans/herdr-wisdohm-memory.md).

`npm run check` checks types, regenerates the architecture artifact and runs boundary, anatomy, disconnection, maintenance and runtime checks.
It does not cover all retained behavior. Select focused checks from the
[simplification plan](docs/plans/simplification.md) for the capability being changed.

## Where things belong

| Responsibility | Source |
| --- | --- |
| Backend composition, switches and registry router | [runtime/](runtime/README.md) |
| Startup and shutdown | [runtime/server.ts](runtime/server.ts) (compatible `src/` entry) |
| UI contribution catalog | [src/contributions.ts](src/contributions.ts) |
| Browser workspace lifetimes | [src/workspace.ts](src/workspace.ts) |
| Shared service and UI contracts | `packages/contracts/`, `packages/ui-contracts/` |
| Feature implementations | `plugins/` |
| Kernel and reused packages | Pinned `vendor/` archives selected by `package.json` |

Reference components live in `_LAB/`, excluded from Build/Hood discovery and build inputs.
[Runtime research](runtime/RESEARCH.md) records the reviewed DeepSeek Harness source and proposed plugins.

Edit canonical local packages or reviewed package sources, never installed
`node_modules` copies. Keep filesystem and subprocess code on the server side.

## Continuing work

- [Agent entry](AGENTS.md): scope and required context.
- [Project memory](.agents/MEMORY.md): current facts, decisions and known gaps.
- [Simplification plan](docs/plans/simplification.md): ordered work and acceptance criteria.
- [Update rules](.agents/protocols/updates.md): when and how to maintain those files.

Preserve `.data/`, historical SQLite records, `.recovery/`, prototypes, editor
drafts and live resource owners. Vite intentionally retains old build chunks so
open workspaces can still load them; `dist/` is not a safe bulk-cleanup target.

The [previous README](docs/history/README-before-simplification-20261115.md)
is preserved as history. Its removed planner/runtime commands are not current
operating instructions. The original refactor excluded Git. Public GitHub publication was separately authorized on 2026-11-16.

## License and public source

[MIT](LICENSE), copyright 2026 Creo Aurea. See [third-party notices](THIRD_PARTY_NOTICES.md).

Public source excludes private runtime data, recovery copies, workstation caches,
local project copies, historical workstation captures/raw evidence exports and staged prototype tasks. Those remain local. The optional
native Harness host requires a separately prepared installation; the normal
`npm start` command starts DevLab without that host.

Publication verification (2026-11-16): clean `npm ci`, build and 20 checks passed.
The dependency audit reports four high-severity findings involving Vite, Zod
and two pinned packages. Dependency remediation remains open. Run this local
workspace on loopback as shown above.
