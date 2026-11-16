import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AgentAssessmentEvidenceSchema, ApplicationError, type RulesService } from '@devlab/contracts';
import { readAgentTraffic, readRulesSnapshot } from '../plugins/rules-local/src/snapshot.ts';
import { rulesRequest } from '../plugins/transport-http/src/rules.ts';

const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const schema = [
  'CREATE TABLE sessions(id TEXT PRIMARY KEY,revision INTEGER,data TEXT)',
  'CREATE TABLE memory(kind TEXT,key TEXT,body TEXT,task_id TEXT REFERENCES sessions(id),updated_at TEXT,PRIMARY KEY(kind,key))',
  'CREATE TABLE events(seq INTEGER PRIMARY KEY,task_id TEXT REFERENCES sessions(id),action TEXT,payload TEXT,at TEXT)',
  'CREATE TABLE claims(path TEXT PRIMARY KEY,task_id TEXT REFERENCES sessions(id))',
  'PRAGMA user_version=1',
];
type State = Record<string, unknown>;
async function fixture(legacy = false) {
  const root = await mkdtemp(join(tmpdir(), 'devtest-rules-'));
  const base = legacy ? '.context' : '.wisdohm';
  const files: Record<string, string> = {
    'AGENTS.md': `Read ${base}/BOOT.md and ${base}/protocols/maintenance.md.`,
    [`${base}/BOOT.md`]: `# ${legacy ? 'WISDOM' : 'WISDOHM'} (version ${legacy ? '2.4.0' : '2.6.0'})\n** CA_${legacy ? 'WISDOM' : 'WISDOHM'} - ON **\n`,
    [`${base}/protocols/rules.md`]: '# Engineering\n1. Understand callers.\n2. Keep ownership clear.\n',
    [`${base}/protocols/updates.md`]: 'Record actual outcomes.\n',
    [`${base}/protocols/maintenance.md`]: '[reviewed]: ../../docs/rules.md "sha256:' + hash('1. Preserve behavior.\n') + '"\n',
    [`${base}/policy.yaml`]: 'context_limit_percent: 33\nmeasurement_max_age_seconds: 60\n',
    [`${base}/config/project.yaml`]: 'project: fixture\nmode: autonomous\ncommands:\n  test: "npm run check"\nrules:\n  protected_paths: []\nownership: {}\n',
    'docs/rules.md': '1. Preserve behavior.\n',
    'src/owned.txt': 'source with unicode \u00e9',
  };
  const runtime = ['router.py', 'session.py', 'common.py', ...(legacy ? ['memory.py'] : ['store.py'])];
  for (const name of runtime) files[base + '/' + name] = 'raise RuntimeError("PROJECT CODE MUST NEVER EXECUTE")\n';
  if (!legacy) files[base + '/journey.yaml'] = 'gates: [BOOT, PREFLIGHT, WORK, VERIFY, CLOSE]\ntask_kinds: [feature, audit]\naccent: cyan\nbold: true\n';
  else files[base + '/state/index.json'] = JSON.stringify({ memory: { codebase: ['src/owned.txt'] } });
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text);
  }
  const database = join(root, base, 'memory.sqlite');
  if (!legacy) {
    const db = new DatabaseSync(database); try { for (const sql of schema) db.exec(sql); } finally { db.close(); }
  }
  const save = async (state: State) => {
    delete state.digest;
    state.digest = execFileSync('python3', ['-I', '-c', 'import sys,json,hashlib;print(hashlib.sha256(json.dumps(json.load(sys.stdin),sort_keys=True,separators=(",",":"),allow_nan=False).encode()).hexdigest())'],
      { input: JSON.stringify(state), encoding: 'utf8' }).trim();
    if (legacy) {
      await mkdir(join(root, base, 'state/agents'), { recursive: true });
      await writeFile(join(root, base, 'state/agents', state.id + '.json'), JSON.stringify(state));
    } else {
      const db = new DatabaseSync(database);
      try { db.prepare('INSERT OR REPLACE INTO sessions VALUES(?,1,?)').run(String(state.id), JSON.stringify(state)); }
      finally { db.close(); }
    }
  };
  const receipt = async (id: string, exit = 0): Promise<State> => ({ schema_version: legacy ? 1 : 2, id, root,
    kind: 'audit', owner: 'fixture', stage: 'VERIFY', task: 'Synthetic receipt fixture',
    read: ['src/owned.txt'], write: [], rules: [base + '/protocols/maintenance.md'],
    verify: ['fixture check'], checks: [{ command: 'fixture check', exit, output_digest: hash('captured output') }],
    inputs: Object.fromEntries(await Promise.all(Object.keys(files).map(async path => [path, hash(await readFile(join(root, path)))]))),
    outputs: {}, updated_at: '2026-10-31T12:00:00Z' });
  return { root, base, database, files, save, receipt, snapshot: () => readRulesSnapshot(root, 'default'),
    dispose: () => rm(root, { recursive: true, force: true }) };
}
async function harnessFixture() {
  const f = await fixture();
  const files = {
    '.wisdohm/BOOT.md': '# WISDOHM (version 2.6.0)\n** CA_WISDOHM - ON **\n' +
      ['BOOT', 'PREFLIGHT', 'WORK', 'VERIFY', 'CLOSE'].map((id, i) => `${i + 1}. ${id} — Actual fixture instruction ${i + 1}.`).join('\n'),
    '.context/modules/registry.yaml': 'schema_version: 1\nmodules:\n  fixture:\n    agent: fixture\n    paths: [src/owned.txt]\n',
    '.wisdohm/config/agents.yaml': 'schema_version: 1\nprofiles:\n  fixture:\n    description: Actual fixture role\n    skills: [.agents/skills/fixture/SKILL.md]\n',
    '.wisdohm/orchestration.py': 'raise RuntimeError("ROUTING CODE MUST NEVER EXECUTE")\n',
    '.agents/skills/fixture/SKILL.md': '# Fixture owner skill\n1. Preserve actual evidence.\n',
  };
  for (const [path, text] of Object.entries(files)) {
    f.files[path] = text;
    await mkdir(dirname(join(f.root, path)), { recursive: true }); await writeFile(join(f.root, path), text);
  }
  return f;
}
test('harness reports actual routing, BOOT gates, memory groups and source freshness without changing SQLite', async () => {
  const f = await harnessFixture();
  try {
    await f.save(await f.receipt('owner'));
    const db = new DatabaseSync(f.database);
    try {
      db.prepare('INSERT INTO memory VALUES(?,?,?,?,?)').run('codebase', 'current-source', JSON.stringify({ text: 'Actual observation', source_path: 'src/owned.txt', sha256: hash(f.files['src/owned.txt']!) }), 'owner', '2026-11-01');
      db.prepare('INSERT INTO memory VALUES(?,?,?,?,?)').run('progress', 'legacy-source', JSON.stringify({ legacy: true, source_path: 'old.txt', sha256: '0'.repeat(64) }), 'owner', '2026-11-01');
    } finally { db.close(); }
    const before = await readFile(f.database);
    const snapshot = await f.snapshot(), h = snapshot.harness!;
    assert.equal(snapshot.authority.status, 'ready'); assert.equal(h.health.status, 'healthy');
    assert.equal(h.memory.integrity, 'ok'); assert.deepEqual(h.routing, { status: 'valid', owners: 1, profiles: 1, skills: 1 });
    assert.deepEqual(h.gates.map(g => g.id), ['BOOT', 'PREFLIGHT', 'WORK', 'VERIFY', 'CLOSE']);
    assert(h.gates.every(g => g.sourcePath === '.wisdohm/BOOT.md' && g.instruction.includes('Actual fixture instruction')));
    assert.deepEqual(h.memory.groups, [{ kind: 'codebase', count: 1 }, { kind: 'progress', count: 1 }]);
    assert.deepEqual(h.memory.stages, [{ stage: 'VERIFY', count: 1 }]);
    assert.deepEqual(h.memory.freshness, { current: 1, stale: 0, missing: 0, unverified: 0, scanned: 1, truncated: false });
    assert.deepEqual(await readFile(f.database), before);
    await writeFile(join(f.root, 'src/owned.txt'), 'Changed source');
    const stale = (await f.snapshot()).harness!;
    assert.equal(stale.memory.freshness.stale, 1); assert.equal(stale.health.status, 'attention');
    await rm(join(f.root, 'src/owned.txt'));
    assert.equal((await f.snapshot()).harness!.memory.freshness.missing, 1);
  } finally { await f.dispose(); }
});
test('memory graph bounds actual rows and closes real foreign keys with verified reference stubs', async () => {
  const f = await harnessFixture();
  try {
    await f.save(await f.receipt('outside-sample'));
    const db = new DatabaseSync(f.database);
    try {
      for (let i = 0; i < 34; i++) db.prepare('INSERT INTO sessions VALUES(?,1,?)').run('recent-' + i, JSON.stringify({ id: 'recent-' + i, stage: 'HANDOVER' }));
      for (let i = 0; i < 70; i++) db.prepare('INSERT INTO memory VALUES(?,?,?,?,?)').run('codebase', 'fact-' + i, JSON.stringify({ provenance: 'actual-fixture', text: 'Recorded fact' }), 'outside-sample', String(i).padStart(3, '0'));
      db.prepare('INSERT INTO events VALUES(?,?,?,?,?)').run(1, 'outside-sample', 'START', JSON.stringify({ stage: 'START' }), '2026-11-01');
      db.prepare('INSERT INTO claims VALUES(?,?)').run('src/owned.txt', 'outside-sample');
    } finally { db.close(); }
    const before = await readFile(f.database);
    const graph = (await f.snapshot()).harness!.memoryGraph;
    assert.equal(graph.status, 'ready'); assert(graph.truncated);
    assert.deepEqual(graph.tables.find(t => t.table === 'memory'), { table: 'memory', total: 70, shown: 32 });
    assert.deepEqual(graph.tables.find(t => t.table === 'claims'), { table: 'claims', total: 1, shown: 1 });
    assert.equal(graph.graph.items.filter(i => i.id.startsWith('wisdohm:row:memory:')).length, 32);
    const stub = graph.graph.items.find(i => i.label === 'outside-sample')!;
    assert(stub.detail.includes('outside the recent sample'));
    assert.equal(graph.graph.edges.length, 34);
    assert(graph.graph.edges.every(e => e.label === 'task_id → id' && e.target === stub.id));
    const ids = new Set(graph.graph.items.map(i => i.id));
    assert(graph.graph.edges.every(e => ids.has(e.source) && ids.has(e.target)));
    assert(graph.graph.items.every(i => i.path === undefined && i.detail.length <= 4096));
    assert.deepEqual(await readFile(f.database), before);
  } finally { await f.dispose(); }
});
test('missing or unsafe harness routing remains distinct from legacy authority and empty SQL memory', async () => {
  const f = await harnessFixture();
  try {
    let snapshot = await f.snapshot();
    assert.equal(snapshot.harness!.memoryGraph.status, 'ready');
    assert(snapshot.harness!.memoryGraph.tables.every(table => table.total === 0 && table.shown === 0));
    await rm(join(f.root, '.wisdohm/config/agents.yaml'));
    snapshot = await f.snapshot(); assert.equal(snapshot.harness!.routing.status, 'unavailable');
    assert.equal(snapshot.authority.status, 'unpopulated');
    await writeFile(join(f.root, '.wisdohm/config/agents.yaml'), f.files['.wisdohm/config/agents.yaml']!);
    await rm(join(f.root, '.agents/skills/fixture/SKILL.md'));
    await writeFile(join(f.root, '.env'), 'NEVER_DISPLAY_HARNESS_SECRET');
    await symlink(join(f.root, '.env'), join(f.root, '.agents/skills/fixture/SKILL.md'));
    snapshot = await f.snapshot(); assert.equal(snapshot.harness!.routing.status, 'invalid');
    assert(!JSON.stringify(snapshot).includes('NEVER_DISPLAY_HARNESS_SECRET'));
    await writeFile(f.database, 'corrupt sqlite');
    snapshot = await f.snapshot(); assert.equal(snapshot.harness!.memory.integrity, 'failed');
    assert.equal(snapshot.harness!.memoryGraph.status, 'unavailable'); assert.deepEqual(snapshot.harness!.memoryGraph.tables, []);
  } finally { await f.dispose(); }
  const legacy = await fixture(true);
  try { assert.equal((await legacy.snapshot()).harness!.memoryGraph.status, 'unavailable'); }
  finally { await legacy.dispose(); }
});
test('harness reports malformed records and dangling foreign keys without inventing graph endpoints', async () => {
  const f = await harnessFixture();
  try {
    const db = new DatabaseSync(f.database);
    try {
      db.exec('PRAGMA foreign_keys=OFF'); // Deliberately inconsistent fixture, never a production writer.
      db.prepare('INSERT INTO memory VALUES(?,?,?,?,?)').run('codebase', 'dangling', '{', 'absent-session', '2026-11-01');
      db.prepare('INSERT INTO memory VALUES(?,?,?,?,?)').run('codebase', 'invalid-key', '{}', Buffer.from('not-a-text-key'), '2026-11-01');
    } finally { db.close(); }
    const before = await readFile(f.database), snapshot = await f.snapshot(), h = snapshot.harness!;
    assert.equal(h.health.status, 'attention'); assert(h.memory.freshness.unverified > 0);
    assert(h.health.issues.some(issue => issue.includes('no session row')));
    assert(h.health.issues.some(issue => issue.includes('invalid identity')));
    assert.equal(h.memoryGraph.status, 'ready'); assert(h.memoryGraph.truncated);
    assert.equal(h.memoryGraph.graph.edges.length, 0);
    assert(!h.memoryGraph.graph.items.some(item => item.label === 'absent-session'));
    assert.deepEqual(await readFile(f.database), before);
  } finally { await f.dispose(); }
});

