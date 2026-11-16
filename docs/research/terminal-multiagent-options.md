# Terminal integration for parallel agents

Researched 2026-10-31. Status: recommendation for review, not an adopted implementation decision. Three delegated investigations covered local code, terminal alternatives and agent control. Primary documentation and source were reviewed; no terminal, agent, dependency installation, benchmark, application restart or Git operation was performed.

## Recommendation

For this DevTest edition, retain the existing **xterm.js renderer + node-pty capability + SSE/POST transport**. Use **tmux as an independently owned persistence backend when agent terminals must survive DevTest backend restarts**. DevTest should own the visible tabs/panes and project/task presentation. Avoid making a second terminal workspace UI the app's layout authority.

This is a recommendation based on compatibility and documented capabilities, not a claim that this stack wins a measured speed contest. The most useful first step, after separate authorization, would be to validate and wire the existing capability, then measure parallel-session behavior. No such implementation has begun.

The terminal layer also needs a separate, structured agent-control capability for reliable parent/child status, approvals, cancellation and results. Interactive terminal sessions and managed SDK/protocol runs are distinct modes. A pane is not itself an agent or proof of an agent's state.

## The choices occupy different layers

| Layer | Responsibility | Best starting point here |
| --- | --- | --- |
| Browser renderer | ANSI/VT interpretation, text, selection, keyboard and drawing | Existing xterm.js UI; evaluate optional WebGL2 with fallback |
| Process/PTY capability | Start interactive processes, input/output, resize, exit and cleanup | Existing server-owned terminal-pty plugin using node-pty |
| Session persistence | Detach/reattach independently of a view or app backend | tmux when that lifetime guarantee is required |
| Agent control | Task/session identity, child relationships, approvals, cancellation, results | Provider-supported structured APIs, behind server-owned contracts |

