# Read-only rules inspection

`rules-local` resolves a registered project through the existing projects service.
Its fixed, installed Python reader treats project scripts, configuration commands
and check receipts as data. It does not import project code or initialize WISDOHM
Store. SQLite opens with `mode=ro` and `query_only`; inspection never creates memory.
The trusted host reader runs with Python `-I -B` and bounded time/output. Linux
uses `/usr/bin/python3`; other hosts use `python3`. Set `DEVLAB_PYTHON` to an
absolute host interpreter path when needed. That interpreter must provide
PyYAML in isolated mode. Project environment files and interpreters are never
selected. Failures identify the interpreter and preserve the service error.

The active adapter is explicit: any `.wisdohm` directory selects the 2.6 reader,
including a partial or invalid installation. Only projects without that directory
can use the legacy `.context` 2.4 reader. After cutover, SQLite supplies operational
memory and checks; legacy files are not merged into a second current memory store.
Product planning JSON remains product data.

The board reads the active BOOT/rules/updates/maintenance/policy/journey/config,
root AGENTS and bounded local sources referenced by reviewed SHA256 pins. Legacy
`rules.sources` and current session-declared local rule files are also observed.
Source text with no reviewed expected pin is **unverified**, even when readable.
Matching text hashes do not prove compliance; unnumbered references remain guidance.

Check result and freshness are independent. Current receipts need valid integrity,
the exact physical project root, matching declared/recorded checks, and matching
bound inputs and verified outputs. A receipt covers its declared files, not every
file a command might read. Imported or relocated receipts remain historical.
Hashes detect drift; these cooperative records are not signed attestations.

Limits: 32 sources, 64 KiB displayed text per source, 128 numbered rules per source,
64 sessions, 100 check rows and 200 distinct hashed evidence paths. Files and SQLite
are size bounded; snapshots have a deadline and plugin disposal aborts its readers. Evidence details display at most 16
paths per check, with an explicit warning when shortened. Unsafe paths/symlinks,
malformed records, missing memory and truncated inspection remain visible.

`GET /api/rules?projectId=ID` is the only transport operation. Displayed commands
are copyable text; refresh only repeats this read. There is no policy editor or
command executor.

## Harness and SQLite memory graph

The additive optional `harness` snapshot contains observed health issues, SQLite
`quick_check` integrity, memory-kind counts, recorded session-stage counts and
source-observation freshness. Stages describe the inspected newest 64 sessions;
coverage gaps are explicit. Freshness examines at most 200 nonhistorical source
observations within a 16 MiB JSON budget and the existing shared 200-file/32 MiB
hashing budget. Legacy imports remain historical rather than stale current facts.
Health describes these inspected inputs, not universal engineering compliance or
the execution of agent instructions. Missing harness data remains unavailable.

Ownership/profile/skill configuration is parsed as data by this installed reader;
the selected project's runtime is never imported. Five gate instructions come from
the validated journey IDs and matching actual BOOT numbered text. They explain the
workflow and do not claim any agent passed a gate.

`harness.memoryGraph` uses the existing neutral RegistryGraph contract and portable
Hood/Dagre renderer. It groups actual database tables and memory kinds and samples
at most 32 rows per table. At most 96 additional referenced sessions can appear as
verified reference-only stubs. Arrows come only from declared `task_id` foreign keys
whose session rows actually exist. The graph carries table totals/shown counts,
an explicit truncation flag and a deterministic content snapshot ID. Inspector
metadata is bounded to 4096 characters per node; text fields are labelled excerpts.
Database nodes expose no source-viewer path, SQL interface or write action. Empty
tables remain distinct from missing, corrupt or unsupported databases. Refresh is
a new observation; the graph does not claim a live event stream.
