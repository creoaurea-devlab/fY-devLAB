# Worker delegation and handoff

An orchestrator may launch workers only within user/host authorization. Task JSON identifies domain agent, task effect, one module/plugin, exact file claims, checks, dependencies and acceptance. A parent contract bounds each child's write subset; unknown ownership and cross-module workers are refused. Split the task instead of broadening a worker.

Use one shared external session directory for cooperating agents. The orchestration runtime atomically checks file claims; run its scope guard before each tool mutation. Overlapping paths, escaping/symlink paths, unrelated modules and missing parent grants are errors. A session is cooperative coordination, not an operating-system sandbox.

Workers mutate only their declared module files and host-owned operation record. They return structured memory deltas and a closing ASCII banner. They do not concurrently edit global progress/goals/changelog/feature/UI/decision/handoff registries. The orchestrator validates child receipts and serially reconciles those shared updates.

A parent cannot finish with pending, failed, stale, ungranted or unreconciled children. Abort releases a claim through an explicit operation; never delete another worker's claim to take ownership. Keep user changes and live sessions intact.
