# devLAB repair handover

Date: 2026-11-05. Scope: read-only research of runtime wiring, rules/evidence integrity and TRAFFIC code quality. Three independent review agents contributed. This report does not authorize a restart or a source repair. Another agent owns the active runtime repair; coordinate before changing it. Runtime observations below are a point-in-time snapshot and may change during that work.

## Start here

The live UI and backend are different editions. The current UI on **4312** proxies an old recovery backend on **4311**. That backend loads a missing Python reader from the obsolete `DEV_FOCUS/devLAB` directory, serves an obsolete project catalog and lacks the TRAFFIC endpoint. This explains the observed Rules error and at least one source of the TRAFFIC warning. Other UI sources can fail independently.

**Do not change Python interpreters as the first repair.** `/usr/bin/python3` successfully imports PyYAML **6.0.1**. The reported failure is a missing script, before Python can import its dependencies.

## Verified runtime findings

| Finding | Evidence | Consequence |
| --- | --- | --- |
| Current frontend, recovery backend | Port 4312 process: `node scripts/dev-ui.mjs --backend http://127.0.0.1:4311 --port 4312`. Port 4311 process: recovery `launch-evaluation.mjs`, supervised by `devlab-evaluation-clean.service`. | Current browser code can call APIs absent from the loaded backend. |
| Hard-coded old imports | `/home/creoaurea/Documents/DEV_FOCUS/devLAB-recovery-agent-home-complete-20261103/launch-evaluation.mjs:1` imports the old kernel; lines 2–3 select old profile/root; line 8 selects recovery `evaluation-state`. | Changing process cwd alone does not select current modules or current `.data`. |
| Missing installed reader | Both live ports return **503** for `/api/rules?projectId=default`, naming `/home/creoaurea/Documents/DEV_FOCUS/devLAB/plugins/rules-local/src/read-memory.py`. That file is absent. | Rules inspection cannot run. |
| Missing TRAFFIC API | Both live ports return **404** for `/api/rules/activity?projectId=default`. Current source implements it in `plugins/transport-http/src/rules.ts:9`. | The claims source is unavailable even though the current UI tab exists. |
| Other capability is reachable | `/api/harness/activity` returns **200**, with zero runs/batches at inspection. | Health/Harness success does not establish Rules or claims availability. |
| Wrong catalog authority | Live `/api/projects` returns **13** projects. Recovery state has two project directories and ten externally registered roots; all ten registered roots are missing under old `DEV_FOCUS/devLAB/.data/projects`. Current checkout `.data/projects` contains ten directories and no `project-roots.json`. | Folder navigation can target nonexistent roots. Counts alone do not prove which projects the user intends to retain. |
| Port/Origin disagreement | Current `devlab.preview.json:8` selects backend 4312 and line 12 frontend 4313. Running pair is backend 4311/frontend 4312. Live backend accepts Origin 4312 and rejects Origin 4313 with **403**. | Replacing one process without settling the pair can introduce Origin failures. |

Current checkout: `/home/creoaurea/Documents/DEV_FOCUS/DEV_NOVEMBER/_devLAB`.
Old `DEV_FOCUS/devLAB` is a small physical directory, not a symlink to this checkout.
The current checkout's direct installed activity reader returns `status: ready`.

## Repair order for the active owner

1. Preserve the old session, drafts, terminal/preview owners, recovery `evaluation-state`, and both catalogs. Establish which data edition the user intends to use; do not bulk merge directories or registry paths.
2. Select one coherent combination: current backend modules, Python reader beside those modules, intended project data, matching build artifact, explicit backend/frontend port pair and matching allowed Origin. `src/server.ts:5,20` derives its root from its own module; `src/profile.ts:25,30,40` controls data/catalog selection and allowed Origin.
3. Launch/reconnect through the existing supervised runtime workflow only after coordination. This research did not stop, restart, reconnect or modify any live service.
4. Verify actual APIs through the selected frontend, then real folder navigation and preserved drafts. Health 200 is insufficient. Do not hide the unavailable warning until its underlying sources succeed.

## Source defects to repair separately

