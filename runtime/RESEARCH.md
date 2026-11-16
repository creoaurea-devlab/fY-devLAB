# Plugin runtime and DeepSeek Harness research

Inspected 2026-11-16. Upstream clone:
`_LAB/deepseek-harness`, commit `39163dd30f703a79079e2d2446545cff3c453738`,
root package version `0.2.2-rc.3`, MIT license. This report describes that revision;
it does not claim compatibility with a future release. Source inspection only:
no upstream install, build, tests, model calls or runtime execution were performed.

## The idea

DevLab becomes a host for selectable capabilities. `runtime/` is the home for
backend boot, composition and the registry router. Each plugin owns one capability,
its configuration, public interface and cleanup. A composition chooses which ones
run. Disabling one omits activation; dependent selections must remain coherent.
The installed Cordis kernel retains injection, admission, leases and disposal.

The registry router is the runtime's discovery outlet. It forwards descriptions
from domain registries into the existing main architecture registry so Build and
Pop the Hood can explain what exists, what is selected, what is running and how it
connects. The owning tool, model or service registry remains responsible for its
behavior. Aggregation must not duplicate credentials, private session contents,
permission policies or lifecycle state.

`_LAB/` is the workshop shelf: complete reference components can be studied there
without appearing as production architecture or running automatically. Promotion
is an explicit source/dependency decision, never a recursive plugin-folder scan.

## Current project evidence

| Concern | Current authority / seam | Consequence |
| --- | --- | --- |
| Backend boot and composition | `runtime/server.ts`, `runtime/index.ts`; compatible `src/` entries | One place now selects the existing eight factories. |
| Lifecycle and admission | Installed `@devlab/kernel` / Cordis; public `PluginDefinition` in `packages/contracts/src/index.ts` | Keep kernel ordering, grants, leases and cleanup. |
| Plugin metadata and runtime graph | `@devlab/registry-map` public factory; inspected `node_modules/@devlab/registry-map/source/src/index.ts` | Existing provider accepts manifest/health callbacks; route there rather than creating another global registry. |
| Architecture and ownership | `scripts/architecture.ts`, `.agents/ownership/`, generated `dist/architecture.json` | Source data remains generated, with `_LAB` excluded. |
| Browser contributions | `src/contributions.ts`, `src/workspace.ts`, installed `UIRegistry` | UI selection and retained view owners are separate from backend boot selection. |
| Project Build graph | `plugins/project-local/src/index.ts` → `plugins/ui-projects/src/workspace.ts` | Omit `_LAB` before traversal, avoiding directory budgets and imported graph nodes. |
| Browser/Agentic spike | `apps/automation-desktop`, `plugins/browser`, `plugins/agentic` | Existing independent implementation is the integration starting point; do not add a second browser/session owner. |
| Memory | `.agents/MEMORY.md`, integration plan and existing Agentic Memory Node adapter | Durable semantic memory remains with Memory Node, not a second Harness memory store. |

The installed main registry is a read-only projection with bounded schemas, not a
mutable catch-all store. Its runtime input currently contains plugin manifests and
kernel health. The new router implements that real caller; tools/models/skills
federation needs new public DTOs and consumers before implementation. Ownership
YAML and the browser contribution registry are distinct authorities, not duplicate
versions of the same plugin registry.

## What Harness contributes

The [upstream architecture](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/docs/architecture.md)
uses Cordis plugins for models, tools, sessions and agent driving. Profiles stack
bundles and configuration patches. Plugin registrations unwind with their owning
scope. Domain services expose provider/consumer seams rather than importing the
agent loop into every capability.

Inspected implementations reinforce three useful patterns:

- `packages/host/plugin-inventory/src/index.ts` reads Loader state on demand.
  DevLab's router likewise forwards current kernel health without a second cache.
- `packages/core/tools/src/index.ts` returns registration disposers, validates
  output declarations and supports scoped tool layers. A future tool registry
  needs those semantics, not just a map of callback names.
- `packages/llm/llm/src/index.ts` owns the provider adapter seam. Retry is a
  separate package; provider translation does not belong in the host profile.

Important compatibility finding: the clone's `vendor/cordis/package.json` declares
`@deepseek-ai/cordis` **4.1.0**. Harness packages also use workspace peer dependencies,
generated Typert remote contracts and their own service vocabulary. DevLab pins
`cordis` **4.0.0-rc.11-creo.bc9a344** behind its kernel adapter. Shared ancestry does
not establish binary/API compatibility. Prefer small adapted patterns behind
DevLab contracts. Direct adoption requires an explicit dependency review and a
lifecycle/transport compatibility test; do not import source from `_LAB` at runtime.

## Suggested modules and plugins

Names below are proposals, not installed services. Paths are relative to the
reviewed upstream clone. Each runtime-owned adapter would live under
`runtime/plugins/<name>/`; existing DevLab feature packages remain canonical.
Create folders only when implementation has a current caller.

