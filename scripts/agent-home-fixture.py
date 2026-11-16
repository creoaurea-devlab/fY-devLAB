#!/usr/bin/env python3
"""Independent disposable agent-home data; no stored command is executed here."""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import tempfile


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def digest(value):
    return hashlib.sha256(encoded(value).encode()).hexdigest()


def fixture_document():
    """Return fresh values on each call so adverse probes cannot mutate the baseline."""
    roles = [{
        'schema_version': 1, 'id': identity, 'purpose': 'Fixture ' + identity,
        'instructions': '.agents/agents/' + identity + '/agent.md',
        'skills': ['.agents/skills/fixture/SKILL.md'],
    } for identity in ['coordinator', 'planner', 'implementer', 'reviewer', 'verifier']]
    defaults = {
        'brainstorm': ('planner', 'review'), 'spec': ('planner', 'review'),
        'roadmap': ('planner', 'review'), 'feature': ('implementer', 'targeted'),
        'bugfix': ('implementer', 'targeted'), 'refactor': ('implementer', 'targeted'),
        'audit': ('reviewer', 'review'), 'docs': ('implementer', 'review'),
        'maintenance': ('implementer', 'smoke'),
    }
    workflows = [{
        'schema_version': 1, 'kind': kind, 'agent': agent,
        'procedure': ['Read the actual task.', 'Return concrete evidence.'],
        'guidance': ['.agents/guides/VERIFICATION.md'],
        'verification': {'default': level, 'reason': 'Independent fixture evidence policy.'},
    } for kind, (agent, level) in defaults.items()]
    ownership = [{
        'schema_version': 1, 'id': identity, 'group': group,
        'purpose': 'Own fixture ' + group, 'paths': [prefix + '/**'],
        'public': [public], 'uses': [], 'guidance': ['.agents/skills/fixture/SKILL.md'],
    } for identity, group, prefix, public in [
        ('fixture-source', 'backend', 'src', 'src/value.ts'),
        ('fixture-docs', 'coordination', 'docs', 'docs/guide.md'),
    ]]
    catalog = {'goals': [{'id': 'G', 'title': 'Fixture outcomes'}],
               'milestones': [{'id': 'M', 'goal': 'G', 'title': 'Fixture migration'}],
               'slices': [{'id': 'S', 'milestone': 'M', 'title': 'Bounded work'}]}
    bug_check = ('node --input-type=module -e "import assert from \'node:assert/strict\'; '
                 'import { value } from \'./src/value.ts\'; assert.equal(value, 2);"')
    entries = [
        ('DOCS', 'docs', 'change_source', 'fixture-docs', ['docs/guide.md'], [], 'review', [],
         'The guide explains fixture ownership.'),
        ('AUDIT', 'audit', 'inspect', 'fixture-source', [], [], 'review', [],
         'Findings distinguish inspected source from executed checks.'),
        ('BUGFIX', 'bugfix', 'change_source', 'fixture-source', ['src/value.ts'], ['BASELINE'],
         'targeted', [bug_check], 'The exported value is 2.'),
        ('BASELINE', 'maintenance', 'change_source', 'fixture-docs', ['docs/history.md'], [],
         'smoke', ['node --check src/value.ts'], 'The saved baseline remains available.'),
    ]
    steps = [{
        'schema_version': 1, 'id': identity, 'title': identity + ' fixture task',
        'outcome': acceptance, 'kind': kind, 'effect': effect, 'owner': owner,
        'slice': 'S', 'read': ['src/value.ts'], 'write': write, 'needs': needs,
        'acceptance': [acceptance], 'mode': 'worker',
        'verification': {'level': level, 'reason': 'Evidence selected for this fixture outcome.', 'checks': checks},
    } for identity, kind, effect, owner, write, needs, level, checks, acceptance in entries]
    legacy_tasks = [{
        'id': step['id'], 'slice': 'S', 'title': step['title'],
        'effect': 'read_only' if step['kind'] == 'audit' else step['kind'],
        'agent': 'general', 'module': step['owner'], 'mode': 'worker',
        'depends_on': step['needs'], 'read': step['read'], 'write': step['write'],
        'verify': step['verification']['checks'], 'acceptance': step['acceptance'],
    } for step in steps]
    legacy = {'schema_version': 1, **deepcopy(catalog), 'tasks': legacy_tasks}
    by_id = {task['id']: task for task in legacy_tasks}
    states = {}
    for identity, status in [('DOCS', 'pending'), ('AUDIT', 'review'), ('BUGFIX', 'running'), ('BASELINE', 'complete')]:
        task = by_id[identity]
        states[identity] = {
            'status': status, 'reportedBy': 'fixture-operator',
            'updatedAt': '2026-11-03T12:00:00.000Z',
            'note': 'Reported workflow only; never imported execution proof.',
            'provenance': 'reported',
            'definitionDigest': digest({'task': task, 'dependencies': [by_id[key] for key in task['depends_on']]}),
        }
    progress = {'schemaVersion': 1, 'revision': 7, 'states': states,
                'milestones': {'M': {'stage': 'running', 'group': 'Fixture', 'archived': False}},
                'order': {'S': [step['id'] for step in steps]}, 'events': [], 'recentCommands': []}
    sources = {'src/value.ts': 'export const value = 1;\n',
               'docs/guide.md': '# Before\nFixture guide.\n',
               'docs/history.md': '# Baseline\nSaved fixture content.\n'}
    adverse = {
        'malformed_json': '{"schema_version":',
        'duplicate_keys_json': '{"schema_version":1,"schema_version":2}',
        'duplicate_ids': ['BUGFIX', 'BUGFIX'],
        'escaping_reference': '../outside.txt',
        'absolute_reference': '/outside.txt',
        'symlink_reference': '.agents/unsafe-source-link',
        'stale_command': {'expectedRevision': 6, 'actualRevision': 7},
        'collision': {'schema_version': 1, 'id': 'conflicting-owner', 'purpose': 'Adverse owner',
                      'paths': ['src/value.ts'], 'public': [], 'uses': [], 'guidance': []},
    }
    return {'schema_version': 1,
            'definitions': {'schema_version': 1, 'roles': roles, 'workflows': workflows,
                            'ownership': ownership, 'catalog': catalog, 'steps': steps},
            'legacy_registry': legacy, 'progress': progress,
            'source_texts': sources, 'sources': {key: hashlib.sha256(value.encode()).hexdigest() for key, value in sources.items()},
            'adverse_cases': adverse}


