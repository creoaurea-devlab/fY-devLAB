#!/usr/bin/env python3
"""Disposable integration checks; no measurements or completion receipts are invented."""
import importlib.util
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
PROJECT = Path(__file__).resolve().parents[1]
SCRIPT = PROJECT / "scripts/wisdohm26-bootstrap.py"
spec = importlib.util.spec_from_file_location("bootstrap", SCRIPT)
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)


class BootstrapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.runtime = Path(os.environ.get("WISDOHM26_RUNTIME", PROJECT / ".wisdohm")).resolve()
        if not (cls.runtime / "store.py").is_file():
            raise unittest.SkipTest("Deploy 2.6 or set WISDOHM26_RUNTIME to its runtime template.")

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="wisdohm26-bootstrap-")
        self.addCleanup(self.cleanup)
        self.root = Path(self.temp.name) / "project"
        shutil.copytree(self.runtime, self.root / ".wisdohm",
                        ignore=shutil.ignore_patterns("*.sqlite*", ".locks", "__pycache__", "*.pyc"))
        self.write("AGENTS.md", "# Fixture\nRead .wisdohm/BOOT.md and its numbered rules.\n")
        self.write("package.json", '{"name":"bootstrap-fixture","version":"0.0.0"}\n')
        self.write("src/profile.ts", "export const fixture = true;\n")
        self.write("packages/contracts/src/rules.ts", "export type FixtureRule = string;\n")
        self.write("plugins/rules-local/src/index.ts", "export const fixtureService = true;\n")
        self.write("plugins/ui-rules/src/index.ts", "export const fixtureUI = true;\n")
        self.write("plugins/planning-local/src/store.ts",
                   "const tasks = '.context/state/tasks.json'; const progress = '.context/state/progress.json';\n")
        self.write("docs/plans/rules-board/SPEC.md",
                   "# Disposable fixture design\nUser-authorized administrative bootstrap; never a gated DONE.\n")
        self.write("scripts/wisdohm26-bootstrap.py", SCRIPT.read_text())
        guidance = "# Reviewed fixture guidance\n1. Preserve source and observed evidence.\n"
        self.write("docs/rules/sources/fixture-rules.md", guidance)
        pin = hashlib.sha256(guidance.encode()).hexdigest()
        self.write(".wisdohm/protocols/maintenance.md",
                   '# Fixture maintenance\n1. Preserve source and evidence.\n\n'
                   '[fixture-rules]: ../../docs/rules/sources/fixture-rules.md "sha256:' + pin + '"\n')
        self.write(".wisdohm/config/project.yaml",
                   "project: fixture\nmode: autonomous\ncommands: {}\nrules:\n"
                   "  protected_paths: ['.git/', '.env', '**/secrets/**']\n"
                   "  sources: ['.wisdohm/protocols/maintenance.md']\n"
                   "ownership: {}\n")
        self.write(".context/modules/registry.yaml",
                   "schema_version: 1\nmodules:\n  fixture:\n    purpose: fixture\n"
                   "    paths: ['src/profile.ts']\n    depends_on: []\n    public_surfaces: ['src/profile.ts']\n")
        # Local routing is mandatory even in disposable bootstrap fixtures.
        self.write(".agents/skills/fixture/SKILL.md", "# Fixture skill\n1. Preserve fixture evidence.\n")
        self.write(".wisdohm/config/agents.yaml",
                   "schema_version: 1\nprofiles:\n  fixture:\n    description: Disposable fixture owner\n"
                   "    skills: ['.agents/skills/fixture/SKILL.md']\n")
        registry = self.root / ".context/modules/registry.yaml"
        registry.write_text(registry.read_text().replace("    purpose: fixture", "    agent: fixture\n    purpose: fixture"))
        maps = []
        for name in ("STACK", "INTEGRATIONS", "ARCHITECTURE", "STRUCTURE", "CONVENTIONS", "TESTING", "CONCERNS"):
            path = ".planning/codebase/" + name + ".md"
            self.write(path, "# " + name + "\nReviewed fixture observation.\n")
            maps.append(path)
        self.write(".context/state/changelog.md", "# Historical fixture change\n")
        self.write(".context/state/progress.md", "# Historical fixture progress\n")
        self.write(".context/state/progress.json", '{"schemaVersion":1,"revision":0,"states":{}}\n')
        self.write(".context/state/tasks.json", '{"schema_version":1,"tasks":[]}\n')
        self.write(".context/state/index.json", json.dumps(dict(
            memory=dict(codebase=maps, changelog=[".context/state/changelog.md"],
                        progress=[".context/state/progress.md", ".context/state/progress.json"]),
            registries=dict(tasks=".context/state/tasks.json"))))
        self.write(".context/state/agents/old.json", json.dumps(dict(
            schema_version=1, id="historical-worker", root="/previous/fixture", task="Historical fixture",
            stage="DONE", read=[], write=["old.txt"], rules=[], verify=["historical fixture command"],
            checks=[dict(command="historical fixture command", exit=0)], context=None,
            summary="Synthetic historical fixture only.", next="Review")))

    def cleanup(self):
        root = Path(self.temp.name)
        for path in root.rglob("*"):
            if path.is_dir() and not path.is_symlink():
                path.chmod(0o700)
        self.temp.cleanup()

    def write(self, relative, text):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def run_tool(self, expected=0, authorized=True):
        args = [sys.executable, str(SCRIPT), "--root", str(self.root)]
        if authorized:
            args.append("--authorized-bootstrap")
        result = subprocess.run(args, text=True, capture_output=True, timeout=20,
                                env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return json.loads(result.stdout) if expected == 0 else result

    def api(self):
        Store, digest = bootstrap.runtime_api(self.root)
        return Store(self.root), digest

    def database(self):
        with closing(sqlite3.connect("file:" + str(self.root / ".wisdohm/memory.sqlite") + "?mode=ro", uri=True)) as db:
            return {table: db.execute("SELECT * FROM " + table).fetchall()
                    for table in ("sessions", "memory", "events", "claims")}

    def agent(self, *args):
        return subprocess.run([sys.executable, str(self.root / ".wisdohm/router.py"), "--target",
                               str(self.root), "agent", *args], text=True, capture_output=True, timeout=10,
                              env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})

    def test_official_migration_and_population_are_repeatable_without_done(self):
        first = self.run_tool()
        self.assertEqual(first["migration"]["imported_sessions"], 1)
        self.assertGreater(first["migration"]["imported_records"], 0)
        self.assertEqual(first["stage"], "IMPORTED")
        before = self.database()
        second = self.run_tool()
        self.assertTrue(second["migration"]["already_imported"])
        self.assertTrue(second["current_facts_unchanged"])
        self.assertEqual(before, self.database())
        store, _ = self.api()
        sessions = store.sessions()
        self.assertNotIn("DONE", {row["stage"] for row in sessions})
        old = store.load("historical-worker")
        self.assertEqual((old["stage"], old["write"], old["checks"], old["context"]),
                         ("HANDOVER", [], [], None))
        self.assertEqual(old["legacy_scope"], ["old.txt"])
        current = store.load(first["bootstrap_id"])
        self.assertEqual((current["stage"], current["write"], current["checks"], current["context"]),
                         ("IMPORTED", [], [], None))
        self.assertEqual(self.database()["claims"], [])
        self.assertNotEqual(self.agent("resume", "--id", first["bootstrap_id"]).returncode, 0)
        self.assertNotEqual(self.agent("finish", "--id", first["bootstrap_id"]).returncode, 0)

    def test_changed_source_preserves_prior_fact_in_transaction_history(self):
        first = self.run_tool()
        store, _ = self.api()
        old = next(row["body"] for row in store.records() if row["key"] == "map/STACK")
        self.write(".planning/codebase/STACK.md", "# STACK\nA new reviewed fixture observation.\n")
        second = self.run_tool()
        self.assertNotEqual(first["bootstrap_id"], second["bootstrap_id"])
        events = [json.loads(row[3]) for row in self.database()["events"]]
        changes = [entry for event in events for entry in event.get("entries", []) if entry["key"] == "map/STACK"]
        self.assertEqual(changes[-1]["before"], old)
        self.assertNotEqual(changes[-1]["after"]["sha256"], old["sha256"])
        self.assertEqual(changes[-1]["after"]["provenance"], "host-authorized-bootstrap")

    def test_unfinished_record_owner_rolls_back_entire_bootstrap(self):
        self.run_tool()
        self.write(".planning/codebase/STACK.md", "# STACK\nChanged before a blocked transaction.\n")
        store, digest = self.api()
        holder = dict(schema_version=2, id="unfinished-holder", root=str(self.root),
                      stage="START", write=[], checks=[], summary="Synthetic owner-conflict fixture.")
        holder["digest"] = digest(holder)
        store.save(holder, entries=[dict(kind="registry", key="ownership/source", body=dict(text="Held fixture fact"))])
        before = self.database()
        failed = self.run_tool(expected=1)
        self.assertIn("unfinished task", failed.stderr)
        self.assertEqual(before, self.database())

    def test_frozen_bundle_detects_drift_including_nested_manifest_named_file(self):
        self.write(".context/manifest.json", '{"historical":"fixture"}\n')
        self.run_tool()
        before = self.database()
        path = self.root / bootstrap.BUNDLE / ".context/manifest.json"
        path.chmod(0o644)
        path.write_text('{"historical":"changed"}\n')
        failed = self.run_tool(expected=1)
        self.assertIn("Frozen import bundle changed", failed.stderr)
        self.assertEqual(before, self.database())

    def test_mutable_product_progress_stays_canonical_outside_operational_memory(self):
        self.run_tool()
        before = self.database()
        self.write(".context/state/progress.json", '{"schemaVersion":1,"revision":42,"states":{}}\n')
        rerun = self.run_tool()
        self.assertTrue(rerun["current_facts_unchanged"])
        self.assertEqual(before, self.database())
        self.assertEqual(json.loads((self.root / ".context/state/progress.json").read_text())["revision"], 42)

    def test_explicit_authorization_and_physical_sources_are_required(self):
        self.run_tool(expected=2, authorized=False)
        self.assertFalse((self.root / bootstrap.BUNDLE).exists())
        source = self.root / ".planning/codebase/STACK.md"
        source.unlink()
        outside = Path(self.temp.name) / "outside.md"
        outside.write_text("Outside fixture source remains untouched.\n")
        source.symlink_to(outside)
        self.run_tool(expected=1)
        self.assertEqual(outside.read_text(), "Outside fixture source remains untouched.\n")
        self.assertFalse((self.root / bootstrap.BUNDLE).exists())

    def test_normal_unknown_context_guard_still_blocks_authoring(self):
        self.run_tool()
        started = self.agent("start", "--id", "normal-worker", "--kind", "audit", "--owner", "fixture",
                             "--task", "Observe fixture without invented context.")
        self.assertEqual(started.returncode, 0, started.stderr)
        self.assertEqual(self.agent("context", "--id", "normal-worker", "--unknown").returncode, 0)
        refused = self.agent("remember", "--id", "normal-worker", "--kind", "progress",
                             "--key", "must-not-exist", "--text", "Unmeasured authoring must fail.")
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn("unknown/stale", refused.stderr)
        store, _ = self.api()
        self.assertFalse(any(row["key"] == "must-not-exist" for row in store.records()))

    def test_pre_cutover_capture_keeps_history_while_current_maps_change(self):
        runtime = self.root / ".wisdohm"
        runtime.rename(self.root / "runtime-staged")
        self.write(".context/BOOT.md", "Historical 2.4 entry, preserved before cutover.\n")
        bundle = bootstrap.import_bundle(self.root)
        self.write(".context/BOOT.md", "Retired product metadata entry.\n")
        self.write(".planning/codebase/STACK.md", "# STACK\nCurrent independent-edition fixture.\n")
        (self.root / "runtime-staged").rename(runtime)
        result = self.run_tool()
        self.assertEqual(result["migration"]["imported_sessions"], 1)
        self.assertIn("Historical 2.4", (bundle / ".context/BOOT.md").read_text())
        self.assertIn("Reviewed fixture observation", (bundle / ".planning/codebase/STACK.md").read_text())
        store, _ = self.api()
        current = next(row for row in store.records() if row["key"] == "map/STACK")
        self.assertIn("Current independent-edition", current["body"]["text"])

    def test_external_report_is_observed_and_updated_without_promoting_checks(self):
        self.run_tool()
        store, _ = self.api()
        key = "rules-board/verification-report"
        self.assertFalse(any(row["key"] == key for row in store.records()))
        report = "docs/evidence/rules-board/delivery.json"

        def record_actual_fixture_check(exit_code):
            command = [sys.executable, "-c", "print('fixture verification'); raise SystemExit(" + str(exit_code) + ")"]
            checked = subprocess.run(command, capture_output=True, text=True, timeout=5)
            self.write(report, json.dumps(dict(fixture=True, command=command,
                       exitCode=checked.returncode, output=checked.stdout)))
            return hashlib.sha256((self.root / report).read_bytes()).hexdigest()

        first_hash = record_actual_fixture_check(0)
        first = self.run_tool()
        current = next(row for row in store.records() if row["key"] == key)
        self.assertEqual(current["body"]["sha256"], first_hash)
        self.assertEqual(current["body"]["report_type"], "external-observed-verification-report")
        self.assertIn("not a guarded check", current["body"]["text"])
        second_hash = record_actual_fixture_check(3)
        second = self.run_tool()
        self.assertNotEqual(first["bootstrap_id"], second["bootstrap_id"])
        events = [json.loads(row[3]) for row in self.database()["events"]]
        changes = [entry for event in events for entry in event.get("entries", []) if entry["key"] == key]
        self.assertEqual(changes[-1]["before"]["sha256"], first_hash)
        self.assertEqual(changes[-1]["after"]["sha256"], second_hash)
        self.assertIn('\"exitCode\": 3', changes[-1]["after"]["text"])
        self.assertTrue(all(not row.get("checks") and row["stage"] != "DONE" for row in store.sessions()))


if __name__ == "__main__":
    unittest.main(verbosity=2)

