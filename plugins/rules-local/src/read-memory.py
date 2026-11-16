"""Trusted bounded observation of project rules. Never imports selected project code."""
import hashlib
import fnmatch
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys
import time
from datetime import datetime, timezone
from contextlib import closing
from urllib.parse import quote

import yaml

MAX_SOURCE = 2 * 1024 * 1024
MAX_RECORD = 2 * 1024 * 1024
HASH = re.compile(r"^[a-f0-9]{64}$")
PIN = re.compile(r'^\[([^\]]+)\]:\s+(\S+)\s+["\']sha256:([a-f0-9]{64})["\']\s*$', re.M)
NUMBER = re.compile(r"^(?:#{1,6}\s+)?(\d+)[.)]\s+(.+)$")
COLUMNS = {"sessions": ["id", "revision", "data"],
           "memory": ["kind", "key", "body", "task_id", "updated_at"],
           "events": ["seq", "task_id", "action", "payload", "at"],
           "claims": ["path", "task_id"]}
PLAN_COLUMNS = {"capabilities": ["id", "revision", "body"],
                "steps": ["id", "revision", "parent", "kind", "effect", "owner", "title", "body"],
                "step_dependencies": ["step", "needs"]}


class Unsafe(ValueError):
    pass


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate mapping key")
        result[key] = value
    return result


def json_value(text):
    value = json.loads(text, object_pairs_hook=unique,
                       parse_constant=lambda value: (_ for _ in ()).throw(ValueError("nonfinite JSON")))
    if not isinstance(value, dict):
        raise ValueError("JSON root must be an object")
    return value


def yaml_value(text):
    class Loader(yaml.SafeLoader):
        pass
    Loader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
                           lambda loader, node: unique(loader.construct_pairs(node)))
    value = yaml.load(text, Loader=Loader)
    if not isinstance(value, dict):
        raise ValueError("configuration must be a mapping")
    return value


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     allow_nan=False).encode()).hexdigest()


