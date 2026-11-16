#!/usr/bin/env python3
"""Task registries and cooperative, host-owned one-module work sessions.

This supplies guards and receipts, not a sandbox for unrestricted external tools.
The existing Router remains the authority for gate/scope/verification checks.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
from graphlib import TopologicalSorter, CycleError
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys
import uuid

_memory_spec = importlib.util.spec_from_file_location('wisdom_memory', Path(__file__).with_name('memory.py'))
_memory = importlib.util.module_from_spec(_memory_spec)
_memory_spec.loader.exec_module(_memory)
MEMORY = _memory.MEMORY
REGISTRIES = ('tasks', 'features', 'ui', 'decisions', 'handoffs', 'addons')
ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$')


class OrchestrationError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise OrchestrationError(message)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def file_digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def unique(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f'duplicate key: {key}')
        result[key] = value
    return result


def read_json(path):
    result = json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=unique)
    require(isinstance(result, dict), f'JSON root must be an object: {path}')
    return result


def atomic_json(path, value):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('x', encoding='utf-8') as handle:
            os.chmod(temporary, 0o600)
            json.dump(value, handle, indent=2)
            handle.write('\n')
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def keyed(items, label):
    result = {}
    for item in items:
        require(item['id'] not in result, f'duplicate {label} ID: {item["id"]}')
        result[item['id']] = item
    return result


def acyclic(graph, label):
    try:
        tuple(TopologicalSorter(graph).static_order())
    except CycleError as error:
        raise OrchestrationError(f'{label} dependency cycle: {error.args[1]}') from error


def banner(phase, task, gates=(), changed=(), memory='pending', next_step='verify'):
    return '\n'.join([
        '+-- CA_WISDOM ' + phase + ' --+',
        f'AGENT {task["agent"]} | TYPE {task["effect"]} | TASK {task["id"]} | MODULE {task["module"]}',
        'GATES ' + (' -> '.join(gates) or 'BOOT -> CONTEXT'),
        'FILES ' + (', '.join(changed) or 'none'),
        'MEMORY ' + memory,
        'NEXT ' + next_step,
        '+----------------------------+',
    ])


class Registries:
    """Validate registry shape, references and selected context using existing authority."""

    def __init__(self, target, router_type):
        self.root = Path(target).resolve()
        self.router_type = router_type
        self.router = router_type(self.root)
        pointer = self.router.index.get('orchestration', 'state/index.json')
        self.index_path = '.context/' + pointer
        self.index = self.router.json(self.index_path)
        self.schema = self.router.json('.context/schemas/orchestration.schema.json')
        self.validate_shape('index', self.index)
        self.documents = {}
        for kind in REGISTRIES:
            path = self.index['registries'][kind]
            self.canonical(path)
            self.documents[kind] = self.router.json(path)
            self.validate_shape(kind, self.documents[kind])
        require(len(set(self.index['registries'].values())) == len(REGISTRIES), 'registry paths must be distinct')
        for paths in self.index['memory'].values():
            for path in paths:
                self.canonical(path)
        self.tasks = keyed(self.documents['tasks']['tasks'], 'task')
        self.features = keyed(self.documents['features']['items'], 'feature')
        self.ui = keyed(self.documents['ui']['items'], 'UI')
        self.addons = keyed(self.documents['addons']['items'], 'addon')
        self.manifest = self.router.manifest()
        self.roles = set(self.manifest['roles']) if self.manifest else {'general'}
        self.modules = self.router.modules.get('modules', {})
        self.validate()

    def canonical(self, path):
        require(isinstance(path, str) and not any(c in path for c in '*?[]'), f'expected exact file path: {path}')
        result = self.router.path(path, write=True)
        require(result.relative_to(self.root).as_posix() == path, f'noncanonical file path: {path}')
        return result

    def validate_shape(self, kind, value):
        import jsonschema
        schema = {'$ref': '#/$defs/' + kind, '$defs': self.schema['$defs']}
        try:
            jsonschema.Draft202012Validator(schema).validate(value)
        except jsonschema.ValidationError as error:
            raise OrchestrationError(f'{kind} registry schema: {error.message}') from error

    def module_matches(self, path):
        return [name for name, item in self.modules.items()
                if any(self.router.matches(path, pattern) for pattern in item.get('paths', []))]

    def owns(self, role, path):
        return any(self.router.matches(path, pattern)
                   for pattern in self.router.project.get('roles', {}).get('ownership', {}).get(role, []))

    def coverage(self):
        rules = self.router.project.get('rules', {})
        roots = rules.get('source_roots')
        if roots is None:
            roots = [name for name in ('src', 'server', 'packages', 'modules', 'plugins') if (self.root / name).is_dir()]
        require(isinstance(roots, list) and all(isinstance(path, str) and path for path in roots), 'source_roots must be an array of project directories')
        ignored = ['.git/', '**/.git/**', '**/.env*', '**/secrets/**'] + rules.get('protected_paths', []) + rules.get('generated_paths', []) + self.router.modules.get('generated_paths', [])
        count = 0
        for relative in roots:
            require(not any(char in relative for char in '*?[]'), 'source_roots cannot contain globs')
            folder = self.router.path(relative)
            require(folder.is_dir() and folder == self.root / relative, f'source root missing or noncanonical: {relative}')
            for directory, dirs, files in os.walk(folder, followlinks=False):
                def skipped(path):
                    name = path.relative_to(self.root).as_posix()
                    return any(self.router.matches(name, pattern) or self.router.matches(name + '/', pattern) for pattern in ignored)
                dirs[:] = [name for name in dirs if name not in {'node_modules', '__pycache__', '.git', '.venv', 'dist', 'build', 'coverage'} and not (Path(directory) / name).is_symlink() and not skipped(Path(directory) / name)]
                for name in files:
                    path = Path(directory) / name
                    if path.is_symlink() or skipped(path):
                        continue
                    source = path.relative_to(self.root).as_posix()
                    modules = self.module_matches(source)
                    require(len(modules) == 1, f'coverage: {source} needs exactly one module (found {modules})')
                    require(any(self.owns(role, source) for role in self.roles), f'coverage: unowned first-party file {source}')
                    count += 1
        return {'roots': roots, 'files': count}

    def validate_scope(self, task):
        readonly = self.router.index['routes'][task['effect']]['writes'] == 'none'
        require(not readonly or not task['write'], f'{task["id"]}: read-only effect cannot declare writes')
        require(not readonly or not task.get('children'), f'{task["id"]}: read-only effects cannot delegate modifying work')
        if task['mode'] == 'worker':
            require(not task.get('children'), f'{task["id"]}: workers cannot delegate children')
        if task.get('children'):
            require(self.index['registries']['handoffs'] in task['write'], f'{task["id"]}: parent must declare its serialized handoff registry output')
        modules = set()
        for path in task['read'] + task['write']:
            self.canonical(path)
        for path in task['write']:
            found = self.module_matches(path)
            require(found, f'{task["id"]}: unclassified source write {path}; register its module')
            require(len(found) == 1, f'{task["id"]}: ambiguous module ownership for {path}: {found}')
            modules.add(found[0])
            require(self.owns(task['agent'], path), f'{task["id"]}: agent {task["agent"]} does not own {path}')
            if task['mode'] == 'worker':
                require(path not in self.router.modules.get('shared_files', []), f'{task["id"]}: shared file requires an integration task: {path}')
        require(len(modules) <= 1, f'{task["id"]}: decomposition_required; a worker operation may edit only one module')
        require(not modules or modules == {task['module']}, f'{task["id"]}: writes do not belong to declared module {task["module"]}')
        require(task['verify'], f'{task["id"]}: declare at least one runnable verification command')
        require(task['acceptance'], f'{task["id"]}: declare observable acceptance criteria')

    def validate(self):
        for name, item in self.modules.items():
            for dependency in item.get('depends_on', []):
                require(dependency in self.modules, f'module {name}: missing dependency {dependency}')
        acyclic({name: item.get('depends_on', []) for name, item in self.modules.items()}, 'module')
        self.coverage_result = self.coverage()
        planning = self.documents['tasks']
        goals = keyed(planning['goals'], 'goal')
        milestones = keyed(planning['milestones'], 'milestone')
        slices = keyed(planning['slices'], 'slice')
        all_ids = [*goals, *milestones, *slices, *self.tasks]
        require(len(set(all_ids)) == len(all_ids), 'planning IDs must be unique across goal/milestone/slice/task')
        for item in milestones.values():
            require(item['goal'] in goals, f'{item["id"]}: missing goal {item["goal"]}')
        for item in slices.values():
            require(item['milestone'] in milestones, f'{item["id"]}: missing milestone {item["milestone"]}')
        for task in self.tasks.values():
            require(task['slice'] in slices, f'{task["id"]}: missing slice {task["slice"]}')
            require(task['effect'] in self.router.index['routes'], f'{task["id"]}: unknown effect {task["effect"]}')
            require(task['agent'] in self.roles, f'{task["id"]}: unknown agent {task["agent"]}')
            require(task['module'] in self.modules, f'{task["id"]}: unknown module {task["module"]}')
            for dependency in task['depends_on'] + task.get('children', []):
                require(dependency in self.tasks, f'{task["id"]}: unknown task reference {dependency}')
                require(dependency != task['id'], f'{task["id"]}: task cannot depend on/delegate itself')
            if task.get('feature'):
                require(task['feature'] in self.features, f'{task["id"]}: missing feature {task["feature"]}')
            for surface in task.get('ui', []):
                require(surface in self.ui, f'{task["id"]}: missing UI surface {surface}')
            if task.get('spec'):
                require(self.canonical(task['spec']).is_file(), f'{task["id"]}: missing task specification {task["spec"]}')
            self.validate_scope(task)
        acyclic({key: item['depends_on'] for key, item in self.tasks.items()}, 'task')
        acyclic({key: item.get('children', []) for key, item in self.tasks.items()}, 'delegation')
        acyclic({key: list(set(item['depends_on'] + item.get('children', []))) for key, item in self.tasks.items()}, 'task/delegation')
        for name, entries in [('feature', self.features), ('addon', self.addons)]:
            for item in entries.values():
                require(item['modules'], f'{name} {item["id"]}: declare module references')
                for module in item['modules']:
                    require(module in self.modules, f'{name} {item["id"]}: unknown module {module}')
                for task in item['tasks']:
                    require(task in self.tasks, f'{name} {item["id"]}: unknown task {task}')
                    require(self.tasks[task]['module'] in item['modules'], f'{name} {item["id"]}: task {task} is outside the declared modules')
                for path in item['entrypoints']:
                    self.entrypoint(path, item['modules'], item['status'], name + ' ' + item['id'])
                for interface in item['requires']:
                    module = self.modules.get(interface['module'])
                    require(module is not None, f'{name} {item["id"]}: unknown required module')
                    require(self.module_matches(interface['entrypoint']) == [interface['module']], f'public interface {interface["entrypoint"]} belongs to another/ambiguous module')
                    require(interface['module'] in item['modules'] or any(interface['module'] in self.modules[consumer].get('depends_on', []) for consumer in item['modules']), f'{name} {item["id"]}: required module is not a declared dependency')
                    require(interface['entrypoint'] in module.get('public_surfaces', []), f'{name} {item["id"]}: unregistered public interface {interface["entrypoint"]}')
                    require(self.canonical(interface['entrypoint']).is_file(), f'missing public interface {interface["entrypoint"]}')
                require(item['status'] != 'verified' or item['checks'], f'{name} {item["id"]}: verified wiring needs declared checks')
        for item in self.ui.values():
            require(item['feature'] in self.features, f'UI {item["id"]}: unknown feature {item["feature"]}')
            require(item['module'] in self.features[item['feature']]['modules'], f'UI {item["id"]}: module is outside its feature')
            self.entrypoint(item['entrypoint'], [item['module']], item['status'], 'UI ' + item['id'])
            require(item['status'] != 'verified' or item['checks'], f'UI {item["id"]}: verified surface needs checks')
        for item in self.addons.values():
            for dependency in item['depends_on']:
                require(dependency in self.addons, f'addon {item["id"]}: missing dependency {dependency}')
            for path in item['context']:
                require(self.canonical(path).is_file(), f'addon {item["id"]}: missing context {path}')
        acyclic({key: item['depends_on'] for key, item in self.addons.items()}, 'addon')
        for item in keyed(self.documents['decisions']['items'], 'decision').values():
            require(all(key in self.tasks for key in item['tasks']), f'decision {item["id"]}: unknown task')
            require(all(key in self.modules for key in item['modules']), f'decision {item["id"]}: unknown module')
            for path in item['evidence']:
                require(self.canonical(path).is_file(), f'decision {item["id"]}: missing evidence {path}')
        require(self.index['decision_tree'] == [{'if': 'read_only', 'then': 'inspect'}, {'if': 'has_children', 'then': 'orchestrate'}, {'if': 'owned_module', 'then': 'worker'}, {'else': 'triage'}], 'decision tree must preserve read-only, orchestration, ownership and final triage branches')
        for item in keyed(self.documents['handoffs']['items'], 'handoff').values():
            require(item['task'] in self.tasks and item['agent'] in self.roles and item['module'] in self.modules, f'handoff {item["id"]}: dangling task/agent/module')
            require(all(path in self.tasks[item['task']]['write'] for path in item['changed']), f'handoff {item["id"]}: unknown changed file')
            receipt = item['receipt']
            body = {key: value for key, value in receipt.items() if key != 'digest'}
            require(receipt['digest'] == digest(body) == item['receipt_digest'], 'durable handoff receipt digest mismatch')
            require(all(item[key] == receipt[key] for key in ('id', 'task', 'agent', 'module', 'changed', 'next')), 'durable handoff identity/provenance mismatch')
            require(receipt['contract_digest'] == digest(receipt['proof']), 'durable handoff contract proof mismatch')
            chain = self.router.chain_integrity(receipt['proof'])
            required = (['WRITE'] if receipt['proof']['write'] else []) + ['VERIFY']
            require([entry['gate'] for entry in chain] == required and all(entry['outcome'] == 'pass' for entry in chain), 'durable handoff has incomplete or failed verification')
            require(receipt['outputs'] == chain[-1]['outputs'], 'durable handoff outputs differ from verified proof')

    def entrypoint(self, path, modules, status, label):
        file = self.canonical(path)
        found = self.module_matches(path)
        require(len(found) == 1 and found[0] in modules, f'{label}: entrypoint {path} is not wired to one declared module')
        require(status == 'planned' or file.is_file(), f'{label}: missing entrypoint {path}')

    def binding(self, writes=()):
        paths = [self.index_path, '.context/schemas/orchestration.schema.json', '.context/memory.py']
        paths += [path for kind, path in self.index['registries'].items() if kind != 'handoffs' and path not in writes]
        return digest({path: file_digest(self.root / path) for path in paths})

    def route(self, task_id, lean=False, max_chars=None, continuing=False):
        require(task_id in self.tasks, f'unknown atomic task: {task_id}')
        task = self.tasks[task_id]
        decision = self.router.route(task['effect'], task['write'], task['agent'], check_source=not continuing)
        load = set(decision['load']) | set(task['read'])
        selected_addons = set()
        def include_addon(identity):
            if identity in selected_addons:
                return
            selected_addons.add(identity)
            for dependency in self.addons[identity]['depends_on']:
                include_addon(dependency)
            load.update(self.addons[identity]['context'])
        for identity, addon in self.addons.items():
            if task_id in addon['tasks']:
                include_addon(identity)
        readonly = decision['write_ceiling'] == 'none'
        conditions = {'read_only': readonly, 'has_children': bool(task.get('children')), 'owned_module': task['module'] in self.modules}
        branch = next(item for item in self.index['decision_tree'] if 'else' in item or conditions[item['if']])
        result = {'task': task, 'agent': task['agent'], 'effect': task['effect'], 'module': self.modules[task['module']], 'decision': branch, 'action': branch.get('then', branch.get('else')), 'load': sorted(load), 'addons': sorted(selected_addons), 'mode': 'lean' if lean else 'normal', 'banner': banner('START', task)}
        if not lean:
            result['context'] = [{'path': path, 'text': self.router.read(path)} for path in result['load']]
        limit = max_chars if max_chars is not None else self.index['max_context_chars']
        require(isinstance(limit, int) and 1500 <= limit <= 100000, 'context budget must be 1500..100000 characters')
        result['payload_chars'] = 0
        for _ in range(3):
            result['payload_chars'] = len(json.dumps(result, indent=2, ensure_ascii=False)) + 1
        require(result['payload_chars'] <= limit, f'context payload is {result["payload_chars"]} characters, budget {limit}; use --lean or raise the declared budget')
        return result


def validate_registries(target, router_type):
    registry = Registries(target, router_type)
    return {'action': 'valid', 'tasks': len(registry.tasks), 'features': len(registry.features), 'ui': len(registry.ui), 'addons': len(registry.addons), 'coverage': registry.coverage_result}


class SessionStore:
    """Atomic cooperative claims; the execution host must guard actual file tools."""

    def __init__(self, path, project):
        self.root = Path(path).absolute()
        physical = self.root.resolve()
        require(self.root == physical, 'host session directory cannot traverse symlinks')
        require(physical != project and project not in physical.parents, 'session directory must be outside the project')
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        require(stat.S_IMODE(self.root.stat().st_mode) & 0o077 == 0, 'host session directory must be private (mode 0700)')
        if hasattr(os, 'getuid'):
            require(self.root.stat().st_uid == os.getuid(), 'host session directory must be owned by the execution host')

    @contextmanager
    def lock(self):
        path = self.root / '.lock'
        try:
            path.mkdir(mode=0o700)
        except FileExistsError as error:
            raise OrchestrationError('session store busy; retry after the active operation; stale locks require explicit host recovery') from error
        try:
            yield
        finally:
            path.rmdir()

    def path(self, identity):
        require(isinstance(identity, str) and ID.fullmatch(identity), 'invalid session ID')
        path = self.root / 'sessions' / (identity + '.json')
        require(path.resolve() == path, 'host session path cannot traverse symlinks')
        return path

    def load(self, identity):
        session = read_json(self.path(identity))
        integrity = session.pop('integrity', None)
        require(integrity == digest(session), f'session {identity}: altered host state')
        require(session.get('id') == identity, 'session identity mismatch')
        return session

    def save(self, session):
        value = dict(session)
        value['integrity'] = digest(value)
        atomic_json(self.path(session['id']), value)

    def all(self):
        folder = self.root / 'sessions'
        return [self.load(path.stem) for path in folder.glob('*.json')] if folder.exists() else []


class Orchestrator:
    def __init__(self, target, session_dir, router_type):
        self.registry = Registries(target, router_type)
        self.root = self.registry.root
        self.router_type = router_type
        self.store = SessionStore(session_dir, self.root)

    def current(self):
        self.registry = Registries(self.root, self.router_type)
        return self.registry

    def outputs(self, paths):
        return {path: file_digest(self.root / path) for path in paths}

    def validate_session(self, session):
        registry = self.current()
        require(session['root'] == str(self.root), 'session targets another project')
        require(session['task_id'] in registry.tasks and session['task'] == registry.tasks[session['task_id']], 'task definition changed; declare a new session')
        require(session['binding'] == registry.binding(session['contract']['write']), 'registry/decision authority changed; declare a new session')
        registry.router.check_scope(session['contract'], [])
        return registry

    @staticmethod
    def parent_binding(parent):
        return digest({'id': parent['id'], 'task': parent['task'], 'contract': parent['contract']['approval_key'], 'approved': parent['approved']})

    def journal_prefix(self):
        journal = self.registry.documents['handoffs']
        return [digest(item) for item in journal['items']]

    def receipt(self, session):
        registry = self.current()
        require(session['root'] == str(self.root) and registry.tasks.get(session['task_id']) == session['task'], 'closed task definition changed')
        require(session['state'] == 'closed' and session.get('receipt'), f'child {session["id"]} has no successful closing receipt')
        receipt = dict(session['receipt'])
        recorded = receipt.pop('digest', None)
        require(recorded == digest(receipt), f'child {session["id"]}: altered receipt')
        require(receipt['contract_digest'] == digest(session['contract']) and receipt['proof'] == session['contract'], 'receipt contract mismatch')
        chain = registry.router.chain_integrity(session['contract'])
        expected = (['WRITE'] if session['contract']['write'] else []) + ['VERIFY']
        require([entry['gate'] for entry in chain] == expected and all(entry['outcome'] == 'pass' for entry in chain), 'historical receipt needs a completed passing gate chain')
        journal_path = registry.index['registries']['handoffs']
        # Historical derived seals may be refreshed through their existing population
        # phases. Explicit reads, playbooks, rules, ownership and schemas remain exact;
        # internally loaded map/flow facts may refresh only with current population.
        derived = {'.planning/codebase/index.json', '.context/state/population.json', '.wisdom/agents/agents.json'}
        derived.update('.planning/codebase/' + name + '.md' for name in ('STACK', 'INTEGRATIONS', 'ARCHITECTURE', 'STRUCTURE', 'CONVENTIONS', 'TESTING', 'CONCERNS'))
        derived.update('.wisdom/agents/flow/' + name + '.md' for name in ('ARCHITECTURE', 'CONVENTIONS', 'INTEGRATIONS', 'STATE', 'STRUCTURE', 'TESTING'))
        derived.difference_update(session['task']['read'])
        refreshed_facts = any(file_digest(self.root / path) != expected_hash for path, expected_hash in session['contract']['evidence'].items() if path in derived)
        exempt = set(session['contract']['write']) | derived | {journal_path, registry.index['registries']['tasks']}
        for path, expected_hash in session['contract']['evidence'].items():
            if path not in exempt:
                actual = None
                if (self.root / path).exists():
                    registry.router.read(path)
                    actual = registry.router.evidence[path]
                require(actual == expected_hash, f'historical receipt authority/input changed: {path}')
        registry.router.route(session['task']['effect'], session['task']['write'], session['task']['agent'], check_source=refreshed_facts)
        for path, expected_hash in receipt['outputs'].items():
            if path != journal_path and path not in derived:
                require(file_digest(self.root / path) == expected_hash, f'child {session["id"]}: verified output changed: {path}')
        prefix = receipt['journal_prefix']
        require(self.journal_prefix()[:len(prefix)] == prefix, 'handoff journal prefix was altered or removed')
        return session['receipt']

    def children(self, parent, identities=None):
        expected = parent['approved']
        selected = list(identities if identities is not None else parent['children'])
        require(set(selected) == set(parent['children']), 'join must include every active child exactly once')
        require(len(selected) == len(set(selected)), 'duplicate child session in join')
        children = [self.store.load(identity) for identity in selected]
        require({child['task_id'] for child in children} == set(expected) and len(children) == len(expected), 'missing required child receipts')
        for child in children:
            require(child['parent'] == parent['id'] and child['parent_binding'] == self.parent_binding(parent), 'child parent binding mismatch')
            require(child['task'] == expected[child['task_id']], 'child is outside the parent-approved task scope')
            self.receipt(child)
        return children

    def start(self, task_id, identity, parent_id=None, allow_children=(), approval=None):
        registry = self.current()
        require(task_id in registry.tasks, f'unknown atomic task: {task_id}')
        task = registry.tasks[task_id]
        with self.store.lock():
            require(not self.store.path(identity).exists(), f'session already exists: {identity}')
            sessions = [s for s in self.store.all() if s['root'] == str(self.root)]
            completed = {s['task_id'] for s in sessions if s['task_id'] in task['depends_on'] and s['state'] == 'closed' and self.receipt(s)}
            require(set(task['depends_on']) <= completed, 'task dependencies do not have current successful receipts')
            parent = self.store.load(parent_id) if parent_id else None
            if parent:
                self.validate_session(parent)
                require(parent['state'] == 'started' and task_id in parent['approved'], 'parent has not approved this child task')
                require(task == parent['approved'][task_id], 'child scope exceeds the parent-approved task definition')
                require(not any(self.store.load(key)['task_id'] == task_id for key in parent['children']), 'parent already has this child task')
            require(not allow_children or task['mode'] == 'orchestrator', 'only an orchestrator task may approve children')
            require(set(allow_children) <= set(task.get('children', [])), 'requested child is outside the planned task children')
            require(set(allow_children) == set(task.get('children', [])), 'approve every planned child explicitly, or split the parent plan')
            active = [s for s in sessions if s['state'] in {'started', 'verifying', 'verified', 'failed'}]
            require(len(active) < registry.router.project.get('thresholds', {}).get('max_parallel_agents', 4), 'parallel agent limit reached')
            for other in active:
                overlap = set(task['write']).intersection(other['contract']['write'])
                require(not overlap, f'overlapping live file claims with {other["id"]}: {sorted(overlap)}')
            core_effect = task['effect'] if task['write'] else 'read_only'
            inputs = sorted(set(task['read'] + [registry.index_path, registry.index['registries']['tasks'], '.context/schemas/orchestration.schema.json']))
            contract = registry.router.preflight(core_effect, task['write'], inputs, verify=task['verify'], role=task['agent'], approval=approval, continuing=bool(parent))
            if contract['status'] != 'ready':
                return {'action': 'waiting_for_human', 'task': task, 'contract': contract, 'approval_key': contract['approval_key'], 'banner': banner('BLOCKED', task, next_step='host approval of the exact proposal required')}
            if task['write']:
                contract = registry.router.record_gate(contract, 'WRITE')
            session = {'id': identity, 'root': str(self.root), 'task_id': task_id, 'task': task, 'state': 'started', 'contract': contract, 'binding': registry.binding(contract['write']), 'parent': parent_id, 'parent_binding': self.parent_binding(parent) if parent else None, 'approved': {key: registry.tasks[key] for key in allow_children}, 'children': [], 'aborted_children': [], 'reconciled': [], 'baseline': self.outputs(contract['write']), 'memory_baseline': {key: self.outputs(paths) for key, paths in registry.index['memory'].items()}, 'opened_at': datetime.now(timezone.utc).isoformat()}
            self.store.save(session)
            if parent:
                parent['children'].append(identity)
                self.store.save(parent)
            return {'action': 'started', 'session': identity, 'contract': contract['approval_key'], 'cooperative_guard': 'check every mutating tool; unchecked external writes are not sandboxed', 'banner': banner('START', task, [entry['gate'] for entry in contract['gate_chain']])}

    def check(self, identity, paths=()):
        with self.store.lock():
            session = self.store.load(identity)
            registry = self.validate_session(session)
            require(session['state'] == 'started', 'writes are allowed only before verification starts')
            others = [p for other in self.store.all() if other['id'] != identity and other['root'] == str(self.root) and other['state'] in {'started', 'verifying', 'verified', 'failed'} for p in other['contract']['write']]
            registry.router.check_scope(session['contract'], paths, others)
            if session['parent']:
                parent = self.store.load(session['parent'])
                require(parent['state'] == 'started' and session['parent_binding'] == self.parent_binding(parent), 'parent is no longer open with the approved scope')
            return {'action': 'allowed', 'paths': list(paths), 'session': identity}

    def project_snapshot(self, ignored=()):
        rules = self.registry.router.project.get('rules', {})
        omitted = set(ignored)
        result = {}
        for directory, dirs, files in os.walk(self.root, followlinks=False):
            dirs[:] = [name for name in dirs if name not in {'.git', 'node_modules', '__pycache__', '.venv', 'dist', 'build', 'coverage'} and not (Path(directory) / name).is_symlink()]
            for name in files:
                path = Path(directory) / name
                relative = path.relative_to(self.root).as_posix()
                if path.is_symlink() or relative in omitted or any(self.registry.router.matches(relative, pattern) for pattern in ['**/.env*', '**/secrets/**'] + rules.get('protected_paths', []) + rules.get('generated_paths', [])):
                    continue
                result[relative] = file_digest(path)
        return result

    def verify(self, identity):
        with self.store.lock():
            session = self.store.load(identity)
            registry = self.validate_session(session)
            require(session['state'] == 'started', 'verification requires an open, unverified session')
            if session['approved']:
                self.children(session)
                require(set(session['reconciled']) == set(session['children']), 'merge child handoffs before parent verification')
            session['state'] = 'verifying'
            self.store.save(session)
            contract = session['contract']
            other_claims = {path for other in self.store.all() if other['id'] != identity and other['root'] == str(self.root) and other['state'] in {'started', 'verifying', 'verified', 'failed'} for path in other['contract']['write']}
            before = self.project_snapshot(other_claims) if not contract['write'] else None
        # Release the registry lock while disjoint workers execute their checks.
        try:
            result, contract = registry.router.verify_all(contract)
        except Exception:
            with self.store.lock():
                session = self.store.load(identity)
                session['state'] = 'failed'
                self.store.save(session)
            raise
        with self.store.lock():
            session = self.store.load(identity)
            require(session['state'] == 'verifying', 'session changed while verification ran')
            session['contract'] = contract
            if before is not None:
                after_claims = {path for other in self.store.all() if other['id'] != identity and other['root'] == str(self.root) and other['state'] in {'started', 'verifying', 'verified', 'failed'} for path in other['contract']['write']}
                expected = {path: value for path, value in before.items() if path not in after_claims}
                actual = self.project_snapshot(other_claims | after_claims)
                if expected != actual:
                    session['state'] = 'failed'
                    session['failure'] = 'read-only verification changed project files outside concurrent claims'
                    self.store.save(session)
                    raise OrchestrationError(session['failure'] + '; review changes before explicit abort')
            session['state'] = 'verified' if result['exit'] == 0 else 'failed'
            self.store.save(session)
            return dict(result, session=identity, banner=banner('CONTINUE' if result['exit'] == 0 else 'BLOCKED', session['task'], [entry['gate'] for entry in contract['gate_chain']], next_step='memory assessment and close' if result['exit'] == 0 else 'abort and redeclare'))

    def assess_memory(self, session, assessment):
        require(isinstance(assessment, dict) and set(assessment) == set(MEMORY), 'memory assessment must include codebase/changelog/progress/goals/decisions/roadmap/features/ui exactly')
        self.registry.validate_shape('memory', assessment)
        current = {key: self.outputs(self.registry.index['memory'][key]) for key in MEMORY}
        return _memory.assess_memory(assessment, session['memory_baseline'], current, session['contract']['write'])

    def close(self, identity, assessment=None, child_ids=None, next_step='none', approval=None):
        with self.store.lock():
            session = self.store.load(identity)
            registry = self.validate_session(session)
            require(session['state'] == 'verified', 'close requires successful verification')
            if session['approved']:
                self.children(session, child_ids)
                require(set(session['reconciled']) == set(session['children']), 'parent handoff merge is incomplete')
            else:
                require(not child_ids, 'this session has no delegated children')
            if not session['contract']['write']:
                assessment = {key: {'status': 'not_applicable', 'reason': 'Read-only operation; no project memory mutation.'} for key in MEMORY}
            memory = self.assess_memory(session, assessment)
            transition = registry.router.next(session['contract']['task'], 'CLOSE', outcome='pass', approval=approval, contract=session['contract'], evidence='memory ' + digest(memory))
            if transition['action'] != 'complete':
                return dict(transition, session=identity, memory=memory, banner=banner('BLOCKED', session['task'], next_step='host close approval required; session remains verified'))
            outputs = self.outputs(session['contract']['write'])
            changed = sorted(path for path in outputs if outputs[path] != session['baseline'][path])
            receipt = {'id': identity, 'task': session['task_id'], 'agent': session['task']['agent'], 'module': session['task']['module'], 'parent': session['parent'], 'contract_digest': digest(session['contract']), 'proof': session['contract'], 'journal_prefix': self.journal_prefix(), 'outputs': outputs, 'changed': changed, 'memory': memory, 'children': list(session['children']), 'next': next_step, 'closed_at': datetime.now(timezone.utc).isoformat()}
            receipt['digest'] = digest(receipt)
            session['receipt'] = receipt
            session['state'] = 'closed'
            self.store.save(session)
            return {'action': 'closed', 'receipt': receipt, 'banner': banner('CLOSED', session['task'], ['BOOT', 'CONTEXT', *[entry['gate'] for entry in session['contract']['gate_chain']], 'CLOSE'], changed, 'assessed; child deltas returned to orchestrator' if session['parent'] else 'assessed', next_step)}

    def reconcile(self, identity, children):
        with self.store.lock():
            parent = self.store.load(identity)
            registry = self.validate_session(parent)
            require(parent['state'] == 'started' and parent['task']['mode'] == 'orchestrator', 'handoffs merge only in an open orchestrator task before verification')
            candidates = self.children(parent, children)
            path = registry.index['registries']['handoffs']
            registry.router.check_scope(parent['contract'], [path])
            document = read_json(self.root / path)
            existing = {item['id'] for item in document['items']}
            for child in candidates:
                receipt = child['receipt']
                if child['id'] in existing:
                    old = next(item for item in document['items'] if item['id'] == child['id'])
                    require(old['receipt_digest'] == receipt['digest'], 'existing handoff receipt conflicts')
                    continue
                document['items'].append({'id': child['id'], 'task': child['task_id'], 'agent': child['task']['agent'], 'module': child['task']['module'], 'receipt_digest': receipt['digest'], 'changed': receipt['changed'], 'summary': child['task']['title'], 'next': receipt['next'], 'receipt': receipt})
            registry.validate_shape('handoffs', document)
            atomic_json(self.root / path, document)
            parent['reconciled'] = list(children)
            self.store.save(parent)
            return {'action': 'reconciled', 'registry': path, 'children': list(children), 'next': 'verify parent, then close with memory digests'}

    def archive(self, identity, publisher_task, publication_id, approval=None, close_approval=None):
        """Publish root proof under a fresh metadata contract; never recursively self-journal."""
        with self.store.lock():
            closed = self.store.load(identity)
            receipt = self.receipt(closed)
            require(closed['parent'] is None, 'child receipts are published by their parent reconciliation')
            require(publisher_task in self.registry.tasks, 'unknown metadata publisher task')
            publisher = self.registry.tasks[publisher_task]
            path = self.registry.index['registries']['handoffs']
            require(publisher['mode'] == 'orchestrator' and publisher['write'] == [path] and not publisher.get('children'), 'publication task must own only the handoff journal and have no children')
            existing_session = self.store.load(publication_id) if self.store.path(publication_id).exists() else None
            if existing_session:
                require(existing_session['task_id'] == publisher_task and existing_session.get('publication_of') == identity, 'publication session belongs to another operation')
                require(existing_session['state'] in {'verified', 'closed'}, 'interrupted/failed publisher requires explicit abort and a new publication ID')
        if not existing_session:
            started = self.start(publisher_task, publication_id, approval=approval)
            if started['action'] == 'waiting_for_human':
                return started
            with self.store.lock():
                publishing = self.store.load(publication_id)
                publishing['publication_of'] = identity
                self.store.save(publishing)
                registry = self.validate_session(publishing)
                registry.router.check_scope(publishing['contract'], [path])
                document = read_json(self.root / path)
                existing = next((item for item in document['items'] if item['id'] == identity), None)
                if existing:
                    require(existing['receipt_digest'] == receipt['digest'], 'root handoff conflicts with an existing receipt')
                else:
                    document['items'].append({'id': identity, 'task': closed['task_id'], 'agent': closed['task']['agent'], 'module': closed['task']['module'], 'receipt_digest': receipt['digest'], 'changed': receipt['changed'], 'summary': closed['task']['title'], 'next': receipt['next'], 'receipt': receipt})
                    registry.validate_shape('handoffs', document)
                    atomic_json(self.root / path, document)
            result = self.verify(publication_id)
            if result['exit'] != 0:
                return dict(result, action='publication_failed', registry=path)
        publishing = self.store.load(publication_id)
        if publishing['state'] == 'closed':
            published = {'receipt': self.receipt(publishing), 'banner': self.status(publication_id)['banner']}
        else:
            assessment = {}
            for key, paths in self.registry.index['memory'].items():
                changes = [name for name in paths if file_digest(self.root / name) != publishing['memory_baseline'][key][name]]
                assessment[key] = {'status': 'updated' if changes else 'unchanged', 'reason': 'Mechanical archival of an already closed operation; no new product behavior.', 'artifacts': [{'path': name, 'sha256': file_digest(self.root / name)} for name in changes]}
            published = self.close(publication_id, assessment, approval=close_approval)
            if published['action'] != 'closed':
                return dict(published, publication_id=publication_id, next='repeat archive with --close-approval after the host approves the verified publisher')
        return {'action': 'archived', 'session': identity, 'registry': path, 'receipt_digest': receipt['digest'], 'publication': published['receipt'], 'banner': published['banner'], 'note': 'The publication proof is returned to the host; mechanical archival does not recursively journal itself.'}

    def abort(self, identity):
        with self.store.lock():
            session = self.store.load(identity)
            require(session['state'] not in {'closed', 'aborted', 'verifying'}, 'cannot abort a closed/aborted session or interrupt an active verifier')
            require(not any(self.store.load(key)['state'] not in {'closed', 'aborted'} for key in session['children']), 'abort active children before their parent')
            session['state'] = 'aborted'
            self.store.save(session)
            if session['parent']:
                parent = self.store.load(session['parent'])
                parent['children'].remove(identity)
                parent['aborted_children'].append(identity)
                self.store.save(parent)
            return {'action': 'aborted', 'session': identity, 'banner': banner('ABORTED', session['task'], next_step='review changes and redeclare; no automatic rollback')}

    def status(self, identity):
        with self.store.lock():
            session = self.store.load(identity)
            self.receipt(session) if session['state'] == 'closed' else self.validate_session(session)
            return {'session': identity, 'state': session['state'], 'task': session['task_id'], 'children': session['children'], 'claim': session['contract']['write'] if session['state'] not in {'closed', 'aborted'} else [], 'banner': banner('CLOSED' if session['state'] == 'closed' else 'ABORTED' if session['state'] == 'aborted' else 'CONTINUE', session['task'], [entry['gate'] for entry in session['contract']['gate_chain']], session.get('receipt', {}).get('changed', []), 'assessed' if session['state'] == 'closed' else 'pending', session.get('receipt', {}).get('next', 'verify and close'))}


def main(target, argv, router_type):
    parser = argparse.ArgumentParser(prog='router.py orchestrate', description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('validate')
    route = commands.add_parser('route')
    route.add_argument('--task', required=True)
    route.add_argument('--lean', action='store_true')
    route.add_argument('--max-chars', type=int)
    for name in ('start', 'check', 'verify', 'close', 'reconcile', 'archive', 'abort', 'status'):
        command = commands.add_parser(name)
        command.add_argument('--session-dir', type=Path, required=True)
        command.add_argument('--id', required=True)
        if name == 'start':
            command.add_argument('--task', required=True)
            command.add_argument('--parent')
            command.add_argument('--approval')
            command.add_argument('--allow-child', action='append', default=[])
        if name == 'archive':
            command.add_argument('--close-approval')
            command.add_argument('--publisher-task', required=True)
            command.add_argument('--publication-id', required=True)
            command.add_argument('--approval')
        if name == 'check':
            command.add_argument('--path', action='append', default=[])
        if name in {'close', 'reconcile'}:
            command.add_argument('--child', action='append', default=[])
        if name == 'close':
            command.add_argument('--approval')
            command.add_argument('--memory', type=Path)
            command.add_argument('--next', default='none')
        if name == 'status':
            command.add_argument('--card', action='store_true')
    args = parser.parse_args(argv)
    try:
        if args.command == 'validate':
            result = validate_registries(target, router_type)
        elif args.command == 'route':
            result = Registries(target, router_type).route(args.task, args.lean, args.max_chars)
        else:
            orchestrator = Orchestrator(target, args.session_dir, router_type)
            if args.command == 'start':
                result = orchestrator.start(args.task, args.id, args.parent, args.allow_child, args.approval)
            elif args.command == 'check':
                result = orchestrator.check(args.id, args.path)
            elif args.command == 'verify':
                result = orchestrator.verify(args.id)
            elif args.command == 'close':
                result = orchestrator.close(args.id, read_json(args.memory) if args.memory else None, args.child or None, args.next, args.approval)
            elif args.command == 'reconcile':
                result = orchestrator.reconcile(args.id, args.child)
            elif args.command == 'archive':
                result = orchestrator.archive(args.id, args.publisher_task, args.publication_id, args.approval, args.close_approval)
            elif args.command == 'abort':
                result = orchestrator.abort(args.id)
            else:
                result = orchestrator.status(args.id)
                if args.card:
                    print(result['banner'])
                    return 0
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 2 if result.get('action') == 'waiting_for_human' else 3 if result.get('exit', 0) else 0
    except Exception as error:
        print(json.dumps({'action': 'stop', 'error': str(error), 'banner': '+-- CA_WISDOM BLOCKED --+\n' + str(error)}, indent=2), file=sys.stderr)
        return 1
