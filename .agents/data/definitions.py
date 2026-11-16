#!/usr/bin/env python3
"""Trusted data-only agent-home reader and serialization facade.

ROOT selects data. This module never imports Python from ROOT. Consumers execute
this installed implementation, not a selected project's copy.
"""
import argparse
from contextlib import closing
import fnmatch
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import sqlite3
import sys
from urllib.parse import quote

import yaml

MAX_FILE = 2 * 1024 * 1024
MAX_TOTAL = 32 * 1024 * 1024
ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$')
EFFECTS = {'inspect', 'plan', 'change_source'}
LEVELS = {'review', 'smoke', 'targeted', 'integration'}
AUTHORITY = '.agents/plans/authority.yaml'
CATALOG = '.agents/plans/catalog.yaml'


def need(condition, message):
    if not condition:
        raise ValueError(message)


def unique(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, 'duplicate key: ' + str(key))
        result[key] = value
    return result


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(encoded(value).encode()).hexdigest()


def planner_task_digest(registry, task):
    """Match the shared planner's canonical UTF-8 task/dependency digest."""
    tasks = {value['id']: value for value in registry['tasks']}
    need(all(value in tasks for value in task['depends_on']), 'unknown planner prerequisite')
    payload = dict(task=task, dependencies=[tasks[value] for value in task['depends_on']])
    raw = json.dumps(payload, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
    return hashlib.sha256(raw.encode('utf8')).hexdigest()


def parse_yaml(text):
    class Loader(yaml.SafeLoader):
        pass
    Loader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
                           lambda loader, node: unique(loader.construct_pairs(node)))
    value = yaml.load(text, Loader=Loader)
    need(isinstance(value, dict), 'expected a YAML object')
    return value


def relative(value, pattern=False):
    need(isinstance(value, str) and value and len(value) <= 1024, 'invalid relative path')
    need(not value.startswith('/') and not any(ord(c) < 32 or 127 <= ord(c) <= 159 for c in value)
         and '\\' not in value and ':' not in value, 'unsafe relative path: ' + repr(value))
    candidate = value[:-1] if pattern and value.endswith('/') else value
    need(all(p and p not in {'.', '..'} for p in candidate.split('/')), 'noncanonical relative path: ' + value)
    need(not any(c in value for c in ('[]{}' if pattern else '*?[]')), 'unsupported path syntax: ' + value)
    return value


def identity(value):
    need(isinstance(value, str) and bool(ID.fullmatch(value)), 'invalid definition ID: ' + str(value))
    return value


def text(value, name):
    need(isinstance(value, str) and value.strip() and len(value) <= 4000, 'invalid ' + name)
    return value


def strings(value, name, item=None, maximum=1000, nonempty=False):
    need(isinstance(value, list) and len(value) <= maximum and all(isinstance(v, str) and v for v in value), 'invalid ' + name)
    need(len(value) == len(set(value)), 'duplicate ' + name)
    need(not nonempty or value, name + ' must not be empty')
    for v in value:
        (item or (lambda x: text(x, name)))(v)
    return value


def fields(value, required, optional=()):
    need(isinstance(value, dict) and set(required) <= set(value) <= set(required) | set(optional), 'unknown or missing fields')


def matches(path, pattern):
    if pattern.endswith('/'):
        return path == pattern[:-1] or path.startswith(pattern)
    return fnmatch.fnmatchcase(path, pattern) or pattern.startswith('**/') and fnmatch.fnmatchcase(path, pattern[3:])


