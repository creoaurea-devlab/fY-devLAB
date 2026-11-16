# Agent runtime direction — not implemented

User selected automatic execution of ready tasks, rather than Run per task. This records the chosen mode and the researched direction; it does not launch agents or enable existing historical task rows.

DevLab should own scheduling, dependencies, task/run links, ownership leases, cancellation/recovery, policy and verification. Reuse the selected run-controller and durable run facilities at public contracts. Planning remains the definition/reported-progress authority; Terminal remains shell/PTY ownership. A Codex provider adapter is a separate capability, importing public contracts and its own internals.

First provider: installed Codex app-server over backend-owned stdio. The installed CLI is0.166.0 and reports ChatGPT login; no credentials were read/copied and no inference turn was started. Version-bind/generated schemas must come from the installed protocol, which is experimental. Use supported account/session APIs; keep authentication backend-side. Current docs support native ChatGPT login, history, approvals and streamed agent events. An existing login is not evidence of model entitlement or a working DevLab integration.

Automatic execution applies to an explicitly enabled plan. Dispatch only dependency-ready tasks with available ownership; do not auto-enroll old pending terminal tasks. Resolve exact-project BOOT/plan protocol and a fresh task snapshot before dispatch. Scheduling leases avoid concurrent writers; they are not OS file-write confinement. Working directory and actor labels confer no permissions. Establish actual confinement/policy through declared facilities before claiming strict ownership.

Bind every turn to task ID, definition/source identity and provider session ID. Stream activity into the existing run/UI projection and update canonical reported JSON through the shared writer. A completed model turn means execution ended, not verified task completion. Run actual declared checks through a trusted verifier, then enter Review; only current evidence and the selected review policy permit verified completion. Failed/interrupted runs remain explicit and recoverable.

Provide pause/cancel, concurrency/resource limits, approval requests and restart recovery. Check storage/readiness before unattended dispatch: disk exhaustion recurred during this UI task. Cache preservation in RAM is temporary recovery, not durable capacity management. No context measurements or Wisdom receipts may be guessed.

Official sources reviewed:
- https://learn.chatgpt.com/docs/app-server
- https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server

Runtime implementation, login UI and unattended scheduling remain the next separately planned code slice. This turn ships compact cards only.
