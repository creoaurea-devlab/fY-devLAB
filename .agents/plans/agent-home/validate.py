#!/usr/bin/env python3
"""Validate selected definitions, one folder per task, and local instruction links."""
import argparse
import importlib.util
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    # Installed validator code supplies its reader; the selected root is data.
    installed = Path(__file__).resolve().parents[2] / 'runtime/definitions.py'
    spec = importlib.util.spec_from_file_location('agent_home_definitions', installed)
    reader = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reader)
    snapshot = reader.load_snapshot(root)
    definitions = snapshot['definitions']
    registry = reader.read_registry(root)
    ids = {task['id'] for task in registry['tasks']}
    assets = root / '.agents'
    errors = []

    def require(condition, message):
        if not condition:
            errors.append(message)

    paths = sorted((assets / 'plans').glob('*/steps/*/step.yaml'))
    folders = {}
    for path in paths:
        value = reader.Reader(root).yaml(path.relative_to(root).as_posix())
        identity = value.get('id') if snapshot['source'] == 'files' else value.get('task_id')
        require(identity == path.parent.name and identity in ids, str(path) + ': invalid task identity')
        require(identity not in folders, str(path) + ': duplicate task folder')
        folders[identity] = path
        if snapshot['source'] == 'legacy':
            require(set(value) == {'schema_version', 'task_id', 'source', 'template'} and
                    value.get('source') == '.context/state/tasks.json', str(path) + ': invalid legacy binding')
        else:
            require('source' not in value and 'task_id' not in value, str(path) + ': stale forwarding binding')
        implementation = path.parent / 'IMPLEMENT.md'
        require(implementation.is_file(), str(path) + ': missing implementation entry')
        if implementation.is_file():
            links = {(implementation.parent / link.split('#')[0]).resolve()
                     for link in re.findall(r'\[[^\]]*\]\(([^)]+)\)', implementation.read_text())}
            require(path.resolve() in links and (assets / 'templates/implementation.md').resolve() in links,
                    str(implementation) + ': reference the definition and shared template')
    require(set(folders) == ids, 'Every current task requires exactly one definition folder')

    markdown = [path for path in assets.rglob('*.md')
                if not {'archive', 'state', '.venv', '__pycache__'}.intersection(path.relative_to(assets).parts)]
    for path in markdown:
        require(path.resolve().is_relative_to(assets), str(path) + ': escaping instruction')
        for raw in re.findall(r'\[[^\]]*\]\(([^)]+)\)', path.read_text()):
            target = raw.strip().split(' "', 1)[0].strip('<>')
            if urlsplit(target).scheme or target.startswith('#') or any(c in target for c in '{}<>$'):
                continue
            target = unquote(target.split('#', 1)[0])
            if target:
                candidates = [(path.parent / target).resolve(), (root / target).resolve()]
                require(any(p.is_relative_to(root) and p.is_file() for p in candidates), str(path) + ': broken link ' + target)
    result = dict(valid=not errors, source=snapshot['source'], generation=snapshot['generation'],
                  counts=dict(roles=len(definitions['roles']), workflows=len(definitions['workflows']),
                              capabilities=len(definitions['ownership']), canonical_tasks=len(ids),
                              task_folders=len(folders), markdown_files=len(markdown)),
                  blocked=snapshot['blocked'], errors=errors,
                  note='Definition and reference validation; task acceptance checks are separate evidence.')
    print(json.dumps(result, indent=2))
    return int(bool(errors))


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(json.dumps(dict(valid=False, errors=[str(error)])))
        raise SystemExit(1)