class Reader:
    def __init__(self, root, project):
        self.root = Path(root).resolve(strict=True)
        self.project = project
        self.deadline = time.monotonic() + 4.5
        self.warnings = []
        self.sources = {}
        self.hashes = {}
        self.hash_bytes = 0
        self.protected = []
        self.base = None
        self.version = None
        self.reported_checks = []
        self.definition_source = None
        self.references = {}
        self.reference_bytes = 0
        self.harness_sources = set()
        self.harness = {
            "health": {"status": "unavailable", "issues": []},
            "memory": {"integrity": "unavailable", "groups": [], "stages": [],
                       "freshness": dict(current=0, stale=0, missing=0, unverified=0, scanned=0, truncated=False)},
            "routing": dict(status="unavailable", owners=0, profiles=0, skills=0),
            "gates": [],
            "memoryGraph": dict(status="unavailable", graph=dict(items=[], edges=[]), tables=[],
                                truncated=False, snapshotId=digest({"status": "unavailable"})),
        }

    def issue(self, text):
        issues = self.harness["health"]["issues"]
        if text not in issues and len(issues) < 64:
            issues.append(text[:500])

    def routing(self):
        """Inspect configuration as data; never import the project's agent runtime."""
        try:
            registry = ".context/modules/registry.yaml"
            profiles_path = ".wisdohm/config/agents.yaml"
            self.harness_sources.update((registry, profiles_path, ".wisdohm/orchestration.py"))
            self.source(registry, "Canonical ownership")
            self.source(profiles_path, "Ownership agent profiles")
            self.source(".wisdohm/orchestration.py", "Owner routing loader")
            modules = yaml_value(self.read(registry).decode()).get("modules")
            config = yaml_value(self.read(profiles_path).decode())
            profiles = config.get("profiles")
            if yaml_value(self.read(".wisdohm/config/project.yaml").decode()).get("ownership"):
                raise ValueError("ownership assignments belong only to the canonical registry")
            if (set(config) != {"schema_version", "profiles"}
                    or type(config.get("schema_version")) is not int or config["schema_version"] != 1
                    or not isinstance(modules, dict) or not modules or len(modules) > 256
                    or not isinstance(profiles, dict) or not profiles or len(profiles) > 64):
                raise ValueError("invalid or oversized ownership/profile configuration")
            skills = set()
            for name, profile in profiles.items():
                if (not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", name)
                        or not isinstance(profile, dict) or set(profile) != {"description", "skills"}
                        or not isinstance(profile["description"], str) or not profile["description"].strip()
                        or not isinstance(profile["skills"], list) or not 0 < len(profile["skills"]) <= 32
                        or not all(isinstance(skill, str) for skill in profile["skills"])
                        or len(set(profile["skills"])) != len(profile["skills"])):
                    raise ValueError("invalid agent profile")
                skills.update(profile["skills"])
            if len(skills) > 128:
                raise ValueError("too many profile skills")
            for skill in sorted(skills):
                if Path(skill).name != "SKILL.md" or not self.read(skill).strip():
                    raise ValueError("missing or empty profile skill: " + skill)
                if skill.startswith(".agents/"):
                    self.harness_sources.add(skill)
                    self.source(skill, "Ownership skill")
            for owner, module in modules.items():
                if (not isinstance(owner, str) or not isinstance(module, dict)
                        or module.get("agent") not in profiles
                        or not isinstance(module.get("paths"), list) or not module["paths"]
                        or not all(isinstance(path, str) and path and not path.startswith("/")
                                   and ".." not in Path(path).parts and "\\" not in path for path in module["paths"])
                        or len(set(module["paths"])) != len(module["paths"])):
                    raise ValueError("owner has invalid profile or paths")
            # Read the loader as text only. Its existence is part of the installed harness.
            self.read(".wisdohm/orchestration.py")
            self.harness["routing"] = dict(status="valid", owners=len(modules), profiles=len(profiles), skills=len(skills))
        except FileNotFoundError as error:
            self.issue("Ownership routing is unavailable: " + str(error))
        except (OSError, ValueError, TypeError, yaml.YAMLError) as error:
            self.harness["routing"]["status"] = "invalid"
            self.issue("Ownership routing is invalid: " + str(error))

    def sql_routing(self, connection):
        """Inspect committed 2.7 capabilities, never the selected project's code."""
        try:
            rows = list(connection.execute(
                "SELECT id,revision,CASE WHEN typeof(body)='text' AND length(CAST(body AS BLOB))<=? "
                "THEN body ELSE NULL END FROM capabilities ORDER BY id LIMIT 257", (MAX_RECORD,)))
            if len(rows) > 256:
                raise ValueError("capability inspection is limited to 256 owners")
            capabilities = {}
            consumed = 0
            for identity, revision, raw in rows:
                if (not isinstance(identity, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", identity)
                        or type(revision) is not int or revision < 1 or not isinstance(raw, str)):
                    raise ValueError("invalid capability identity, revision or body")
                consumed += len(raw.encode())
                if consumed > 8 * 1024 * 1024:
                    raise ValueError("capability inspection exceeded 8 MiB")
                body = json_value(raw)
                if (set(body) - {"purpose", "paths", "public", "uses", "guidance", "archived"}
                        or not isinstance(body.get("purpose"), str) or not body["purpose"].strip()
                        or type(body.get("archived", False)) is not bool):
                    raise ValueError("invalid capability fields")
                for field in ("paths", "public", "uses", "guidance"):
                    values = body.get(field, [])
                    if (not isinstance(values, list) or len(values) > 1000
                            or not all(isinstance(value, str) and value for value in values)
                            or len(set(values)) != len(values)):
                        raise ValueError("invalid capability " + field)
                    body[field] = values
                for path in body["paths"]:
                    if path.startswith("/") or ".." in Path(path).parts or "\\" in path or "\0" in path:
                        raise ValueError("unsafe capability path")
                for path in body["public"] + body["guidance"]:
                    self.path(path)
                if not body.get("archived"):
                    capabilities[identity] = body
            visiting, visited = set(), set()
            def visit(identity):
                if identity in visiting or identity not in capabilities:
                    raise ValueError("cyclic or missing capability dependency")
                if identity in visited:
                    return
                visiting.add(identity)
                for target in capabilities[identity]["uses"]:
                    visit(target)
                visiting.remove(identity)
                visited.add(identity)
            def owns(path, body):
                return any((path == pattern[:-1] or path.startswith(pattern)) if pattern.endswith("/")
                           else (fnmatch.fnmatchcase(path, pattern) or
                                 pattern.startswith("**/") and fnmatch.fnmatchcase(path, pattern[3:]))
                           for pattern in body["paths"])
            for identity, body in capabilities.items():
                visit(identity)
                for path in body["public"]:
                    if [owner for owner, candidate in capabilities.items() if owns(path, candidate)] != [identity]:
                        raise ValueError("public file has ambiguous or incorrect capability ownership")
            # Stock 2.7 capabilities have no agent/profile field. Retained YAML is
            # compatibility data for app consumers, not execution ownership here.
            self.harness["routing"] = dict(status="valid" if capabilities else "unavailable",
                                            owners=len(capabilities), profiles=0, skills=0)
            if not capabilities:
                self.issue("No committed SQL capabilities are available for execution routing.")
            self.warn("Execution routing is observed from SQL capabilities; legacy app profiles are not SQL assignments.")
        except (OSError, ValueError, TypeError, sqlite3.Error, RecursionError) as error:
            self.harness["routing"] = dict(status="invalid", owners=0, profiles=0, skills=0)
            self.issue("SQL capability routing is invalid: " + str(error))

    def definition_observations(self):
        """Decode selected definitions as bounded data, using no project imports."""
        authority = '.agents/plans/authority.yaml'
        if not self.exists(authority):
            return
        self.source(authority, 'Definition authority selection')
        self.definition_source = 'invalid'
        try:
            manifest = yaml_value(self.read(authority).decode())
            if (set(manifest) != {'schema_version', 'definitions'}
                    or type(manifest.get('schema_version')) is not int or manifest['schema_version'] != 1
                    or manifest.get('definitions') not in {'files', 'legacy'}):
                raise ValueError('unsupported definition authority manifest')
            self.definition_source = manifest['definitions']
            if manifest['definitions'] == 'legacy':
                return
            total = 0
            def document(name):
                nonlocal total
                raw = self.read(name)
                total += len(raw)
                if total > 32 * 1024 * 1024:
                    raise ValueError('definition inspection exceeded 32 MiB')
                value = yaml_value(raw.decode())
                if type(value.get('schema_version')) is not int or value['schema_version'] != 1:
                    raise ValueError('unsupported definition version: ' + name)
                self.source(name, 'Selected agent definition')
                return value
            def collection(pattern, key, maximum):
                names = []
                for path in self.root.glob(pattern):
                    names.append(path.relative_to(self.root).as_posix())
                    if len(names) > maximum:
                        raise ValueError('definition inspection is limited to %s %s' % (maximum, key))
                values = {}
                for name in sorted(names):
                    value = document(name)
                    identity = value.get(key)
                    if not isinstance(identity, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,95}', identity) or identity in values:
                        raise ValueError('invalid or duplicate definition identity')
                    values[identity] = value
                if not values:
                    raise ValueError('unpopulated definition collection: ' + key)
                return values
            roles = collection('.agents/agents/*/agent.yaml', 'id', 64)
            workflows = collection('.agents/workflows/*/workflow.yaml', 'kind', 64)
            owners = collection('.agents/ownership/*/*.yaml', 'id', 256)
            guidance = set()
            for role in roles.values():
                if set(role) != {'schema_version', 'id', 'purpose', 'instructions', 'skills'} or not isinstance(role['skills'], list):
                    raise ValueError('invalid agent role')
                guidance.add(role['instructions'])
                guidance.update(role['skills'])
            for workflow in workflows.values():
                if (set(workflow) != {'schema_version', 'kind', 'agent', 'procedure', 'guidance', 'verification'}
                        or workflow['agent'] not in roles or not isinstance(workflow['procedure'], list)
                        or not workflow['procedure'] or not isinstance(workflow['guidance'], list)
                        or not isinstance(workflow['verification'], dict)):
                    raise ValueError('invalid workflow')
                guidance.update(workflow['guidance'])
            for owner in owners.values():
                if (set(owner) - {'schema_version', 'id', 'purpose', 'paths', 'public', 'uses', 'guidance', 'group'}
                        or not isinstance(owner.get('purpose'), str) or not owner['purpose'].strip()):
                    raise ValueError('invalid segmented ownership')
                for field in ('paths', 'public', 'uses', 'guidance'):
                    values = owner.get(field)
                    if (not isinstance(values, list) or len(values) > 1000
                            or not all(isinstance(value, str) and value for value in values)
                            or len(set(values)) != len(values)):
                        raise ValueError('invalid ownership ' + field)
                if not owner['paths'] or any(value not in owners for value in owner['uses']):
                    raise ValueError('invalid ownership dependencies or paths')
                for name in owner['paths'] + owner['public'] + owner['guidance']:
                    self.path(name)
                guidance.update(owner['guidance'])
            catalog = document('.agents/plans/catalog.yaml')
            if set(catalog) != {'schema_version', 'goals', 'milestones', 'slices', 'steps'} or not isinstance(catalog['steps'], list) or len(catalog['steps']) > 10000:
                raise ValueError('invalid or oversized plan catalog')
            steps = {}
            for reference in catalog['steps']:
                if (not isinstance(reference, dict) or not {'id', 'path', 'agent'} <= set(reference)
                        or set(reference) - {'id', 'path', 'agent', 'legacy_effect', 'children', 'verification_explicit'}):
                    raise ValueError('invalid step reference')
                name = reference['path']
                if not isinstance(name, str) or not name.startswith('.agents/plans/') or not name.endswith('/step.yaml'):
                    raise ValueError('step must be in its plan folder')
                step = document(name)
                required = {'schema_version', 'id', 'title', 'outcome', 'kind', 'effect', 'read', 'write', 'needs', 'acceptance', 'verification'}
                if (not required <= set(step) or set(step) - required - {'owner', 'slice', 'parent', 'mode', 'feature', 'ui', 'spec'}
                        or step['id'] != reference['id'] or step['id'] in steps or step['kind'] not in workflows
                        or step.get('owner') and step['owner'] not in owners
                        or step['effect'] not in {'inspect', 'plan', 'change_source'}):
                    raise ValueError('invalid selected step: ' + str(reference['id']))
                for field in ('read', 'write', 'needs', 'acceptance'):
                    values = step[field]
                    if not isinstance(values, list) or len(values) > 1000 or not all(isinstance(value, str) and value for value in values):
                        raise ValueError('invalid step ' + field)
                for name in step['read'] + step['write']:
                    self.path(name)
                verification = step['verification']
                if (not isinstance(verification, dict) or set(verification) != {'level', 'reason', 'checks'}
                        or verification['level'] not in {'review', 'smoke', 'targeted', 'integration'}
                        or not isinstance(verification['reason'], str) or not verification['reason'].strip()
                        or not isinstance(verification['checks'], list)
                        or bool(verification['checks']) == (verification['level'] == 'review')):
                    raise ValueError('invalid verification policy')
                steps[step['id']] = step
            for step in steps.values():
                if any(name not in steps for name in step['needs']) or step.get('parent') and step['parent'] not in steps:
                    raise ValueError('missing step prerequisite or parent')
            def acyclic(graph):
                incoming = {key: len(set(values)) for key, values in graph.items()}
                downstream = {key: set() for key in graph}
                for key, values in graph.items():
                    for dependency in values:
                        if dependency not in downstream:
                            raise ValueError('missing definition dependency')
                        downstream[dependency].add(key)
                ready = [key for key, count in incoming.items() if count == 0]
                seen = 0
                while ready:
                    if time.monotonic() > self.deadline:
                        raise ValueError('definition inspection deadline exceeded')
                    key = ready.pop()
                    seen += 1
                    for dependant in downstream[key]:
                        incoming[dependant] -= 1
                        if incoming[dependant] == 0:
                            ready.append(dependant)
                if seen != len(graph):
                    raise ValueError('cyclic definition dependencies')
            acyclic({key: owner['uses'] for key, owner in owners.items()})
            acyclic({key: step['needs'] for key, step in steps.items()})
            acyclic({key: [step['parent']] if step.get('parent') else [] for key, step in steps.items()})
            comparisons, routes = 0, {}
            pattern_count = sum(len(owner['paths']) for owner in owners.values())
            def owners_of(name):
                nonlocal comparisons
                if name in routes:
                    return routes[name]
                comparisons += pattern_count
                if comparisons > 250000:
                    raise ValueError('ownership routing comparison limit exceeded')
                routes[name] = [key for key, owner in owners.items() if any(
                    (name == pattern[:-1] or name.startswith(pattern)) if pattern.endswith('/') else
                    fnmatch.fnmatchcase(name, pattern) or pattern.startswith('**/') and fnmatch.fnmatchcase(name, pattern[3:])
                    for pattern in owner['paths'])]
                return routes[name]
            for key, owner in owners.items():
                for name in owner['public']:
                    if owners_of(name) != [key]:
                        raise ValueError('ambiguous public ownership or routing comparison limit')
            for step in steps.values():
                for name in step['write']:
                    if owners_of(name) != [step.get('owner')]:
                        raise ValueError('step write ownership is ambiguous or exceeds comparison limit')
            for name in sorted(guidance):
                raw = self.read(name)
                total += len(raw)
                if not raw.strip() or b'\0' in raw or total > 32 * 1024 * 1024:
                    raise ValueError('empty or oversized definition guidance')
            self.harness['routing'] = dict(status='valid', owners=len(owners), profiles=len(roles), skills=len(guidance))
            self.warn('Selected file definitions decoded as data: %s steps, %s roles, %s workflows, %s owners; this is observation, not execution approval.' % (len(steps), len(roles), len(workflows), len(owners)))
        except (OSError, ValueError, TypeError, KeyError, yaml.YAMLError) as error:
            self.harness['routing'] = dict(status='invalid', owners=0, profiles=0, skills=0)
            self.issue('Agent-home definitions are invalid or incomplete: ' + str(error))
            if authority in self.sources:
                self.sources[authority]['status'] = 'invalid'

    def workflow_observations(self, connection):
        """Reported workflow is root-local; public project IDs are DTO aliases."""
        rows = list(connection.execute("SELECT revision,CASE WHEN typeof(body)='text' AND length(CAST(body AS BLOB))<=? THEN body ELSE NULL END FROM workflow WHERE project_id=? LIMIT 1", (MAX_RECORD, "default")))
        for revision, raw in rows:
            if type(revision) is not int or revision < 1 or not isinstance(raw, str):
                raise ValueError('invalid or oversized workflow report')
            body = json_value(raw)
            reports = body.get('states')
            if type(body.get('schemaVersion')) is not int or body['schemaVersion'] != 1 or type(body.get('revision')) is not int or body['revision'] < 0 or not isinstance(reports, dict) or len(reports) > 10000:
                raise ValueError('invalid workflow report body')
            self.warn('Operational workflow storage revision %s, report revision %s contains %s reported statuses; reported completion is not verified execution.' % (revision, body['revision'], len(reports)))
            for identity, report in list(reports.items())[:100]:
                if (not isinstance(identity, str) or not isinstance(report, dict) or report.get('provenance') != 'reported'
                        or report.get('status') not in {'pending', 'running', 'review', 'complete'}
                        or not isinstance(report.get('note'), str) or len(report['note']) > 4000
                        or not isinstance(report.get('definitionDigest'), str) or not HASH.fullmatch(report['definitionDigest'])):
                    raise ValueError('invalid reported workflow status')
                self.reported_checks.append(dict(id='reported:' + identity[:80], sessionId='workflow-report',
                    command='Reported workflow: ' + identity[:80] + ' — ' + report['status'], result='unknown',
                    freshness='unverified', reason='Reported by ' + str(report.get('reportedBy', 'unknown'))[:80] + '. ' + report['note'][:3500] + ' This report is not assessed, verified or integrated evidence.', evidence=[]))
            if len(reports) > 100:
                self.warn('Reported workflow display is limited to 100 rows; remaining reports are not inspected.')

    def assessment_observations(self, states):
        assessments = []
        for state in states:
            assessment, plan = state.get('assessment'), state.get('plan')
            if not isinstance(assessment, dict) or not isinstance(plan, dict):
                continue
            text, actor, contract = assessment.get('text'), assessment.get('actor'), assessment.get('contract')
            identity, recorded = plan.get('step'), state.get('updated_at')
            if (not isinstance(text, str) or not text.strip() or not isinstance(actor, str) or not actor.strip()
                    or not isinstance(contract, str) or not HASH.fullmatch(contract) or not isinstance(identity, str)
                    or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,95}', identity) or not isinstance(recorded, str)):
                self.warn('Malformed acceptance assessment; it was not promoted to evidence.')
                continue
            try:
                moment = datetime.fromisoformat(recorded.replace('Z', '+00:00'))
                if moment.tzinfo is None:
                    raise ValueError('assessment timestamp needs timezone')
                recorded = moment.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
            except ValueError:
                continue
            historical = state.get('stage') == 'IMPORTED' or state.get('root') != str(self.root) or bool(state.get('_legacy'))
            assessments.append(dict(schema_version=1, step_id=identity, definition_digest=contract,
                actor=actor[:4000], recorded_at=recorded, kind='assessed', accepted=False,
                assessment=('Historical assessment. ' if historical else 'Recorded acceptance assessment. ') + text[:3600] + ' The read-only observer has not assessed its SQL step/scoped-memory binding; acceptance remains unverified.'))
        return assessments[:100]

    def memory_observations(self, connection, states, total):
        observed = self.harness["memory"]
        groups = list(connection.execute("SELECT kind,count(*) FROM memory GROUP BY kind ORDER BY kind LIMIT 33"))
        observed["groups"] = [{"kind": str(kind)[:80], "count": count} for kind, count in groups[:32]]
        if len(groups) > 32:
            self.issue("Memory kind summary is limited to 32 groups.")
        stages = {}
        for state in states:
            stage = state.get("stage")
            if isinstance(stage, str) and stage:
                stage = stage[:80]
                stages[stage] = stages.get(stage, 0) + 1
        observed["stages"] = [{"stage": stage, "count": count} for stage, count in sorted(stages.items())[:32]]
        if len(states) < total:
            self.issue("Session stages cover %s of %s sessions; remaining stages were not inspected." % (len(states), total))
        fresh = observed["freshness"]
        consumed = 0
        for index, (raw,) in enumerate(connection.execute(
                "SELECT CASE WHEN typeof(body)='text' AND length(CAST(body AS BLOB))<=? THEN body ELSE NULL END "
                "FROM memory ORDER BY kind,key LIMIT 201", (MAX_RECORD,))):
            if index == 200 or (isinstance(raw, str) and consumed + len(raw.encode()) > 16 * 1024 * 1024):
                fresh["truncated"] = True
                break
            try:
                if not isinstance(raw, str):
                    raise ValueError("malformed or oversized memory observation")
                consumed += len(raw.encode())
                body = json_value(raw)
                if body.get("legacy") or not body.get("source_path"):
                    continue
                fresh["scanned"] += 1
                if not isinstance(body.get("sha256"), str) or not HASH.fullmatch(body["sha256"]):
                    fresh["unverified"] += 1
                    continue
                item, same, safe = self.evidence(body["source_path"], body["sha256"])
                state = "unverified" if not safe else "current" if same else "missing" if item["status"] == "missing" else "stale"
                fresh[state] += 1
                if not safe:
                    fresh["truncated"] = True
            except (ValueError, TypeError):
                fresh["scanned"] += 1
                fresh["unverified"] += 1
                self.issue("A memory observation is malformed or too large; freshness is incomplete.")
        if fresh["truncated"]:
            self.issue("Memory freshness inspection is bounded; some observations or files were not verified.")
        if fresh["stale"] or fresh["missing"] or fresh["unverified"]:
            self.issue("Memory source observations include stale, missing or unverified evidence.")

    def memory_graph(self, connection):
        """A bounded view of actual rows and declared task_id foreign keys, never SQL execution input."""
        items, edges, tables = [], [], []
        schema = connection.execute("PRAGMA user_version").fetchone()[0]
        root = "wisdohm:sqlite"
        truncated = False
        consumed = 0
        references = []
        session_nodes = set()

        def node(identity, label, parent, detail, kind="symbol"):
            items.append(dict(id=identity, label=str(label)[:240], kind=kind, parentId=parent,
                              detail=str(detail)[:4096]))

        def row_id(table, key):
            return "wisdohm:row:" + table + ":" + digest(key)[:24]

        def metadata(raw, fields):
            nonlocal consumed, truncated
            if not isinstance(raw, str) or consumed + len(raw.encode()) > 16 * 1024 * 1024:
                truncated = True
                return {"inspection": "Record body is oversized or outside the inspection budget."}
            consumed += len(raw.encode())
            try:
                value = json_value(raw)
                result = {field: value[field] for field in fields if field in value and
                          (value[field] is None or isinstance(value[field], (str, bool, int, float)))}
                if isinstance(value.get("text"), str):
                    result["text_excerpt"] = value["text"][:1024]
                    result["text_excerpt_truncated"] = len(value["text"]) > 1024
                return result
            except ValueError:
                truncated = True
                return {"inspection": "Record body is malformed; metadata is unavailable."}

        node(root, "WISDOHM SQLite memory", None, "Read-only observed database rows. Arrows are task_id references, not task execution flows.", "group")
        for table in ("sessions", "memory", "events", "claims"):
            parent = "wisdohm:table:" + table
            total = connection.execute("SELECT count(*) FROM " + table).fetchone()[0]
            tables.append(dict(table=table, total=total, shown=0))
            node(parent, table, root, "%s rows in the database; at most 32 recent rows are sampled." % total, "group")
            foreign = table != "sessions" and any(row[2:5] == ("sessions", "task_id", "id")
                for row in connection.execute("PRAGMA foreign_key_list(" + table + ")"))
            if table == "sessions":
                rows = connection.execute("SELECT id,revision,CASE WHEN typeof(data)='text' AND length(CAST(data AS BLOB))<=? THEN data ELSE NULL END FROM sessions ORDER BY rowid DESC LIMIT 32", (MAX_RECORD,))
                for identity, revision, raw in rows:
                    if not isinstance(identity, str) or type(revision) is not int:
                        truncated = True
                        self.issue("A sampled session has invalid identity metadata.")
                        continue
                    detail = dict(id=identity, revision=revision, **metadata(raw, ("stage", "owner", "task", "summary", "updated_at", "provenance", "_legacy")))
                    node(row_id(table, identity), identity, parent, json.dumps(detail, ensure_ascii=False))
                    session_nodes.add(identity)
                    tables[-1]["shown"] += 1
            elif table == "memory":
                groups = {}
                rows = connection.execute("SELECT kind,key,task_id,updated_at,CASE WHEN typeof(body)='text' AND length(CAST(body AS BLOB))<=? THEN body ELSE NULL END FROM memory ORDER BY updated_at DESC,kind,key LIMIT 32", (MAX_RECORD,))
                for kind, key, task, at, raw in rows:
                    if not all(isinstance(value, str) for value in (kind, key, task, at)):
                        truncated = True
                        self.issue("A sampled memory row has invalid identity metadata.")
                        continue
                    if kind not in groups:
                        group = "wisdohm:kind:" + digest(kind)[:24]
                        groups[kind] = group
                        count = connection.execute("SELECT count(*) FROM memory WHERE kind=?", (kind,)).fetchone()[0]
                        node(group, "%s (%s)" % (kind, count), parent, "Actual memory.kind grouping; record children are a bounded sample.", "group")
                    identity = row_id(table, [kind, key])
                    detail = dict(kind=kind, key=key, task_id=task, updated_at=at,
                                  **metadata(raw, ("source_path", "sha256", "provenance", "evidence", "legacy")))
                    node(identity, key, groups[kind], json.dumps(detail, ensure_ascii=False))
                    if foreign:
                        references.append((identity, task))
                    tables[-1]["shown"] += 1
            elif table == "events":
                rows = connection.execute("SELECT seq,task_id,action,at,CASE WHEN typeof(payload)='text' AND length(CAST(payload AS BLOB))<=? THEN payload ELSE NULL END FROM events ORDER BY seq DESC LIMIT 32", (MAX_RECORD,))
                for seq, task, action, at, raw in rows:
                    if (type(seq) is not int or not all(isinstance(value, str) for value in (action, at))
                            or (not isinstance(task, str) and not (schema in (2, 3) and task is None))):
                        truncated = True
                        self.issue("A sampled event has invalid identity metadata.")
                        continue
                    identity = row_id(table, seq)
                    detail = dict(seq=seq, task_id=task, action=action, at=at,
                                  **metadata(raw, ("stage", "summary", "revision", "next", "provenance")))
                    node(identity, "%s · %s" % (seq, action), parent, json.dumps(detail, ensure_ascii=False))
                    if foreign and task is not None:
                        references.append((identity, task))
                    tables[-1]["shown"] += 1
            else:
                for path, task in connection.execute("SELECT path,task_id FROM claims ORDER BY path LIMIT 32"):
                    if not all(isinstance(value, str) for value in (path, task)):
                        truncated = True
                        self.issue("A sampled claim has invalid identity metadata.")
                        continue
                    identity = row_id(table, path)
                    node(identity, path, parent, json.dumps(dict(path=path, task_id=task), ensure_ascii=False))
                    if foreign:
                        references.append((identity, task))
                    tables[-1]["shown"] += 1
            truncated = truncated or tables[-1]["shown"] < total
        for identity, task in references:
            if task not in session_nodes:
                exists = connection.execute("SELECT 1 FROM sessions WHERE id=?", (task,)).fetchone()
                if not exists:
                    self.issue("A sampled task_id reference has no session row; no relationship edge was invented.")
                    truncated = True
                    continue
                node(row_id("sessions", task), task, "wisdohm:table:sessions",
                     "Referenced session row exists outside the recent sample. Its body and stage were not inspected.")
                session_nodes.add(task)
                tables[0]["shown"] += 1
            edges.append(dict(id="wisdohm:fk:" + digest([identity, task])[:24], source=identity,
                              target=row_id("sessions", task), kind="requires", label="task_id → id", evidence=[]))
        graph = dict(items=items, edges=edges)
        self.harness["memoryGraph"] = dict(status="ready", graph=graph, tables=tables,
                                            truncated=truncated, snapshotId=digest(dict(graph=graph, tables=tables)))

    def warn(self, text):
        if text not in self.warnings and len(self.warnings) < 64:
            self.warnings.append(text[:500])

    def path(self, relative):
        if (not isinstance(relative, str) or not relative or len(relative) > 1024
                or "\\" in relative or "\0" in relative or relative.startswith("/")
                or any(part in {"", ".", ".."} for part in relative.split("/"))):
            raise Unsafe("expected a canonical project-relative path")
        for pattern in self.protected:
            if fnmatch.fnmatchcase(relative, pattern) or (pattern.endswith("/") and relative.startswith(pattern)):
                raise Unsafe("protected project path")
        path = self.root
        for part in relative.split("/"):
            if part.lower() in {".git", "secrets"} or part.lower().startswith(".env"):
                raise Unsafe("protected path")
            path = path / part
            try:
                info = path.lstat()
            except FileNotFoundError:
                continue
            if stat.S_ISLNK(info.st_mode) or not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
                raise Unsafe("symlink or special file")
        return path

    def read(self, relative, limit=MAX_SOURCE):
        if time.monotonic() > self.deadline:
            raise ValueError("inspection deadline exceeded")
        path = self.path(relative)
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise Unsafe("expected an unlinked-safe regular file")
            if info.st_size > limit:
                raise ValueError("file exceeds inspection size limit")
            with os.fdopen(fd, "rb", closefd=False) as stream:
                raw = stream.read(limit + 1)
            if len(raw) > limit:
                raise ValueError("file exceeds inspection size limit")
            return raw
        finally:
            os.close(fd)

    def exists(self, relative):
        # Presence selects an adapter even when the directory is an unsafe symlink.
        return os.path.lexists(self.root / relative)

    def source(self, relative, label=None, expected=None):
        if relative in self.sources:
            source = self.sources[relative]
            if expected and source.get("expectedSha256") not in (None, expected):
                source["status"] = "invalid"
                self.warn("Conflicting reviewed pins: " + relative)
            elif expected:
                source["expectedSha256"] = expected
                if source.get("sha256") and source["status"] != "invalid":
                    source["status"] = "current" if source["sha256"] == expected else "stale"
            return
        if len(self.sources) >= 32:
            self.warn("Source inspection limited to 32 files; omitted sources are not verified.")
            return
        name = relative.lower()
        category = ("solid" if "/solid/" in name else "reference" if Path(name).name in {"books", "code", "code=.txt"} or name.endswith(".py")
                    else "maintenance" if "maintenance" in name or "code-maintenance" in name
                    else "configuration" if name.endswith((".yaml", ".json"))
                    else "engineering" if name.endswith("rules.md") else "workflow")
        source = {"id": "source:" + relative, "path": relative, "label": label or Path(relative).name,
                  "category": category, "status": "unverified", "text": "", "truncated": False,
                  "numberedRules": [], "review": "reference" if category == "reference" else "required"}
        if expected:
            source["expectedSha256"] = expected
        self.sources[relative] = source
        try:
            raw = self.read(relative)
            if b"\0" in raw:
                raise ValueError("rule source is not text")
            source["sha256"] = hashlib.sha256(raw).hexdigest()
            source["text"] = raw[:65536].decode("utf-8", errors="replace")
            source["truncated"] = len(raw) > 65536
            if expected:
                source["status"] = "current" if source["sha256"] == expected else "stale"
            for line, text in enumerate(source["text"].splitlines(), 1):
                match = NUMBER.match(text)
                if match:
                    if len(source["numberedRules"]) < 128:
                        source["numberedRules"].append({"number": int(match[1]), "text": match[2][:1000], "line": line})
                    else:
                        source["truncated"] = True
                        self.warn("Numbered rule display limited to 128 entries: " + relative)
            if source["truncated"]:
                self.warn("Rule display is truncated: " + relative)
        except FileNotFoundError:
            source["status"] = "missing"
            self.warn("Missing rule source: " + relative)
        except (OSError, ValueError) as error:
            source["status"] = "invalid"
            self.warn("Cannot inspect " + relative + ": " + str(error))

    def pins(self):
        # Only reviewed local reference links are followed, never network URLs or arbitrary UI paths.
        seen = set()
        while True:
            pending = [source for path, source in self.sources.items() if path not in seen]
            if not pending:
                return
            for source in pending:
                seen.add(source["path"])
                for label, target, expected in PIN.findall(source["text"]):
                    candidate = os.path.normpath(str(Path(source["path"]).parent / target))
                    self.source(candidate, label, expected)

    def sessions(self, base):
        if base in (".wisdohm", ".agents"):
            memory = {"status": "missing", "records": 0, "sessions": 0, "reason": "Operational SQLite memory is not initialized."}
            relative = base + ("/state/memory.sqlite" if base == ".agents" else "/memory.sqlite")
            try:
                path = self.path(relative)
                info = path.stat(follow_symlinks=False)
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > 64 * 1024 * 1024:
                    raise Unsafe("invalid or oversized SQLite memory")
                # URI mode=ro cannot create the database. No WISDOHM Store/runtime is imported.
                with closing(sqlite3.connect("file:" + quote(str(path)) + "?mode=ro", uri=True, timeout=0.3)) as connection:
                    connection.execute("PRAGMA query_only=ON")
                    connection.execute("PRAGMA trusted_schema=OFF")
                    if hasattr(connection, "setlimit"):
                        connection.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, MAX_RECORD + 4096)
                    connection.set_progress_handler(lambda: int(time.monotonic() > self.deadline), 1000)
                    connection.execute("BEGIN")
                    schema = connection.execute("PRAGMA user_version").fetchone()[0]
                    if schema not in (1, 2, 3):
                        raise ValueError("unsupported SQLite schema version")
                    columns_by_table = {**COLUMNS, **(PLAN_COLUMNS if schema in (2, 3) else {}), **({"workflow": ["project_id", "revision", "body"]} if schema == 3 else {})}
                    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
                    if tables != set(columns_by_table):
                        raise ValueError("invalid SQLite memory tables")
                    for table, columns in columns_by_table.items():
                        if [row[1] for row in connection.execute("PRAGMA table_info(" + table + ")")] != columns:
                            raise ValueError("invalid SQLite memory columns")
                    if connection.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                        raise ValueError("SQLite integrity check failed")
                    self.harness["memory"]["integrity"] = "ok"
                    memory["sessions"] = connection.execute("SELECT count(*) FROM sessions").fetchone()[0]
                    memory["records"] = connection.execute("SELECT count(*) FROM memory").fetchone()[0]
                    rows = list(connection.execute("SELECT id,CASE WHEN typeof(data)='text' AND length(CAST(data AS BLOB))<=? THEN data ELSE NULL END FROM sessions ORDER BY rowid DESC LIMIT 65", (MAX_RECORD,)))
                    memory["status"] = "populated" if memory["records"] else "unpopulated"
                    memory["reason"] = "SQLite is the sole operational authority. Record presence does not certify rule compliance."
                    if len(rows) > 64:
                        self.warn("Only the newest 64 inserted sessions are inspected; other checks are not verified.")
                    states = []
                    total = 0
                    for identity, text in rows[:64]:
                        if not isinstance(text, str):
                            self.warn("Invalid session " + str(identity)[:80] + ": malformed or oversized JSON record")
                            continue
                        total += len(text.encode())
                        if total > 16 * 1024 * 1024:
                            self.warn("Session inspection exceeded 16 MiB; remaining checks are not verified.")
                            break
                        try:
                            state = json_value(text)
                            if not isinstance(state, dict) or state.get("id") != identity:
                                raise ValueError("invalid session identity")
                            states.append(state)
                        except (TypeError, ValueError) as error:
                            self.warn("Invalid session " + str(identity)[:80] + ": " + str(error))
                    if schema in (2, 3):
                        if self.definition_source not in ("files", "invalid"):
                            self.sql_routing(connection)
                        if schema == 3:
                            self.workflow_observations(connection)
                    elif self.version == "2.7.0":
                        self.issue("WISDOHM 2.7 is installed but SQL memory still has schema 1; upgrade is pending.")
                    self.memory_observations(connection, states, memory["sessions"])
                    self.memory_graph(connection)
                return memory, states
            except FileNotFoundError:
                return memory, []
            except (OSError, ValueError, sqlite3.Error) as error:
                self.harness["memory"]["integrity"] = "failed"
                self.issue("Operational SQLite memory could not be inspected safely: " + str(error))
                memory.update(status="invalid", reason="Cannot read operational SQLite memory: " + str(error)[:300])
                return memory, []

        memory = {"status": "missing", "records": 0, "sessions": 0,
                  "reason": "Legacy 2.4 adapter; operational facts are read from its declared catalogue and agent JSON only."}
        states = []
        try:
            catalogue = json_value(self.read(base + "/state/index.json").decode())
            groups = catalogue.get("memory", {})
            if not isinstance(groups, dict):
                raise ValueError("invalid legacy memory catalogue")
            paths = {path for files in groups.values() if isinstance(files, list) for path in files if isinstance(path, str)}
            for path in sorted(paths)[:100]:
                try:
                    if self.read(path).strip():
                        memory["records"] += 1
                except FileNotFoundError:
                    self.warn("Missing legacy catalogue artifact: " + path)
            folder = self.path(base + "/state/agents")
            if folder.exists():
                names = sorted(name for name in os.listdir(folder) if re.fullmatch(r"[A-Za-z0-9_-]{1,80}\.json", name))
                memory["sessions"] = len(names)
                if len(names) > 64:
                    self.warn("Legacy session inspection limited to 64 files.")
                for name in names[-64:]:
                    try:
                        value = json_value(self.read(base + "/state/agents/" + name, MAX_RECORD).decode())
                        if not isinstance(value, dict):
                            raise ValueError("invalid agent JSON")
                        states.append(value)
                    except (OSError, ValueError) as error:
                        self.warn("Invalid legacy session " + name + ": " + str(error))
            memory["status"] = "populated" if memory["records"] else "unpopulated"
            memory["reason"] += " Counts describe nonempty artifacts, not a semantic completeness review."
        except FileNotFoundError:
            pass
        except (OSError, ValueError) as error:
            memory.update(status="invalid", reason="Cannot read legacy memory: " + str(error)[:300])
        return memory, states

    def evidence(self, path, expected):
        item = {"path": str(path)[:1024], "status": "unsafe"}
        if isinstance(expected, str) and HASH.fullmatch(expected):
            item["expectedSha256"] = expected
        elif expected is not None:
            return item, False, False
        try:
            if path not in self.hashes:
                if len(self.hashes) >= 200 or self.hash_bytes >= 32 * 1024 * 1024:
                    self.warn("Evidence hashing is limited to 200 files and 32 MiB; omitted bindings are unverified.")
                    return item, False, False
                try:
                    raw = self.read(path, min(8 * 1024 * 1024, 32 * 1024 * 1024 - self.hash_bytes))
                    self.hash_bytes += len(raw)
                    self.hashes[path] = hashlib.sha256(raw).hexdigest()
                except FileNotFoundError:
                    self.hashes[path] = None
            actual = self.hashes[path]
            if actual:
                item["actualSha256"] = actual
            item["status"] = "missing" if actual is None else "current" if actual == expected else "stale"
            return item, actual == expected, True
        except (OSError, ValueError, TypeError):
            return item, False, False

    def pinned_paths(self, seeds):
        """A receipt's own guidance closure; other agents' optional sources are display-only."""
        selected, pending = set(), list(seeds)
        try:
            while pending:
                path = pending.pop()
                if path in selected:
                    continue
                if len(selected) >= 200:
                    raise ValueError("receipt guidance exceeds 200 sources")
                self.path(path)
                selected.add(path)
                if path not in self.references:
                    source = self.sources.get(path)
                    if source and not source["truncated"] and source["status"] not in {"missing", "invalid"}:
                        text = source["text"]
                    else:
                        remaining = 32 * 1024 * 1024 - self.reference_bytes
                        if remaining <= 0:
                            raise ValueError("receipt guidance exceeds 32 MiB")
                        raw = self.read(path, min(MAX_SOURCE, remaining))
                        self.reference_bytes += len(raw)
                        text = raw.decode("utf-8")
                    self.references[path] = {os.path.normpath(str(Path(path).parent / target)) for _, target, _ in PIN.findall(text)}
                pending.extend(self.references[path])
            return selected
        except (OSError, ValueError):
            self.warn("Receipt guidance is missing, unsafe or exceeds inspection limits; freshness is unverified.")
            return None

    def checks(self, states):
        checks = []
        base = self.base
        control = lambda name: base + ("/runtime/" if base == ".agents" and name.endswith(".py") else "/") + name
        if not base:
            return checks
        required = {control(name) for name in ["BOOT.md", "protocols/rules.md", "protocols/updates.md", "policy.yaml", "router.py", "session.py", "common.py"]}
        required.add(base + ("/project.yaml" if base == ".agents" else "/config/project.yaml"))
        required.update({control("store.py")} if base == ".agents" else {base + "/store.py", base + "/journey.yaml"} if base == ".wisdohm" else {base + "/memory.py", base + "/state/index.json"})
        if self.exists("AGENTS.md"):
            required.add("AGENTS.md")
        if self.exists("RULES.md"):
            required.add("RULES.md")
        modern = base in (".wisdohm", ".agents") and self.version == "2.7.0"
        if modern:
            required.update(control(name) for name in ("planning.py", "routing.py", "workspaces.py"))
            for name in ("settings.json", "protocols/work.md"):
                if self.exists(base + "/" + name):
                    required.add(base + "/" + name)
        else:
            if self.exists(base + "/protocols/maintenance.md"):
                required.add(base + "/protocols/maintenance.md")
            if ".context/modules/registry.yaml" in self.sources.get("AGENTS.md", {}).get("text", ""):
                required.add(".context/modules/registry.yaml")
        for state in states:
            historical = bool(state.get("_legacy")) or bool(state.get("legacy_checks")) or state.get("stage") == "IMPORTED" or state.get("root") != str(self.root)
            recorded = state.get("checks", [])
            if historical and not recorded:
                recorded = state.get("legacy_checks", [])
            if not isinstance(recorded, list):
                self.warn("Malformed checks: " + str(state.get("id"))[:80])
                continue
            try:
                integrity = state.get("digest") == digest({key: value for key, value in state.items() if key not in {"digest", "_revision"}})
            except (TypeError, ValueError):
                integrity = False
            valid = (integrity and type(state.get("schema_version")) is int and state["schema_version"] == (2 if base in (".wisdohm", ".agents") else 1)
                     and isinstance(state.get("id"), str) and re.fullmatch(r"[A-Za-z0-9_-]{1,80}", state["id"])
                     and isinstance(state.get("inputs"), dict) and required <= set(state["inputs"])
                     and all(isinstance(state["inputs"][path], str) and HASH.fullmatch(state["inputs"][path]) for path in required)
                     and state.get("stage") in ("VERIFY", "DONE", "BLOCKED"))
            valid = valid and state.get("verify") == [check.get("command") for check in recorded if isinstance(check, dict)]
            valid = valid and all(isinstance(check, dict) and type(check.get("exit")) is int
                                  and isinstance(check.get("output_digest"), str) and HASH.fullmatch(check["output_digest"]) for check in recorded)
            writes, reads = state.get("write"), state.get("read")
            valid = valid and isinstance(writes, list) and all(isinstance(path, str) for path in writes) and len(set(writes)) == len(writes)
            valid = valid and isinstance(reads, list) and all(isinstance(path, str) for path in reads)
            valid = valid and isinstance(state.get("outputs"), dict) and set(state["outputs"]) == set(writes)
            read_bindings = {("read:" if modern else "") + path for path in set(reads or []) - set(writes or [])} if valid else set()
            valid = valid and read_bindings <= set(state["inputs"])
            declared_rules = state.get("rules")
            valid = valid and isinstance(declared_rules, list) and all(isinstance(path, str) for path in declared_rules)
            if valid:
                scoped = set(read_bindings)
                guidance = set(declared_rules) if modern else required | set(declared_rules)
                if len(reads) + len(writes) + len(declared_rules) > 400:
                    valid = False
                else:
                    for path in set(reads + writes):
                        try:
                            self.path(path)
                            for parent in Path(path).parents:
                                candidate = (parent / "AGENTS.md").as_posix()
                                if self.exists(candidate):
                                    guidance.add(candidate)
                        except (OSError, ValueError):
                            valid = False
                    pinned = guidance if modern else self.pinned_paths(guidance)
                    valid = valid and pinned is not None
                    scoped.update(("workspace:" if modern else "") + path for path in (pinned or ()))
                    valid = valid and scoped <= set(state["inputs"]) and all(
                        isinstance(state["inputs"][path], str) and HASH.fullmatch(state["inputs"][path]) for path in scoped)
            bindings = []
            seen_bindings = {}
            for label, expected in state.get("inputs", {}).items() if isinstance(state.get("inputs"), dict) else []:
                path = label
                if modern and label.startswith(("read:", "workspace:")):
                    path = label.split(":", 1)[1]
                if path in seen_bindings and seen_bindings[path] != expected:
                    valid = False
                seen_bindings[path] = expected
                bindings.append((path, expected))
            external_workspace = modern and state.get("source_root", str(self.root)) != str(self.root)
            # File hashes alone cannot establish a 2.7 SQL plan or scoped-memory
            # binding. Expose these receipts, but do not promote them to current.
            unassessed_binding = modern and bool(state.get("plan") or state.get("consumed_memory"))
            if external_workspace or unassessed_binding:
                valid = False
            if isinstance(state.get("outputs"), dict):
                bindings += list(state["outputs"].items())
            elif state.get("write"):
                valid = False
            evidence, matching, inspectable = [], True, True
            if not historical and not external_workspace:
                if len(bindings) > 400:
                    valid = False
                    bindings = bindings[:400]
                    self.warn("Receipt has too many bindings; its freshness is unverified.")
                for path, expected in bindings:
                    item, same, safe = self.evidence(path, expected)
                    matching = matching and same
                    inspectable = inspectable and safe
                    if len(evidence) < 16:
                        evidence.append(item)
                if len(bindings) > 16:
                    self.warn("Evidence details show at most 16 paths per check; all bounded bindings are compared.")
            freshness = "historical" if historical else "unverified" if not valid or not inspectable else "current" if matching else "stale"
            reason = ("Imported or relocated evidence is historical; run current project checks." if historical else
                      "Receipt refers to another source workspace; its files were not inspected." if external_workspace else
                      "SQL step or scoped-memory binding was not assessed by this read-only adapter." if unassessed_binding else
                      "Receipt integrity, declared checks or bound files are incomplete/unsafe." if freshness == "unverified" else
                      "Bound rule/read/output hashes differ from current files." if freshness == "stale" else
                      "Recorded checks match their declared files. This is cooperative evidence, not whole-project or per-rule compliance.")
            evidence_kind = state.get("evidence_kind")
            if evidence_kind in {"reported", "assessed", "verified", "integrated"}:
                reason = evidence_kind.capitalize() + " receipt. " + reason
            for index, check in enumerate(recorded):
                if len(checks) >= 100:
                    self.warn("Check display limited to 100 rows; remaining checks are not inspected.")
                    return checks
                if not isinstance(check, dict) or not isinstance(check.get("command"), str):
                    self.warn("Malformed check receipt: " + str(state.get("id"))[:80])
                    continue
                code = check.get("exit")
                item = {"id": str(state.get("id"))[:80] + ":" + str(index), "sessionId": str(state.get("id"))[:80],
                        "command": check["command"][:4000], "result": "unknown" if type(code) is not int else "passed" if code == 0 else "failed",
                        "freshness": freshness, "reason": reason, "evidence": evidence}
                if type(code) is int and abs(code) <= 2147483647:
                    item["exitCode"] = code
                if isinstance(state.get("updated_at"), str):
                    item["recordedAt"] = state["updated_at"][:80]
                checks.append(item)
        return checks

    def snapshot(self):
        base = ".agents" if self.exists(".agents/BOOT.md") else ".wisdohm" if self.exists(".wisdohm") else ".context" if self.exists(".context") else None
        self.base = base
        factory = base == ".agents" and self.exists(".agents/factory/README.md")
        control = lambda name: base + ("/runtime/" if base == ".agents" and name.endswith(".py") else "/") + name
        project_path = base + ("/project.yaml" if base == ".agents" else "/config/project.yaml") if base else ""
        edition = "wisdohm-2.6" if base in (".wisdohm", ".agents") else "legacy-context-2.4" if base else "absent"
        entry = (base or ".wisdohm") + "/BOOT.md"
        authority = {"entryPath": entry, "status": "missing"}
        memory = {"status": "missing", "records": 0, "sessions": 0, "reason": "No installed rule authority was found."}
        config, states, commands = {}, [], []
        self.source("AGENTS.md", "Project agent entry")
        if self.exists("RULES.md"):
            self.source("RULES.md", "Project rules")
        if base:
            authority["memoryPath"] = base + ("/state/memory.sqlite" if base == ".agents" else "/memory.sqlite" if base == ".wisdohm" else "/state/index.json")
            for path, label in [(entry, "Workflow entry"), (base + "/protocols/rules.md", "Engineering rules"),
                                (base + "/protocols/updates.md", "Memory obligations"),
                                (base + "/policy.yaml", "Context policy"), (project_path, "Project configuration")]:
                self.source(path, label)
            if base == ".wisdohm":
                self.source(base + "/journey.yaml", "Five-gate journey")
            if self.exists(base + "/protocols/maintenance.md") or base + "/protocols/maintenance.md" in self.sources["AGENTS.md"]["text"]:
                self.source(base + "/protocols/maintenance.md", "Project maintenance routing")
            for name in ([] if factory else ["router.py", "session.py", "common.py"] + (["store.py"] if base in (".wisdohm", ".agents") else ["memory.py", "state/index.json"])):
                self.source(control(name), "Loader: " + name)
            if factory:
                for name in ("definitions.py", "common.py", "store.py"):
                    self.source(".agents/data/" + name, "Planning/history data adapter: " + name)
                self.source(".agents/factory/README.md", "Automatic factory flow")
            version = re.search(r"\(version\s+([0-9.]+)\)", self.sources[entry]["text"])
            self.version = version[1] if version else None
            if base in (".wisdohm", ".agents") and self.version == "2.7.0":
                edition = "wisdohm-2.7"
                for name in ("planning.py", "routing.py", "workspaces.py", "protocols/work.md"):
                    if factory and name.endswith(".py"):
                        continue
                    self.source(control(name), "Loader: " + name)
            invalid = False
            for path in [project_path, base + "/policy.yaml"] + ([base + "/journey.yaml"] if base == ".wisdohm" else []):
                try:
                    parsed = yaml_value(self.read(path).decode())
                    if path.endswith("project.yaml"):
                        config = parsed
                        if base in (".wisdohm", ".agents") and (not isinstance(config.get("project"), str) or not config["project"]
                                or config.get("mode", "autonomous") not in ("autonomous", "human_in_loop")
                                or not isinstance(config.get("commands", {}), dict) or not isinstance(config.get("ownership", {}), dict)):
                            raise ValueError("invalid project configuration")
                        rules = parsed.get("rules", {})
                        protected = rules.get("protected_paths", []) if isinstance(rules, dict) else None
                        if not isinstance(protected, list) or len(protected) > 256 or not all(isinstance(item, str) and 0 < len(item) <= 1024 for item in protected):
                            raise ValueError("invalid protected paths")
                        self.protected = protected
                    elif path.endswith("policy.yaml"):
                        if (set(parsed) not in ({"context_limit_percent", "measurement_max_age_seconds"},
                                               {"context_limit_percent", "measurement_max_age_seconds", "context_mode"})
                                or parsed.get("context_mode", "required") not in ("advisory", "required")) or any(
                                type(parsed[key]) not in (int, float) or not math.isfinite(parsed[key]) or not 0 < parsed[key] <= maximum
                                for key, maximum in [("context_limit_percent", 100), ("measurement_max_age_seconds", 3600)]):
                            raise ValueError("invalid context policy")
                    elif (set(parsed) != {"gates", "task_kinds", "accent", "bold"}
                          or parsed.get("gates") != ["BOOT", "PREFLIGHT", "WORK", "VERIFY", "CLOSE"]
                          or not isinstance(parsed.get("task_kinds"), list) or not parsed["task_kinds"]
                          or not all(isinstance(kind, str) and kind for kind in parsed["task_kinds"])
                          or len(set(parsed["task_kinds"])) != len(parsed["task_kinds"])
                          or parsed.get("accent") not in ("cyan", "blue", "magenta") or type(parsed.get("bold")) is not bool):
                        raise ValueError("invalid journey")
                    elif base in (".wisdohm", ".agents"):
                        boot_rules = {rule["number"]: rule for rule in self.sources[entry]["numberedRules"]}
                        for number, gate in enumerate(parsed["gates"], 1):
                            rule = boot_rules.get(number)
                            if rule and rule["text"].startswith(gate):
                                self.harness["gates"].append(dict(id=gate, label=gate, sourcePath=entry,
                                                                   number=number, instruction=rule["text"][:4096]))
                        if len(self.harness["gates"]) != 5:
                            self.issue("The five journey gates could not all be matched to BOOT instructions.")
                except (OSError, ValueError, yaml.YAMLError) as error:
                    invalid = True
                    self.sources[path]["status"] = "missing" if isinstance(error, FileNotFoundError) else "invalid"
                    self.warn("Cannot validate " + path + ": " + str(error))
            if base == ".agents":
                journey = config.get("journey")
                if (not isinstance(journey, dict) or set(journey) != {"gates", "accent", "bold"}
                        or journey.get("gates") != (["PLAN", "BUILD", "CHECK", "REPAIR", "DONE"] if factory else ["BOOT", "PREFLIGHT", "WORK", "VERIFY", "CLOSE"])
                        or journey.get("accent") not in ("cyan", "blue", "magenta") or type(journey.get("bold")) is not bool):
                    invalid = True
                    self.warn("Invalid agent-home journey presentation.")
                else:
                    boot_rules = {rule["number"]: rule for rule in self.sources[entry]["numberedRules"]}
                    for number, gate in enumerate(journey["gates"], 1):
                        rule = boot_rules.get(number)
                        if rule and rule["text"].startswith(gate):
                            self.harness["gates"].append(dict(id=gate, label=gate, sourcePath=entry, number=number, instruction=rule["text"][:4096]))
                    if len(self.harness["gates"]) != 5:
                        self.issue("The five journey gates could not all be matched to BOOT instructions.")
            # Project protection rules must be loaded before reading routing inputs.
            if base in (".wisdohm", ".agents") and self.version != "2.7.0":
                self.routing()
            if base == ".context":
                configured = config.get("rules", {}).get("sources", []) if isinstance(config.get("rules"), dict) else []
                if isinstance(configured, list):
                    for path in configured[:32]:
                        if isinstance(path, str):
                            self.source(path)
            version = re.search(r"\(version\s+([0-9.]+)\)", self.sources[entry]["text"])
            if version:
                authority["version"] = version[1]
                if version[1] not in (("2.6.0", "2.7.0") if base in (".wisdohm", ".agents") else ("2.4.0",)):
                    edition = "unsupported"
                    invalid = True
                    self.warn("Unsupported installed edition; legacy fallback is disabled.")
            else:
                invalid = True
            rules = self.sources[base + "/protocols/rules.md"]
            if not rules["numberedRules"]:
                invalid = True
                self.warn("Canonical engineering rules are missing or unpopulated.")
            if any(source["status"] in {"missing", "invalid"} for source in self.sources.values()
                   if source["path"] not in self.harness_sources):
                invalid = True
            self.definition_observations()
            memory, states = self.sessions(base)
            for state in states:
                if state.get("root") == str(self.root) and not state.get("_legacy"):
                    for path in state.get("rules", [])[:32] if isinstance(state.get("rules"), list) else []:
                        if isinstance(path, str):
                            self.source(path)
            authority["status"] = "invalid" if invalid or memory["status"] == "invalid" else "missing" if memory["status"] == "missing" else "unpopulated" if memory["status"] == "unpopulated" else "ready"
            for label, command in list(config.get("commands", {}).items())[:10] if isinstance(config.get("commands"), dict) else []:
                if isinstance(command, str) and command.strip():
                    commands.append({"label": str(label)[:80], "command": command[:4000]})
        if not base:
            self.definition_observations()
        self.pins()
        if base and any(source["status"] in {"missing", "invalid"} for source in self.sources.values()
                        if source["path"] not in self.harness_sources):
            authority["status"] = "invalid"
        checks = self.checks(states)
        if len(checks) + len(self.reported_checks) > 100:
            self.warn("Combined execution/report display is limited to 100 rows; omitted reports are not verified.")
        checks.extend(self.reported_checks[:max(0, 100 - len(checks))])
        if base not in (".wisdohm", ".agents"):
            self.issue("The WISDOHM SQLite harness is unavailable for this authority.")
        else:
            if authority["status"] != "ready":
                self.issue("Rule authority status is " + authority["status"] + ".")
            for source in self.sources.values():
                if source["status"] in {"stale", "missing", "invalid"}:
                    self.issue("Rule source " + source["status"] + ": " + source["path"])
            if any("limited" in warning or "exceeded" in warning for warning in self.warnings):
                self.issue("Some source or receipt inspection is limited; omitted evidence is not verified.")
        self.harness["health"]["status"] = ("unavailable" if base not in (".wisdohm", ".agents") or memory["status"] in {"missing", "invalid"}
                                               else "attention" if self.harness["health"]["issues"] else "healthy")
        self.warn("Source pins and recorded checks are independent evidence; review guidance is not an automatic compliance certificate.")
        return {"projectId": self.project, "observedAt": datetime.now(timezone.utc).isoformat(), "edition": edition,
                "authority": authority, "sources": list(self.sources.values()), "checks": checks, "memory": memory,
                "commands": commands, "warnings": self.warnings, "harness": self.harness, "assessments": self.assessment_observations(states)}