test('rules snapshot reads pinned sources and separates recorded results from current/stale hashes without writes', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.snapshot()).memory.status, 'unpopulated');
    await f.save(await f.receipt('current-pass'));
    await f.save(await f.receipt('current-failure', 2));
    assert.equal((await f.snapshot()).memory.status, 'unpopulated', 'Sessions alone are not populated authored knowledge');
    const memory = new DatabaseSync(f.database);
    try { memory.prepare('INSERT INTO memory VALUES(?,?,?,?,?)').run('codebase', 'fixture', JSON.stringify({ text: 'Authored fixture observation' }), 'current-pass', '2026-10-31T12:00:00Z'); }
    finally { memory.close(); }
    const before = await readFile(f.database), entries = await readdir(join(f.root, f.base));
    let snapshot = await f.snapshot();
    assert.equal(snapshot.edition, 'wisdohm-2.6'); assert.equal(snapshot.authority.status, 'ready');
    assert.equal(snapshot.sources.find(source => source.path === 'docs/rules.md')!.status, 'current');
    assert.equal(snapshot.sources.find(source => source.path.endsWith('/protocols/rules.md'))!.status, 'unverified');
    assert.equal(snapshot.checks.find(check => check.sessionId === 'current-pass')!.freshness, 'current');
    assert.equal(snapshot.checks.find(check => check.sessionId === 'current-failure')!.result, 'failed');
    assert.equal(snapshot.checks.find(check => check.sessionId === 'current-failure')!.freshness, 'current');
    assert.deepEqual(await readFile(f.database), before); assert.deepEqual(await readdir(join(f.root, f.base)), entries);
    await writeFile(join(f.root, 'src/AGENTS.md'), 'New scoped instruction not present in old receipts.');
    assert((await f.snapshot()).checks.every(check => check.freshness === 'unverified'));
    await rm(join(f.root, 'src/AGENTS.md'));
    await writeFile(join(f.root, 'docs/rules.md'), '1. Drifted guidance.\n');
    snapshot = await f.snapshot();
    assert.equal(snapshot.sources.find(source => source.path === 'docs/rules.md')!.status, 'stale');
    assert(snapshot.checks.every(check => check.freshness === 'stale'));
  } finally { await f.dispose(); }
});

