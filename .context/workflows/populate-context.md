# Workflow: Populate Context

Enter through the target `.context/BOOT.md` and follow its gates first.

Invocation: `/populate-context [target-directory]`

Population adapts installed templates to one target repository. Mapping is a
separate prerequisite/capability.

## Procedure

1. Normalize the target. Default to the current project folder.
2. Confirm `<target>/.context/index.json` exists. Refuse to populate the
   Wisdom Context package source itself unless explicitly requested.
3. Locate `<target>/.planning/codebase/`.
   - If complete, reuse it.
   - If stale, request incremental mapping of changed paths.
   - If absent, invoke an available `map-codebase` skill/tool. If none is
     installed, execute the four passes in `.context/workflows/map-codebase.md`.
4. Read each of the seven map documents once and build a compact fact table.
5. Populate, in order:
   - `.context/config/project.yaml`
   - `.context/modules/registry.yaml`
   - `.context/state/progress.md`
   - `.context/state/roadmap.md`
6. Preserve explicit user configuration. Replace template placeholders only
   when supported by repository evidence; otherwise use `TBD` with a reason.
7. Validate paths, commands, project type, and module relationships.
8. Seal populated context and let the router append its phase event; report files.
9. When the addon exists and the full population flow is authorized, continue
   to `/populate-agents <target>` with its own preflight; otherwise report it as next.

Population must not modify application source code.


If mapping outputs must change, enter the `map_codebase` route through BOOT
Gates 2 and 3 for that phase, then return to `populate_context` with its own
preflight. Do not write mapping outputs under the population write contract.

## Routing and population seal

After reviewed mapping, use `router.py index-codebase` under `map_codebase`.
After adapting project YAML and modules, run `router.py seal-context` to preview
and then `--apply --contract <host-contract>` under `populate_context`.
Declare `.context/state/population.json` and `.context/state/events.jsonl`.
The router checks indexed map/source fingerprints and appends the phase event;
do not append a second event for this seal. Explicit settings are preserved.
If code changed after mapping, remap the affected evidence before indexing.
When ownership alone changes later, the agent registry records that separately.
