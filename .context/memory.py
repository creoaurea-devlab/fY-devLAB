"""Project-memory review shared by the default and indexed task lifecycles."""

MEMORY = ('codebase', 'changelog', 'progress', 'goals', 'decisions', 'roadmap', 'features', 'ui')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def assess_memory(assessment, baseline, current, writes):
    """Validate complete reviews against actual before/after hashes and exact writes."""
    require(isinstance(assessment, dict) and set(assessment) == set(baseline),
            'memory review must include every registered category')
    for key, before in baseline.items():
        item = assessment[key]
        require(isinstance(item, dict) and set(item) <= {'status', 'reason', 'artifacts', 'proposal'},
                f'{key}: invalid memory assessment fields')
        require(item.get('status') in {'updated', 'unchanged', 'not_applicable'}
                and isinstance(item.get('reason'), str) and item['reason'].strip(),
                f'{key}: declare status and a reason')
        if writes and key in {'changelog', 'progress'}:
            require(item['status'] == 'updated',
                    f'{key}: modifying task requires an updated record before close')
        require('proposal' not in item or isinstance(item['proposal'], str) and item['proposal'].strip(),
                f'{key}: proposal must be nonempty text')
        changed = {path for path in current[key] if current[key][path] != before[path]}
        artifacts = item.get('artifacts', [])
        require(isinstance(artifacts, list), f'{key}: artifacts must be a list')
        if item['status'] == 'updated':
            require(changed and artifacts, f'{key}: updated requires an actual changed artifact digest')
            supplied = {}
            for artifact in artifacts:
                require(isinstance(artifact, dict) and set(artifact) == {'path', 'sha256'},
                        f'{key}: artifact must name path and sha256')
                path = artifact['path']
                require(path in current[key] and path in writes,
                        f'{key}: undeclared or unregistered memory artifact {path}')
                require(path not in supplied, f'{key}: duplicate memory artifact {path}')
                require(current[key][path] is not None and current[key][path] == artifact['sha256'],
                        f'{key}: memory artifact digest does not match {path}')
                supplied[path] = artifact['sha256']
            require(changed <= set(supplied), f'{key}: changed artifacts were omitted')
        else:
            require(not changed, f'{key}: unchanged/N/A cannot hide changed memory artifacts')
            require(not artifacts, f'{key}: unchanged/N/A cannot claim updated artifacts')
    return assessment
