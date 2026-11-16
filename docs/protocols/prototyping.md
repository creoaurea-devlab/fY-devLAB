# Prototyping — Kanban first

Use the independent DevTest-WISDOHM-2.6 application at http://127.0.0.1:4311/.

1. In UI preview, open **Server → Start**. The existing project-server owns a Vite frontend; it attaches to this backend and never launches/restarts it. Alternatively `npm run prototype` requests the same managed server and prints the first prototype URL.
2. Open **View** and choose **Kanban A / B / C**: current columns, dense execution table, ownership swimlanes. The View menu is the single variant-selection owner. The iframe URL has `variant=A/B/C`; no extra floating navigation/header is added.
3. Use **Viewport** (fit/desktop/mobile), pane resizing and existing preview focus/fullscreen as needed. The small in-frame **Prototype state** control simulates normal/empty/loading/error in memory. Prototype data is read-only; no real planning commands run.
4. Open **Inspect → Prototyping** for Source, Style and Design guide. Existing source navigation and editor draft/conflict protections apply. Saved CSS and compatible TSX changes refresh this isolated preview; the outer factory workspace and live terminal remain mounted. Hook/owner/bootstrap/server changes may require an explicit reload after saving drafts.
5. Enter the requested UI change and **Copy UI-agent brief**. It contains the selected project/backend, configured variant URL, declared owner, saved source and guide hashes, named skill workflow and verification expectations. It copies text only; paste it into the coding agent you choose. Unsaved editor drafts are retained and excluded from those hashes.

The editor/preview retains existing compact bars and menus; new controls use24pxheight and a two-row request. Project rules are AGENTS.md → .wisdohm/BOOT.md plus docs/protocols/ui-design.md. The exact Matt Pocock prototype skill is preserved in docs/skills/prototype with hashes/provenance. Its UI branch supplies temporary comparisons; the user's compact-menu/no-Git preferences take priority over an extra switcher or branch creation.

A uses the actual read-only PlanningView. B/C are clearly marked development-only `prototype-*` files and are eliminated from production UI bundles. Opening a B/C production URL reports its unavailability. The design verdict is pending user review: no variant has been promoted into the normal planner. The reusable source/preview host has full validation and tests; throwaway layout experiments receive visual review rather than a new test framework.

Existing Continuity designs remain in tobeimplemented/CA_devLAB_Kanban_v2_Continuity as references. No demonstration progress/rules/releases were imported. Bars/sidebar and additional prototype registrations are the next slice, using the same explicit element/catalog contract.
