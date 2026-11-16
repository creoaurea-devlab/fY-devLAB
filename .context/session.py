"""One per-agent checkpoint. The host supplies usage and intercepts task actions."""
import argparse
import fcntl
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import time

from common import digest, load_agent_policy as load_policy, need, parse_json, parse_yaml, project_path, write_artifact
from memory import MEMORY, assess_memory


class Session:
    def __init__(self, root, identity):
        self.root = Path(root).resolve()
        need(re.fullmatch(r"[A-Za-z0-9_-]{1,80}", identity), "invalid agent id")
        self.identity = identity
        self.relative = f".context/state/agents/{identity}.json"
        # Existing projects retain their declared protections without loading roles or registries.
        config = project_path(self.root, ".context/config/project.yaml")
        self.protected = parse_yaml(config.read_text()).get("rules", {}).get("protected_paths", []) if config.exists() else []
        need(isinstance(self.protected, list) and all(isinstance(p, str) and p for p in self.protected),
             "project protected_paths must be a list of patterns")

    def path(self, relative, write=False):
        path = project_path(self.root, relative, write, self.protected)
        need(path.relative_to(self.root).as_posix() == relative, f"noncanonical path: {relative}")
        return path

    def fingerprints(self, paths):
        return {p: hashlib.sha256(self.path(p).read_bytes()).hexdigest()
                if self.path(p).is_file() else None for p in paths}

    def authorization_mode(self):
        settings = self.path(".context/settings.json")
        if settings.exists():
            mode = parse_json(settings.read_text()).get("mode")
            need(mode == "autonomous", "use the legacy approval workflow for human_in_loop or unknown authorization mode")

    def inputs(self, state):
        sources = {".context/BOOT.md", ".context/protocols/rules.md", ".context/protocols/updates.md",
                   ".context/state/index.json", ".context/memory.py", ".context/policy.yaml",
                   ".context/router.py", ".context/session.py", ".context/common.py", *state["rules"]}
        if self.path(".context/config/project.yaml").exists():
            sources.add(".context/config/project.yaml")
            configured = parse_yaml(self.path(".context/config/project.yaml").read_text()).get("rules", {}).get("sources", [])
            need(isinstance(configured, list) and all(isinstance(path, str) and path for path in configured),
                 "project rules.sources must list local rule files")
            for path in configured:
                need(self.path(path).is_file(), f"missing configured rules: {path}")
                sources.add(path)
        if self.path(".context/settings.json").exists():
            sources.add(".context/settings.json")
        for name in ("AGENTS.md", "RULES.md"):
            if self.path(name).exists():
                sources.add(name)
        for name in state["read"] + state["write"]:
            for directory in self.path(name).parent.relative_to(self.root).parents:
                candidate = (directory / "AGENTS.md").as_posix()
                if self.path(candidate).exists():
                    sources.add(candidate)
            candidate = (Path(name).parent / "AGENTS.md").as_posix()
            if self.path(candidate).exists():
                sources.add(candidate)
        receipt = {}
        for name in sorted(sources):
            text = self.path(name).read_text(encoding="utf-8")
            if name == ".context/BOOT.md":
                need("** CA_WISDOM - ON **" in text, "BOOT declaration missing; load valid boot instructions")
            if name.endswith(".md"):
                rules = re.findall(r"^(?:#{1,6}\s+)?(\d+)[.)]\s+(.+)$", text, re.MULTILINE)
                receipt[name] = [f"{number}. {title}" for number, title in rules]
        need(receipt[".context/protocols/rules.md"], "canonical engineering rules must be numbered and nonempty")
        reads = set(state["read"]) - set(state["write"])
        for name in reads:
            need(self.path(name).is_file(), f"missing declared read: {name}")
        return self.fingerprints(sources | reads), receipt

    def memory_snapshot(self):
        catalogue = parse_json(self.path(".context/state/index.json").read_text()).get("memory")
        need(isinstance(catalogue, dict) and set(catalogue) == set(MEMORY), "invalid project memory catalogue")
        for paths in catalogue.values():
            need(isinstance(paths, list) and all(isinstance(p, str) and p for p in paths),
                 "memory catalogue must list exact file paths")
            for name in paths:
                self.path(name, write=True)
        return {key: self.fingerprints(paths) for key, paths in catalogue.items()}

    def review(self, state, args):
        self.guard(state)
        current = self.memory_snapshot()
        key = args.category
        item = dict(status=args.status, reason=args.reason)
        if args.status == "updated":
            item["artifacts"] = [dict(path=path, sha256=checksum)
                                 for path, checksum in current[key].items()
                                 if checksum != state["memory_baseline"][key][path]]
        assess_memory({key: item}, {key: state["memory_baseline"][key]}, {key: current[key]}, state["write"])
        state["memory_review"][key] = item
        self.save(state)

    def save(self, state):
        target = self.path(self.relative, write=True)
        target.parent.mkdir(parents=True, exist_ok=True)
        self.path(self.relative, write=True)
        state["updated_at"] = datetime.now(timezone.utc).isoformat()
        state["files"] = self.fingerprints(state["write"])
        state["digest"] = digest({key: value for key, value in state.items() if key != "digest"})
        write_artifact(target, json.dumps(state, indent=2) + "\n")

    def load(self):
        state = parse_json(self.path(self.relative).read_text())
        need(state.get("digest") == digest({key: value for key, value in state.items() if key != "digest"}),
             "corrupt agent checkpoint")
        need(state.get("schema_version") == 1 and state.get("id") == self.identity
             and state.get("root") == str(self.root), "checkpoint belongs to another agent/project")
        for field in ("read", "write", "rules", "verify"):
            need(isinstance(state.get(field), list) and all(isinstance(x, str) and x for x in state[field]),
                 f"invalid checkpoint field: {field}")
        for name in state["read"] + state["rules"]:
            self.path(name)
        for name in state["write"]:
            self.path(name, write=True)
        return state

    def start(self, args):
        self.authorization_mode()
        need(not self.path(self.relative).exists(), "agent already exists; resume or use a new id")
        need(args.task.strip(), "task must not be empty")
        need(not args.write or args.verify, "modifying task needs verification commands")
        need(all(cmd.strip() for cmd in args.verify) and len(args.verify) == len(set(args.verify)),
             "verification commands must be nonempty and unique")
        for name in args.write:
            self.path(name, write=True)
            need(not name.startswith(".context/state/agents/"), "agent state is reserved for checkpoint operations")
        state = dict(schema_version=1, id=self.identity, root=str(self.root), task=args.task,
                     read=sorted(set(args.read)), write=sorted(set(args.write)), rules=sorted(set(args.rules)),
                     verify=args.verify, stage="START", summary="Task declared; no work recorded.",
                     next="Supply a fresh runtime context measurement before task actions.", blockers=[],
                     context=None, checks=[], outputs=None, memory_review={}, memory_outputs=None,
                     memory_baseline=self.memory_snapshot())
        load_policy(self.root)
        state["inputs"], state["receipt"] = self.inputs(state)
        self.save(state)
        return state

    def usage(self, state):
        policy = load_policy(self.root)
        observation = state["context"]
        if observation is None:
            return None
        age = time.time() - observation["at"]
        if not 0 <= age <= policy["measurement_max_age_seconds"]:
            return None
        return 100 * observation["used_tokens"] / observation["window_tokens"]

    def guard(self, state, paths=()):
        self.authorization_mode()
        need(state["stage"] != "DONE", "completed task needs a new id")
        policy = load_policy(self.root)
        current, _ = self.inputs(state)
        need(current == state["inputs"], "governing rules or read inputs changed; checkpoint and resume")
        usage = self.usage(state)
        if usage is None or usage >= policy["context_limit_percent"]:
            state["stage"] = "HANDOVER"
            state["outputs"] = None
            state["next"] = "Checkpoint current work, then compact or hand over; resume with fresh usage."
            self.save(state)
            need(False, "context unknown/stale or at threshold; HANDOVER required before new work")
        need(state["stage"] not in {"HANDOVER", "DONE"}, "resume this checkpoint before task actions")
        for name in paths:
            self.path(name, write=True)
            need(name in state["write"], f"undeclared write: {name}")

    def context(self, state, args):
        need(state["stage"] != "DONE", "completed task needs a new id")
        if args.unknown:
            need(args.used_tokens is None and args.window_tokens is None, "unknown usage cannot include tokens")
            state["context"] = None
        else:
            need(args.used_tokens is not None and args.used_tokens >= 0
                 and args.window_tokens is not None and args.window_tokens > 0
                 and args.source and args.source.strip(), "usage requires nonnegative tokens, a positive window and host source")
            state["context"] = dict(used_tokens=args.used_tokens, window_tokens=args.window_tokens,
                                    source=args.source, at=time.time())
        usage = self.usage(state)
        if usage is None or usage >= load_policy(self.root)["context_limit_percent"]:
            state["stage"] = "HANDOVER"
            state["outputs"] = None
            state["next"] = "Checkpoint current work; compact with the host or hand over, then resume."
        self.save(state)

    def verify(self, state):
        self.guard(state)
        before = self.fingerprints(state["write"])
        memory_before = self.memory_snapshot()
        state.update(stage="VERIFY", checks=[], outputs=None)
        self.save(state)
        try:
            for command in state["verify"]:
                self.guard(state)
                try:
                    with tempfile.TemporaryFile() as log:
                        process = subprocess.Popen(command, shell=True, cwd=self.root, stdout=log,
                                                   stderr=subprocess.STDOUT, start_new_session=True)
                        try:
                            exit_code = process.wait(timeout=900)
                        finally:
                            # Checks own their children; cancellation/timeout must not leave writers running.
                            try:
                                os.killpg(process.pid, signal.SIGKILL)
                            except ProcessLookupError:
                                pass
                            process.wait()
                        log.seek(0)
                        checksum = hashlib.sha256()
                        for chunk in iter(lambda: log.read(65536), b""):
                            checksum.update(chunk)
                        output_digest = checksum.hexdigest()
                    check = dict(command=command, exit=exit_code, output_digest=output_digest)
                except (OSError, subprocess.TimeoutExpired) as exc:
                    check = dict(command=command, exit=124, error=str(exc))
                state["checks"].append(check)
                self.save(state)
            self.guard(state)
            need(before == self.fingerprints(state["write"]), "outputs changed during verification; verify again")
            need(memory_before == self.memory_snapshot(), "project memory changed during verification; verify again")
            passed = all(check["exit"] == 0 for check in state["checks"])
            state.update(stage="VERIFY" if passed else "BLOCKED", outputs=before if passed else None,
                         memory_outputs=memory_before if passed else None,
                         next="Review project memory, then finish." if passed else "Repair failed checks and verify again.")
            self.save(state)
            return passed
        except BaseException:
            if state["stage"] != "HANDOVER":
                state.update(stage="BLOCKED", outputs=None, next="Review the verification failure and verify again.")
                self.save(state)
            raise

    def finish(self, state):
        self.guard(state)
        need(state["stage"] == "VERIFY" and [c["command"] for c in state["checks"]] == state["verify"]
             and all(c["exit"] == 0 for c in state["checks"]), "all declared verification must pass before DONE")
        need(state["outputs"] == self.fingerprints(state["write"]), "outputs changed after verification; verify again")
        current = self.memory_snapshot()
        need(state.get("memory_outputs") == current, "project memory changed after verification; verify again")
        if not state["write"]:
            state["memory_review"] = {key: dict(status="not_applicable", reason="Read-only task; no project memory changes.")
                                      for key in MEMORY}
        assess_memory(state.get("memory_review"), state["memory_baseline"], current, state["write"])
        state.update(stage="DONE", summary="Task completed; verification and project-memory review passed.",
                     next="None; task complete.")
        self.save(state)

    def render(self, state, receipt=False):
        # Escape control characters from task/user text so they cannot forge terminal status.
        clean = lambda value: str(value).encode("unicode_escape").decode("ascii")
        try:
            usage = self.usage(state)
            context = "unknown" if usage is None else f"{usage:.2f}%"
            limit = f"{load_policy(self.root)['context_limit_percent']}%"
        except (ValueError, OSError):
            context = "unknown (policy unavailable)"
            limit = "unknown"
        lines = [f"+-- CA_WISDOM | {state['id']} | {state['stage']} --+",
                 f"| Task: {clean(state['task'])}", f"| Context: {context}; limit: {limit}; host-supplied measurement",
                 f"| Scope: {clean(', '.join(state['write']) or 'read-only')}", "+----------------------------------------+",
                 f"Summary: {clean(state['summary'])}", f"Next: {clean(state['next'])}"]
        lines += [f"Check: {clean(c['command'])} exit {c['exit']}" for c in state["checks"]]
        lines += [f"Blocker: {clean(x)}" for x in state["blockers"]]
        lines.append(f"Memory: {len(state.get('memory_review', {}))}/{len(MEMORY)} categories reviewed")
        if receipt:
            lines.append("We are holding these rules (acknowledgment; compliance needs evidence):")
            for source, rules in state["receipt"].items():
                lines.append(clean(source) + ": " + clean("; ".join(rules) or "loaded"))
        if state["stage"] == "DONE":
            lines.append("CA_WISDOM - COMPLETED")
        return "\n".join(lines)


