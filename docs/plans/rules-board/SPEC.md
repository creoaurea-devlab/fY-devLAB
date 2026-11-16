# Rules Board and WISDOHM 2.6 edition
User-authorized independent copy; preserve original live DevTest and WISDOHM source. No Git operations.

## Observable outcome
Rules inspection from existing workspace toolbar, source-backed read-only rules, search/filter, explicit missing/drifted sources, populated-memory counts and recorded checks with result and freshness separated. Keep workspace/editor/terminal owners mounted. Native modal keyboard behavior. Never claim perfect code, universal SOLID compliance or signed evidence.

## Connected contracts
RulesService.snapshot(projectId) -> RulesSnapshot; GET /api/rules?projectId=ID. Neutral Zod contracts in packages/contracts/src/rules.ts. rules-local owns trusted bounded filesystem and read-only SQLite observation; ui-rules owns display. Parent composes services, client, transport, UI slots and canonical registries. Partial 2.6 never silently falls back to legacy.

## Milestone and slices
RULES-M1: verified independent edition. RULES-S1: Rules Board/contracts/backend/UI/integration. RULES-S2: full backup, supported 2.6 deployment, local-rule routing, historical migration, current administrative population and verified final backup.

## Acceptance
A1: sources and reviewed pins visible, missing/changed data explicit; no mutation from inspection. A2: honest check freshness, historical imports remain historical. A3: modal keyboard/filter/error/scope/retention interactions verified. A4: one operational memory authority (.wisdohm SQLite) and unchanged product planning JSON. A5: full archived source/data/dependencies restored and verified, originals preserved.

## Administrative scope
User explicitly waived protocol pauses. No actual context telemetry is available: do not fabricate usage or claim guarded DONE. Preserve normal guards and mark migration/bootstrap IMPORTED. Record actual checks and limits separately. Parent serializes shared context; workers have disjoint capability files.
