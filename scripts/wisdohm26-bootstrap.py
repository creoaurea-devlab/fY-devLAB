#!/usr/bin/env python3
"""Trusted, explicitly authorized WISDOHM 2.6 administration; never a gated DONE."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
BUNDLE = ".recovery/wisdohm26-import"
MAPS = ("STACK", "INTEGRATIONS", "ARCHITECTURE", "STRUCTURE", "CONVENTIONS", "TESTING", "CONCERNS")


def source(root, relative):
    path = root / relative
    if path.resolve() != path or not path.is_file() or path.stat().st_nlink != 1:
        raise ValueError("Expected an independent physical source file: " + relative)
    raw = path.read_bytes()
    if len(raw) > 8 * 1024 * 1024:
        raise ValueError("Source exceeds 8 MiB: " + relative)
    return raw.decode("utf-8"), hashlib.sha256(raw).hexdigest()


def legacy_snapshot(root):
    files = {}
    for directory in (".context", ".planning"):
        base = root / directory
        if base.is_symlink() or not base.is_dir():
            raise ValueError("Missing physical legacy directory: " + directory)
        for path in sorted(base.rglob("*")):
            if "__pycache__" in path.parts or path.suffix == ".pyc":
                continue
            if path.is_symlink() or not (path.is_file() or path.is_dir()):
                raise ValueError("Unsafe legacy entry: " + str(path))
            if path.is_file():
                relative = path.relative_to(root).as_posix()
                text, _ = source(root, relative)
                files[relative] = text.encode("utf-8")
    json.loads(files[".context/state/index.json"])
    return files


def hashes(directory):
    result = {}
    for path in directory.rglob("*"):
        if path.is_symlink() or not (path.is_file() or path.is_dir()):
            raise ValueError("Unsafe import bundle entry: " + str(path))
        if path.is_file() and path != directory / "manifest.json":
            result[path.relative_to(directory).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def import_bundle(root):
    bundle = root / BUNDLE
    if bundle.exists():
        if bundle.resolve() != bundle or not bundle.is_dir():
            raise ValueError("Import bundle must be a physical directory.")
        manifest = json.loads(source(bundle, "manifest.json")[0])
        if (bundle.resolve() != bundle or manifest.get("schema_version") != 1
                or manifest.get("source_root") != str(root) or manifest.get("files") != hashes(bundle)):
            raise ValueError("Frozen import bundle changed; preserve it and investigate.")
        return bundle
    recovery = bundle.parent
    if recovery.resolve() != recovery:
        raise ValueError("Recovery directory cannot follow symlinks.")
    recovery.mkdir(parents=True, exist_ok=True)
    snapshot = legacy_snapshot(root)
    staging = Path(tempfile.mkdtemp(prefix=".wisdohm26-import-", dir=recovery))
    try:
        for relative, raw in snapshot.items():
            target = staging / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
        aliases = staging / ".wisdohm/state"
        aliases.mkdir(parents=True)
        shutil.copyfile(staging / ".context/state/index.json", aliases / "index.json")
        agents = staging / ".context/state/agents"
        (aliases / "agents").mkdir()
        if agents.exists():
            for path in agents.glob("*.json"):
                shutil.copyfile(path, aliases / "agents" / path.name)
        manifest = dict(schema_version=1, source_root=str(root),
                        captured_at=datetime.now(timezone.utc).isoformat(), files=hashes(staging))
        (staging / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        if snapshot != legacy_snapshot(root):
            raise ValueError("Legacy sources changed during capture; retry after coordinating writers.")
        staging.rename(bundle)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    for path in bundle.rglob("*"):
        path.chmod(0o555 if path.is_dir() else 0o444)
    bundle.chmod(0o555)
    return bundle


def runtime_api(root):
    """Load the copied runtime, not the SOT launcher's different implementation."""
    runtime = root / ".wisdohm"
    modules = {}
    previous = sys.modules.get("common")
    try:
        for name in ("common", "store"):
            spec = importlib.util.spec_from_file_location(name, runtime / (name + ".py"))
            module = importlib.util.module_from_spec(spec)
            if name == "common":
                sys.modules["common"] = module
            spec.loader.exec_module(module)
            modules[name] = module
    finally:
        if previous is None:
            sys.modules.pop("common", None)
        else:
            sys.modules["common"] = previous
    return modules["store"].Store, modules["common"].digest


