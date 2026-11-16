import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

HERE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('trusted_reader', HERE / 'plugins/rules-local/src/read-memory.py')
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)

SCHEMA = [
 'CREATE TABLE sessions(id TEXT PRIMARY KEY,revision INTEGER,data TEXT)',
 'CREATE TABLE memory(kind TEXT,key TEXT,body TEXT,task_id TEXT,updated_at TEXT,PRIMARY KEY(kind,key))',
 'CREATE TABLE events(seq INTEGER PRIMARY KEY,task_id TEXT,action TEXT,payload TEXT,at TEXT)',
 'CREATE TABLE claims(path TEXT PRIMARY KEY,task_id TEXT)',
]
PLAN = [
 'CREATE TABLE capabilities(id TEXT PRIMARY KEY,revision INTEGER,body TEXT)',
 'CREATE TABLE steps(id TEXT PRIMARY KEY,revision INTEGER,parent TEXT,kind TEXT,effect TEXT,owner TEXT,title TEXT,body TEXT)',
 'CREATE TABLE step_dependencies(step TEXT,needs TEXT)',
]

def sha(raw):
    return hashlib.sha256(raw.encode() if isinstance(raw, str) else raw).hexdigest()

class Fixture:
    def __init__(self, modern=True, schema=None):
        self.tmp = tempfile.TemporaryDirectory(prefix='rules27-fixture-')
        self.root = Path(self.tmp.name)
        self.modern = modern
        self.schema = schema if schema is not None else (2 if modern else 1)
        self.files = {
            'AGENTS.md': 'Read .wisdohm/BOOT.md.\n',
            '.wisdohm/BOOT.md': '# WISDOHM (version ' + ('2.7.0' if modern else '2.6.0') + ')\n** CA_WISDOHM - ON **\n' + '\n'.join(f'{n}. {gate} — instructions.' for n, gate in enumerate(['BOOT','PREFLIGHT','WORK','VERIFY','CLOSE'],1)),
            '.wisdohm/protocols/rules.md': '1. Keep actual evidence.\n',
            '.wisdohm/protocols/updates.md': 'Record outcomes.\n',
            '.wisdohm/policy.yaml': 'context_limit_percent: 33\nmeasurement_max_age_seconds: 60\n' + ('context_mode: advisory\n' if modern else ''),
            '.wisdohm/journey.yaml': 'gates: [BOOT, PREFLIGHT, WORK, VERIFY, CLOSE]\ntask_kinds: [audit, feature]\naccent: cyan\nbold: true\n',
            '.wisdohm/config/project.yaml': 'project: fixture\nmode: autonomous\ncommands: {}\nrules: {protected_paths: []}\nownership: {}\n',
            'src/owned.txt': 'retained content',
            'docs/task.md': '1. Keep workspace instructions.\n',
        }
        for name in ['router.py','session.py','common.py','store.py'] + (['planning.py','routing.py','workspaces.py'] if modern else []):
            self.files['.wisdohm/' + name] = 'raise RuntimeError("PROJECT CODE MUST NEVER EXECUTE")\n'
        if modern:
            self.files['.wisdohm/protocols/work.md'] = '1. Follow declared source scope.\n'
        else:
            self.files.update({
                '.context/modules/registry.yaml': 'schema_version: 1\nmodules:\n  fixture:\n    agent: fixture\n    paths: [src/owned.txt]\n',
                '.wisdohm/config/agents.yaml': 'schema_version: 1\nprofiles:\n  fixture:\n    description: Fixture role\n    skills: [.agents/skills/fixture/SKILL.md]\n',
                '.agents/skills/fixture/SKILL.md': '1. Preserve evidence.\n',
                '.wisdohm/orchestration.py': 'raise RuntimeError("PROJECT CODE MUST NEVER EXECUTE")\n',
            })
        for path, text in self.files.items():
            self.put(path,text)
        self.db = self.root / '.wisdohm/memory.sqlite'
        with sqlite3.connect(self.db) as db:
            for sql in SCHEMA + (PLAN if self.schema == 2 else []): db.execute(sql)
            db.execute('PRAGMA user_version=' + str(self.schema))
            if self.schema == 2:
                self.cap = dict(purpose='Own fixture',paths=['src/owned.txt'],public=['src/owned.txt'],uses=[],guidance=[],archived=False)
                db.execute('INSERT INTO capabilities VALUES(?,?,?)', ('fixture',1,json.dumps(self.cap)))
            db.execute('INSERT INTO memory VALUES(?,?,?,?,?)',('codebase','fixture',json.dumps({'source_path':'src/owned.txt','sha256':sha(self.files['src/owned.txt'])}),'receipt','now'))
    def put(self,path,text):
        p=self.root/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text)
    def receipt(self):
        inputs = {path:sha(text) for path,text in self.files.items() if path.startswith('.wisdohm/') or path == 'AGENTS.md'}
        inputs.update({('read:' if self.modern else '')+'src/owned.txt':sha(self.files['src/owned.txt'])})
        for path in ['AGENTS.md','docs/task.md']:
            inputs[('workspace:' if self.modern else '')+path] = sha(self.files[path])
        return dict(schema_version=2,id='receipt',root=str(self.root),source_root=str(self.root),stage='VERIFY',
            kind='audit',owner='fixture',read=['src/owned.txt'],write=[],rules=['docs/task.md'],
            verify=['fixture check'],checks=[dict(command='fixture check',exit=0,output_digest=sha('check output'))],
            inputs=inputs,outputs={})
    def save(self, state):
        state=copy.deepcopy(state);state.pop('digest',None);state['digest']=reader.digest(state)
        with sqlite3.connect(self.db) as db:
            db.execute('INSERT OR REPLACE INTO sessions VALUES(?,?,?)',(state['id'],1,json.dumps(state)))
    def snapshot(self):
        before=self.db.read_bytes()
        result=reader.Reader(self.root,'default').snapshot()
        assert self.db.read_bytes() == before, 'reader changed SQLite bytes'
        return result
    def close(self): self.tmp.cleanup()