test('rules inspection never falls back from broken 2.6 to legacy or creates missing operational memory', async () => {
  const f = await fixture(true);
  try {
    assert.equal((await f.snapshot()).edition, 'legacy-context-2.4');
    await mkdir(join(f.root, '.wisdohm'));
    let snapshot = await f.snapshot();
    assert.equal(snapshot.edition, 'wisdohm-2.6'); assert.notEqual(snapshot.authority.status, 'ready');
    assert.equal(snapshot.memory.status, 'missing');
    await assert.rejects(stat(join(f.root, '.wisdohm/memory.sqlite')), { code: 'ENOENT' });
    await rm(join(f.root, '.wisdohm'), { recursive: true });
    await symlink(join(f.root, '.context'), join(f.root, '.wisdohm'));
    snapshot = await f.snapshot();
    assert.equal(snapshot.edition, 'wisdohm-2.6'); assert.equal(snapshot.authority.status, 'invalid');
    assert(snapshot.sources.some(source => source.status === 'invalid'));
  } finally { await f.dispose(); }
});

test('rules receipts with missing canonical inputs, malformed schema/digest/output or relocated/imported history never appear current', async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.root, '.context/modules'), { recursive: true });
    f.files['.context/modules/registry.yaml'] = 'schema_version: 1\nmodules: {}\n';
    await writeFile(join(f.root, '.context/modules/registry.yaml'), f.files['.context/modules/registry.yaml']);
    await writeFile(join(f.root, 'AGENTS.md'), f.files['AGENTS.md'] + '\nOwnership: .context/modules/registry.yaml');
    const cases: [string, (state: State) => void][] = [
      ['wrong-schema', state => { state.schema_version = 99; }],
      ['missing-input', state => { delete (state.inputs as Record<string, unknown>)[f.base + '/protocols/rules.md']; }],
      ['missing-ownership-input', state => { delete (state.inputs as Record<string, unknown>)['.context/modules/registry.yaml']; }],
      ['null-canonical-input', state => { (state.inputs as Record<string, unknown>)[f.base + '/protocols/rules.md'] = null; }],
      ['wrong-stage', state => { state.stage = []; }],
      ['wrong-id', state => { state.id = 'invalid id'; }],
      ['missing-check-output', state => { delete (state.checks as Record<string, unknown>[])[0]!.output_digest; }],
      ['missing-write-output', state => { state.write = ['src/owned.txt']; state.outputs = {}; }],
      ['extra-write-output', state => { state.outputs = { 'src/owned.txt': hash(f.files['src/owned.txt']!) }; }],
      ['relocated', state => { state.root = '/another/project'; }],
      ['imported', state => { state._legacy = true; state.legacy_checks = state.checks; state.checks = []; }],
    ];
    for (const [id, mutate] of cases) { const state = await f.receipt(id); mutate(state); await f.save(state); }
    const badDigest = await f.receipt('bad-digest'); await f.save(badDigest);
    const db = new DatabaseSync(f.database);
    try { db.prepare('UPDATE sessions SET data=? WHERE id=?').run(JSON.stringify({ ...badDigest, digest: '0'.repeat(64) }), 'bad-digest'); }
    finally { db.close(); }
    const snapshot = await f.snapshot();
    assert.equal(snapshot.checks.length, 12);
    assert(snapshot.checks.every(check => check.freshness !== 'current'));
    assert.equal(snapshot.checks.find(check => check.sessionId === 'relocated')!.freshness, 'historical');
    assert.equal(snapshot.checks.find(check => check.sessionId === 'imported')!.freshness, 'historical');
  } finally { await f.dispose(); }
});