| Priority | Location | Finding and minimal direction |
| --- | --- | --- |
| P1 | `plugins/ui-shell/src/traffic.tsx:61` and `packages/client/client.ts:74` | Next poll waits for all three requests, with no browser request timeout. A hung source can stop refresh for all sources. Freshness is computed on render at `traffic.tsx:83`; no independent clock means a cached run can remain labelled live. Bound requests, update freshness independently, and exercise a deliberately hung source. |
| P2 | `plugins/ui-shell/src/traffic.tsx:97` | The warning checks claims/Harness/planner errors but renders only `claims.value.reason`. Thrown request errors are hidden. Render the source name and its stored error compactly so the user can act on the actual failure. |
| P2 | `plugins/ui-shell/src/traffic.tsx:92` | Claims status prefers database `ready` over calculated freshness. A retained snapshot can say ready while old; explicit request errors alone add stale. Show storage status and observation freshness as separate facts. |
| P2 | `plugins/rules-local/src/snapshot.ts:8,23` | Reader path is resolved relative to loaded `import.meta.url`, independently from selected project root. The catch adds PyYAML advice to every subprocess failure. Distinguish missing reader asset, interpreter/dependency failure, timeout and data failure while retaining the original cause. |

The 120-line TRAFFIC module has no substantial overengineering finding. These repairs need small changes to existing facilities, not a new abstraction framework.

## Rules and execution-evidence integrity

Two concrete workflow hazards caused repeated receipt refreshes during TRAFFIC delivery:

- **Global memory-key collisions:** `.agents/runtime/store.py:325` identifies memory by `(kind,key)` and permits a terminal task's entry to be reassigned. Reusing a key such as `audit/final-refresh` in another task can replace a completed task's evidence. Events retain before/after history. Use task-prefixed keys for task-specific records; intentionally shared facts need an explicit owner/update convention.
- **Backward invalidation through shared source paths:** `session.py:205` scopes memory to read/write paths; `store.py:365` includes other records matching those paths; `planning.py:316` invalidates completion when that memory snapshot changes. A downstream UI source fact can invalidate an upstream spec that read the same UI file without source or contract changes. Investigate consumed-evidence snapshots versus later discoveries; preserve source freshness and prerequisite protections.

Verified protections in current source include file-selected authority (`.agents/plans/authority.yaml`), safe YAML parsing with duplicate-key rejection (`read-memory.py:54`), and SQLite read-only access with `query_only`, `trusted_schema=OFF`, schema/integrity checks and bounded activity output (`read-memory.py:1181`). These protections are not proof that the live recovery backend is loading the current reader.

## Verification: what passed and what it proves

Earlier TRAFFIC delivery passed TypeScript, Rules/host Node tests, a private Vite/architecture build, and disposable browser probes at 1440/820. The browser exercised keyboard activation, exact claims, stale/error recovery, project switching, retained canvas, CSS HMR and clean fixture teardown.

**Those results do not verify the current live runtime.** `scripts/traffic-browser.py:59` mocks activity/Harness responses. Host tests use a disposable current-source backend. `scripts/verify-deployment.ts:23` skips missing artifact source files on ENOENT and has no Rules endpoint smoke. The live missing Python asset and old route set therefore require a separate selected-runtime check. CSS HMR/canvas retention evidence also does not establish every editor, terminal or preview retention path.

Minimum acceptance after the runtime owner repairs attachment:

- `/api/rules?projectId=default` returns **200** and a contract-valid snapshot from the intended root.
- `/api/rules/activity?projectId=default` returns **200**, correct project ID, explicit authority status and genuine claim paths. An empty snapshot is trustworthy only when authority is ready and not partial.
- Harness and planner sources load; TRAFFIC shows actionable failures if a source fails and no stale claim snapshot is presented as fresh.
- The intended project catalog resolves to existing folders; open representative development folders and verify DEVLAB availability and navigation.
- Selected frontend Origin is allowed; switching project/tab and compatible HMR preserve existing drafts and owners.

Read-only reproduction commands (run in current checkout; endpoints reflect the observed pair):

```sh
/usr/bin/python3 -I -c 'import yaml; print(yaml.__version__)'
/usr/bin/python3 -I -B plugins/rules-local/src/read-memory.py . default activity
curl -i --max-time 10 'http://127.0.0.1:4312/api/rules?projectId=default'
curl -i --max-time 10 'http://127.0.0.1:4312/api/rules/activity?projectId=default'
curl -i --max-time 10 'http://127.0.0.1:4312/api/harness/activity'
systemctl --user cat devlab-evaluation-clean.service
ss -ltnp
```

## Changes made by this research

Only this requested report and its one-line document ownership registration in `.agents/ownership/delivery/delivery-config.yaml`, plus required session/evidence records. Review workers made no writes. Product source, live launch configuration, services, project data and planner tasks were not changed. Findings above are recommendations, not implemented repairs.
