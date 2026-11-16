#!/usr/bin/env python3
"""Validate this design's graph/traceability/reference integrity, not product behavior."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import re
from urllib.parse import unquote
from zipfile import ZipFile

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[2]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def unique(items, label):
    values = {item['id']: item for item in items}
    require(len(values) == len(items), label + ': duplicate IDs')
    return values


def relative(value):
    path = PurePosixPath(value)
    return bool(value) and not path.is_absolute() and '..' not in path.parts and '\\' not in value


def main():
    plan = json.loads((BASE / 'PLAN.json').read_text())
    require(plan['target'] == str(ROOT), 'target mismatch')
    require(plan['documentRole'] == 'implementation-proposal', 'not a proposal')
    require(plan['implementationAuthorized'] is False, 'planning must not claim implementation')
    require(plan['executionAuthority'] == '.context/state/tasks.json', 'authority drift')
    milestones = unique(plan['milestones'], 'milestones')
    tasks = unique(plan['tasks'], 'tasks')
    features = unique(plan['features'], 'features')
    acceptance = unique(plan['acceptance'], 'acceptance')
    require(not (set(features) & set(acceptance)), 'acceptance collision')
    all_acceptance = set(features) | set(acceptance)
    slices = {}
    for milestone in milestones.values():
        require(milestone['goalId'] == plan['goal']['id'], 'orphan milestone')
        require((BASE / milestone['document']).is_file(), 'missing milestone document')
        for item in milestone['slices']:
            require(item['id'] not in slices, 'duplicate slice')
            slices[item['id']] = milestone['id']
            require((BASE / item['document']).is_file(), 'missing slice document')
    require(not (set(milestones) & set(slices) | set(milestones) & set(tasks) | set(slices) & set(tasks)), 'ID collision')
    documents = set()
    covered = set()
    for task in tasks.values():
        name = task['id']
        require(task['milestoneId'] in milestones, name + ': missing milestone')
        require(slices.get(task['sliceId']) == task['milestoneId'], name + ': wrong slice')
        require(task['phase'] == milestones[task['milestoneId']]['phase'], name + ': wrong phase')
        require(relative(task['document']) and (BASE / task['document']).is_file(), name + ': missing task document')
        require(task['document'] not in documents, name + ': duplicate document')
        documents.add(task['document'])
        require(task['owner'] and task['outcome'] and task['verify'] and task['probeReadiness'], name + ': incomplete task')
        require(task['candidateReads'] and task['candidateWrites'], name + ': missing exact candidate scope')
        for value in task['candidateReads'] + task['candidateWrites']:
            require(relative(value), name + ': unsafe candidate path ' + value)
        for value in task['candidateReads']:
            require((ROOT / value).is_file(), name + ': missing source read ' + value)
        require(set(task['dependsOn']) <= set(tasks) and name not in task['dependsOn'], name + ': invalid dependency')
        require(set(task['acceptance']) <= all_acceptance, name + ': unknown acceptance')
        if task['phase'] == 'required':
            require(task['acceptance'], name + ': required task has no acceptance')
            require(all(tasks[dep]['phase'] == 'required' for dep in task['dependsOn']), name + ': required waits on deferred')
            covered.update(task['acceptance'])
        text = (BASE / task['document']).read_text()
        for heading in ('## Outcome', '## Exact candidate reads', '## Exact candidate writes', '## Verification commands', '## Completion evidence', '## Rollback'):
            require(heading in text, name + ': missing task section ' + heading)
    require(covered == all_acceptance, 'uncovered requirements: ' + str(all_acceptance - covered))
    visited, active = set(), set()

    def visit(name):
        require(name not in active, 'dependency cycle at ' + name)
        if name in visited:
            return
        active.add(name)
        for dependency in tasks[name]['dependsOn']:
            visit(dependency)
        active.remove(name)
        visited.add(name)

    for name in tasks:
        visit(name)
    shipping = set()

    def shipping_dependencies(name):
        if name in shipping:
            return
        shipping.add(name)
        for dependency in tasks[name]['dependsOn']:
            shipping_dependencies(dependency)

    shipping_dependencies('K035')
    required = {name for name, task in tasks.items() if task['phase'] == 'required'}
    require(shipping == required, 'shipping gate misses required tasks: ' + str(required - shipping))
    for task in tasks.values():
        text = (BASE / task['document']).read_text()
        for command in task['verify']:
            require('`' + command + '`' in text, task['id'] + ': Markdown verification drift')
    for path in BASE.rglob('*.md'):
        if 'evidence' in path.relative_to(BASE).parts:
            continue  # Original research memos preserve their observed scratch locators.
        for link in re.findall(r'\]\(([^)]+)\)', path.read_text()):
            value = unquote(link.strip('<>').split('#', 1)[0])
            if not value or re.match(r'^[a-zA-Z]+:', value):
                continue
            require((path.parent / value).exists(), str(path.relative_to(BASE)) + ': broken link ' + link)
    prototype = ROOT / 'tobeimplemented/CA_devLAB_Kanban_v2_Continuity'
    manifest = json.loads((prototype / 'IMPORT.json').read_text())
    original = Path(manifest['sourceArchive'])
    require(hashlib.sha256(original.read_bytes()).hexdigest() == manifest['archiveSha256'], 'original ZIP changed')
    with ZipFile(original) as archive:
        expected = {info.filename for info in archive.infolist() if not info.is_dir()}
        require(set(manifest['files']) == expected, 'member inventory changed')
        for name, checksum in manifest['files'].items():
            require(relative(name), 'unsafe member')
            require(hashlib.sha256((prototype / name).read_bytes()).hexdigest() == checksum, 'extracted file changed: ' + name)
            require(hashlib.sha256(archive.read(name)).hexdigest() == checksum, 'member mismatch: ' + name)
    require(json.loads((prototype / 'source/seed.json').read_text()) == json.loads((prototype / 'sample-project.json').read_text()), 'seed/sample mismatch')
    browser = json.loads((BASE / 'evidence/browser-observations.json').read_text())
    require(isinstance(browser, dict), 'missing browser evidence')
    print(json.dumps({'result': 'proposal-valid', 'milestones': len(milestones), 'slices': len(slices),
                      'tasks': len(tasks), 'requiredTasks': sum(t['phase'] == 'required' for t in tasks.values()),
                      'deferredTasks': sum(t['phase'] == 'deferred' for t in tasks.values()),
                      'prototypeFeaturesCovered': len(features), 'additionalAcceptanceCovered': len(acceptance),
                      'extractedFilesVerified': len(manifest['files']), 'productAcceptance': 'not run'}, indent=2))


if __name__ == '__main__':
    main()
