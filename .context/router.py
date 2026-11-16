#!/usr/bin/env python3
"""CA_WISDOM: deterministic decisions; the host executes and enforces them."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys

sys.dont_write_bytecode = True
MAPS = ("STACK", "INTEGRATIONS", "ARCHITECTURE", "STRUCTURE", "CONVENTIONS", "TESTING", "CONCERNS")
SEAL = ".context/state/population.json"
MAP_INDEX = ".planning/codebase/index.json"
EVENTS = ".context/state/events.jsonl"
# Gates the host must attest inside the contract before CLOSE is allowed. BOOT and
# CONTEXT are attested cryptographically by the contract evidence (BOOT.md and every
# CONTEXT load are hashed into approval_key), so the chain starts at WRITE.
RECORDABLE_GATES = ("WRITE", "VERIFY")
REGISTRY_KEYS = ("schema_version", "context_seal", "manifest", "ownership", "flows", "profiles")
# Fields that define a preflight contract. The approval key binds exactly these, so a
# tampered declaration changes the key while an executed output does not.
KEY_FIELDS = ("working_folder", "task", "role", "explicit_role", "intent", "modules",
              "read", "write", "risk", "verify", "assumptions", "evidence")


# Load our own sibling primitives even when imported by an external validator/test runner.
_shared_spec = importlib.util.spec_from_file_location("wisdom_common", Path(__file__).with_name("common.py"))
_shared = importlib.util.module_from_spec(_shared_spec)
_shared_spec.loader.exec_module(_shared)
RoutingError = _shared.RoutingError
need = _shared.need
parse_json = _shared.parse_json
parse_yaml = _shared.parse_yaml
digest = _shared.digest
write_artifact = _shared.write_artifact
matches = _shared.matches
project_path = _shared.project_path
load_agent_policy = _shared.load_agent_policy

def render_card(state):
    """Monochrome gate card: white dot bands, no emoji, one line per concern."""
    header = f"○ CA_WISDOM · task={state['task']} · role={state.get('role') or 'general'} · risk={state.get('risk')}"
    progress = [f"{gate} ✓" for gate in state["gates_recorded"]]
    progress += [f"{gate} →" for gate in state["gates_remaining"]]
    if not state["gates_remaining"]:
        progress.append("NEXT CLOSE")
    lines = [header, "○ " + (" ─ ".join(progress) if progress else "no gates recorded")]
    if state["writes"]:
        lines.append("○ write: " + ", ".join(state["writes"]))
    if state["blockers"]:
        lines.append("○ STOP: " + "; ".join(state["blockers"]))
    return "\n".join(lines)


class Router:
    matches = staticmethod(matches)

    def __init__(self, root):
        import jsonschema
        self.root = Path(root).resolve()
        self.evidence = {}
        boot = self.read(".context/BOOT.md")
        need("** CA_WISDOM - ON **" in boot, "Gate 1: BOOT declaration is missing")
        self.index = self.json(".context/index.json")
        need(self.index.get("entry") == "BOOT.md" and self.index.get("version") == "2.4.0",
             "Gate 2: unsupported context entry/version")
        jsonschema.Draft202012Validator(self.json(".context/schemas/context-index.schema.json")).validate(self.index)
        need(self.index["routes"].get("read_only", {}).get("writes") == "none", "read_only must forbid writes")
        self.read(".context/router.py")
        self.settings = self.json(".context/settings.json")
        jsonschema.Draft202012Validator(self.json(".context/schemas/settings.schema.json")).validate(self.settings)
        self.project = parse_yaml(self.read(".context/config/project.yaml"))
        self.modules = parse_yaml(self.read(".context/modules/registry.yaml"))
        self.base_evidence = dict(self.evidence)

    def refresh_authority(self):
        """Long-lived hosts must compare against current policy, not cached constructor inputs."""
        fresh = type(self)(self.root)
        self.__dict__.update(fresh.__dict__)

    def approval_key(self, proposal):
        """Digest the proposal with declared outputs excluded from the evidence binding.

        Inputs must stay unchanged for a contract to remain valid, but declared outputs are
        expected to change — the host executes the contract. Population is read-modify-write,
        so without this the router could never verify its own population step.
        """
        outputs = set(proposal.get("write") or [])
        payload = {field: proposal.get(field) for field in KEY_FIELDS}
        payload["evidence"] = {path: value for path, value in (proposal.get("evidence") or {}).items()
                               if path not in outputs}
        return digest(payload)

    def path(self, relative, write=False):
        return project_path(self.root, relative, write,
                            self.project.get("rules", {}).get("protected_paths", []) if write else ())

    def read(self, relative, optional=False):
        path = self.path(relative)
        if optional and not path.exists():
            self.evidence[relative] = None
            return None
        text = path.read_text(encoding="utf-8")
        self.evidence[relative] = hashlib.sha256(text.encode()).hexdigest()
        return text

    def json(self, relative, optional=False):
        text = self.read(relative, optional)
        return parse_json(text) if text is not None else None

    def source_fingerprint(self):
        # ponytail: full file hashes; use an incremental index when measured IO warrants it.
        omitted = {".git", "node_modules",
                   ".venv", "venv", "__pycache__", ".pytest_cache", "dist", "build", "coverage"}
        rules = self.project.get("rules", {})
        ignored = ["**/.env*", "**/secrets/**"] + rules.get("protected_paths", []) + rules.get("generated_paths", [])
        # Optional scope: when set, only matching paths can invalidate the population seal.
        # Narrowing scope keeps unrelated documentation churn from forcing a remap.
        scope = [pattern for pattern in self.settings.get("population", {}).get("source_scope") or []
                 if isinstance(pattern, str) and pattern]
        for pattern in scope:
            matches("", pattern)  # reject unsafe globs before hashing anything
        files = {}
        for directory, dirs, names in os.walk(self.root, followlinks=False):
            reserved = {".context", ".wisdom", ".planning", ".agents"} if Path(directory) == self.root else set()
            dirs[:] = sorted(d for d in dirs if d not in omitted | reserved and not (Path(directory) / d).is_symlink()
                             and not any(matches((Path(directory) / d).relative_to(self.root).as_posix() + "/", p) for p in ignored))
            for name in sorted(names):
                path = Path(directory) / name
                relative = path.relative_to(self.root).as_posix()
                if scope and not any(matches(relative, p) for p in scope):
                    continue
                if not path.is_symlink() and not any(matches(relative, p) for p in ignored):
                    files[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
        return digest(files)

    def map_fingerprint(self):
        files = {}
        for name in MAPS:
            relative = f".planning/codebase/{name}.md"
            text = self.read(relative)
            need(text.strip(), f"empty map: {relative}")
            files[relative] = self.evidence[relative]
        return digest(files)

    def context_fingerprint(self):
        # Agent ownership is populated after core facts; its own hash belongs to the registry.
        return digest({"project": {k: v for k, v in self.project.items() if k != "roles"}, "modules": self.modules})

    def fresh_context(self, check_source=True):
        seal = self.json(SEAL)
        need(seal.get("map") == self.map_fingerprint()
             and seal.get("context") == self.context_fingerprint()
             and (not check_source or seal.get("source") == self.source_fingerprint()),
             "stale population: remap changed sources, populate context, and seal again")
        return seal

    def manifest(self):
        text = self.read(".wisdom/agents/manifest.yaml", optional=True)
        if text is None:
            return None
        manifest = parse_yaml(text)
        need(manifest.get("selection_order") == self.settings["routing"]["selection_order"],
             "agent manifest routing order disagrees with settings")
        roles = manifest.get("roles", {})
        need(roles and manifest.get("role_selection", {}).get("fallback_role") in roles,
             "invalid agent manifest/fallback")
        self.read(".wisdom/agents/" + manifest["common_contract"])
        for role, config in roles.items():
            self.read(".wisdom/agents/" + config["file"])
            need(config.get("intents"), f"role lacks intents: {role}")
        return manifest

    def route(self, task, paths=(), explicit_role=None, intent=None, check_source=True):
        need(task in self.index["routes"], f"unknown route: {task}")
        route = self.index["routes"][task]
        context_load = set()
        for relative in self.index["base"] + route["load"]:
            self.read(".context/" + relative)
            context_load.add(".context/" + relative)
        workflow = route["workflow"]
        if workflow is not None:
            need(workflow in self.index["workflows"], f"unregistered workflow: {workflow}")
            self.read(".context/" + self.index["workflows"][workflow])
            context_load.add(".context/" + self.index["workflows"][workflow])
        for capability in route.get("requires", []):
            self.read(self.index["optional_manifests"][capability])
        manifest = self.manifest()
        role, reason = "general", "agent addon absent"
        if manifest:
            roles = manifest["roles"]
            ownership = self.project.get("roles", {}).get("ownership", {})
            if explicit_role:
                need(explicit_role in roles, f"unknown explicit role: {explicit_role}")
                role, reason = explicit_role, "explicit role"
            else:
                role = self.settings["routing"]["route_roles"].get(task)
                if role:
                    need(role in roles, f"configured role is missing: {role}")
                    reason = "configured task intent"
                elif intent:
                    candidates = sorted(r for r, c in roles.items() if intent in c["intents"])
                    role = candidates[0] if candidates else None
                    reason = "task intent; lexical tie break"
                if not role and paths:
                    candidates = [r for r in roles if all(any(matches(p, glob) for glob in ownership.get(r, [])) for p in paths)]
                    # Prefer the smallest complete ownership set; deterministic tie break.
                    candidates.sort(key=lambda r: (len(ownership.get(r, [])), r))
                    role = candidates[0] if candidates else None
                    reason = "smallest complete ownership set"
                if not role:
                    role = manifest["role_selection"]["fallback_role"]
                    reason = "declared fallback; no complete intent/ownership match"
            self.read(".wisdom/agents/" + roles[role]["file"])
            context_load.update((".wisdom/agents/" + manifest["common_contract"],
                                 ".wisdom/agents/" + roles[role]["file"]))
            for name in self.settings["routing"]["role_flows"].get(role, ["STRUCTURE"]):
                path = ".wisdom/agents/" + manifest["flow_root"] + "/" + name + ".md"
                self.read(path)
                context_load.add(path)
        else:
            need(not explicit_role, "explicit role requires agent addon")
        registry = self.json(self.settings["population"]["registry"], optional=True)
        # Population tasks may regenerate a stale derived registry under a new preflight.
        if registry is not None and task not in {"map_codebase", "populate_context", "populate_agents"}:
            self.validate_registry(registry)
            seal = self.fresh_context(check_source)
            need(manifest and registry.get("context_seal") == digest(seal)
                 and registry.get("manifest") == digest(manifest)
                 and registry.get("ownership") == digest(self.project.get("roles", {}))
                 and role in registry.get("profiles", {}), "stale agents: populate agents again")
            for flow, expected in registry["flows"].items():
                self.read(flow)
                need(self.evidence[flow] == expected, "stale agents: role flows changed")
        return {"task": task, "role": role, "reason": reason, "workflow": workflow,
                "mode": self.settings["mode"], "write_ceiling": route["writes"],
                "load": sorted(context_load), "validated_input_count": len(self.evidence),
                "agent_profile": role if registry else None}

    def preflight(self, task, writes, reads=(), risk="low", verify=(), assumptions=(), role=None, intent=None, approval=None, continuing=False, previous=None):
        if previous is not None:
            need(previous["task"] == task, "previous contract belongs to another task")
            self.check_scope(previous, [])
            continuing = True
        self.evidence = dict(self.base_evidence)
        verify = list(verify)
        self.declared_checks({"verify": verify})
        writes = sorted(set(writes))
        for relative in writes:
            need(self.path(relative, write=True).relative_to(self.root).as_posix() == relative,
                 f"noncanonical write path: {relative}")
        decision = self.route(task, writes, role, intent, check_source=not continuing)
        ceiling = decision["write_ceiling"]
        need(ceiling != "none" or not writes, "read-only route cannot authorize writes")
        if isinstance(ceiling, list):
            need(all(any(p == allowed or (allowed.endswith("/") and p.startswith(allowed))
                         for allowed in ceiling) for p in writes), "write exceeds route ceiling")
        need(ceiling == "none" or (writes and verify), "modifying preflight needs writes and verification")
        self.read(".context/protocols/preflight.md")
        self.read(".context/protocols/isolation.md")
        for relative in reads:
            # Hash every declared input into the contract: a changed input invalidates it.
            self.read(relative)
        module_names = sorted(name for name, module in self.modules.get("modules", {}).items()
                              if any(matches(p, glob) for p in writes for glob in module.get("paths", [])))
        proposal = {"working_folder": str(self.root), "task": task, "role": decision["role"],
                    "explicit_role": role, "intent": intent, "modules": module_names, "read": sorted(set(reads)),
                    "write": writes, "risk": risk, "verify": list(verify), "assumptions": list(assumptions),
                    "evidence": dict(self.evidence)}
        key = self.approval_key(proposal)
        required = bool(writes) and self.settings["mode"] == "human_in_loop" and "before_write" in self.settings["human_in_loop"]["checkpoints"]
        proposal.update(approval_key=key, approval=approval,
                        status="waiting_for_human" if required and approval != key else "ready")
        proposal["gate_chain"] = []
        proposal["declaration"] = f"PREFLIGHT task={task} agent={decision['role']} modules={','.join(module_names) or 'none'} write={','.join(writes) or 'none'} risk={risk} verify={'; '.join(verify) or 'inspection'}"
        return proposal

    def check_scope(self, contract, paths, others=()):
        self.refresh_authority()
        need(contract.get("working_folder") == str(self.root), "contract targets another project")
        current = self.preflight(contract["task"], contract["write"], contract["read"], contract["risk"],
                                 contract["verify"], contract["assumptions"], contract["explicit_role"],
                                 contract["intent"], contract.get("approval"), continuing=True)
        need(current["approval_key"] == contract["approval_key"], "stale or altered preflight; declare again")
        need(current["status"] == "ready", "human approval required for this exact preflight")
        claimed = {self.path(p, write=True) for p in current["write"]}
        need(not claimed.intersection(self.path(p, write=True) for p in others), "overlapping worker write sets")
        for relative in paths:
            need(self.path(relative, write=True) in claimed, f"undeclared write: {relative}")
        return {"status": "allowed", "paths": list(paths)}

    def validate_registry(self, registry):
        """Refuse corrupted or partial agent registries instead of treating them as absent."""
        missing = [key for key in REGISTRY_KEYS if key not in registry]
        need(not missing, "invalid agents registry: missing " + ", ".join(missing)
             + "; run _populate agents again")
        need(registry["schema_version"] == 1, "invalid agents registry: unsupported schema_version")
        for key in ("flows", "profiles"):
            need(isinstance(registry[key], dict) and registry[key],
                 f"invalid agents registry: empty or malformed {key}; run _populate agents again")

    def output_fingerprints(self, contract):
        """Freeze exact declared outputs after verification, including absent/deleted files."""
        outputs = {}
        for relative in contract["write"]:
            path = self.path(relative, write=True)
            outputs[relative] = hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
        return outputs

    def declared_checks(self, contract):
        declared = contract.get("verify") or []
        need(isinstance(declared, list) and all(isinstance(command, str) and command.strip() for command in declared),
             "verification commands must be non-empty strings")
        commands = [command.strip() for command in declared]
        need(len(commands) == len(set(commands)), "duplicate verification commands are not allowed")
        return commands

    def chain_integrity(self, contract):
        """Validate historical entry integrity; callers must separately validate current outputs."""
        chain = contract.get("gate_chain")
        need(chain is None or isinstance(chain, list), "contract gate_chain must be a list")
        chain = list(chain or [])
        mutating = self.index["routes"][contract["task"]]["writes"] != "none"
        expected = (["WRITE"] if mutating else []) + ["VERIFY"]
        need(len(chain) <= len(expected), "gate chain is already complete")
        previous = None
        for position, entry in enumerate(chain):
            need(isinstance(entry, dict), "gate entry must be an object")
            need(entry.get("gate") == expected[position], "gates are recorded in order: expected " + expected[position])
            need(entry.get("digest") == digest({key: value for key, value in entry.items() if key != "digest"}),
                 "gate entry digest mismatch; redeclare a legacy or altered contract")
            need(entry.get("prev") == previous, f"broken gate chain at {entry.get('gate')}")
            need(entry.get("outcome") in {"pass", "fail"}, "invalid gate outcome")
            need(entry.get("evidence_digest") == hashlib.sha256((entry.get("evidence") or "").encode()).hexdigest(),
                 "gate evidence digest mismatch")
            if entry["gate"] == "WRITE":
                need(entry.get("writes") == contract["write"], "recorded write set disagrees with the contract")
            else:
                verification = entry.get("verification") or {}
                checks = verification.get("checks") or []
                need(verification.get("source") in {"executed", "host-attested"}, "verification source is missing")
                need(isinstance(checks, list) and all(isinstance(check, dict) for check in checks),
                     "verification checks must be structured results")
                need([check.get("command") for check in checks] == self.declared_checks(contract),
                     "VERIFY must cover every declared verification command in order")
                need(all(type(check.get("exit")) is int for check in checks), "verification exit status is invalid")
                if verification["source"] == "executed":
                    need(all(isinstance(check.get("output_digest"), str)
                             and re.fullmatch(r"[a-f0-9]{64}", check["output_digest"]) for check in checks),
                         "executed check output digest is missing")
                if entry["outcome"] == "pass":
                    need(all(check["exit"] == 0 for check in checks), "VERIFY record contains a failing check")
            previous = digest(entry)
        return chain

    def checked_chain(self, contract):
        """Live gate operations require both intact evidence and unchanged verified outputs."""
        chain = self.chain_integrity(contract)
        for entry in chain:
            if entry["gate"] == "VERIFY":
                need(entry.get("outputs") == self.output_fingerprints(contract),
                     "declared outputs changed after VERIFY; redeclare and verify again")
        return chain

    def require_gate_chain(self, contract, mutating):
        """CLOSE requires all declared checks and the exact outputs they verified."""
        chain = self.checked_chain(contract)
        need(chain, "CLOSE requires recorded gates: run router.py record --gate WRITE/VERIFY first")
        expected = (["WRITE"] if mutating else []) + ["VERIFY"]
        need([entry["gate"] for entry in chain] == expected, "incomplete gate history: expected " + " -> ".join(expected))
        for entry in chain:
            need(entry["outcome"] == "pass", f"gate {entry['gate']} did not pass")
        return chain

    def gate_ready(self, contract, gate):
        """Check scope, approval and gate order before any verification subprocess starts."""
        need(contract.get("task") in self.index["routes"], "contract task is not a registered route")
        self.check_scope(contract, [])
        chain = self.checked_chain(contract)
        mutating = self.index["routes"][contract["task"]]["writes"] != "none"
        allowed = (["WRITE"] if mutating else []) + ["VERIFY"]
        need(len(chain) < len(allowed), "gate chain is already complete")
        expected = allowed[len(chain)]
        need(gate == expected, f"gates are recorded in order: expected {expected}, got {gate}")
        need(all(entry["outcome"] == "pass" for entry in chain), "a failed gate requires a new preflight")
        return chain

    def record_gate(self, contract, gate, outcome="pass", evidence=None, attempt=0, verification=None):
        """Record executed checks or explicit trusted-host attestation; neither authenticates the host."""
        need(gate in RECORDABLE_GATES, f"unknown gate: {gate}")
        need(outcome in {"pass", "fail"}, f"unknown outcome: {outcome}")
        chain = self.gate_ready(contract, gate)
        if gate == "VERIFY":
            exits = [int(code) for code in re.findall(r"exit\s*[:=]?\s*(-?\d+)", evidence or "")]
            need(exits, "VERIFY needs evidence that includes the command exit status")
            if verification is None:
                checks = []
                for command in self.declared_checks(contract):
                    matches = re.findall(re.escape(command) + r"\s+exit\s*[:=]?\s*(-?\d+)(?!\d)", evidence or "")
                    need(len(matches) == 1, f"host attestation needs one exit status for declared command: {command}")
                    checks.append({"command": command, "exit": int(matches[0])})
                verification = {"source": "host-attested", "checks": checks}
            if outcome == "pass":
                observed = [check["exit"] for check in verification["checks"]] or exits
                need(all(code == 0 for code in observed), "a failing check cannot be recorded as a passing VERIFY")
        entry = {"gate": gate, "outcome": outcome, "attempt": attempt,
                 "at": datetime.now(timezone.utc).isoformat(),
                 "prev": digest(chain[-1]) if chain else None,
                 "evidence": evidence,
                 "evidence_digest": hashlib.sha256((evidence or "").encode()).hexdigest()}
        if gate == "WRITE":
            entry["writes"] = list(contract["write"])
        else:
            entry["verification"] = verification
            entry["outputs"] = self.output_fingerprints(contract)
        entry["digest"] = digest(entry)
        updated = dict(contract)
        updated["gate_chain"] = chain + [entry]
        self.checked_chain(updated)
        return updated

    def verification_evidence(self, contract, command, timeout=900):
        """Validate first, then run one declared check and retain its actual output digest."""
        self.gate_ready(contract, "VERIFY")
        declared = self.declared_checks(contract)
        wanted = (command or "").strip()
        need(declared, "contract declares no verification commands")
        need(wanted in declared, f"undeclared verification command: {wanted}")
        result = subprocess.run(wanted, shell=True, cwd=self.root, capture_output=True, text=True, timeout=timeout)
        combined = (result.stdout or "") + (result.stderr or "")
        lines = [line.strip() for line in combined.splitlines() if line.strip()]
        summary = lines[-1][:200] if lines else ""
        evidence = f"{wanted} exit {result.returncode}" + (f" | {summary}" if summary else "")
        return {"command": wanted, "exit": result.returncode, "summary": summary,
                "output_digest": hashlib.sha256(combined.encode()).hexdigest(), "evidence": evidence}

    def verify_all(self, contract, attempt=0):
        """Run every required check, then append one aggregate VERIFY gate."""
        self.gate_ready(contract, "VERIFY")
        commands = self.declared_checks(contract)
        need(commands, "contract declares no verification commands")
        generated = self.project.get("rules", {}).get("generated_paths", [])
        source_outputs = {path: value for path, value in self.output_fingerprints(contract).items()
                          if not any(matches(path, pattern) for pattern in generated)}
        results = []
        for command in commands:
            results.append(self.verification_evidence(contract, command))
            current = self.output_fingerprints(contract)
            need(all(current[path] == value for path, value in source_outputs.items()),
                 "declared source outputs changed during verification; finish edits and verify again")
        passed = all(result["exit"] == 0 for result in results)
        evidence = "; ".join(f"{result['command']} exit {result['exit']}" for result in results)
        updated = self.record_gate(contract, "VERIFY", "pass" if passed else "fail", evidence, attempt,
                                   {"source": "executed", "checks": results})
        outcome = {"action": "verified" if passed else "verification_failed",
                   "exit": 0 if passed else next(result["exit"] for result in results if result["exit"] != 0),
                   "checks": results, "output_digest": digest(results),
                   "gates": [entry["gate"] for entry in updated["gate_chain"]]}
        if len(results) == 1:
            outcome.update({key: results[0][key] for key in ("command", "summary", "output_digest")})
        return outcome, updated

    def verify(self, contract, command, attempt=0):
        """Compatibility entrypoint for one-check contracts; use verify_all for a suite."""
        self.gate_ready(contract, "VERIFY")
        commands = self.declared_checks(contract)
        need(commands, "contract declares no verification commands")
        need((command or "").strip() in commands, f"undeclared verification command: {command}")
        need(len(commands) == 1, "multiple declared checks require verify --all / Router.verify_all")
        return self.verify_all(contract, attempt)

    def status(self, contract):
        """Read-only gate progress. Reports blockers instead of raising, so a host can display it."""
        self.refresh_authority()
        need(contract.get("task") in self.index["routes"], "contract task is not a registered route")
        current = self.preflight(contract["task"], contract["write"], contract["read"], contract["risk"],
                                 contract["verify"], contract["assumptions"], contract["explicit_role"],
                                 contract["intent"], contract.get("approval"), continuing=True)
        need(current["approval_key"] == contract["approval_key"], "stale or altered preflight; declare again")
        mutating = self.index["routes"][contract["task"]]["writes"] != "none"
        expected = (["WRITE"] if mutating else []) + ["VERIFY"]
        chain = self.checked_chain(contract)
        recorded = [entry.get("gate") for entry in chain]
        blockers = []
        if current["status"] != "ready":
            blockers.append("human approval pending")
        for entry in chain:
            if entry.get("outcome") != "pass":
                blockers.append(f"{entry.get('gate')} recorded as {entry.get('outcome')}")
        remaining = expected[len(recorded):]
        return {"task": contract["task"], "role": current["role"], "risk": contract.get("risk"),
                "writes": list(contract.get("write") or []), "verify": list(contract.get("verify") or []),
                "gates_recorded": recorded, "gates_remaining": remaining,
                "next_gate": remaining[0] if remaining else "CLOSE", "blockers": blockers,
                "ready_to_close": not blockers and not remaining}

    def next(self, task, after, outcome="pass", attempt=0, approval=None, contract=None, failure_kind="task", evidence=None):
        self.refresh_authority()
        need(task in self.index["routes"], f"unknown route: {task}")
        mutating = self.index["routes"][task]["writes"] != "none"
        if outcome == "fail":
            policy = self.settings["self_healing"]
            repair = mutating and policy["enabled"] and failure_kind != "authority" and after in {"CONTEXT", "WRITE", "VERIFY"} and attempt < policy["max_attempts"]
            if failure_kind == "derived":
                repair = repair and self.settings["population"]["strategy"] == "on_demand"
            return {"action": "diagnose_then_preflight" if repair else "stop",
                    "next_gate": "WRITE" if repair else None, "attempt": attempt + 1 if repair else attempt,
                    "reason": "repair only authorized task or derived artifacts; never rewrite authority or waive verification"}
        if contract is not None:
            need(contract["task"] == task, "contract task does not match transition")
            self.check_scope(contract, [])
        decision = self.route(task, check_source=contract is None)
        need(after != "WRITE" or mutating, "read-only route skips WRITE")
        need(after != "VERIFY" or evidence, "VERIFY pass requires actual evidence from the host")
        if after == "WRITE":
            need(contract is not None, "execution needs a preflight contract")
            need(contract["task"] == task, "contract task does not match transition")
            self.check_scope(contract, [])
        if after == "CLOSE":
            # Completion is refused unless the gates that led here are attested in the contract.
            need(contract is not None, "CLOSE requires the host-owned preflight contract")
            need(contract["task"] == task, "contract task does not match transition")
            self.check_scope(contract, [])
            chain = self.require_gate_chain(contract, mutating)
            if self.settings["mode"] == "human_in_loop" and "before_close" in self.settings["human_in_loop"]["checkpoints"]:
                need(isinstance(evidence, str) and evidence.strip(), "before_close requires verified close evidence")
                key = digest({"checkpoint": "before_close", "preflight": contract["approval_key"],
                              "verification": chain[-1]["digest"], "outputs": chain[-1]["outputs"],
                              "close_evidence": evidence})
                if approval != key:
                    return {"action": "waiting_for_human", "checkpoint": "before_close",
                            "next_gate": "CLOSE", "approval_key": key}
            return {"action": "complete", "next_gate": None, "mode": decision["mode"],
                    "gates": [entry["gate"] for entry in chain]}
        steps = {"BOOT": ("CONTEXT", "route_and_load"), "CONTEXT": ("WRITE" if mutating else "VERIFY", "preflight" if mutating else "inspect"),
                 "WRITE": ("VERIFY", "execute_with_contract"), "VERIFY": ("CLOSE", "reconcile_memory")}
        gate, action = steps[after]
        return {"action": action, "next_gate": gate, "mode": decision["mode"]}

    def populate(self, kind, contract=None):
        if kind == "index-codebase":
            data = {"schema_version": 1, "map": self.map_fingerprint(), "source": self.source_fingerprint()}
            output, task = MAP_INDEX, "map_codebase"
        elif kind == "seal-context":
            project = self.project.get("project", {})
            need(project.get("name") and not project["name"].startswith("<")
                 and project.get("type") and not project["type"].startswith("<")
                 and self.modules.get("modules"), "populate real project facts before sealing")
            data = {"schema_version": 1, "map": self.map_fingerprint(),
                    "context": self.context_fingerprint(), "source": self.source_fingerprint()}
            indexed = self.json(MAP_INDEX)
            need(indexed.get("map") == data["map"] and indexed.get("source") == data["source"],
                 "stale map index: remap changed evidence and index codebase first")
            output, task = SEAL, "populate_context"
        else:
            seal = self.fresh_context()
            manifest = self.manifest()
            need(manifest is not None, "populate agents requires agent addon")
            ownership = self.project.get("roles", {}).get("ownership", {})
            need(not set(ownership) - set(manifest["roles"]), "ownership names an unknown role")
            profiles = {}
            for role, config in manifest["roles"].items():
                self.read(".wisdom/agents/" + config["file"])
                globs = ownership.get(role, [])
                for glob in globs:
                    matches("", glob)  # Validate even when it matches no files.
                    need(any(p.is_file() and not p.is_symlink() and self.root in p.resolve().parents
                             and matches(p.relative_to(self.root).as_posix(), glob) for p in self.root.rglob("*")),
                         f"ownership glob matches no files: {role}: {glob}")
                profiles[role] = {"file": config["file"], "ownership": globs, "populated": bool(globs)}
            flows = {}
            for name in ("ARCHITECTURE", "CONVENTIONS", "INTEGRATIONS", "STATE", "STRUCTURE", "TESTING"):
                path = f".wisdom/agents/flow/{name}.md"
                text = self.read(path)
                need("Status: unpopulated" not in text and "TBD" not in text, f"populate role flow first: {path}")
                flows[path] = self.evidence[path]
            data = {"schema_version": 1, "context_seal": digest(seal), "manifest": digest(manifest),
                    "ownership": digest(self.project.get("roles", {})), "flows": flows, "profiles": profiles}
            output, task = self.settings["population"]["registry"], "populate_agents"
        if contract is None:
            return {"action": "preview", "task": task, "write": [output, EVENTS], "data": data}
        need(contract["task"] == task, "population needs its own route contract")
        self.check_scope(contract, [output, EVENTS])
        # The host has already displayed the declaration before invoking this mutation.
        # Publish the artifact atomically; the append-only event log follows it.
        write_artifact(self.path(output, write=True), json.dumps(data, indent=2) + "\n")
        with self.path(EVENTS, write=True).open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"at": datetime.now(timezone.utc).isoformat(), "agent": "router",
                                     "task": task, "result": kind, "files": [output]}) + "\n")
        return {"action": "populated", "files": [output, EVENTS]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", type=Path, default=Path(__file__).resolve().parent.parent)
    commands = parser.add_subparsers(dest="command", required=True)
    command = commands.add_parser("agent", help="Start, checkpoint, verify or resume one agent")
    command.add_argument("argv", nargs=argparse.REMAINDER)
    command = commands.add_parser("orchestrate", help="Run indexed task, isolation and handoff operations")
    command.add_argument("argv", nargs=argparse.REMAINDER)
    for name in ("route", "preflight", "next"):
        command = commands.add_parser(name)
        command.add_argument("--task", required=True, help="Effect classified by the host; advice is read_only")
        if name != "next":
            command.add_argument("--role")
            command.add_argument("--intent")
        if name == "route":
            command.add_argument("--path", action="append", default=[])
        if name == "preflight":
            for flag in ("write", "read", "verify", "assumption"):
                command.add_argument("--" + flag, action="append", default=[])
            command.add_argument("--risk", choices=("low", "medium", "high"), default="low")
            command.add_argument("--approval")
            command.add_argument("--previous-contract", type=Path, help="Host-owned contract for amending an active task")
        if name == "next":
            command.add_argument("--after", choices=("BOOT", "CONTEXT", "WRITE", "VERIFY", "CLOSE"), required=True)
            command.add_argument("--outcome", choices=("pass", "fail"), default=None,
                                 help="Explicit gate outcome; required for VERIFY and CLOSE")
            command.add_argument("--attempt", type=int, default=0)
            command.add_argument("--approval")
            command.add_argument("--contract", type=Path)
            command.add_argument("--failure-kind", choices=("task", "derived", "authority"), default="task")
            command.add_argument("--evidence", help="Actual verification result or its digest, supplied by the host")
    command = commands.add_parser("check-scope")
    command.add_argument("--contract", type=Path, required=True)
    command.add_argument("--path", action="append", default=[])
    command.add_argument("--other-write", action="append", default=[])
    command = commands.add_parser("record", help="Append one attested gate entry to a host-owned contract")
    command.add_argument("--contract", type=Path, required=True)
    command.add_argument("--gate", choices=RECORDABLE_GATES, required=True)
    command.add_argument("--outcome", choices=("pass", "fail"), default="pass")
    command.add_argument("--evidence")
    command.add_argument("--attempt", type=int, default=0)
    command = commands.add_parser("verify", help="Run a command the contract declares, then attest VERIFY")
    command.add_argument("--contract", type=Path, required=True)
    checks = command.add_mutually_exclusive_group(required=True)
    checks.add_argument("--cmd", help="Run the sole declared verification command")
    checks.add_argument("--all", action="store_true", help="Run every declared verification command")
    command.add_argument("--attempt", type=int, default=0)
    command = commands.add_parser("status", help="Read-only gate progress for a contract")
    command.add_argument("--contract", type=Path, required=True)
    command.add_argument("--card", action="store_true", help="Print the monochrome gate card")
    for name in ("index-codebase", "seal-context", "populate-agents"):
        command = commands.add_parser(name)
        command.add_argument("--apply", action="store_true")
        command.add_argument("--contract", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "agent":
            spec = importlib.util.spec_from_file_location(
                "wisdom_session", Path(__file__).with_name("session.py"))
            runtime = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(runtime)
            return runtime.main(args.target, args.argv)
        if args.command == "orchestrate":
            spec = importlib.util.spec_from_file_location(
                "wisdom_orchestration", Path(__file__).with_name("orchestration.py"))
            runtime = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(runtime)
            return runtime.main(args.target, args.argv, Router)
        router = Router(args.target)
        contract = parse_json(args.contract.read_text()) if getattr(args, "contract", None) else None
        if args.command == "route":
            result = router.route(args.task, args.path, args.role, args.intent)
        elif args.command == "preflight":
            previous = parse_json(args.previous_contract.read_text()) if args.previous_contract else None
            result = router.preflight(args.task, args.write, args.read, args.risk, args.verify, args.assumption, args.role, args.intent, args.approval, previous=previous)
        elif args.command == "next":
            need(args.attempt >= 0, "attempt cannot be negative")
            need(args.after not in {"VERIFY", "CLOSE"} or args.outcome is not None,
                 "next --after VERIFY/CLOSE requires an explicit --outcome pass|fail")
            result = router.next(args.task, args.after, args.outcome or "pass", args.attempt, args.approval, contract, args.failure_kind, args.evidence)
        elif args.command == "check-scope":
            result = router.check_scope(contract, args.path, args.other_write)
        elif args.command == "record":
            need(args.attempt >= 0, "attempt cannot be negative")
            updated = router.record_gate(contract, args.gate, args.outcome, args.evidence, args.attempt)
            write_artifact(args.contract, json.dumps(updated, indent=2) + "\n")
            result = {"action": "recorded", "gate": args.gate, "contract": str(args.contract),
                      "gates": [entry["gate"] for entry in updated["gate_chain"]]}
        elif args.command == "verify":
            need(args.attempt >= 0, "attempt cannot be negative")
            outcome, updated = router.verify_all(contract, args.attempt) if args.all else router.verify(contract, args.cmd, args.attempt)
            write_artifact(args.contract, json.dumps(updated, indent=2) + "\n")
            result = dict(outcome, contract=str(args.contract))
        elif args.command == "status":
            state = router.status(contract)
            if args.card:
                print(render_card(state))
                return 1 if state["blockers"] else 0
            result = state
        else:
            need(not args.apply or contract is not None, "--apply requires --contract")
            result = router.populate(args.command, contract if args.apply else None)
        print(json.dumps(result, indent=2))
        if result.get("action") == "verification_failed":
            return 3
        return 2 if result.get("status") == "waiting_for_human" or result.get("action") == "waiting_for_human" else 0
    except Exception as exc:
        print(json.dumps({"action": "stop", "error": str(exc)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