test('optional pinned rules from one agent do not invalidate another agent receipt', async () => {
  const f = await fixture();
  try {
    await f.save(await f.receipt('baseline-agent'));
    assert.equal((await f.snapshot()).checks[0]!.freshness, 'current');
    const guidance = '1. Other agent guidance.\n';
    const optional = '[other]: other-guidance.md "sha256:' + hash(guidance) + '"\n';
    await writeFile(join(f.root, 'docs/other-guidance.md'), guidance);
    await writeFile(join(f.root, 'docs/optional-rules.md'), optional);
    const other = await f.receipt('other-agent');
    (other.rules as string[]).push('docs/optional-rules.md');
    (other.read as string[]).push('docs/other-guidance.md');
    (other.inputs as Record<string, string>)['docs/optional-rules.md'] = hash(optional);
    (other.inputs as Record<string, string>)['docs/other-guidance.md'] = hash(guidance);
    await f.save(other);
    let snapshot = await f.snapshot();
    assert.equal(snapshot.sources.find(source => source.path === 'docs/other-guidance.md')!.status, 'current');
    assert.equal(snapshot.checks.find(check => check.sessionId === 'baseline-agent')!.freshness, 'current');
    assert.equal(snapshot.checks.find(check => check.sessionId === 'other-agent')!.freshness, 'current');
    await writeFile(join(f.root, 'docs/other-guidance.md'), '1. Changed only for the other agent.\n');
    snapshot = await f.snapshot();
    assert.equal(snapshot.checks.find(check => check.sessionId === 'baseline-agent')!.freshness, 'current');
    assert.equal(snapshot.checks.find(check => check.sessionId === 'other-agent')!.freshness, 'stale');
  } finally { await f.dispose(); }
});