def traffic_snapshot(root_arg, project):
    """Read only the selected project's current reservations, never session bodies."""
    root = Path(root_arg).resolve(strict=True)
    result = dict(projectId=project, observedAt=datetime.now(timezone.utc).isoformat(),
                  status="ready", totalSessions=0, totalClaims=0, truncated=False,
                  sessions=[], claims=[])
    base = root / ".agents" if (root / ".agents/BOOT.md").is_file() else root / ".wisdohm"
    if not (base / "BOOT.md").is_file():
        return dict(result, status="missing", reason="Agent authority is not installed for this project.")
    directory, database = base / "state", base / "state/memory.sqlite"
    if base.name == ".wisdohm":
        directory, database = base, base / "memory.sqlite"
    if any(path.is_symlink() for path in (base, directory, database)):
        return dict(result, status="invalid", reason="Agent activity storage is not a regular local database.")
    if not database.is_file():
        return dict(result, status="missing", reason="Agent activity database is not initialized.")
    try:
        with sqlite3.connect("file:" + quote(str(database)) + "?mode=ro", uri=True, timeout=2) as connection:
            connection.execute("PRAGMA query_only=ON")
            connection.execute("PRAGMA trusted_schema=OFF")
            deadline = time.monotonic() + 3
            connection.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
            connection.execute("BEGIN")
            if connection.execute("PRAGMA user_version").fetchone()[0] not in (1, 2, 3):
                return dict(result, status="unsupported", reason="Agent activity database version is unsupported.")
            for table in ("sessions", "claims"):
                columns = [row[1] for row in connection.execute("PRAGMA table_info(" + table + ")")]
                if columns != COLUMNS[table]:
                    raise ValueError("invalid activity table")
            if connection.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                raise ValueError("invalid activity database")
            if connection.execute("SELECT COUNT(*) FROM sessions WHERE NOT json_valid(data)").fetchone()[0]:
                raise ValueError("invalid session record")
            if connection.execute("SELECT COUNT(*) FROM sessions WHERE json_type(data,'$.stage') IS NOT 'text'").fetchone()[0]:
                raise ValueError("invalid session stage")
            result["totalClaims"] = connection.execute("SELECT COUNT(*) FROM claims").fetchone()[0]
            rows = connection.execute("SELECT path,task_id FROM claims ORDER BY path LIMIT 1025").fetchall()
            if any(not isinstance(path, str) or not 1 <= len(path) <= 1024 or
                   not isinstance(session, str) or not 1 <= len(session) <= 128 for path, session in rows):
                raise ValueError("invalid claim")
            result["claims"] = [dict(path=path, sessionId=session) for path, session in rows[:1024]]
            result["totalSessions"] = connection.execute(
                "SELECT COUNT(*) FROM sessions WHERE json_extract(data,'$.stage') NOT IN ('DONE','ABANDONED','IMPORTED')"
            ).fetchone()[0]
            sessions = connection.execute(
                "SELECT id,CASE WHEN length(CAST(data AS BLOB))<=? THEN data ELSE NULL END FROM sessions "
                "WHERE json_extract(data,'$.stage') NOT IN ('DONE','ABANDONED','IMPORTED') "
                "ORDER BY rowid DESC LIMIT 257", (MAX_RECORD,)
            ).fetchall()
            for identity, raw in sessions[:256]:
                if raw is None:
                    raise ValueError("oversized session record")
                state = json_value(raw)
                if state.get("id") != identity:
                    raise ValueError("invalid session identity")
                item = dict(id=identity, owner=state.get("owner"), stage=state.get("stage"))
                if (not isinstance(identity, str) or not 1 <= len(identity) <= 128 or
                    not isinstance(item["owner"], str) or not 1 <= len(item["owner"]) <= 128 or
                    not isinstance(item["stage"], str) or not 1 <= len(item["stage"]) <= 32):
                    raise ValueError("invalid session summary")
                plan = state.get("plan")
                if isinstance(plan, dict) and isinstance(plan.get("step"), str):
                    if not 1 <= len(plan["step"]) <= 96:
                        raise ValueError("invalid step identity")
                    item["stepId"] = plan["step"]
                if isinstance(state.get("updated_at"), str):
                    if datetime.fromisoformat(state["updated_at"]).tzinfo is None:
                        raise ValueError("invalid session time")
                    item["updatedAt"] = state["updated_at"]
                result["sessions"].append(item)
            result["truncated"] = result["totalClaims"] > 1024 or result["totalSessions"] > 256
            return result
    except (OSError, ValueError, sqlite3.Error):
        return dict(result, status="invalid", reason="Agent activity database could not be read safely.",
                    totalSessions=0, totalClaims=0, truncated=False, sessions=[], claims=[])


if __name__ == "__main__":
    try:
        value = traffic_snapshot(sys.argv[1], sys.argv[2]) if len(sys.argv) == 4 and sys.argv[3] == "activity" else Reader(sys.argv[1], sys.argv[2]).snapshot()
        print(json.dumps(value, ensure_ascii=False, allow_nan=False))
    except Exception as error:
        print(str(error)[:500], file=sys.stderr)
        raise SystemExit(1)
