# Execution Protocol

Use the smallest loop that proves the requested outcome.

## Plan

- Confirm acceptance criteria and existing repository conventions.
- Prefer small, reversible change sets. Apply the Ponytail ladder: reuse existing
  code, standard library, platform behavior, and installed dependencies before
  adding the minimum implementation; preserve necessary validation.
- For features, create or locate the matching spec.
- Delegate only independent work with disjoint write sets.

## Build

- Stay inside the preflight write contract.
- Follow existing project patterns discovered from code and populated flow docs.
- Do not perform adjacent cleanup unless requested.
- Register new module boundaries in the same change set.

## Verify

- Run configured commands from `config/project.yaml` when applicable.
- Start with focused checks, then broaden in proportion to risk.
- Report command, exit status, and meaningful result.
- After the configured `settings.json` → `self_healing.max_attempts` failed repair cycles,
  stop and report evidence. Use `protocols/self-healing.md` for recovery routing.

## Document

Apply `updates.md`. Update only artifacts whose underlying facts changed.
Keep summaries concise enough for the next agent to load cheaply.


Canonical minimalism/correctness policy: [rules.md](rules.md). Implementation requires the indexed goal/milestone/slice/atomic-task plan. Domain owner and task effect are separate; start/continue/close banners report both. Follow task-specific reads rather than loading all playbooks.
