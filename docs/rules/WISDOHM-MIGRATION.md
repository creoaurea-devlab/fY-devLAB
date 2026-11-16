# WISDOHM 2.6 migration and administrative population

This edition uses .wisdohm/memory.sqlite for operational notes and history. Product
planning remains in .context/state/tasks.json and progress.json through its existing
writer. Historical import is not fresh execution evidence. This trusted administrator
script is never called by HTTP inspection or by the Rules Board read model.

## Order and prerequisites

Keep the independent full backup, original live app, and WISDOHM source unchanged.
The parent owns deployment and the root-loader/config merge. Do not copy the source
project's populated SQLite database. Complete the Rules Board files and deployment
before current-fact population.

Freeze legacy context before retiring its old BOOT/maps. The script's independently
callable import_bundle(root) captures .context and .planning, excluding generated Python
bytecode, under .recovery/wisdohm26-import. It stages the .wisdohm/state entrypoints the
official importer recognizes. The manifest records actual file hashes; repeated calls
verify and reuse the same read-only bundle and never refresh it from changed product
state. This is a migration snapshot, not the full source/data backup.

From the final copy, a capture-only administrative command is:

    python3 -c 'import importlib.util,pathlib; p=pathlib.Path("scripts/wisdohm26-bootstrap.py"); s=importlib.util.spec_from_file_location("bootstrap",p); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.import_bundle(pathlib.Path.cwd().resolve()))'

After the parent deploys/merges 2.6 and refreshes current project documentation:

    python3 scripts/wisdohm26-bootstrap.py --authorized-bootstrap

--root defaults to this script's project; it can explicitly name a disposable fixture.
The command refuses missing 2.6/merged loaders, missing board facts, unsafe source aliases,
bundle drift, and conflicting unfinished record owners. Missing files are errors rather
than invented capability claims.

## What is populated

Official copied-runtime migration imports real catalogue artifacts and old checkpoints
with provenance. Imported sessions remain historical HANDOVER and have no active claims,
current checks, or reusable DONE proof. Identical import is a no-op.

The public Store API then records current source-hashed observations: seven codebase
maps, edition/composition, ownership registry, active policy/journey/project config and
maintenance route, board contracts/implementation entrypoints/design, and the explicit
administrative waiver/data-authority decision. It records actual progress/changelog
notes for this administration. It does not mirror mutable product task state.

If docs/evidence/rules-board/delivery.json exists, an audit observation records its
actual contents and hash as external evidence. It never becomes a session check or
guarded completion receipt. Rerun after the parent replaces that report to preserve
the prior report in history and record its current source identity.

Bootstrap administration is IMPORTED, non-resumable, with no source claims, fabricated
context, checks, or DONE. Its output separates import results, current fact counts by
kind, evidence paths/hashes, and the reason no gated completion exists. Identical current
facts add no event. Changed facts retain the prior version in transactional history.
Source and database are not one transaction; source hashes are rechecked immediately
before persistence, and the parent coordinates writers.

## Project commands and ordinary guarded work

Use the copied runtime, including its deliberate local maintenance/ownership adapter:

    python3 .wisdohm/router.py --target . db status
    python3 .wisdohm/router.py --target . db memory
    python3 .wisdohm/router.py --target . agent start ...

The parent's npm entry is equivalent:

    npm run wisdom -- agent start ...

The SOT launcher uses its own template runtime and does not execute local adaptations.
For normal authoring, retain the real measurement/check/review/verify/finish guards.
The user authorized this bootstrap outside that journey; it does not create a general
bypass, weaken the source, or turn unknown usage into a measurement.

## Focused verification

With the deployed copied runtime:

    TMPDIR=/dev/shm PYTHONDONTWRITEBYTECODE=1 python3 scripts/wisdohm26-bootstrap.test.py

Before deployment, explicitly set WISDOHM26_RUNTIME to the reviewed release's
templates/core/.wisdohm directory. The suite uses disposable RAM fixtures and exercises
official import/idempotency, transactional rollback/history, bundle integrity, unchanged
product planning authority, and unknown-usage refusal. It never runs population against
the live app, the authoritative source, or the actual new edition during tests.

Keep a consistent database backup with the source snapshot:

    python3 .wisdohm/router.py --target . db backup --output /safe/new-backup.sqlite

Backups refuse existing outputs. Preserve the immutable import bundle and review any
source drift before updating current observations; never silently rebuild historical
imports or fabricate a successful completion receipt.



## Owner orchestration and audited sync — 2026-11-01

Every canonical module selects an agent profile in `.wisdohm/config/agents.yaml`.
Profiles reference real project-local skills. `agent route --path exact/file` resolves
owners without duplicating their paths or launching agents. The host follows the
project orchestration skill to create workers, coordinate contracts and integrate.
Current rule declarations count numbered occurrences, not unique principles or obedience.

`scripts/wisdohm26-sync.py` audits current source-linked observations and offers an
explicit administrative apply operation. Read its help before use; apply requires
task-specific user authorization. It preserves legacy imports and prior fact versions.
The 2026-11-01 hardening task has an explicit one-task exception because host telemetry
is unavailable. Its actual checks and four-group review are external administrative
evidence, recorded IMPORTED; the ordinary runtime still refuses unknown context.
The original installer manifest remains intact as installation provenance. Local
adaptations are documented in WISDOHM-ADAPTATIONS.json, not falsely stamped stock.