| Order / proposed plugin | Upstream source to study | DevLab implementation and boundary | Required evidence |
| --- | --- | --- | --- |
| 1. Plugin inventory and configuration UI | `packages/host/plugin-inventory`, `packages/boot/plugin-manager` | Extend the existing Hood plugin panel with selected/active/failed/disabled states. Persist selection separately from live health; show restart-required. Reuse `runtime/plugins.json` and the existing kernel. | Unknown IDs refused; failed start visible; saving a switch preserves current shells and drafts. |
| 2. Scoped contribution catalogs | `packages/core/scope`, `packages/core/tools` | Add owner-bound registration and exact disposers only when the first tools/commands need it. Namespace IDs, reject same-scope duplicates, expose safe metadata through the registry router. | Disposing an owner removes exactly its entries; no sibling-project leakage or stale generation removal. |
| 3. Model adapter registry | `packages/llm/llm`, `llm-deepseek`, `llm-pi-ai`, `llm-retry` | Public provider-neutral streaming interface; explicit model capability metadata, cancellation and bounded retries. Integrate the existing Agentic provider seam first. Credential references stay server-side. | Fake stream success/error/cancel; retry budget; no credentials in registry responses; provider swap preserves consumer behavior. |
| 4. Tool registry and guarded executor | `packages/core/tools`, `packages/core/tool-executor-native` | Separate tool schemas, execution and output projection. Reuse project admission and existing process owners; keep timeout, concurrency and validation in the execution seam. Default off until an execution feature is approved. | Schema rejection, denied call has no effects, abort/timeout releases resources, deterministic safe parallelism. |
| 5. Policy adapter | `packages/sandbox/sandbox-policy`, `packages/interaction/user-approval`, `packages/fs/fs-observation-policy` | Adapt canonical DevLab ownership and effective policy to future tools. Preserve immutable running-terminal policies and existing confinement. Discovery never grants rights. | Read/write refusal, path/link escapes, cancellation during approval, unavailable enforcement fails closed. |
| 6. Session event log and persistence | `packages/core/session`, `packages/session/session-persistence`, `session-persistence-jsonl`, `session-projection` | Add replayable events to the existing Agentic session owner when real execution requires them. Keep transient stream state separate from committed events. Memory Node keeps semantic memory. | Replay, interrupted tail, version refusal, one writer, cancellation and no fabricated completion. |
| 7. MCP connector | `packages/mcp/mcp-client`, `mcp-manager`, `mcp-resources` | One managed connection per admitted server. Publish tool/resource metadata through domain catalogs and the router; credential refs outside config snapshots. | Disabled server spawns nothing; disconnect/reconnect budget; exact tool removal; shutdown cancels in-flight calls. |
| 8. Skills catalog | `packages/skill/skill`, `skill-filesystem`, `tool-skill` | Read-only discovery of explicitly admitted roots, provenance and bounded content. Integrate current `.agents` rules as data without granting execution or reviving a planner. | Oversize/link refusal, duplicate precedence, root isolation, watcher cleanup; no implicit tool rights. |
| 9. Language-service adapter | `packages/lsp/lsp`, `lsp-stdio`, `tool-lsp` | Definitions, references and hover through configured per-project servers. Reuse project roots and subprocess ownership. Expose a neutral editor/tool DTO. | Wrong-root refusal, server failure, queued cancellation, shutdown and no duplicate process owner. |
| 10. Local diagnostics / trace plugin | `packages/telemetry/otel`, `packages/session/session-telemetry`, `packages/guard/timeout-policy` | Local lifecycle/run diagnostics first; optional redacted export later. Separate export selection from plugin activation. | No network exporter by default, bounded queue, redaction and complete disposal. |
| 11. Browser tool adapter | `packages/browser-use/browser-use`, `packages/computer-use/computer-use` | Adapt the existing `plugins/browser` public seam into optional tools. Keep its profile/session partitions and observed-node validation; no second Chromium/CDP owner. | Stale references, frame/session isolation, disabled no-op activation, native host cleanup. |
| 12. External agent providers | `packages/subagent/subagent`, `subagent-codex`, `subagent-claude-code`, `subagent-acp` | Optional process/IPC adapters behind the existing bounded Agentic session contract. Real execution is a separate integration decision. | Missing auth, explicit workspace grants, interruption, process-tree cleanup, partial results and no silent resume. |
| Later. Search, jobs and workflow | `packages/session-query/session-query-sqlite`, `packages/jobs`, `packages/workflow`, `packages/goal` | Add only for a concrete history/job/workflow consumer. Search indexes are derived; goals/jobs do not replace the disconnected planner or independently own the same task. | Rebuildable index, one writer, cancellation, crash recovery and clear authority. |

Recommended first feature: an inspectable plugin inventory and restart-aware switch
UI. Then scoped catalogs and one fake model/tool adapter to prove the contract.
Only after refusal, cancellation, cleanup and replay work should a real model,
MCP process or external agent be admitted. Memory Node and the existing browser/
terminal owners should be reused throughout.

## Registry federation contract to implement with the first consumer

A future contribution needs a stable namespaced ID, kind, owning plugin ID,
project/scope, generation, schema version, public description and evidence link.
The router should accept only bounded public DTOs; duplicates in the same scope
must fail. A plugin registers via its lifecycle scope and receives an exact disposer.
No filesystem discovery should instantiate a contribution. Credentials, executable
callbacks and full private session payloads stay with their domain service.

The main registry should combine descriptions for inspection. Execution must route
back through the domain service, where admission and cancellation apply. A failed
or disabled plugin may remain visible in a future *configuration inventory* but
must never be represented as active. Current `snapshot.plugins` intentionally
contains selected plugins only, with kernel health attached by the existing map.

## Delivery boundary

Implemented now: root runtime boot/composition, boolean startup selection, HTTP service
selection, the manifest/health registry router and `_LAB` exclusions. Existing
plugin implementations and Cordis are reused. Existing `src/` entries remain small
compatibility seams. There is no new dependency or kernel replacement.

Proposed only: the modules above, live backend toggling, arbitrary domain-catalog
federation and a new plugin settings UI. No upstream code was installed or executed;
no planner, agent loop or factory was reconnected; no live backend was restarted.
Verification results and remaining limits belong to the runtime item in
[the current plan](../docs/plans/simplification.md#rt--runtime-composition-and-component-laboratory).
