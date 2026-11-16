"""Shared parsing, path safety, policy and atomic-file primitives."""
import fnmatch
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile

class RoutingError(ValueError):
    pass


def need(condition, message):
    if not condition:
        raise RoutingError(message)


def unique(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, f"duplicate key: {key}")
        result[key] = value
    return result


def parse_json(text):
    value = json.loads(text, object_pairs_hook=unique)
    need(isinstance(value, dict), "JSON root must be an object")
    return value


def parse_yaml(text):
    import yaml
    class Loader(yaml.SafeLoader):
        pass
    Loader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
                           lambda loader, node: unique(loader.construct_pairs(node)))
    value = yaml.load(text, Loader=Loader)
    need(isinstance(value, dict), "YAML root must be an object")
    return value


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def write_artifact(target, text):
    """Publish a file atomically: write a sibling temp file, then os.replace it."""
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=target.parent,
                                     prefix=target.name + ".", suffix=".tmp", delete=False) as handle:
        temp = Path(handle.name)
        try:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
            os.replace(temp, target)
        finally:
            temp.unlink(missing_ok=True)


def matches(path, pattern):
    need(isinstance(pattern, str) and pattern and not pattern.startswith("/")
         and ".." not in Path(pattern).parts and "\\" not in pattern, f"unsafe glob: {pattern}")
    if pattern.endswith("/"):
        return path == pattern[:-1] or path.startswith(pattern)
    return fnmatch.fnmatchcase(path, pattern) or (
        pattern.startswith("**/") and fnmatch.fnmatchcase(path, pattern[3:]))


def project_path(root, relative, write=False, protected=()):
    """Resolve one project path; writes must be exact and cannot follow symlinks."""
    need(isinstance(relative, str) and relative and not relative.startswith("/")
         and "\\" not in relative and "\x00" not in relative
         and ".." not in Path(relative).parts, f"unsafe path: {relative}")
    path = root / relative
    physical = path.resolve()
    need(physical != root and root in physical.parents, f"path escapes project: {relative}")
    if write:
        need(not any(char in relative for char in "*?[]") and not relative.endswith("/")
             and not path.is_dir(), f"write must name an exact file: {relative}")
        need(path == physical, f"write through symlink is forbidden: {relative}")
        patterns = [".git/", "**/.git/**", "**/.env*", "**/secrets/**", *protected]
        need(not any(matches(relative, pattern) for pattern in patterns), f"protected path: {relative}")
    return physical


def load_agent_policy(root):
    policy = parse_yaml(project_path(root, ".context/policy.yaml").read_text())
    need(set(policy) == {"context_limit_percent", "measurement_max_age_seconds"}, "invalid agent policy keys")
    for key, maximum in (("context_limit_percent", 100), ("measurement_max_age_seconds", 3600)):
        value = policy[key]
        need(type(value) in (int, float) and math.isfinite(value) and 0 < value <= maximum,
             f"invalid policy value: {key}")
    return policy


