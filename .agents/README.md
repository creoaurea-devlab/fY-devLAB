# DevLab workspace

Retained capabilities: projects, editor, canvas, terminals, previews and read-only rules inspection. Planning, agent execution and Whiteboard are disconnected. Preserved source: `../devLAB-planning-runtime-standalone/` relative to the repository root.

Use [common rules](protocols/rules.md). For a change, read its single [ownership segment](ownership/README.md) and relevant guidance; do not load unrelated capability rules. Source history is data, not current execution authority.

Current context lives in [MEMORY.md](MEMORY.md); work order and status live in the
[simplification plan](../docs/plans/simplification.md). Follow the
[update rules](protocols/updates.md) when either changes. Source owns behavior,
ownership YAML owns file boundaries, and these documents summarize those facts.
Historical task catalogs and SQLite reports remain preserved separately.

New integration scope lives in the [Herdr / WISDOHM 3 / Memory Node plan](../docs/plans/herdr-wisdohm-memory.md).
Mandatory boot preflight and lean invariants apply before changes and after context restoration.

`npm run check` checks types and disconnection. `npm run build` builds the workspace; `npm start` starts its server. Run focused behavioral checks for the change as well. No Git initialization or deployment is authorized by the extraction.
