"""Transactional task, memory, event and exact-path claim storage."""
from contextlib import closing, contextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sqlite3
from urllib.parse import quote

from common import control_relative, need, parse_json, parse_yaml, digest, project_path, matches


KINDS = {"changelog", "codebase", "feature", "registry", "progress", "decision", "audit"}
TERMINAL = {"DONE", "ABANDONED", "IMPORTED"}
GROUPS = {"changelog": "changelog", "codebase": "codebase", "feature": "registry",
          "registry": "registry", "progress": "state", "decision": "state", "audit": "state"}
SCHEMA = (
    "CREATE TABLE sessions (id TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0), data TEXT NOT NULL)",
    "CREATE TABLE memory (kind TEXT NOT NULL, key TEXT NOT NULL, body TEXT NOT NULL, task_id TEXT NOT NULL REFERENCES sessions(id), updated_at TEXT NOT NULL, PRIMARY KEY(kind, key))",
    "CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT REFERENCES sessions(id), action TEXT NOT NULL, payload TEXT NOT NULL, at TEXT NOT NULL)",
    "CREATE TABLE claims (path TEXT PRIMARY KEY NOT NULL, task_id TEXT NOT NULL REFERENCES sessions(id))",
    "CREATE TABLE capabilities (id TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0), body TEXT NOT NULL)",
    "CREATE TABLE steps (id TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0), parent TEXT REFERENCES steps(id) DEFERRABLE INITIALLY DEFERRED, kind TEXT NOT NULL, effect TEXT NOT NULL, owner TEXT REFERENCES capabilities(id), title TEXT NOT NULL, body TEXT NOT NULL)",
    "CREATE TABLE step_dependencies (step TEXT NOT NULL REFERENCES steps(id) DEFERRABLE INITIALLY DEFERRED, needs TEXT NOT NULL REFERENCES steps(id) DEFERRABLE INITIALLY DEFERRED, PRIMARY KEY(step,needs), CHECK(step <> needs))",
)
COLUMNS = {"sessions": ("id", "revision", "data"), "memory": ("kind", "key", "body", "task_id", "updated_at"),
           "events": ("seq", "task_id", "action", "payload", "at"), "claims": ("path", "task_id"),
           "capabilities": ("id", "revision", "body"),
           "steps": ("id", "revision", "parent", "kind", "effect", "owner", "title", "body"),
           "step_dependencies": ("step", "needs")}
WORKFLOW_SCHEMA = "CREATE TABLE workflow (project_id TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0), body TEXT NOT NULL)"
WORKFLOW_COLUMNS = ("project_id", "revision", "body")


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def identity(value):
    need(isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,80}", value), "invalid task id")
    return value