test('rules source and evidence paths reject escape, symlink and secret reads; large guidance is explicitly bounded', async () => {
  const f = await fixture();
  try {
    const secret = join(f.root, '.env'); await writeFile(secret, 'PRIVATE_VALUE_NEVER_DISPLAY');
    await symlink(secret, join(f.root, 'docs/linked.md'));
    await writeFile(join(f.root, 'docs/large.md'), '1. A rule.\n' + 'visible '.repeat(10000));
    await writeFile(join(f.root, 'docs/many.md'), Array.from({ length: 140 }, (_, index) => (index + 1) + '. Rule').join('\n'));
    await writeFile(join(f.root, f.base, 'protocols/maintenance.md'), [
      '[escape]: ../../../outside.md "sha256:' + '1'.repeat(64) + '"',
      '[secret]: ../../.env "sha256:' + '1'.repeat(64) + '"',
      '[linked]: ../../docs/linked.md "sha256:' + '1'.repeat(64) + '"',
      '[large]: ../../docs/large.md "sha256:' + hash(await readFile(join(f.root, 'docs/large.md'))) + '"',
      '[many]: ../../docs/many.md "sha256:' + hash(await readFile(join(f.root, 'docs/many.md'))) + '"',
    ].join('\n'));
    const state = await f.receipt('unsafe'); (state.inputs as Record<string, unknown>)['.env'] = hash('PRIVATE_VALUE_NEVER_DISPLAY');
    await f.save(state);
    const snapshot = await f.snapshot();
    assert(!JSON.stringify(snapshot).includes('PRIVATE_VALUE_NEVER_DISPLAY'));
    assert.equal(snapshot.sources.find(source => source.path === 'docs/linked.md')!.status, 'invalid');
    assert.equal(snapshot.sources.find(source => source.path === '.env')!.status, 'invalid');
    const large = snapshot.sources.find(source => source.path === 'docs/large.md')!;
    assert(large.truncated && large.text.length <= 65536);
    const many = snapshot.sources.find(source => source.path === 'docs/many.md')!;
    assert(many.truncated && many.numberedRules.length === 128);
    assert.equal(snapshot.checks[0]!.freshness, 'unverified');
    assert(snapshot.checks[0]!.evidence.some(item => item.status === 'unsafe'));
  } finally { await f.dispose(); }
});

