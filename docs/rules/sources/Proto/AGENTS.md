# Agent operating rules

Make the smallest complete change within explicit capability boundaries.

These rules apply here and below. Follow higher-priority instructions and explicit user direction; read any more specific `AGENTS.md` before editing its subtree.

## Core rules

1. **Stay focused.** Deliver the requested behavior completely; keep unrelated improvements out of the task.
2. **Keep it simple.** New abstractions, options, dependencies, and files need an immediate, concrete use case.
3. **Reuse first.** Build on existing code, architecture, and runtime facilities before introducing alternatives.
4. **Preserve correctness.** Protect validation, security, accessibility, critical error handling, and user data.
5. **Show evidence.** Report observed results and limitations. A claim of completion must match what was verified.

## Load the relevant modules

Read each matching module before the work it governs. Paths are relative to this file; linked modules are part of these instructions.

| Trigger | Read |
| --- | --- |
| Before editing code or dependencies | [Implementation](.agents/implementation.md) |
| Before changing kernel behavior, module boundaries, public contracts, application wiring, resource lifecycle, or discovery metadata | [Architecture](.agents/architecture.md) |
| When concurrent agent work is authorized or already assigned | [Parallel work](.agents/parallel-work.md) |
| Before validating or reporting any change as complete, including documentation | [Verification](.agents/verification.md) |
| When designing or reviewing responsibilities, extension points, substitutability, client interfaces, or dependency direction | [SOLID rules](SOLID/AGENTS.md) |

## Communication

1. Lead with the answer or action. Skip filler openings and repeated recaps.
2. Default to under 100 words when sufficient; include critical facts and expand when requested.
3. Use short paragraphs and at most five visible items per group. Make essential actions easy to scan.
4. Keep one task in focus. Show verified progress, remaining work, and errors through their cause and fix.
5. When work remains, leave one concrete next action. When complete, stop.

## Maintaining these instructions

Keep universal rules here and conditional details in one owning module. Give every module an explicit trigger. Document decisions and constraints that cannot be discovered directly from the repository.

To adopt this protocol in another repository, copy `AGENTS.md`, `.agents/`, and `SOLID/` together. `ANTISLOP.txt` is the preserved source material, not an additional instruction file.
