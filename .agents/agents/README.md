# Agent roles

Each role folder contains one `agent.yaml` and its instructions. A task's workflow selects that role; its routed ownership segment supplies domain skills. Workers combine those instructions with the canonical task and its exact scope.

The trusted installed resolver loads the selected role, workflow and ownership data with confined project-relative paths and source hashes. Inspect them with `python3 .agents/runtime/definitions.py resolve --root . --task TASK_ID`. Selected-project Python is never imported during inspection.

Roles describe responsibilities. Exact claims and the current step contract control writes; a role name grants no additional paths. See [ownership](../ownership/README.md) and [workflows](../workflows/README.md).