test('rules snapshot reports missing loaders, dangling maintenance, corrupt SQLite and oversized/malformed session data honestly', async () => {
  const f = await fixture();
  try {
    await rm(join(f.root, f.base, 'router.py'));
    assert.equal((await f.snapshot()).authority.status, 'invalid');
    await writeFile(join(f.root, f.base, 'router.py'), f.files[f.base + '/router.py']!);
    await rm(join(f.root, f.base, 'protocols/maintenance.md'));
    assert.equal((await f.snapshot()).sources.find(source => source.path.endsWith('/protocols/maintenance.md'))!.status, 'missing');
    const db = new DatabaseSync(f.database);
    try { db.prepare('INSERT INTO sessions VALUES(?,1,?)').run('broken', '{'); }
    finally { db.close(); }
    let snapshot = await f.snapshot(); assert(snapshot.warnings.some(warning => /Invalid session/.test(warning)));
    const oversized = new DatabaseSync(f.database);
    try { oversized.prepare('INSERT INTO sessions VALUES(?,1,?)').run('oversized', JSON.stringify({ text: 'x'.repeat(2 * 1024 * 1024) })); }
    finally { oversized.close(); }
    snapshot = await f.snapshot();
    assert(snapshot.memory.status === 'invalid' || snapshot.warnings.some(warning => /oversized/.test(warning)));
    await writeFile(f.database, 'not sqlite');
    snapshot = await f.snapshot(); assert.equal(snapshot.memory.status, 'invalid'); assert.equal(snapshot.authority.status, 'invalid');
    assert.equal(snapshot.checks.length, 0);
  } finally { await f.dispose(); }
});