class Reader:
    def __init__(self, root):
        self.root = Path(root).resolve()
        need(self.root.is_dir(), 'project root must exist')
        self.hashes = {}
        self.total = 0

    def path(self, name, missing=False):
        relative(name)
        need(not any(piece == '.git' or piece == 'secrets' or piece.startswith('.env') or piece.endswith(('.pem', '.crt')) for piece in name.split('/')), 'protected definition source: ' + name)
        current = self.root
        for piece in name.split('/'):
            current = current / piece
            if current.is_symlink():
                raise ValueError('definition path cannot traverse a symlink: ' + name)
            if current.exists():
                need(current.resolve().is_relative_to(self.root), 'definition path escapes root')
        if not missing:
            need(current.is_file(), 'missing definition source: ' + name)
            need(current.stat().st_nlink == 1, 'definition source has an unsafe hardlink: ' + name)
        return current

    def raw(self, name, optional=False):
        path = self.path(name, missing=optional)
        if not path.exists():
            return None
        need(path.is_file() and path.stat().st_size <= MAX_FILE, 'definition source too large: ' + name)
        raw = path.read_bytes()
        self.total += len(raw)
        need(self.total <= MAX_TOTAL, 'definition snapshot exceeds byte limit')
        self.hashes[name] = hashlib.sha256(raw).hexdigest()
        return raw.decode('utf8')

    def yaml(self, name, optional=False):
        value = self.raw(name, optional)
        return None if value is None else parse_yaml(value)

    def json(self, name, optional=False):
        value = self.raw(name, optional)
        return None if value is None else json.loads(value, object_pairs_hook=unique)

    def discover(self, pattern, maximum):
        values = sorted(p.relative_to(self.root).as_posix() for p in self.root.glob(pattern))
        need(len(values) <= maximum, 'too many definition sources for ' + pattern)
        return values


def version_one(value):
    return type(value) is int and value == 1


def retired_control_writes(root, paths):
    """Historical scope stays readable; fresh execution uses the active controls."""
    if not Reader(root).path('.agents/project.yaml', missing=True).is_file():
        return []
    removed = {'.wisdohm/' + name for name in (
        'BOOT.md', 'policy.yaml', 'journey.yaml', 'session.py', 'common.py',
        'planning.py', 'store.py', 'routing.py', 'workspaces.py', 'orchestration.py')}
    return [name for name in paths if name in removed or name.startswith(('.wisdohm/config/', '.wisdohm/protocols/'))]


def selected_source(reader):
    manifest = reader.yaml(AUTHORITY, optional=True)
    if manifest is None:
        return 'legacy'
    fields(manifest, ['schema_version', 'definitions'])
    need(version_one(manifest['schema_version']) and manifest['definitions'] in {'legacy', 'files'}, 'unsupported authority manifest')
    return manifest['definitions']


def sql_path(root):
    new = Path(root) / '.agents/state/memory.sqlite'
    old = Path(root) / '.wisdohm/memory.sqlite'
    # Runtime migration leaves only one selected database; never initialize during reads.
    need(not (new.exists() and old.exists()), 'ambiguous operational databases; finish the explicit relocation first')
    return new if new.is_file() else old