node-pty exposes terminal process operations; it does not supply durable app identity or agent semantics. tmux provides detach/reattach while its server remains alive, and has a documented programmatic control mode. [node-pty API](https://github.com/microsoft/node-pty/blob/main/typings/node-pty.d.ts), [tmux overview](https://github.com/tmux/tmux/wiki), [tmux control mode](https://github.com/tmux/tmux/wiki/Control-Mode).

## Comparison

| Option | Embedding and multiagent fit | Assessment for DevTest |
| --- | --- | --- |
| xterm.js + node-pty | Browser renderer plus real PTYs; application supplies session ownership and transport. Both MIT. | Best incremental foundation because these implementations and public contracts already exist locally. |
| tmux | Linux session multiplexer with detach/reattach, CLI and asynchronous control mode; ISC-style license. | Best persistence addition when needed. Keep it behind the terminal capability, with DevTest owning layout. |
| cmux TUI / Linux browser | Current Linux offerings, CLI, typed SDKs, terminal render streams and agent-oriented workspace features. | Serious alternative, but adoption introduces another resource/workspace model and current integration contracts need release validation. |
| Ghostty / ghostty-web | Native embeddable library and a separate browser WASM-based library. | Worth a renderer comparison if measurements expose a real limitation; not evidence of an automatic browser performance upgrade. |
| Zellij | Rich terminal workspace, programmatic actions and an authenticated built-in web client. | Attractive if adopting its workspace experience. More overlap with DevTest's existing project/pane ownership. |

Sources: [xterm.js](https://github.com/xtermjs/xterm.js), [node-pty](https://github.com/microsoft/node-pty), [tmux license](https://github.com/tmux/tmux/blob/master/COPYING), [cmux TUI](https://cmux.com/docs/tui), [Ghostty](https://github.com/ghostty-org/ghostty), [ghostty-web](https://github.com/coder/ghostty-web), [Zellij web client](https://zellij.dev/documentation/web-client.html).

WezTerm is a capable native GPU terminal/multiplexer with Unix and SSH mux domains, but is not a ready React renderer. ttyd and WeTTY are useful browser terminal gateways; adopting them here would add a second served terminal/transport lifecycle beside existing public ports. These are alternatives for a standalone companion or externally hosted terminal, rather than the default integrated path. [WezTerm](https://wezterm.org/multiplexing.html), [ttyd](https://github.com/tsl0922/ttyd), [WeTTY](https://github.com/butlerx/wetty).

## What is already in this app

Here `D` means DevTest; `F` means the sibling `DevLab-Full` reference checkout. Referenced terminal implementation source matches the preserved original kernel checkout. Installed terminal UI/contracts/transport source matches those references.

| Area | Verified local facts | Evidence |
| --- | --- | --- |
| Availability | D deliberately sets `client.terminals` to undefined and omits the backend grant/plugin/HTTP selection. There is no additional Electron-only gate in the inspected terminal UI. | `D/src/main.ts:17`, `D/src/profile.ts:16`, `D/node_modules/@devlab/ui-shell/source/src/terminals.tsx:307` |
| UI | Existing xterm 6.0.0 and FitAddon 0.11.0, 2,000-line scrollback, input/resize, exit status, reconnect feedback, project tabs/history and canvas terminal nodes. This is an installed snapshot, not a claim about latest upstream versions. | `D/node_modules/@devlab/ui-terminal/package.json:37`, `F/plugins/ui-terminal/src/view.tsx:47`, `F/plugins/ui-shell/src/terminals.tsx:94` |
| Backend | Real node-pty implementation; create/list/inspect/read/subscribe/write/resize/close; one running session per project/node; eight active sessions by default, configurable up to32; default1MiB bounded replay. | `F/packages/contracts/src/terminal.ts:4`, `F/plugins/terminal-pty/src/index.ts:75`, `:173`, `:273` |
| Transport/lifetime | POST commands plus SSE output, cursors/reset, heartbeats, observer limits, HTTP-drain handling. Unmount disconnects the observer without stopping the PTY; explicit stop/host disposal handles process cleanup. | `F/apps/web/src/client.ts:218`, `F/plugins/transport-http/src/index.ts:212`, `F/plugins/ui-terminal/src/view.tsx:279`, `F/plugins/terminal-pty/src/index.ts:131` |

This is more than removing a frontend mask. The vendored terminal plugin depends on node-pty1.1.0, but node-pty is not installed in D and the archive contains no native binary. Compatibility/install/build behavior with this host's Node24.18.0 remains unverified. Existing tests explicitly expect terminal unavailability and would need intentional revision with any future integration: `D/scripts/host.test.ts:64`, `D/scripts/ui-copy-browser.py:297`.

Existing sessions/replay are memory-only. A browser reconnect can recover a session while the backend lives; a backend restart cannot currently restore ownership/history. Terminal runtime IDs are deliberately stripped from serialized graphs (`F/packages/contracts/src/workspace.ts:99`). The API has no agent-launch/resume/task/approval contract. Create currently selects bash/sh and cwd/geometry, not an arbitrary initial agent command.

HTTP drainage and bounded replay already exist. No end-to-end PTY pause/credit or xterm-consumption acknowledgment was found in this path. Concurrent observers can write, while resize ownership is a UI convention rather than a server-enforced lease. Full-screen application replay, high-output parallel smoothness, crash recovery and detached-descendant cleanup need acceptance checks; these are not observed failures.

## Current cmux findings

cmux is **not simply Mac-only**. Official offerings now include a Linux Chromium workspace and a cross-platform Rust TUI. Avoid confusing the current Manaflow project with older similarly named agent managers. [Linux offering](https://cmux.com/linux), [TUI documentation](https://cmux.com/docs/tui).

Current source documents single-terminal attachment without surrounding chrome, plus a browser-safe ESM SDK using injected transport and styled render snapshots/patches. Those streams need an appropriate renderer; they are not raw ANSI bytes fed into xterm.js. Native remote WebSockets reject browser-Origin connections, so browser-safe bindings do not alone establish direct browser access. [TUI source](https://github.com/manaflow-ai/cmux/blob/main/cmux-tui/README.md), [SDK bindings](https://github.com/manaflow-ai/cmux/blob/main/cmux-tui/spec/bindings.md), [remote transport](https://github.com/manaflow-ai/cmux/blob/main/cmux-tui/docs/remote.md).

The current v2 resource contract identifies itself as prelaunch and incompatible with earlier control APIs. Its journal document says live application of restored models and verified root ownership leases remain pending. Detach/reattach is not therefore proof of complete crash recovery. These are moving-main documents, not a tested release pin. [API status](https://github.com/manaflow-ai/cmux/blob/main/cmux-tui/spec/resource-api-v2.md), [restoration status](https://github.com/manaflow-ai/cmux/blob/main/cmux-tui/spec/session-journal.md).

The reviewed license declares GPL-3.0-or-later generally and BUSL-1.1 for named server/relay directories. Any adoption must review the exact components being distributed, rather than assuming a single permissive license. This report has not determined a distribution licensing strategy. [Current license](https://github.com/manaflow-ai/cmux/blob/main/LICENSE).

## Smoothness and Ghostty

Smoothness is a property of the full pipeline: stable mounted views, batching, bounded queues, input responsiveness, resize ownership and recovery under output load. xterm's official guide documents how fast producers can overwhelm browser processing and describes write acknowledgments/watermarks propagated back to the producer. Network drain alone does not show that the terminal has consumed its queue. Its optional WebGL2 renderer needs context-loss handling and a fallback. [Flow control](https://xtermjs.org/docs/guides/flowcontrol/), [WebGL addon](https://github.com/xtermjs/xterm.js/blob/master/addons/addon-webgl/README.md).

Native libghostty embedding is now real, while current headers/release notes still describe API instability. Coder's MIT ghostty-web is an actual browser library with a WASM parser and xterm-like API; the reviewed0.4.0 source uses Canvas2D. Native GPU performance claims therefore cannot be transferred to that browser implementation. Addon/accessibility/IME parity and multi-pane latency need direct comparison before replacing the existing renderer. [Ghostty embedding](https://github.com/ghostty-org/ghostty), [library API warning](https://github.com/ghostty-org/ghostty/blob/main/include/ghostty/vt.h), [1.4 release notes](https://ghostty.org/docs/install/release-notes/1-4-0), [ghostty-web renderer](https://github.com/coder/ghostty-web/blob/main/lib/renderer.ts).

## Multiagent ownership and lifecycle

DevTest should keep the kernel minimal: reuse terminal UI, public terminal contracts, terminal-pty, workspace resolution and HTTP transport. Provider-specific agent behavior belongs behind capability contracts, not in the shell renderer. No new agent contract or plugin has been implemented by this research.

For independent CLI agents, use explicit project/task/session identities, separate writable working directories where concurrency requires them, and per-session input/resize ownership. Git worktrees become an option only when a repository exists; this project has not been initialized in Git. Directories and tmux sessions organize work but are not security sandboxes. node-pty processes run with their parent's privileges, and existing cwd validation does not restrict everything a shell may access. [node-pty security](https://github.com/microsoft/node-pty#security).

Provider-native subagents may be logical children within a provider process; they do not necessarily receive separate PTYs or worktrees. Agent state must come from identified structured events rather than pane titles, screen scraping or `send-keys`. Keep provider credentials and process authority server-owned. Approval requests must identify their originating session and request, preserving the configured permission policy.

For richer Codex integration, the official app-server protocol exposes sessions/turns, streamed events and approval handling; SDKs suit automated runs. Claude supports structured SDK control and headless streaming output. Pin the chosen runtime and matching schemas before implementation. Do not assume managed SDK runs expose the same interactive terminal process, or that every provider offers identical subagent/approval controls. [Codex app-server](https://developers.openai.com/codex/app-server), [Codex SDK](https://developers.openai.com/codex/sdk), [Claude headless/SDK entry](https://code.claude.com/docs/en/headless), [Claude approval callbacks](https://code.claude.com/docs/en/agent-sdk/user-input).

| Event | Required distinction |
| --- | --- |
| Browser refresh/disconnect | Detach/reconnect to the surviving owner, with replay gaps made explicit |
| DevTest backend restart | Direct in-memory sessions are lost; tmux can preserve processes only if its owner survives independently and the app can reconcile stable mappings |
| OS reboot | Live PTYs/processes end; conversation/workspace resume creates a new process |
| User action | Detach, interrupt and terminate are separate operations; process exit is not sufficient proof of task success |

tmux is a persistence tool, not a complete agent scheduler or approval system. Its control mode is a real protocol that needs correct response/output decoding. A simpler future integration can attach one single-pane session per independent agent terminal while React owns layout; a complete control-mode adapter is not automatically necessary. [tmux manual](https://man.openbsd.org/tmux.1).

## Future acceptance checks — not executed

1. Native compatibility and identity: validate the pinned PTY dependency on the supported host; exercise isolated sessions, duplicate-start prevention, project binding and rejected cross-session actions. A provisional load target could be eight concurrent sessions with four visible, matching current default capacity; confirm the desired capacity first.
2. Interaction: real chosen agent TUIs, Unicode/IME/paste/control keys, rapid resize, hidden/reopened panes, context loss, keyboard accessibility and exactly one input/resize owner.
3. Output pressure: flood output with slow/disconnected readers; measure input-to-paint latency, memory and loss; prove bounded queues, end-to-end consumption control and truthful replay-gap handling. Record hardware, versions, session counts and measured percentiles before ranking renderers.
4. Recovery: browser reload, backend restart and reboot separately; verify process lifetime, discovery, full-screen redraw, retained state and no duplicate agent launches.
5. Stop/approvals: interrupt during tools and approval waits, terminate owned sessions, inspect descendants/listener cleanup and retained edits; verify no credential-bearing browser data or approvals crossing sessions.

## Decisions remaining before implementation

| Decision | Research assumption / recommendation |
| --- | --- |
| Required lifetime and scale | Browser reconnect required; independently persistent tmux agent sessions if backend-restart survival is wanted. Confirm concurrency target. |
| First agent integration | Choose provider and interactive-CLI versus structured-managed mode. Support other modes only through real capability contracts. |
| Trust/permissions | Begin with local-user project authority; choose isolation and approval policy explicitly before remote/multiuser deployment. |

## Delegation brief used

The research prompts assigned three separate roles: source auditor, terminal-stack evaluator and agent-control specialist. They specified the exact target and full reference, read-only source scopes, primary-source citations, current platform/license checks, separate terminal layers, explicit unknowns, comparison/recommendation, and no implementation/install/Git operations. Follow-up prompts challenged outdated cmux/Mac-only assumptions, required preservation of the existing transport unless evidence justified replacement, and distinguished managed agents from terminal automation. Workers returned findings to the parent; shared report/state writes are serialized here.

## Verification and limits

The local auditor ran the read-only package provenance verifier:32 original archives,71 reused sources,101 refreshed source/dist/web files and exact presentation passed. Existing terminal tests were inspected, not executed. No terminal session, agent workload or performance benchmark was run. Current-main upstream APIs may differ from packaged releases; pin/recheck before any implementation.

Parent handoff checks cover this report's local evidence paths, unchanged application/package/vendor baseline, installed Wisdom target validity, state journal parsing and refreshed context seals. Results are recorded in `.context/state/changelog.md`, `.context/state/progress.md` and `.context/state/events.jsonl`. No product capability is marked implemented by this report.
