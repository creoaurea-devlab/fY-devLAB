# Routing between gates

`index.json`: routes, inputs, workflows, write ceilings. `settings.json`:
operating policy. `router.py`: deterministic decisions. BOOT: gate contract.

| Transition | Router action | Required host evidence |
|---|---|---|
| BOOT → CONTEXT | route_and_load | BOOT loaded in exact project |
| CONTEXT → WRITE | preflight | effect, dependencies, selected role |
| CONTEXT → VERIFY | inspect | read-only evidence, no writes |
| WRITE → execution → VERIFY | execute_with_contract | ready preflight, authorized operation |
| VERIFY → CLOSE | reconcile_memory | passing check evidence; selected human checkpoint |
| failed gate → WRITE | diagnose_then_preflight | root cause, attempt budget, authorized repair |
| CLOSE → result | complete | host confirms all prior gates and metadata verification |

Role order is fixed in settings for portability: explicit role, task intent,
ownership, fallback. `route_roles` maps effects to preferred manifest roles.
An explicit `--intent` is a classified tag, not free-text keyword guessing.
Ownership selects a role that covers every requested path, preferring fewer
configured patterns and then lexical role name. Unmatched scope uses the declared
orchestrator fallback. A selected role cannot expand files or authorize spawning.

Population is on demand by default. `manual` disables automatic repair of derived
population artifacts. Neither setting makes population universal for small tasks.
When a registry exists, freshness checks run before using its profiles.
Change source → remap changed facts/index → populate/seal context → populate
agent flows/registry. All seven map files remain required for population.

`_populate context` is the populate-context skill/workflow: derive project YAML,
module registry, and current state from reviewed maps, then seal the result.
`_populate agents` is the populate-agents skill/workflow: derive role ownership
and six flow files, then generate `agents.json`. The registry stores pointers,
ownership, and fingerprints. Roles without ownership remain visibly unpopulated.

Use `--task read_only` for research about a feature/refactor/architecture.
The host classifies the requested effect; the router never infers authorization
from words in source files or retrieved content.