def sql_ownership(reader):
    database = sql_path(reader.root)
    if database.is_file():
        need(database == database.resolve(), 'operational database cannot be a symlink')
        with closing(sqlite3.connect('file:' + quote(str(database)) + '?mode=ro', uri=True)) as c:
            c.execute('PRAGMA trusted_schema=OFF')
            tables = {row[0] for row in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if 'capabilities' in tables:
                rows = c.execute('SELECT id,revision,body FROM capabilities ORDER BY id LIMIT 257').fetchall()
                need(len(rows) <= 256, 'too many ownership segments')
                result = []
                for owner, revision, raw in rows:
                    need(isinstance(raw, str) and len(raw) <= MAX_FILE, 'invalid capability body')
                    body = json.loads(raw, object_pairs_hook=unique)
                    if body.get('archived'):
                        continue
                    result.append(dict(schema_version=1, id=owner,
                        **{key: body.get(key, []) for key in ('paths', 'public', 'uses', 'guidance')}, purpose=body.get('purpose', '')))
                reader.hashes['sql:capabilities'] = digest(rows)
                return result
    registry = reader.yaml('.context/modules/registry.yaml')
    return [dict(schema_version=1, id=owner, purpose=body.get('purpose', 'Legacy ownership ' + owner), paths=body['paths'],
                 public=body.get('public_surfaces', []), uses=body.get('depends_on', []), guidance=[])
            for owner, body in registry['modules'].items()]


def read_ownership(reader, source):
    if source == 'legacy':
        return sql_ownership(reader)
    return [reader.yaml(name) for name in reader.discover('.agents/ownership/*/*.yaml', 256)]


def normalize_task(task):
    fields(task, ['id', 'slice', 'title', 'effect', 'agent', 'module', 'mode', 'depends_on', 'read', 'write', 'verify', 'acceptance'],
           ['children', 'feature', 'ui', 'spec', 'verification'])
    kind = 'audit' if task['effect'] == 'read_only' else task['effect']
    effect = 'change_source' if task['write'] else 'inspect' if task['effect'] == 'read_only' else 'plan'
    verification = task.get('verification') or dict(level='targeted' if task['verify'] else 'review',
                        reason='Preserved canonical task checks.' if task['verify'] else 'Assessment of the declared outcome.', checks=task['verify'])
    need(verification['checks'] == task['verify'], 'declared verification checks differ from compatibility checks')
    result = dict(schema_version=1, id=task['id'], title=task['title'], outcome=task['title'], kind=kind,
                  effect=effect, owner=task['module'], slice=task['slice'], mode=task['mode'],
                  read=task['read'], write=task['write'], needs=task['depends_on'], acceptance=task['acceptance'], verification=verification)
    for key in ('feature', 'ui', 'spec'):
        if key in task:
            result[key] = task[key]
    return result


def project_task(step, reference):
    result = dict(id=step['id'], slice=step.get('slice'), title=step['title'],
        effect=reference.get('legacy_effect', step['kind']), agent=reference['agent'], module=step.get('owner'),
        mode=step.get('mode', 'worker'), depends_on=step['needs'], read=step['read'], write=step['write'],
        verify=step['verification']['checks'], acceptance=step['acceptance'])
    for key in ('feature', 'ui', 'spec'):
        if key in step:
            result[key] = step[key]
    if reference.get('children'):
        result['children'] = reference['children']
    if reference.get('verification_explicit'):
        result['verification'] = step['verification']
    return result


def read_plan(reader, source):
    if source == 'legacy':
        registry = reader.json('.context/state/tasks.json')
        fields(registry, ['schema_version', 'goals', 'milestones', 'slices', 'tasks'])
        need(version_one(registry['schema_version']), 'unsupported legacy planner version')
        need(isinstance(registry['tasks'], list) and len(registry['tasks']) <= 10000, 'too many tasks')
        return registry, [normalize_task(task) for task in registry['tasks']]
    catalog = reader.yaml(CATALOG)
    fields(catalog, ['schema_version', 'goals', 'milestones', 'slices', 'steps'])
    need(version_one(catalog['schema_version']) and isinstance(catalog['steps'], list) and len(catalog['steps']) <= 10000, 'invalid catalog')
    tasks, steps = [], []
    for reference in catalog['steps']:
        fields(reference, ['id', 'path', 'agent'], ['legacy_effect', 'children', 'verification_explicit'])
        identity(reference['id']); relative(reference['path']); identity(reference['agent'])
        if 'verification_explicit' in reference:
            need(reference['verification_explicit'] is True, 'verification_explicit must be true')
        need(reference['path'].startswith('.agents/plans/') and reference['path'].endswith('/step.yaml'), 'step must be inside its plan folder')
        if 'legacy_effect' in reference:
            need(reference['legacy_effect'] == 'read_only', 'unsupported legacy effect alias')
        step = reader.yaml(reference['path'])
        need(step.get('id') == reference['id'], 'catalog/step identity mismatch')
        tasks.append(project_task(step, reference)); steps.append(step)
    return dict(schema_version=1, goals=catalog['goals'], milestones=catalog['milestones'], slices=catalog['slices'], tasks=tasks), steps


def acyclic(graph, name):
    edges = sum(len(v) for v in graph.values())
    need(edges <= 50000, name + ' graph is too large')
    pending, dependents = {}, {}
    for item, needs in graph.items():
        need(all(dep in graph for dep in needs), 'unknown ' + name + ' reference')
        pending[item] = len(needs)
        for dep in needs:
            dependents.setdefault(dep, []).append(item)
    ready = [key for key, count in pending.items() if not count]
    for item in ready:
        for consumer in dependents.get(item, []):
            pending[consumer] -= 1
            if not pending[consumer]:
                ready.append(consumer)
    need(len(ready) == len(graph), name + ' cycle')


def validate_definitions(definitions):
    fields(definitions, ['schema_version', 'roles', 'workflows', 'ownership', 'catalog', 'steps'])
    need(version_one(definitions['schema_version']), 'unsupported definitions version')
    def indexed(items, key, maximum, label):
        need(isinstance(items, list) and len(items) <= maximum, 'too many ' + label)
        result = {}
        for item in items:
            identity(item.get(key)); need(item[key] not in result, 'duplicate ' + label + ' ID: ' + item[key]); result[item[key]] = item
        return result
    roles = indexed(definitions['roles'], 'id', 64, 'role')
    kinds = indexed(definitions['workflows'], 'kind', 64, 'workflow')
    owners = indexed(definitions['ownership'], 'id', 256, 'owner')
    steps = indexed(definitions['steps'], 'id', 10000, 'step')
    need(roles and kinds, 'roles and workflows must be populated')
    for role in roles.values():
        fields(role, ['schema_version', 'id', 'purpose', 'instructions', 'skills'])
        need(version_one(role['schema_version']), 'unsupported role version'); text(role['purpose'], 'role purpose'); relative(role['instructions']); strings(role['skills'], 'skills', relative, nonempty=True)
    for workflow in kinds.values():
        fields(workflow, ['schema_version', 'kind', 'agent', 'procedure', 'guidance', 'verification'])
        need(version_one(workflow['schema_version']) and workflow['agent'] in roles, 'unknown workflow role or version')
        strings(workflow['procedure'], 'procedure', maximum=64, nonempty=True); strings(workflow['guidance'], 'guidance', relative)
        fields(workflow['verification'], ['default', 'reason']); need(workflow['verification']['default'] in LEVELS, 'unknown verification default'); text(workflow['verification']['reason'], 'verification reason')
    for owner in owners.values():
        fields(owner, ['schema_version', 'id', 'purpose', 'paths', 'public', 'uses', 'guidance'], ['group'])
        need(version_one(owner['schema_version']), 'unsupported ownership version'); text(owner['purpose'], 'ownership purpose')
        if 'group' in owner: identity(owner['group'])
        strings(owner['paths'], 'ownership patterns', lambda x: relative(x, True), nonempty=True)
        strings(owner['public'], 'public paths', relative); strings(owner['uses'], 'ownership dependencies', identity); strings(owner['guidance'], 'domain guidance', relative)
    catalog = definitions['catalog']; fields(catalog, ['goals', 'milestones', 'slices'])
    goals = indexed(catalog['goals'], 'id', 1000, 'goal'); milestones = indexed(catalog['milestones'], 'id', 1000, 'milestone'); slices = indexed(catalog['slices'], 'id', 5000, 'slice')
    ids = list(goals) + list(milestones) + list(slices) + list(steps); need(len(ids) == len(set(ids)), 'duplicate plan ID')
    for item in goals.values(): fields(item, ['id', 'title']); text(item['title'], 'goal title')
    for item in milestones.values(): fields(item, ['id', 'goal', 'title']); need(item['goal'] in goals, 'unknown milestone goal'); text(item['title'], 'milestone title')
    for item in slices.values(): fields(item, ['id', 'milestone', 'title']); need(item['milestone'] in milestones, 'unknown slice milestone'); text(item['title'], 'slice title')
    scope = sum(len(o['paths']) + len(o['public']) for o in owners.values())
    parents = {s.get('parent') for s in steps.values() if s.get('parent')}
    for step in steps.values():
        fields(step, ['schema_version', 'id', 'title', 'outcome', 'kind', 'effect', 'read', 'write', 'needs', 'acceptance', 'verification'], ['owner', 'slice', 'parent', 'mode', 'feature', 'ui', 'spec'])
        need(version_one(step['schema_version']) and step['kind'] in kinds and step['effect'] in EFFECTS, 'unknown kind/effect/version in ' + step['id'])
        text(step['title'], 'step title'); text(step['outcome'], 'step outcome')
        strings(step['read'], 'read paths', relative); strings(step['write'], 'write paths', relative); scope += len(step['read']) + len(step['write'])
        strings(step['needs'], 'prerequisites', identity); need(step['id'] not in step['needs'], 'step requires itself')
        strings(step['acceptance'], 'acceptance', maximum=100, nonempty=True)
        need(not step.get('owner') or step['owner'] in owners, 'unknown owner in ' + step['id'])
        need(not step.get('slice') or step['slice'] in slices, 'unknown slice in ' + step['id'])
        need(step['effect'] == 'change_source' or not step['write'], 'read-only step declares writes')
        need(step['effect'] != 'change_source' or step.get('owner') and step['write'], 'source step needs owner/write scope')
        need(not (step['id'] in parents and step['write']), 'group parent declares writes')
        need(not any(dep in parents for dep in step['needs']), 'prerequisites must be leaves')
        if step.get('parent'): identity(step['parent'])
        if 'mode' in step: need(step['mode'] in {'worker', 'orchestrator'}, 'invalid execution mode')
        for key in ('feature',):
            if key in step: identity(step[key])
        if 'ui' in step: strings(step['ui'], 'UI references', identity)
        if 'spec' in step: relative(step['spec'])
        v = step['verification']; fields(v, ['level', 'reason', 'checks']); need(v['level'] in LEVELS, 'unknown verification level'); text(v['reason'], 'verification reason'); strings(v['checks'], 'checks', maximum=100)
        need(not v['checks'] if v['level'] == 'review' else bool(v['checks']), 'review needs assessment; executable verification needs checks')
    need(scope <= 50000, 'definition scope is too large')
    acyclic({key: value['uses'] for key, value in owners.items()}, 'ownership')
    acyclic({key: value['needs'] for key, value in steps.items()}, 'prerequisite')
    acyclic({key: [value['parent']] if value.get('parent') else [] for key, value in steps.items()}, 'parent')
    resolved, comparisons = {}, 0
    pattern_count = sum(len(o['paths']) for o in owners.values())
    def owners_of(name):
        nonlocal comparisons
        if name not in resolved:
            comparisons += pattern_count; need(comparisons <= 250000, 'ownership resolution exceeds comparison limit')
            resolved[name] = [key for key, owner in owners.items() if any(matches(name, pattern) for pattern in owner['paths'])]
        return resolved[name]
    for key, owner in owners.items():
        for name in owner['public']: need(owners_of(name) == [key], 'ambiguous public owner: ' + name)
    for step in steps.values():
        for name in step['write']: need(owners_of(name) == [step.get('owner')], 'ambiguous or incorrect write owner: ' + name)
    return definitions


def load_snapshot(root):
    reader = Reader(root); source = selected_source(reader)
    roles = [reader.yaml(name) for name in reader.discover('.agents/agents/*/agent.yaml', 64)]
    workflows = [reader.yaml(name) for name in reader.discover('.agents/workflows/*/workflow.yaml', 64)]
    registry, steps = read_plan(reader, source)
    definitions = dict(schema_version=1, roles=roles, workflows=workflows, ownership=read_ownership(reader, source),
                       catalog={key: registry[key] for key in ('goals', 'milestones', 'slices')}, steps=steps)
    blocked = {task['id']: ['Deferred task scope requires reconciliation'] for task in registry['tasks']
               if any(v.startswith('PLANNED PATHS') or v.startswith('DEFERRED:') for v in task['acceptance']) or
               task['effect'] not in {'read_only', 'audit', 'brainstorm', 'spec', 'roadmap', 'docs'} and not task['write']}
    if source == 'files':
        for task in registry['tasks']:
            if retired_control_writes(root, task['write']):
                blocked.setdefault(task['id'], []).append('Retired control paths require a refined follow-up using the active .agents runtime')
    known_kinds = {value['kind'] for value in workflows}
    known_owners = {value['id'] for value in definitions['ownership']}
    unavailable = {}
    for step in steps:
        if step['kind'] not in known_kinds:
            unavailable[step['id']] = ['Unsupported task kind: ' + str(step['kind'])]
        elif step.get('owner') and step['owner'] not in known_owners:
            unavailable[step['id']] = ['Unknown task owner: ' + str(step['owner'])]
    changed = True
    while changed:
        changed = False
        for step in steps:
            if step['id'] not in unavailable and any(dep in unavailable for dep in step['needs'] + ([step['parent']] if step.get('parent') else [])):
                unavailable[step['id']] = ['A prerequisite or parent has an unsupported definition']; changed = True
    # Unsupported legacy tasks stay visible as specifically blocked registry rows,
    # while the normalized snapshot contains the independent, valid subgraph.
    definitions['steps'] = [step for step in steps if step['id'] not in unavailable]
    blocked.update(unavailable)
    validate_definitions(definitions)
    return dict(generation=digest(reader.hashes), source=source, definitions=definitions, blocked=blocked, inputs=dict(reader.hashes))


def load_ownership(root):
    reader = Reader(root)
    values = read_ownership(reader, selected_source(reader))
    # Ownership-only consumers need not load an unrelated project task catalog.
    need(isinstance(values, list) and len(values) <= 256, 'invalid ownership catalog')
    ids = set()
    for owner in values:
        need(version_one(owner['schema_version']), 'unsupported ownership version')
        identity(owner['id']); need(owner['id'] not in ids, 'duplicate ownership ID'); ids.add(owner['id'])
        strings(owner['paths'], 'ownership patterns', lambda p: relative(p, True), nonempty=True)
    return values


def ownership_projection(root):
    return dict(schema_version=1, project=Reader(root).json('package.json')['name'],
                modules={owner['id']: dict(agent=owner.get('group', 'unknown'),
                    paths=owner['paths'], purpose=owner['purpose'],
                    depends_on=owner['uses'], public_surfaces=owner['public'])
                    for owner in load_ownership(root)})


def read_registry(root):
    reader = Reader(root)
    return read_plan(reader, selected_source(reader))[0]


def resolve_task(root, task_id):
    snapshot = load_snapshot(root); identity(task_id)
    registry = read_registry(root)
    definition = next((s for s in snapshot['definitions']['steps'] if s['id'] == task_id), None)
    if definition is None:
        task = next((t for t in registry['tasks'] if t['id'] == task_id), None)
        need(task is not None, 'unknown task: ' + task_id)
        return dict(task=task, definition=None, workflow=None, role=None, skills=[], instructions=[],
                    generation=snapshot['generation'], definition_digest=planner_task_digest(registry, task), blocked=snapshot['blocked'].get(task_id, ['Unsupported task definition']))
    workflow = next(v for v in snapshot['definitions']['workflows'] if v['kind'] == definition['kind'])
    role = next(v for v in snapshot['definitions']['roles'] if v['id'] == workflow['agent'])
    owner = next((v for v in snapshot['definitions']['ownership'] if v['id'] == definition.get('owner')), None)
    skills = list(dict.fromkeys(role['skills'] + (owner['guidance'] if owner else [])))
    reader = Reader(root)
    # Missing optional task prose is a warning, required instruction sources remain controlling.
    instructions = []
    names = list(dict.fromkeys([role['instructions'], *skills, *workflow['guidance']]))
    if reader.path('.agents/templates/implementation.md', missing=True).is_file(): names.append('.agents/templates/implementation.md')
    for name in names:
        content = reader.raw(name)
        instructions.append(dict(path=name, text=content, sha256=reader.hashes[name]))
    task = next(t for t in registry['tasks'] if t['id'] == task_id)
    return dict(task=task, definition=definition, workflow=workflow, role=role, skills=skills,
                generation=digest(dict(definitions=snapshot['generation'], instructions=reader.hashes)), definition_digest=planner_task_digest(registry, task), instructions=instructions, blocked=snapshot['blocked'].get(task_id, []))


def route_paths(root, paths):
    owners = load_ownership(root); grouped = {}
    for name in paths:
        relative(name); Reader(root).path(name, missing=True)
        found = [owner for owner in owners if any(matches(name, pattern) for pattern in owner['paths'])]
        need(len(found) == 1, 'task path needs exactly one owner: ' + name)
        owner = found[0]; grouped.setdefault(owner['id'], dict(owner=owner['id'], agent='implementer', description=owner['purpose'], skills=owner.get('guidance', []), paths=[]))['paths'].append(name)
    return list(grouped.values())


def planner_files(root, payload):
    registry = payload.get('registry', payload)
    overrides = payload.get('verification', {}) if 'registry' in payload else {}
    need(isinstance(overrides, dict), 'verification overrides must be an object')
    reader = Reader(root); old_catalog = reader.yaml(CATALOG, optional=True)
    previous = {ref['id']: ref['path'] for ref in old_catalog.get('steps', [])} if old_catalog else {}
    if not previous:
        for name in reader.discover('.agents/plans/*/steps/*/step.yaml', 10000):
            binding = reader.yaml(name)
            if binding.get('task_id'): previous[binding['task_id']] = name
    catalog = dict(schema_version=1, **{k: registry[k] for k in ('goals', 'milestones', 'slices')}, steps=[])
    files = {}
    for task in registry['tasks']:
        identity(task['id']); name = previous.get(task['id'], '.agents/plans/workspace/steps/' + task['id'] + '/step.yaml')
        before = reader.yaml(name, optional=True)
        step = normalize_task(task)
        if before and version_one(before.get('schema_version')) and before.get('id') == task['id']:
            # Legacy clients edit their projection; preserve canonical-only intent.
            step['outcome'] = before['outcome']
            step['effect'] = before['effect']
            if before.get('parent'): step['parent'] = before['parent']
            if 'verification' not in task and before['verification']['checks'] == task['verify']:
                step['verification'] = before['verification']
        if task['id'] in overrides:
            step['verification'] = overrides[task['id']]
        ref = dict(id=task['id'], path=name, agent=task['agent'])
        if task['effect'] == 'read_only': ref['legacy_effect'] = 'read_only'
        if task.get('children'): ref['children'] = task['children']
        if 'verification' in task: ref['verification_explicit'] = True
        catalog['steps'].append(ref); files[name] = yaml.safe_dump(step, sort_keys=False, allow_unicode=True)
    files[CATALOG] = yaml.safe_dump(catalog, sort_keys=False, allow_unicode=True)
    candidate = load_snapshot(root)['definitions']
    candidate['catalog'] = {key: registry[key] for key in ('goals', 'milestones', 'slices')}
    candidate['steps'] = [parse_yaml(raw) for name, raw in files.items() if name != CATALOG]
    validate_definitions(candidate)
    for reference in catalog['steps']:
        if reference['id'] not in previous:
            entry = str(Path(reference['path']).parent / 'IMPLEMENT.md')
            template = os.path.relpath('.agents/templates/implementation.md', Path(entry).parent)
            if reader.path(entry, missing=True).exists():
                continue
            files[entry] = '# Implementation entry\n\nUse [task definition](step.yaml) and [shared implementation template](' + template + ').\n'
    return dict(files=files, remove=[name for task_id, name in previous.items() if task_id not in {t['id'] for t in registry['tasks']}])


def trusted_store():
    here = Path(__file__).resolve().parent
    location = here if (here / 'store.py').is_file() else here.parent.parent / '.wisdohm'
    sys.path.insert(0, str(location))
    from store import Store
    return Store


def progress_read(root, project_id='default'):
    database = sql_path(root)
    if not database.is_file(): return dict(body=None, revision=0)
    with closing(sqlite3.connect('file:' + quote(str(database)) + '?mode=ro', uri=True)) as c:
        tables = {row[0] for row in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if 'workflow' not in tables: return dict(body=None, revision=0)
        row = c.execute('SELECT revision,body FROM workflow WHERE project_id=?', (project_id,)).fetchone()
        return dict(revision=row[0], body=json.loads(row[1])) if row else dict(body=None, revision=0)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['validate', 'snapshot', 'resolve', 'ownership', 'ownership-projection', 'route', 'planner-read', 'planner-files', 'progress-read', 'progress-save', 'progress-upgrade'])
    parser.add_argument('--root', type=Path, required=True); parser.add_argument('--task'); parser.add_argument('--path', action='append', default=[])
    parser.add_argument('--output', type=Path); parser.add_argument('--project-id', default='default'); parser.add_argument('--expected-revision', type=int)
    args = parser.parse_args(); root = args.root.resolve()
    if args.action in {'validate', 'snapshot'}:
        result = load_snapshot(root)
        if args.action == 'validate': result = dict(valid=True, generation=result['generation'], source=result['source'], tasks=len(result['definitions']['steps']), blocked=result['blocked'])
    elif args.action == 'resolve': result = resolve_task(root, args.task)
    elif args.action == 'ownership': result = load_ownership(root)
    elif args.action == 'ownership-projection':
        result = ownership_projection(root)
        if args.output:
            target = Reader(root).path(str(args.output), missing=True)
            with tempfile.NamedTemporaryFile(mode='w', dir=target.parent, delete=False) as output:
                json.dump(result, output, ensure_ascii=False, allow_nan=False, indent=2)
                output.write('\n')
            try: os.replace(output.name, target)
            finally: Path(output.name).unlink(missing_ok=True)
    elif args.action == 'route': result = route_paths(root, args.path)
    elif args.action == 'planner-files': result = planner_files(root, json.loads(sys.stdin.read(MAX_TOTAL + 1)))
    elif args.action == 'progress-read': result = progress_read(root, args.project_id)
    elif args.action == 'progress-upgrade':
        need(args.output is not None, 'workflow upgrade needs an explicit backup output')
        result = trusted_store().upgrade_workflow(root, args.output)
    elif args.action == 'progress-save':
        need(args.expected_revision is not None, 'progress save needs expected revision')
        result = trusted_store()(root).save_workflow(args.project_id, json.loads(sys.stdin.read(MAX_TOTAL + 1)), args.expected_revision)
    elif args.action == 'planner-read':
        validated = load_snapshot(root)
        reader = Reader(root); source = selected_source(reader); registry, canonical_steps = read_plan(reader, source)
        progress = progress_read(root, args.project_id) if source == 'files' else dict(body=reader.json('.context/state/progress.json', optional=True), revision=0)
        if source == 'files': need(progress['body'] is not None, 'file authority has no imported operational workflow reports')
        owners = load_ownership(root)
        result = dict(registry=registry, progress=progress['body'], report_revision=progress['revision'], source=source,
                      generation=validated['generation'], inputs=validated['inputs'], verification={step['id']:step['verification'] for step in canonical_steps}, modules=[dict(id=o['id'], purpose=o['purpose'], paths=o['paths']) for o in owners])
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))


if __name__ == '__main__':
    try: main()
    except (ValueError, OSError, sqlite3.Error, yaml.YAMLError, KeyError, TypeError) as error:
        print(json.dumps(dict(error=str(error))), file=sys.stderr); raise SystemExit(1)