class Store:
    @staticmethod
    def database_relative(root):
        root = Path(root)
        current, legacy = root / ".agents/state/memory.sqlite", root / ".wisdohm/memory.sqlite"
        need(not (current.exists() and legacy.exists()), "ambiguous operational databases; complete explicit relocation")
        return ".agents/state/memory.sqlite" if current.is_file() or not legacy.exists() and (root / ".agents/project.yaml").is_file() else ".wisdohm/memory.sqlite"

    def __init__(self, root, readonly=False):
        self.root = Path(root).resolve()
        config = project_path(self.root, control_relative(self.root, '.wisdohm/config/project.yaml'))
        self.history_roots = parse_yaml(config.read_text()).get('history_roots', []) if config.is_file() else []
        need(isinstance(self.history_roots, list) and len(self.history_roots) <= 16
             and all(isinstance(path, str) and Path(path).is_absolute() and os.path.normpath(path) == path
                     and path != str(self.root) for path in self.history_roots),
             'history roots must be distinct absolute former project locations')
        self.readonly = readonly
        self.relative = self.database_relative(self.root)
        self.path = self._path()
        if readonly:
            need(self.path.is_file(), "memory is not initialized")
            with closing(self._open()) as connection:
                self._validate(connection)
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._path()
        try:
            descriptor = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        except FileExistsError:
            pass
        else:
            os.close(descriptor)
        with closing(self._open()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                version = connection.execute("PRAGMA user_version").fetchone()[0]
                need(version in {0, 2, 3}, f"unsupported memory database version: {version}; use db upgrade for version 1")
                if version == 0:
                    need(not self._tables(connection), "unversioned memory database is not empty")
                    for statement in SCHEMA:
                        connection.execute(statement)
                    if self.relative == ".agents/state/memory.sqlite":
                        connection.execute(WORKFLOW_SCHEMA)
                        connection.execute("PRAGMA user_version=3")
                    else:
                        connection.execute("PRAGMA user_version=2")
                self._validate(connection)
                connection.commit()
            except BaseException:
                connection.rollback()
                raise
            need(connection.execute("PRAGMA journal_mode=DELETE").fetchone()[0] == "delete",
                 "memory database requires DELETE journal mode")

    @classmethod
    def upgrade(cls, root, output):
        """Back up an existing version-1 database before a single schema transaction."""
        store = cls.__new__(cls)
        store.root = Path(root).resolve()
        store.relative = cls.database_relative(store.root)
        store.readonly = False
        store.path = store._path()
        need(store.path.is_file(), "memory is not initialized")
        with closing(store._open()) as connection:
            version = connection.execute("PRAGMA user_version").fetchone()[0]
            if version in {2, 3}:
                store._validate(connection)
                return {"upgraded": False, "schema": version}
            need(version == 1, "only schema 1 can be upgraded")
            old_names = {"sessions", "memory", "events", "claims"}
            need(store._tables(connection) == old_names, "invalid version-1 tables")
            for name in old_names:
                need(tuple(row["name"] for row in connection.execute(f"PRAGMA table_info({name})")) == COLUMNS[name],
                     "invalid version-1 columns: " + name)
            target = store._backup_target(output)
            store._copy_backup(connection, target)
            connection.execute("BEGIN IMMEDIATE")
            try:
                need(connection.execute("PRAGMA user_version").fetchone()[0] == 1, "schema changed during upgrade")
                connection.execute("ALTER TABLE events RENAME TO old_events")
                connection.execute(SCHEMA[2])
                connection.execute("INSERT INTO events SELECT * FROM old_events ORDER BY seq")
                connection.execute("DROP TABLE old_events")
                for statement in SCHEMA[4:]:
                    connection.execute(statement)
                config = project_path(store.root, control_relative(store.root, ".wisdohm/config/project.yaml"))
                ownership = parse_yaml(config.read_text()).get("ownership", {}) if config.exists() else {}
                need(isinstance(ownership, dict), "ownership must be a mapping")
                for owner, paths in ownership.items():
                    identity(owner)
                    need(isinstance(paths, list) and all(isinstance(path, str) for path in paths), "invalid ownership paths")
                    for path in paths:
                        matches("scope-probe", path)
                    body = dict(purpose="Migrated ownership for " + owner, paths=paths, public=[], uses=[], guidance=[], archived=False)
                    connection.execute("INSERT INTO capabilities VALUES (?,?,?)", (owner, 1, encoded(body)))
                connection.execute("PRAGMA user_version=2")
                store._validate(connection)
                need(not connection.execute("PRAGMA foreign_key_check").fetchall(), "foreign key check failed")
                connection.commit()
            except BaseException:
                connection.rollback()
                raise
        return {"upgraded": True, "schema": 2, "backup": str(target)}

    @classmethod
    def upgrade_workflow(cls, root, output):
        """Explicit schema-2 to 3 upgrade, with a recoverable online backup first."""
        store = cls(root, readonly=True)
        store.readonly = False
        with closing(store._open()) as connection:
            store._validate(connection)
            version = connection.execute("PRAGMA user_version").fetchone()[0]
            if version == 3:
                return {"upgraded": False, "schema": 3}
            need(version == 2, "workflow storage requires schema 2 before upgrade")
            target = store._backup_target(output)
            store._copy_backup(connection, target)
            connection.execute("BEGIN IMMEDIATE")
            try:
                need(connection.execute("PRAGMA user_version").fetchone()[0] == 2, "schema changed during upgrade")
                connection.execute(WORKFLOW_SCHEMA)
                connection.execute("PRAGMA user_version=3")
                store._validate(connection)
                need(not connection.execute("PRAGMA foreign_key_check").fetchall(), "foreign key check failed")
                connection.commit()
            except BaseException:
                connection.rollback()
                raise
        return {"upgraded": True, "schema": 3, "backup": str(target)}

    def _path(self):
        result = project_path(self.root, self.relative, write=True)
        need(result.relative_to(self.root).as_posix() == self.relative, "noncanonical database path")
        for suffix in ("-journal", "-wal", "-shm"):
            project_path(self.root, self.relative + suffix, write=True)
        return result

    def _open(self):
        path = self._path()
        connection = sqlite3.connect("file:" + quote(str(path)) + ("?mode=ro" if self.readonly else "?mode=rw"),
                                     uri=True, timeout=5, isolation_level=None)
        try:
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA busy_timeout=5000")
            return connection
        except BaseException:
            connection.close()
            raise

    @staticmethod
    def _tables(connection):
        return {row[0] for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}

    def _validate(self, connection):
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        need(version in {2, 3}, f"unsupported memory database version: {version}; use explicit db upgrade")
        columns = dict(COLUMNS, **({"workflow": WORKFLOW_COLUMNS} if version == 3 else {}))
        need(self._tables(connection) == set(columns), "invalid memory database tables")
        for table, expected in columns.items():
            need(tuple(row["name"] for row in connection.execute(f"PRAGMA table_info({table})")) == expected,
                 f"invalid memory database columns: {table}")

    @contextmanager
    def transaction(self, write=False):
        need(not write or not self.readonly, "read-only store cannot write")
        with closing(self._open()) as connection:
            self._validate(connection)
            need(connection.execute("PRAGMA journal_mode").fetchone()[0] == "delete",
                 "memory database requires DELETE journal mode")
            connection.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            try:
                need(self.relative == self.database_relative(self.root), "operational database relocated; retry with current storage")
                yield connection
                if write:
                    connection.commit()
            except BaseException:
                if connection.in_transaction:
                    connection.rollback()
                raise

    _connection = transaction

    def _state(self, row):
        need(row is not None, "unknown task id")
        state = parse_json(row["data"])
        self._payload(state, historical=True)
        need(state["id"] == row["id"], "task identity differs from database row")
        state["_revision"] = row["revision"]
        return state

    def _payload(self, state, historical=False):
        need(isinstance(state, dict), "task state must be an object")
        payload = {key: value for key, value in state.items() if key != "_revision"}
        identity(payload.get("id"))
        # A declared former location permits reading retained history and claims only.
        # New writes still require this physical project; old proofs retain their old roots.
        need(payload.get("root") == str(self.root) or historical and payload.get("root") in getattr(self, 'history_roots', []),
             "task belongs to another project")
        need(isinstance(payload.get("stage"), str) and payload["stage"], "task stage is required")
        for field in ("summary", "next"):
            need(field not in payload or isinstance(payload[field], str), f"task {field} must be text")
        need(isinstance(payload.get("checks", []), list)
             and all(isinstance(check, dict) for check in payload.get("checks", [])), "task checks must be objects")
        for check in payload.get("checks", []):
            need("command" not in check or isinstance(check["command"], str), "invalid check command")
            need("exit" not in check or type(check["exit"]) is int, "invalid check exit status")
            need("output_digest" not in check or isinstance(check["output_digest"], str)
                 and re.fullmatch(r"[a-f0-9]{64}", check["output_digest"]), "invalid check output digest")
        need(isinstance(payload.get("write"), list), "task writes must be a list")
        need(len(set(payload["write"])) == len(payload["write"]), "duplicate task writes")
        for path in payload["write"]:
            self._write_path(path, payload.get("source_root"))
        need(payload.get("digest") == digest({key: value for key, value in payload.items() if key != "digest"}),
             "task state digest mismatch")
        encoded(payload)
        return payload

    def _write_path(self, relative, source_root=None):
        root = self.root if source_root is None else Path(source_root)
        need(root.is_absolute() and root == root.resolve(), "noncanonical source root")
        path = project_path(root, relative, write=True)
        need(path.relative_to(root).as_posix() == relative, f"noncanonical write path: {relative}")
        need(relative not in {self.relative, *(self.relative + suffix for suffix in ("-journal", "-wal", "-shm"))},
             "memory database files are reserved")
        return relative

    @staticmethod
    def _entry(entry):
        need(isinstance(entry, dict) and set(entry) == {"kind", "key", "body"}, "invalid memory entry fields")
        kind, key, body = entry["kind"], entry["key"], entry["body"]
        need(isinstance(kind, str) and kind in KINDS, "unknown memory kind")
        need(isinstance(key, str) and key.strip() and len(key) <= 512 and "\x00" not in key, "invalid memory key")
        need(isinstance(body, dict) and isinstance(body.get("text"), str) and body["text"].strip(),
             "memory body requires nonempty text")
        if "source_path" in body:
            need(isinstance(body["source_path"], str) and body["source_path"].strip(), "invalid memory source path")
        if "sha256" in body:
            need(isinstance(body["sha256"], str) and re.fullmatch(r"[a-f0-9]{64}", body["sha256"]),
                 "invalid memory source digest")
        encoded(body)
        return kind, key, body

    def load(self, id):
        identity(id)
        with self._connection() as connection:
            return self._state(connection.execute("SELECT * FROM sessions WHERE id=?", (id,)).fetchone())

    def save(self, state, action=None, entries=None, release=False, expected_memory=None, memory_scope=None, validate=None):
        payload = self._payload(state)
        revision = state.get("_revision", 0)
        need(type(revision) is int and revision >= 0, "invalid task revision")
        action = payload["stage"] if action is None else action
        need(isinstance(action, str) and action.strip(), "event action must be nonempty")
        need(type(release) is bool and (not release or payload["stage"] in TERMINAL),
             "claims can only be released by a terminal task")
        entries = [] if entries is None else entries
        need(isinstance(entries, list), "memory entries must be a list")
        validated = [self._entry(entry) for entry in entries]
        need(len({(kind, key) for kind, key, _ in validated}) == len(validated), "duplicate memory entries")
        now = datetime.now(timezone.utc).isoformat()
        with self._connection(write=True) as connection:
            if expected_memory is not None:
                need(expected_memory == self._snapshot(connection, memory_scope), "memory changed after review")
            if validate is not None:
                validate(connection)
            old = connection.execute("SELECT * FROM sessions WHERE id=?", (payload["id"],)).fetchone()
            need((old is None and revision == 0) or (old is not None and old["revision"] == revision),
                 "stale task revision; reload before saving")
            if old is None:
                connection.execute("INSERT INTO sessions VALUES (?,?,?)", (payload["id"], 1, encoded(payload)))
                self._claim(connection, payload)
            else:
                previous = self._state(old)
                need(previous["write"] == payload["write"] and previous.get("source_root") == payload.get("source_root"),
                     "task write scope changed; start a successor task")
                connection.execute("UPDATE sessions SET revision=?, data=? WHERE id=? AND revision=?",
                                   (revision + 1, encoded(payload), payload["id"], revision))
            changes = []
            for kind, key, body in validated:
                existing = connection.execute("SELECT task_id,body FROM memory WHERE kind=? AND key=?", (kind, key)).fetchone()
                if existing is not None and existing["task_id"] != payload["id"]:
                    owner = self._state(connection.execute("SELECT * FROM sessions WHERE id=?", (existing["task_id"],)).fetchone())
                    need(owner["stage"] in TERMINAL, f"memory record belongs to unfinished task: {kind}/{key}")
                connection.execute("INSERT INTO memory VALUES (?,?,?,?,?) ON CONFLICT(kind,key) DO UPDATE SET body=excluded.body, task_id=excluded.task_id, updated_at=excluded.updated_at",
                                   (kind, key, encoded(body), payload["id"], now))
                changes.append(dict(kind=kind, key=key,
                                    before=parse_json(existing["body"]) if existing is not None else None, after=body))
            if release:
                connection.execute("DELETE FROM claims WHERE task_id=?", (payload["id"],))
            event = {"stage": payload["stage"], "revision": revision + 1, "entries": changes,
                     "summary": payload.get("summary", ""), "next": payload.get("next", ""),
                     "checks": [{key: check[key] for key in ("command", "exit", "output_digest") if key in check}
                                for check in payload.get("checks", [])]}
            connection.execute("INSERT INTO events(task_id,action,payload,at) VALUES (?,?,?,?)",
                               (payload["id"], action, encoded(event), now))
        state["_revision"] = revision + 1

    def _claim(self, connection, state):
        existing = list(connection.execute("SELECT path,task_id FROM claims"))
        for path in state["write"]:
            for claim in existing:
                overlap = path == claim["path"] or path.startswith(claim["path"] + "/") or claim["path"].startswith(path + "/")
                need(not overlap or claim["task_id"] == state["id"], f"write path claimed by another task: {path}")
            connection.execute("INSERT INTO claims VALUES (?,?)", (path, state["id"]))

    def assert_claim(self, id, paths):
        identity(id)
        need(isinstance(paths, (list, tuple)), "claim paths must be a list")
        with self._connection() as connection:
            state = self._state(connection.execute("SELECT * FROM sessions WHERE id=?", (id,)).fetchone())
            need(state["stage"] not in TERMINAL, "terminal task cannot write")
            for path in paths:
                self._write_path(path, state.get("source_root"))
                claim = connection.execute("SELECT task_id FROM claims WHERE path=?", (path,)).fetchone()
                need(path in state["write"] and claim is not None and claim["task_id"] == id,
                     f"task does not own write path: {path}")

    @staticmethod
    def _in_scope(row, body, scope):
        if scope is None:
            return True
        return (row["task_id"] == scope.get("task_id")
                or body.get("step") in scope.get("step_ids", [])
                or body.get("source_path") in scope.get("paths", [])
                or any(all(row[key] == value for key, value in query.items()) for query in scope.get("queries", [])))

    @staticmethod
    def _scope(scope):
        if scope is None:
            return
        need(isinstance(scope, dict) and set(scope) <= {"task_id", "step_ids", "paths", "queries"}, "invalid memory scope")
        need(all(isinstance(scope.get(k, []), list) for k in ("step_ids", "paths", "queries")), "invalid memory scope lists")
        need(all(isinstance(value, str) and value for key in ("step_ids", "paths") for value in scope.get(key, [])), "invalid memory scope identifiers")
        need("task_id" not in scope or isinstance(scope["task_id"], str) and scope["task_id"], "invalid memory scope task")
        for query in scope.get("queries", []):
            need(isinstance(query, dict) and set(query) <= {"kind", "key"}
                 and all(isinstance(v, str) and v for v in query.values()), "invalid memory query")
            need("kind" not in query or query["kind"] in KINDS, "unknown memory kind")

    def _snapshot(self, connection, scope=None):
        self._scope(scope)
        result = {group: {} for group in ("changelog", "codebase", "registry", "state")}
        for row in connection.execute("SELECT kind,key,body,task_id FROM memory ORDER BY kind,key"):
            body = parse_json(row["body"])
            kind, key, body = self._entry({"kind": row["kind"], "key": row["key"], "body": body})
            if self._in_scope(row, body, scope):
                result[GROUPS[kind]][f"{kind}/{key}"] = digest(body)
        return result

    def snapshot(self, scope=None):
        with self._connection() as connection:
            return self._snapshot(connection, scope)

    def context(self, scope, limit=50, offset=0):
        self._scope(scope)
        need(type(limit) is int and 1 <= limit <= 200 and type(offset) is int and offset >= 0, "invalid memory page")
        with self.transaction() as connection:
            rows = [row for row in self._records(connection) if self._in_scope(row, row["body"], scope)]
            end = offset + limit
            return {"records": rows[offset:end], "next_offset": end if end < len(rows) else None,
                    "total": len(rows), "snapshot": self._snapshot(connection, scope)}

    def claims(self):
        with self._connection() as connection:
            return [dict(row) for row in connection.execute("SELECT path,task_id FROM claims ORDER BY path")]

    def _records(self, connection, kind=None):
        need(kind is None or kind in KINDS, "unknown memory kind")
        rows = connection.execute("SELECT m.*,json_extract(s.data,'$.root') AS session_root FROM memory m JOIN sessions s ON s.id=m.task_id"
                                  + (" WHERE m.kind=?" if kind is not None else "")
                                  + " ORDER BY m.kind,m.key", (kind,) if kind is not None else ())
        return [dict(kind=row["kind"], key=row["key"], body=parse_json(row["body"]),
                     task_id=row["task_id"], updated_at=row["updated_at"],
                     **({"historical": True} if row["session_root"] in getattr(self, 'history_roots', []) else {})) for row in rows]

    def records(self, kind=None, scope=None, connection=None):
        self._scope(scope)
        if connection is None:
            with self._connection() as connection:
                return self.records(kind, scope, connection)
        return [record for record in self._records(connection, kind)
                if self._in_scope(record, record["body"], scope)]

    def history(self, id=None):
        if id is not None:
            identity(id)
        with self._connection() as connection:
            rows = connection.execute("SELECT * FROM events" + (" WHERE task_id=?" if id is not None else "")
                                      + " ORDER BY seq", (id,) if id is not None else ())
            return [dict(seq=row["seq"], task_id=row["task_id"], action=row["action"],
                         payload=parse_json(row["payload"]), at=row["at"]) for row in rows]

    def sessions(self):
        with self._connection() as connection:
            return [self._state(row) for row in connection.execute("SELECT * FROM sessions ORDER BY id")]

    @staticmethod
    def _workflow_body(body):
        """Validate report data without treating a reported status as execution proof."""
        need(isinstance(body, dict) and set(body) in (
            {"schemaVersion", "revision", "states", "order", "events", "recentCommands"},
            {"schemaVersion", "revision", "states", "order", "events", "recentCommands", "milestones"}), "invalid workflow fields")
        need(type(body["schemaVersion"]) is int and body["schemaVersion"] == 1 and type(body["revision"]) is int and body["revision"] >= 0, "invalid workflow version or revision")
        def name(value):
            need(isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,95}", value), "invalid workflow id")
        def text(value, maximum=4000, required=True):
            need(isinstance(value, str) and len(value) <= maximum and (not required or value.strip()), "invalid workflow text")
        def sha(value):
            need(isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value), "invalid workflow digest")
        def uuid(value):
            from uuid import UUID
            need(isinstance(value, str) and str(UUID(value)) == value.lower(), "invalid workflow command/event id")
        need(isinstance(body["states"], dict) and len(body["states"]) <= 10000, "invalid workflow reports")
        for key, report in body["states"].items():
            name(key)
            need(isinstance(report, dict) and set(report) == {"status", "reportedBy", "updatedAt", "note", "provenance", "definitionDigest"}, "invalid workflow report")
            need(report["status"] in {"pending", "running", "review", "complete"} and report["provenance"] == "reported", "workflow reports cannot become execution evidence")
            text(report["reportedBy"]); text(report["updatedAt"], required=False); text(report["note"], required=False); sha(report["definitionDigest"])
        need(isinstance(body["order"], dict) and len(body["order"]) <= 5000, "invalid workflow order")
        for key, order in body["order"].items():
            name(key); need(isinstance(order, list) and len(order) <= 10000, "invalid workflow order entries")
            for item in order: name(item)
        milestones = body.get("milestones", {})
        need(isinstance(milestones, dict) and len(milestones) <= 1000, "invalid milestone reports")
        for key, state in milestones.items():
            name(key)
            need(isinstance(state, dict) and set(state) == {"stage", "group", "archived"}, "invalid milestone report")
            need(state["stage"] in {"pool", "planned", "queue", "running", "review", "complete"} and type(state["archived"]) is bool, "invalid milestone placement")
            text(state["group"], maximum=120, required=False)
        need(isinstance(body["events"], list) and len(body["events"]) <= 1000, "invalid workflow event history")
        for event in body["events"]:
            need(isinstance(event, dict) and set(event) in ({"id", "at", "actor", "kind", "summary"}, {"id", "at", "actor", "kind", "summary", "taskId"}), "invalid workflow event")
            uuid(event["id"]); text(event["at"], required=False)
            for key in ("actor", "kind", "summary"): text(event[key])
            if "taskId" in event: name(event["taskId"])
        need(isinstance(body["recentCommands"], list) and len(body["recentCommands"]) <= 100, "invalid workflow replay history")
        for command in body["recentCommands"]:
            need(isinstance(command, dict) and set(command) == {"id", "fingerprint"}, "invalid workflow replay entry")
            uuid(command["id"]); sha(command["fingerprint"])
        raw = encoded(body)
        need(len(raw.encode()) <= 32 * 1024 * 1024, "workflow data is too large")
        return raw

    def load_workflow(self, project_id="default", connection=None):
        identity(project_id)
        if connection is None:
            with self._connection() as connection:
                return self.load_workflow(project_id, connection)
        if connection.execute("PRAGMA user_version").fetchone()[0] != 3:
            return {"body": None, "revision": 0}
        row = connection.execute("SELECT revision,body FROM workflow WHERE project_id=?", (project_id,)).fetchone()
        if row is None:
            return {"body": None, "revision": 0}
        body = parse_json(row["body"])
        self._workflow_body(body)
        return {"body": body, "revision": row["revision"]}

    def save_workflow(self, project_id, body, expected_revision):
        identity(project_id)
        need(type(expected_revision) is int and expected_revision >= 0, "invalid expected workflow revision")
        raw = self._workflow_body(body)
        with self._connection(write=True) as connection:
            need(connection.execute("PRAGMA user_version").fetchone()[0] == 3, "workflow storage needs an explicit schema-3 upgrade")
            row = connection.execute("SELECT revision,body FROM workflow WHERE project_id=?", (project_id,)).fetchone()
            revision = row["revision"] if row else 0
            if row and row["body"] == raw:
                return {"body": body, "revision": revision}
            need(revision == expected_revision, "workflow revision changed; reload before saving")
            connection.execute("INSERT INTO workflow VALUES (?,?,?) ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision,body=excluded.body", (project_id, revision + 1, raw))
            connection.execute("INSERT INTO events(task_id,action,payload,at) VALUES (NULL,?,?,?)", (
                "WORKFLOW_REPORT", encoded(dict(project_id=project_id, revision=revision + 1, body_digest=digest(body))), datetime.now(timezone.utc).isoformat()))
            return {"body": body, "revision": revision + 1}

    def _backup_target(self, output):
        target = Path(output).expanduser()
        if not target.is_absolute():
            target = self.root / target
        need(target == target.resolve(), "backup path must be canonical and cannot follow symlinks")
        source_family = {self.path, *(Path(str(self.path) + suffix) for suffix in ("-journal", "-wal", "-shm"))}
        need(target not in source_family and target.parent.is_dir(), "invalid backup destination")
        family = [target, *(Path(str(target) + suffix) for suffix in ("-journal", "-wal", "-shm"))]
        need(not any(path.exists() or path.is_symlink() for path in family), "backup destination already exists")
        return target

    @staticmethod
    def _copy_backup(source, target):
        descriptor = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        os.close(descriptor)
        try:
            with closing(sqlite3.connect(str(target))) as destination:
                source.backup(destination)
        except BaseException:
            for suffix in ("", "-journal", "-wal", "-shm"):
                Path(str(target) + suffix).unlink(missing_ok=True)
            raise

    def backup(self, output):
        target = self._backup_target(output)
        with self._connection() as source:
            self._copy_backup(source, target)
        return target

    @staticmethod
    def _database_signature(connection):
        tables = sorted(Store._tables(connection))
        return digest({table: [list(row) for row in connection.execute(
            'SELECT * FROM "' + table + '" ORDER BY ' + ','.join('"' + row["name"] + '"' for row in connection.execute('PRAGMA table_info("' + table + '")')))] for table in tables})

    @classmethod
    def relocate(cls, root, output):
        """Move one operational authority after online backup and validated restore."""
        store = cls(root, readonly=True)
        need(store.relative == ".wisdohm/memory.sqlite", "operational database already relocated")
        target = project_path(store.root, ".agents/state/memory.sqlite", write=True)
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        need(not target.exists(), "relocation target already exists")
        backup = store._backup_target(output)
        retired = backup.with_name(backup.name + ".retired")
        need(not retired.exists() and not retired.is_symlink(), "retired database path already exists")
        store.readonly = False
        with closing(store._open()) as source:
            store._validate(source)
            need(source.execute("PRAGMA user_version").fetchone()[0] == 3, "relocation requires schema 3")
            store._copy_backup(source, backup)
            # A connection opened before relocation must re-check its selected
            # path after acquiring this lock, before any later write.
            source.execute("BEGIN IMMEDIATE")
            try:
                signature = store._database_signature(source)
                with closing(sqlite3.connect("file:" + quote(str(backup)) + "?mode=ro", uri=True)) as saved:
                    saved.row_factory = sqlite3.Row
                    need(signature == store._database_signature(saved), "database changed after online backup; retry with fresh backup")
                    store._copy_backup(saved, target)
                with closing(sqlite3.connect(str(target))) as restored:
                    restored.row_factory = sqlite3.Row
                    store._validate(restored)
                    need(restored.execute("PRAGMA integrity_check").fetchone()[0] == "ok", "restored database integrity failed")
                    need(not restored.execute("PRAGMA foreign_key_check").fetchall(), "restored foreign keys failed")
                    need(signature == store._database_signature(restored), "restored database differs from online backup")
                with target.open('rb') as restored_file:
                    os.fsync(restored_file.fileno())
                os.rename(store.path, retired)
                source.commit()
            except BaseException:
                source.rollback()
                if store.path.exists():
                    target.unlink(missing_ok=True)
                raise
        return {"relocated": True, "database": str(target), "backup": str(backup),
                "retired": str(retired), "signature": signature}

    def plan_snapshot(self, connection=None):
        if connection is None:
            with self.transaction() as connection:
                return self.plan_snapshot(connection)
        capabilities = [dict(id=row["id"], revision=row["revision"], **parse_json(row["body"]))
                        for row in connection.execute("SELECT * FROM capabilities ORDER BY id")]
        dependencies = {}
        for row in connection.execute("SELECT * FROM step_dependencies ORDER BY step,needs"):
            dependencies.setdefault(row["step"], []).append(row["needs"])
        steps = [dict(id=row["id"], revision=row["revision"], parent=row["parent"], kind=row["kind"],
                      effect=row["effect"], owner=row["owner"], title=row["title"],
                      needs=dependencies.get(row["id"], []), **parse_json(row["body"]))
                 for row in connection.execute("SELECT * FROM steps ORDER BY id")]
        return {"steps": steps, "capabilities": capabilities}

    def edit_plan(self, actor, changes, validate, preview=False):
        """Compare revisions and validate the complete candidate graph under one lock."""
        with self.transaction(write=not preview) as connection:
            before = self.plan_snapshot(connection)
            candidate = {key: {item["id"]: item for item in items} for key, items in before.items()}
            history = []
            for change in changes:
                collection = "steps" if change["type"] == "step" else "capabilities"
                value = dict(change["value"])
                old = candidate[collection].get(value["id"])
                need(value["revision"] == (old["revision"] if old else 0),
                     f"revision conflict: {change['type']}/{value['id']}; current revision {old['revision'] if old else 0}")
                value["revision"] += 1
                candidate[collection][value["id"]] = value
                history.append(dict(type=change["type"], before=old, after=value))
            snapshot = {key: sorted(items.values(), key=lambda item: item["id"]) for key, items in candidate.items()}
            sessions = [self._state(row) for row in connection.execute("SELECT * FROM sessions ORDER BY id")]
            validate(snapshot, before, sessions)
            if preview:
                return {"preview": True, "changes": history}
            for change in sorted(history, key=lambda item: item["type"]):
                value = change["after"]
                if change["type"] == "capability":
                    body = {k: v for k, v in value.items() if k not in {"id", "revision"}}
                    connection.execute("INSERT INTO capabilities VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body",
                                       (value["id"], value["revision"], encoded(body)))
                else:
                    body = {k: v for k, v in value.items() if k not in {"id", "revision", "parent", "kind", "effect", "owner", "title", "needs"}}
                    connection.execute("INSERT INTO steps VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,parent=excluded.parent,kind=excluded.kind,effect=excluded.effect,owner=excluded.owner,title=excluded.title,body=excluded.body",
                                       (value["id"], value["revision"], value["parent"], value["kind"], value["effect"], value["owner"], value["title"], encoded(body)))
                    connection.execute("DELETE FROM step_dependencies WHERE step=?", (value["id"],))
                    connection.executemany("INSERT INTO step_dependencies VALUES (?,?)", [(value["id"], dependency) for dependency in value["needs"]])
            connection.execute("INSERT INTO events(task_id,action,payload,at) VALUES (NULL,?,?,?)",
                               ("PLAN_EDIT", encoded({"actor": actor, "changes": history}), datetime.now(timezone.utc).isoformat()))
            return {"preview": False, "changes": history}

    def plan_sessions(self, connection=None):
        if connection is None:
            return self.sessions()
        return [self._state(row) for row in connection.execute("SELECT * FROM sessions ORDER BY id")]

    def reserve_repair(self, step, contract, actor, reason, validate):
        with self.transaction(write=True) as connection:
            validate(connection)
            for row in connection.execute("SELECT payload FROM events WHERE action='REPAIR'"):
                event = parse_json(row["payload"])
                need(event.get("step") != step or event.get("contract") != contract, "repair budget exhausted for this step contract")
            payload = dict(step=step, contract=contract, actor=actor, reason=reason, remaining=0)
            connection.execute("INSERT INTO events(task_id,action,payload,at) VALUES (NULL,?,?,?)",
                               ("REPAIR", encoded(payload), datetime.now(timezone.utc).isoformat()))
            return payload

    def import_legacy(self, entries, sessions, source, fingerprint):
        need(isinstance(source, str) and source.strip(), "legacy source is required")
        need(isinstance(fingerprint, str) and re.fullmatch(r"[a-f0-9]{64}", fingerprint), "invalid legacy fingerprint")
        need(isinstance(entries, list) and isinstance(sessions, list), "legacy entries and sessions must be lists")
        validated = [self._entry(entry) for entry in entries]
        need(len({(kind, key) for kind, key, _ in validated}) == len(validated), "duplicate legacy memory records")
        normalized = []
        for state in sessions:
            need(isinstance(state, dict) and state.get("_legacy") is True and state.get("stage") == "HANDOVER"
                 and state.get("write") == [], "legacy session must be a normalized handover without claims")
            payload = {key: value for key, value in state.items() if key != "_revision"}
            payload["digest"] = digest({key: value for key, value in payload.items() if key != "digest"})
            normalized.append(self._payload(payload))
        need(len({state["id"] for state in normalized}) == len(normalized), "duplicate legacy session ids")
        admin_id = "migration-" + fingerprint[:16]
        need(admin_id not in {state["id"] for state in normalized}, "legacy session conflicts with migration marker")
        now = datetime.now(timezone.utc).isoformat()
        admin = dict(schema_version=2, id=admin_id, root=str(self.root), task="Import legacy memory",
                     kind="maintenance", owner="migration", write=[], read=[], verify=[], stage="IMPORTED", _legacy=True)
        admin["digest"] = digest(admin)
        with self._connection(write=True) as connection:
            for row in connection.execute("SELECT payload FROM events WHERE action='MIGRATE'"):
                payload = parse_json(row["payload"])
                if payload.get("source") == source and payload.get("fingerprint") == fingerprint:
                    return dict(imported_records=0, imported_sessions=0, already_imported=True)
            need(connection.execute("SELECT id FROM sessions WHERE id=?", (admin_id,)).fetchone() is None,
                 "migration marker conflicts with an existing task")
            connection.execute("INSERT INTO sessions VALUES (?,?,?)", (admin_id, 1, encoded(admin)))
            imported_sessions = 0
            for state in normalized:
                old = connection.execute("SELECT * FROM sessions WHERE id=?", (state["id"],)).fetchone()
                if old is not None:
                    current = self._state(old)
                    current.pop("_revision")
                    need(current == state, f"legacy session conflicts with existing task: {state['id']}")
                else:
                    connection.execute("INSERT INTO sessions VALUES (?,?,?)", (state["id"], 1, encoded(state)))
                    imported_sessions += 1
            imported_records = 0
            for kind, key, body in validated:
                old = connection.execute("SELECT body FROM memory WHERE kind=? AND key=?", (kind, key)).fetchone()
                if old is not None:
                    need(parse_json(old["body"]) == body, f"legacy memory conflicts with existing record: {kind}/{key}")
                else:
                    connection.execute("INSERT INTO memory VALUES (?,?,?,?,?)", (kind, key, encoded(body), admin_id, now))
                    imported_records += 1
            result = dict(imported_records=imported_records, imported_sessions=imported_sessions, already_imported=False)
            connection.execute("INSERT INTO events(task_id,action,payload,at) VALUES (?,?,?,?)",
                               (admin_id, "MIGRATE", encoded(dict(source=source, fingerprint=fingerprint, **result)), now))
            return result