def build_fixture(root, *, source='files'):
    """Create a new fixture root; refuse existing trees to protect caller/user work."""
    root = Path(root).absolute()
    if source not in {'files', 'legacy'}:
        raise ValueError('fixture source must be files or legacy')
    if root != root.resolve():
        raise ValueError('fixture output cannot traverse a symlink')
    if root.exists() or root.is_symlink():
        raise ValueError('fixture output must be a new directory')
    root.mkdir(parents=True)
    document = fixture_document()

    def text(relative, content):
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)

    def data(relative, value):
        # JSON is valid YAML; keep the fixture builder independent of the loader/parser.
        text(relative, json.dumps(value, indent=2) + '\n')

    for relative, content in document['source_texts'].items():
        text(relative, content)
    text('.agents/skills/fixture/SKILL.md', '# Fixture skill\nRead current source and return actual evidence.\n')
    text('.agents/guides/VERIFICATION.md', '# Fixture evidence\nReview prose; execute meaningful behavior checks.\n')
    definitions = document['definitions']
    for role in definitions['roles']:
        data('.agents/agents/' + role['id'] + '/agent.yaml', role)
        text(role['instructions'], '# ' + role['id'] + '\nFollow the selected fixture workflow.\n')
    for workflow in definitions['workflows']:
        data('.agents/workflows/' + workflow['kind'] + '/workflow.yaml', workflow)
    for owner in definitions['ownership']:
        data('.agents/ownership/' + owner['group'] + '/' + owner['id'] + '.yaml', owner)
    references = []
    for step in definitions['steps']:
        relative = '.agents/plans/fixture/steps/' + step['id'] + '/step.yaml'
        data(relative, step)
        ref = {'id': step['id'], 'path': relative, 'agent': 'general'}
        if step['kind'] == 'audit':
            ref['legacy_effect'] = 'read_only'
        references.append(ref)
    data('.agents/plans/catalog.yaml', {'schema_version': 1, **definitions['catalog'], 'steps': references})
    data('.agents/plans/authority.yaml', {'schema_version': 1, 'definitions': source})
    data('.context/state/tasks.json', document['legacy_registry'])
    data('.context/state/progress.json', document['progress'])
    text('.context/BOOT.md', '# Fixture legacy entry\nRead only the selected fixture authority.\n')
    data('.context/index.json', {'routes': {kind: {} for kind in ['feature', 'bugfix', 'docs', 'maintenance', 'read_only']}})
    data('.context/config/project.yaml', {'roles': {'ownership': {'general': ['src/**', 'docs/**']}}})
    data('.context/modules/registry.yaml', {'schema_version': 1, 'modules': {
        item['id']: {'purpose': item['purpose'], 'paths': item['paths'], 'depends_on': item['uses'],
                     'public_surfaces': item['public']} for item in definitions['ownership']}, 'shared_files': []})
    data('fixture/baseline.json', document)
    text('fixture/adverse/malformed.json', document['adverse_cases']['malformed_json'])
    text('fixture/adverse/duplicate-keys.json', document['adverse_cases']['duplicate_keys_json'])
    data('fixture/adverse/stale-command.json', document['adverse_cases']['stale_command'])
    data('fixture/adverse/collision.json', document['adverse_cases']['collision'])
    # The relative target stays inside the disposable root but is outside agent definitions.
    (root / '.agents/unsafe-source-link').symlink_to('../docs/history.md')
    assert_fixture(root)
    return document