test('rules HTTP accepts one registered project ID and rejects duplicate/extra/path/write requests without invoking service', async () => {
  const f = await fixture(); let calls = 0, activityCalls = 0;
  const service: RulesService = {
    async snapshot(id) { calls++; if (id !== 'default') throw new ApplicationError('NOT_FOUND', 'Unknown project'); return f.snapshot(); },
    async activity(id) { activityCalls++; if (id !== 'default') throw new ApplicationError('NOT_FOUND', 'Unknown project'); return readAgentTraffic(f.root, id); },
  };
  const send = (response: ServerResponse, status: number, value: unknown) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void rulesRequest(request, response, new URL(request.url!, 'http://127.0.0.1'), service, send)
      .then(handled => { if (!handled) send(response, 404, {}); })
      .catch(error => send(response, error.code === 'NOT_FOUND' ? 404 : 400, { message: String(error) }));
  });
  try {
    await new Promise<void>(ready => server.listen(0, '127.0.0.1', ready));
    const address = server.address(); assert(address && typeof address !== 'string');
    const origin = 'http://127.0.0.1:' + address.port;
    for (const path of ['/api/rules', '/api/rules?projectId=default&projectId=other', '/api/rules?projectId=default&path=/etc/passwd', '/api/rules?projectId=..%2F..'])
      assert.equal((await fetch(origin + path)).status, 400);
    assert.equal((await fetch(origin + '/api/rules?projectId=default', { method: 'POST' })).status, 404);
    assert.equal(calls, 0);
    assert.equal((await fetch(origin + '/api/rules?projectId=unknown')).status, 404);
    assert.equal((await fetch(origin + '/api/rules?projectId=default')).status, 200);
    assert.equal(calls, 2);
    for (const path of ['/api/rules/activity', '/api/rules/activity?projectId=default&projectId=other', '/api/rules/activity?projectId=default&path=secret', '/api/rules/activity?projectId=..%2F..'])
      assert.equal((await fetch(origin + path)).status, 400);
    assert.equal((await fetch(origin + '/api/rules/activity?projectId=default', { method: 'POST' })).status, 404);
    assert.equal(activityCalls, 0);
    assert.equal((await fetch(origin + '/api/rules/activity?projectId=unknown')).status, 404);
    const activity = await fetch(origin + '/api/rules/activity?projectId=default');
    assert.equal(activity.status, 200);
    assert.equal((await activity.json()).projectId, 'default');
    assert.equal(activityCalls, 2);
  } finally { await new Promise<void>(ready => server.close(() => ready())); await f.dispose(); }
});

