# Workflow: Populate Agents

Enter through the target `.context/BOOT.md` and follow its gates first.

Invocation: `/populate-agents [target-directory]`

Adapt the optional role system after codebase mapping and core context
population. Require `.wisdom/agents/manifest.yaml` and all seven map documents.

Populate `.context/config/project.yaml` role ownership and the six
`.wisdom/agents/flow/` documents from repository evidence. Keep role
playbooks universal. Validate role files, ownership globs, module alignment, and
all flow sections. Do not modify source code, mapper output, or core role files.


## Executable agent population

Require a current `.context/state/population.json` seal. After adapting ownership
and the six flow files, preview `python3 .context/router.py populate-agents`.
Declare `.wisdom/agents/agents.json` and `.context/state/events.jsonl` in a fresh
`populate_agents` preflight, then run `--apply --contract <host-contract>`.
The router writes compact role pointers/ownership and appends the phase event;
do not append a second event for registry generation. No process is spawned.
Profiles with no established ownership remain marked unpopulated. A later task
uses `route --task <effect> --path <file>` to select one profile deterministically.
