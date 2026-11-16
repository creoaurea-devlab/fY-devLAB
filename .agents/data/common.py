"""Planning/history parsing, path safety and canonical digests; no execution policy."""

import fnmatch

import hashlib

import json

from pathlib import Path

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

def control_relative(root, relative):
    """Resolve installed controls while retaining data-only legacy inspection."""
    if not (Path(root) / ".agents/project.yaml").is_file():
        return relative
    if relative == ".wisdohm/config/project.yaml" or relative == ".wisdohm/journey.yaml":
        return ".agents/project.yaml"
    if relative.startswith(".wisdohm/protocols/"):
        return relative.replace(".wisdohm/", ".agents/", 1)
    if relative in {".wisdohm/BOOT.md", ".wisdohm/policy.yaml"}:
        return relative.replace(".wisdohm/", ".agents/", 1)
    if relative.startswith(".wisdohm/") and relative.endswith(".py"):
        return ".agents/runtime/" + relative.rsplit("/", 1)[1]
    return relative
