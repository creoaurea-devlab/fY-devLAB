# Task-kind workflows

Each folder's `workflow.yaml` defines one work kind's procedure, role and shared guidance. Workflow metadata owns kind discovery. It does not store task bodies, ownership paths or reported status.

The task's `verification` policy selects review, smoke, targeted or integration evidence and explains why. A workflow default is guidance for authoring that policy. Review requires an actual attributed acceptance assessment; it adds no approval gate and creates no command receipt. Other levels require the task's declared executable checks.

Inspect the resolved task with `python3 .agents/runtime/definitions.py resolve --root . --task TASK_ID`. The same resolver is used by ordinary implementation and triage. A workflow label grants no write permission; use the task's [ownership route](../ownership/README.md).