class ReaderCompatibility(unittest.TestCase):
    def fixture(self, **kw):
        f=Fixture(**kw);self.addCleanup(f.close);return f
    def test_schema1_and_26_remain_current(self):
        f=self.fixture(modern=False);f.save(f.receipt());s=f.snapshot()
        self.assertEqual(s['edition'],'wisdohm-2.6');self.assertEqual(s['authority']['status'],'ready')
        self.assertEqual(s['checks'][0]['freshness'],'current');self.assertEqual(s['harness']['routing']['owners'],1)
    def test_schema2_sql_and_prefixed_receipt(self):
        f=self.fixture();f.save(f.receipt());s=f.snapshot()
        self.assertEqual(s['edition'],'wisdohm-2.7');self.assertEqual(s['authority']['status'],'ready')
        self.assertEqual(s['checks'][0]['freshness'],'current');self.assertEqual(s['harness']['routing'],dict(status='valid',owners=1,profiles=0,skills=0))
        self.assertEqual(len(s['harness']['gates']),5)
    def test_imported_checks_stay_historical(self):
        f=self.fixture();state=f.receipt();state['stage']='IMPORTED';f.save(state)
        self.assertEqual(f.snapshot()['checks'][0]['freshness'],'historical')
    def test_changed_prefixed_read_is_stale(self):
        f=self.fixture();f.save(f.receipt());f.put('src/owned.txt','changed')
        self.assertEqual(f.snapshot()['checks'][0]['freshness'],'stale')
    def test_missing_required_read_binding_is_unverified(self):
        f=self.fixture();state=f.receipt();state['inputs'].pop('read:src/owned.txt');f.save(state)
        self.assertEqual(f.snapshot()['checks'][0]['freshness'],'unverified')
    def test_prefix_escape_is_unsafe(self):
        f=self.fixture();state=f.receipt();state['inputs']['read:../outside']=sha('secret');f.save(state)
        self.assertEqual(f.snapshot()['checks'][0]['freshness'],'unverified')
    def test_conflicting_prefixed_hash_is_not_current(self):
        f=self.fixture();state=f.receipt();state['inputs']['read:AGENTS.md']=sha('different');f.save(state)
        self.assertEqual(f.snapshot()['checks'][0]['freshness'],'unverified')
    def test_symlink_read_does_not_escape(self):
        f=self.fixture();state=f.receipt();(f.root/'src/owned.txt').unlink();(f.root/'src/owned.txt').symlink_to('/etc/passwd');f.save(state)
        self.assertEqual(f.snapshot()['checks'][0]['freshness'],'unverified')
    def test_foreign_source_workspace_not_inspected(self):
        f=self.fixture();state=f.receipt();state['source_root']='/not-the-selected-project';f.save(state);check=f.snapshot()['checks'][0]
        self.assertEqual(check['freshness'],'unverified');self.assertEqual(check['evidence'],[])
    def test_sql_binding_not_claimed_current(self):
        f=self.fixture();state=f.receipt();state['plan']={'step':'work','digest':sha('binding')};f.save(state)
        self.assertEqual(f.snapshot()['checks'][0]['freshness'],'unverified')
    def test_capability_cycle_rejected(self):
        f=self.fixture();f.cap['uses']=['fixture']
        with sqlite3.connect(f.db) as db: db.execute('UPDATE capabilities SET body=?',(json.dumps(f.cap),))
        s=f.snapshot();self.assertEqual(s['harness']['routing']['status'],'invalid')
    def test_null_session_planning_event_is_displayed(self):
        f=self.fixture()
        with sqlite3.connect(f.db) as db:
            db.execute('INSERT INTO events VALUES(?,?,?,?,?)',(1,None,'PLAN_EDIT','{}','now'))
        s=f.snapshot()
        self.assertFalse(any('invalid identity metadata' in x for x in s['harness']['health']['issues']))
        event_table=next(x for x in s['harness']['memoryGraph']['tables'] if x['table']=='events')
        self.assertEqual(event_table['shown'],1)
    def test_schema1_null_session_event_stays_invalid(self):
        f=self.fixture(modern=False)
        with sqlite3.connect(f.db) as db:
            db.execute('INSERT INTO events VALUES(?,?,?,?,?)',(1,None,'PLAN_EDIT','{}','now'))
        self.assertTrue(any('invalid identity metadata' in x for x in f.snapshot()['harness']['health']['issues']))
    def test_ambiguous_public_ownership_rejected(self):
        f=self.fixture()
        with sqlite3.connect(f.db) as db:
            db.execute('INSERT INTO capabilities VALUES(?,?,?)',('second',1,json.dumps(f.cap)))
        self.assertEqual(f.snapshot()['harness']['routing']['status'],'invalid')
    def test_legacy_yaml_does_not_override_sql(self):
        f=self.fixture();f.put('.context/modules/registry.yaml','not a registry')
        self.assertEqual(f.snapshot()['harness']['routing']['status'],'valid')
    def test_invalid_policy_rejected(self):
        f=self.fixture();f.put('.wisdohm/policy.yaml','context_limit_percent: 33\nmeasurement_max_age_seconds: 60\ncontext_mode: bypass\n')
        self.assertEqual(f.snapshot()['authority']['status'],'invalid')
    def test_schema1_upgrade_pending_is_disclosed(self):
        f=self.fixture(schema=1);s=f.snapshot()
        self.assertEqual(s['memory']['status'],'populated');self.assertTrue(any('upgrade is pending' in x for x in s['harness']['health']['issues']))
    def test_unknown_schema_rejected(self):
        f=self.fixture()
        with sqlite3.connect(f.db) as db: db.execute('PRAGMA user_version=99')
        self.assertEqual(f.snapshot()['memory']['status'],'invalid')

if __name__=='__main__': unittest.main(verbosity=2)