def main(root, argv):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("start", "context", "check", "checkpoint", "resume", "verify", "review", "finish", "status"):
        command = commands.add_parser(name)
        command.add_argument("--id", required=True)
        if name == "start":
            command.add_argument("--task", required=True)
            for option in ("write", "read", "verify", "rules"):
                command.add_argument("--" + option, action="append", default=[])
        if name == "check":
            command.add_argument("--path", action="append", default=[])
        if name == "checkpoint":
            command.add_argument("--summary", required=True)
            command.add_argument("--next", required=True)
            command.add_argument("--blocker", action="append", default=[])
        if name == "review":
            command.add_argument("--category", choices=MEMORY, required=True)
            command.add_argument("--status", choices=("updated", "unchanged", "not_applicable"), required=True)
            command.add_argument("--reason", required=True)
        if name == "context":
            command.add_argument("--used-tokens", type=int)
            command.add_argument("--window-tokens", type=int)
            command.add_argument("--source")
            command.add_argument("--unknown", action="store_true")
    args = parser.parse_args(argv)
    session = Session(root, args.id)
    lock = None
    state = None
    try:
        if args.command != "status":
            lock_path = session.path(f".context/state/agents/.{args.id}.lock", write=True)
            lock_path.parent.mkdir(parents=True, exist_ok=True)
            session.path(f".context/state/agents/.{args.id}.lock", write=True)
            lock = lock_path.open("a")
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                need(False, "agent is busy; serialize commands for this id")
        if args.command == "start":
            state = session.start(args)
        else:
            state = session.load()
            if args.command == "context":
                session.context(state, args)
            elif args.command == "checkpoint":
                need(state["stage"] != "DONE", "completed task needs a new id")
                need(args.summary.strip() and args.next.strip(), "checkpoint needs summary and next action")
                state.update(stage="HANDOVER", summary=args.summary, next=args.next, blockers=args.blocker,
                         outputs=None, context=None)
                session.save(state)
            elif args.command == "resume":
                need(state["stage"] != "DONE", "completed task needs a new id")
                load_policy(session.root)
                state["inputs"], state["receipt"] = session.inputs(state)
                # Older checkpoints acquire the baseline before any resumed memory edits.
                if "memory_baseline" not in state:
                    state["memory_baseline"] = session.memory_snapshot()
                state.update(stage="RESUME", context=None, outputs=None, memory_outputs=None, memory_review={})
                session.save(state)
            elif args.command == "check":
                session.guard(state, args.path)
            elif args.command == "verify":
                if not session.verify(state):
                    print(session.render(state))
                    return 3
            elif args.command == "finish":
                session.finish(state)
            elif args.command == "review":
                session.review(state, args)
        print(session.render(state, receipt=args.command in {"start", "resume"}))
        if args.command == "check":
            print("Scope: allowed")
        return 0
    except Exception:
        stage = "HANDOVER" if state is not None and state["stage"] == "HANDOVER" else "BLOCKED"
        print(f"+-- CA_WISDOM | {args.id} | {stage} --+", file=sys.stderr)
        raise
    finally:
        if lock is not None:
            lock.close()