def assert_fixture(root):
    """Assert baseline data/hash consistency only, without importing a consumer runtime."""
    root = Path(root)
    actual = json.loads((root / 'fixture/baseline.json').read_text())
    expected = fixture_document()
    if actual != expected:
        raise AssertionError('fixture baseline differs from independently specified values')
    for relative, expected_hash in expected['sources'].items():
        if hashlib.sha256((root / relative).read_bytes()).hexdigest() != expected_hash:
            raise AssertionError('fixture source hash differs: ' + relative)
    registry = json.loads((root / '.context/state/tasks.json').read_text())
    reports = json.loads((root / '.context/state/progress.json').read_text())
    if registry != expected['legacy_registry'] or reports != expected['progress']:
        raise AssertionError('fixture task/report identity changed')
    authority = json.loads((root / '.agents/plans/authority.yaml').read_text())
    if authority not in [{'schema_version': 1, 'definitions': value} for value in ['files', 'legacy']]:
        raise AssertionError('fixture authority selection changed')
    definitions = expected['definitions']
    catalog = json.loads((root / '.agents/plans/catalog.yaml').read_text())
    references = []
    for step in definitions['steps']:
        relative = '.agents/plans/fixture/steps/' + step['id'] + '/step.yaml'
        if json.loads((root / relative).read_text()) != step:
            raise AssertionError('fixture canonical step differs: ' + step['id'])
        ref = {'id': step['id'], 'path': relative, 'agent': 'general'}
        if step['kind'] == 'audit':
            ref['legacy_effect'] = 'read_only'
        references.append(ref)
    if catalog != {'schema_version': 1, **definitions['catalog'], 'steps': references}:
        raise AssertionError('fixture catalog/task identity changed')
    for role in definitions['roles']:
        if json.loads((root / '.agents/agents' / role['id'] / 'agent.yaml').read_text()) != role:
            raise AssertionError('fixture role changed: ' + role['id'])
    for workflow in definitions['workflows']:
        if json.loads((root / '.agents/workflows' / workflow['kind'] / 'workflow.yaml').read_text()) != workflow:
            raise AssertionError('fixture workflow changed: ' + workflow['kind'])
    for owner in definitions['ownership']:
        if json.loads((root / '.agents/ownership' / owner['group'] / (owner['id'] + '.yaml')).read_text()) != owner:
            raise AssertionError('fixture ownership changed: ' + owner['id'])
    ids = [task['id'] for task in registry['tasks']]
    if len(ids) != len(set(ids)) or set(reports['states']) != set(ids):
        raise AssertionError('fixture task/report IDs differ')
    if {state['status'] for state in reports['states'].values()} != {'pending', 'running', 'review', 'complete'}:
        raise AssertionError('fixture must retain every reported workflow state')
    if not (root / expected['adverse_cases']['symlink_reference']).is_symlink():
        raise AssertionError('fixture symlink example is absent')
    if expected['adverse_cases']['stale_command']['expectedRevision'] == reports['revision']:
        raise AssertionError('fixture stale revision is not stale')
    return {'tasks': len(ids), 'source_hashes': len(expected['sources']), 'reports': len(reports['states'])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument('--self-check', action='store_true')
    choice.add_argument('--json', action='store_true')
    choice.add_argument('--output', type=Path)
    parser.add_argument('--source', choices=['files', 'legacy'], default='files')
    args = parser.parse_args()
    if args.json:
        print(json.dumps(fixture_document()))
    elif args.output:
        build_fixture(args.output, source=args.source)
        print(json.dumps({'root': str(args.output.absolute()), **assert_fixture(args.output)}))
    else:
        with tempfile.TemporaryDirectory(prefix='agent-home-fixture-') as temporary:
            root = Path(temporary) / 'project'
            build_fixture(root)
            result = assert_fixture(root)
            # Prove self-check failures do not depend on the future consumer implementation.
            (root / 'src/value.ts').write_text('changed\n')
            try:
                assert_fixture(root)
            except AssertionError:
                pass
            else:
                raise AssertionError('fixture self-check accepted changed source')
            (root / 'src/value.ts').write_text(fixture_document()['source_texts']['src/value.ts'])
            report_path = root / '.context/state/progress.json'
            original_reports = report_path.read_text()
            altered = json.loads(original_reports)
            altered['states']['BUGFIX']['definitionDigest'] = '0' * 64
            report_path.write_text(json.dumps(altered))
            try:
                assert_fixture(root)
            except AssertionError:
                pass
            else:
                raise AssertionError('fixture self-check accepted changed report identity')
            report_path.write_text(original_reports)
            catalog_path = root / '.agents/plans/catalog.yaml'
            catalog = json.loads(catalog_path.read_text())
            catalog['steps'][0]['id'] = 'wrong-task'
            catalog_path.write_text(json.dumps(catalog))
            try:
                assert_fixture(root)
            except AssertionError:
                pass
            else:
                raise AssertionError('fixture self-check accepted changed catalog identity')
            print(json.dumps({'fixture': 'passed', **result,
                              'limits': 'Fixture/data consistency only; consumer migration acceptance is not executed.'}))


if __name__ == '__main__':
    main()