test('agent activity keeps exact claims independent of session age and never writes the database', async () => {
  const f = await fixture();
  try {
    const session = await f.receipt('claimed');
    session.stage = 'WORK'; session.plan = { step: 'T-ONE' };
    session.updated_at = '2020-01-01T00:00:00Z';
    await f.save(session);
    const db = new DatabaseSync(f.database);
    try { db.prepare('INSERT INTO claims VALUES(?,?)').run('src/owned.txt', 'claimed'); }
    finally { db.close(); }
    const before = await readFile(f.database);
    const snapshot = await readAgentTraffic(f.root, 'default');
    assert.equal(snapshot.status, 'ready');
    assert.deepEqual(snapshot.claims, [{ path: 'src/owned.txt', sessionId: 'claimed' }]);
    assert.deepEqual(snapshot.sessions.map(({ id, stepId, owner, stage, updatedAt }) => ({ id, stepId, owner, stage, updatedAt })),
      [{ id: 'claimed', stepId: 'T-ONE', owner: 'fixture', stage: 'WORK', updatedAt: '2020-01-01T00:00:00Z' }]);
    assert.deepEqual(await readFile(f.database), before);
    await rm(f.database);
    assert.equal((await readAgentTraffic(f.root, 'default')).status, 'missing');
    await writeFile(f.database, 'not sqlite');
    assert.equal((await readAgentTraffic(f.root, 'default')).status, 'invalid');
  } finally { await f.dispose(); }
});

test('agent activity bounds sessions and claims while reporting full counts', async () => {
  const f = await fixture();
  try {
    const db = new DatabaseSync(f.database);
    try {
      const session = db.prepare('INSERT INTO sessions VALUES(?,1,?)');
      const claim = db.prepare('INSERT INTO claims VALUES(?,?)');
      for (let index = 0; index < 257; index++)
        session.run(`session-${index}`, JSON.stringify({ id: `session-${index}`, owner: 'fixture', stage: 'WORK' }));
      for (let index = 0; index < 1025; index++) claim.run(`src/file-${index}.txt`, 'session-0');
    } finally { db.close(); }
    const snapshot = await readAgentTraffic(f.root, 'default');
    assert.equal(snapshot.status, 'ready');
    assert.equal(snapshot.totalSessions, 257);
    assert.equal(snapshot.totalClaims, 1025);
    assert.equal(snapshot.sessions.length, 256);
    assert.equal(snapshot.claims.length, 1024);
    assert.equal(snapshot.truncated, true);
  } finally { await f.dispose(); }
});


test('retained assessed evidence accepts reports and rejects malformed or execution-shaped input', () => {
  const evidence = { schema_version: 1, step_id: 'review', definition_digest: 'a'.repeat(64),
    actor: ' reviewer ', recorded_at: '2026-11-15T12:00:00Z', kind: 'assessed', assessment: ' reviewed ', accepted: false };
  assert.deepEqual(AgentAssessmentEvidenceSchema.parse(evidence), { ...evidence, actor: 'reviewer', assessment: 'reviewed' });
  for (const patch of [{ schema_version: 2 }, { step_id: '../unsafe' }, { definition_digest: 'bad' },
    { actor: ' ' }, { recorded_at: 'yesterday' }, { assessment: 'x'.repeat(4001) },
    { accepted: 'yes' }, { kind: 'verified' }, { checks: [] }]) {
    assert.equal(AgentAssessmentEvidenceSchema.safeParse({ ...evidence, ...patch }).success, false);
  }
});