def observations(root):
    entries = []

    def add(kind, key, path, text=None):
        content, checksum = source(root, path)
        entries.append(dict(kind=kind, key=key, body=dict(
            text=content if text is None else text, source_path=path, sha256=checksum,
            provenance="host-authorized-bootstrap",
            evidence="Observed source; not a guarded verification or DONE receipt.")))
        return content

    loader, _ = source(root, "AGENTS.md")
    if ".wisdohm/BOOT.md" not in loader:
        raise ValueError("Merge the new root loader before capturing/bootstrap.")
    for name in MAPS:
        add("codebase", "map/" + name, ".planning/codebase/" + name + ".md")
    package = json.loads(source(root, "package.json")[0])
    add("codebase", "app/identity", "package.json",
        f"Independent edition: {package.get('name')} {package.get('version')}; canonical root: {root}.")
    add("codebase", "app/composition", "src/profile.ts",
        "The selected host composition is source-owned in src/profile.ts; inspect this exact source/hash.")
    add("codebase", "governance/entry", "AGENTS.md")
    add("codebase", "governance/runtime", ".wisdohm/BOOT.md")
    add("registry", "ownership/source", ".context/modules/registry.yaml")
    for name in ("policy.yaml", "journey.yaml", "config/project.yaml"):
        add("registry", "governance/" + name, ".wisdohm/" + name)
    add("registry", "engineering/routing", ".wisdohm/protocols/maintenance.md")
    add("registry", "rules-board/contracts", "packages/contracts/src/rules.ts",
        "Neutral Rules Board service/data contracts are defined at this source path; no compliance certification.")
    add("feature", "rules-board/design", "docs/plans/rules-board/SPEC.md")
    add("feature", "rules-board/backend", "plugins/rules-local/src/index.ts",
        "Rules Board backend entry source exists here. Behavioral verification is separate evidence.")
    add("feature", "rules-board/ui", "plugins/ui-rules/src/index.ts",
        "Rules Board UI contribution entry source exists here. Behavioral verification is separate evidence.")
    planning = source(root, "plugins/planning-local/src/store.ts")[0]
    if not all(path in planning for path in (".context/state/tasks.json", ".context/state/progress.json")):
        raise ValueError("Review the product-planning authority split before changing this bootstrap.")
    add("decision", "product/planning-authority", "plugins/planning-local/src/store.ts",
        "Product planning remains in .context/state/tasks.json and progress.json through its existing writer; "
        "operational SQLite does not become another editable planner.")
    add("decision", "governance/bootstrap-waiver", "docs/plans/rules-board/SPEC.md",
        "The user authorized administrative population outside the formal CLI. No authoring-session context "
        "measurement is available; normal guards are retained and no gated DONE is claimed.")
    add("progress", "governance/population", "scripts/wisdohm26-bootstrap.py",
        "Legacy context was imported as historical provenance; current source observations were populated "
        "administratively. This is not verified agent completion or reported product task progress.")
    add("changelog", "governance/population", "scripts/wisdohm26-bootstrap.py",
        "Imported preserved context and recorded source-hashed project observations through the public Store API "
        "under the explicit user waiver. No source mutation, context measurement, check result, or DONE is fabricated.")
    report = "docs/evidence/rules-board/delivery.json"
    if (root / report).exists() or (root / report).is_symlink():
        content = add("audit", "rules-board/verification-report", report)
        if not isinstance(json.loads(content), dict):
            raise ValueError("External delivery report must be a JSON object.")
        entries[-1]["body"].update(
            text="External observed verification report; not a guarded check or completion receipt.\n\n" + content,
            report_type="external-observed-verification-report")
    return entries


def populate(root):
    boot = source(root, ".wisdohm/BOOT.md")[0]
    if "(version 2.6.0)" not in boot:
        raise ValueError("Deploy and review WISDOHM 2.6 before running administration.")
    for name in ("router.py", "common.py", "store.py"):
        source(root, ".wisdohm/" + name)
    entries = observations(root)  # Missing or unfinished board wiring refuses capture.
    bundle = import_bundle(root)
    migrated = subprocess.run(
        [sys.executable, str(root / ".wisdohm/router.py"), "--target", str(root),
         "db", "migrate", "--from", str(bundle)], text=True, capture_output=True, timeout=60,
        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
    if migrated.returncode:
        raise ValueError("Official migration refused: " + migrated.stderr.strip())
    migration = json.loads(migrated.stdout)
    Store, digest = runtime_api(root)
    store = Store(root)
    identity = "bootstrap-" + digest(dict(root=str(root), entries=entries))[:24]
    existing = next((state for state in store.sessions() if state["id"] == identity), None)
    if existing and not (existing["stage"] == "IMPORTED" and existing.get("_legacy")
                         and existing.get("write") == [] and existing.get("checks") == []
                         and existing.get("context") is None):
        raise ValueError("Bootstrap identity conflicts with a non-administrative task.")
    current = {(item["kind"], item["key"]): item["body"] for item in store.records()}
    unchanged = existing is not None and all(current.get((item["kind"], item["key"])) == item["body"]
                                             for item in entries)
    if not unchanged:
        state = existing or dict(schema_version=2, id=identity, root=str(root), kind="maintenance",
                                 owner="governance-bootstrap", task="Import reviewed project observations",
                                 stage="IMPORTED", _legacy=True, write=[], rules=[], verify=[], checks=[],
                                 context=None, outputs=None, memory=None, receipt={}, inputs={})
        state.update(read=sorted({entry["body"]["source_path"] for entry in entries}),
                     summary="User-authorized administrative bootstrap; no guarded journey completed.",
                     next="Start a successor task with real host measurements for normal guarded authoring.",
                     provenance="host-authorized-bootstrap", updated_at=datetime.now(timezone.utc).isoformat())
        state["digest"] = digest({key: value for key, value in state.items() if key not in {"digest", "_revision"}})
        expected = store.snapshot()
        for entry in entries:
            if source(root, entry["body"]["source_path"])[1] != entry["body"]["sha256"]:
                raise ValueError("Source changed before population; review and retry.")
        store.save(state, action="BOOTSTRAP_IMPORT", entries=entries, release=True, expected_memory=expected)
    return dict(bundle=str(bundle), migration=migration, bootstrap_id=identity, stage="IMPORTED",
                current_facts_unchanged=unchanged, records=len(entries),
                categories=dict(Counter(item["kind"] for item in entries)),
                evidence={item["body"]["source_path"]: item["body"]["sha256"] for item in entries},
                no_done_reason="Administrative user-waiver import; no host telemetry or guarded verification supplied.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--authorized-bootstrap", action="store_true", required=True,
                        help="Confirm user authorization for administration outside the guarded CLI.")
    args = parser.parse_args()
    try:
        print(json.dumps(populate(args.root.resolve()), indent=2))
        return 0
    except Exception as exc:
        print(json.dumps(dict(action="stop", error=str(exc))), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

