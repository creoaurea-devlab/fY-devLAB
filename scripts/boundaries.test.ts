import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { glob, readFile, realpath } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
type Owner = { id: string; group: string; paths: string[]; uses: string[]; public: string[] };
function cycles(graph: Map<string, string[]>) {
  const complete = new Set<string>(), stack = new Set<string>();
  const visit = (id: string) => {
    if (stack.has(id)) throw new Error(`Dependency cycle: ${[...stack, id].join(' -> ')}`);
    if (complete.has(id)) return;
    stack.add(id); for (const dependency of graph.get(id) ?? []) visit(dependency);
    stack.delete(id); complete.add(id);
  };
  for (const id of graph.keys()) visit(id);
}
function boundary(from: Owner, to: Owner, path: string) {
  if (from.id === to.id || from.group === 'verification') return;
  assert(from.uses.includes(to.id), `Undeclared owner dependency: ${from.id} -> ${to.id} (${path})`);
  assert(to.public.includes(path), `Private implementation import: ${from.id} -> ${path}`);
}
function browserDependency(specifier: string) {
  assert(!specifier.startsWith('node:') && !builtinModules.includes(specifier) && specifier !== 'node-pty', `Browser imports server code: ${specifier}`);
}
function imports(text: string, path: string) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const result: { name: string; typeOnly: boolean }[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;
      const bindings = clause?.namedBindings;
      const onlyTypes = ts.isExportDeclaration(node) ? node.isTypeOnly : !!clause?.isTypeOnly ||
        (!!bindings && ts.isNamedImports(bindings) && !clause?.name && bindings.elements.length > 0 && bindings.elements.every(item => item.isTypeOnly));
      result.push({ name: node.moduleSpecifier.text, typeOnly: onlyTypes });
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      assert(node.arguments[0] && ts.isStringLiteral(node.arguments[0]), `Unresolved dynamic import in ${path}`);
      result.push({ name: node.arguments[0].text, typeOnly: false });
    }
    ts.forEachChild(node, visit);
  };
  visit(source); return result;
}

test('boundary guard rejects seeded cycles, private imports and browser Node dependencies', () => {
  assert.throws(() => cycles(new Map([['a', ['b']], ['b', ['a']]])), /Dependency cycle/);
  const a: Owner = { id: 'a', group: 'browser', paths: [], uses: ['b'], public: [] };
  const b: Owner = { id: 'b', group: 'browser', paths: ['private.ts'], uses: [], public: ['index.ts'] };
  assert.throws(() => boundary(a, b, 'private.ts'), /Private implementation/);
  assert.throws(() => browserDependency('node:fs'), /server code/);
  assert.deepEqual(imports("export { x } from './x.ts'; const load = () => import('./y.ts'); import type { T } from './t.ts';", 'fixture.ts'), [
    { name: './x.ts', typeOnly: false }, { name: './y.ts', typeOnly: false }, { name: './t.ts', typeOnly: true },
  ]);
});

test('editable source respects selected ownership, public seams and browser/server boundaries', async () => {
  const selected: Owner[] = JSON.parse(execFileSync('/usr/bin/python3', ['-I', '-B', resolve(root, '.agents/data/definitions.py'), 'ownership', '--root', root], { encoding: 'utf8' }));
  cycles(new Map(selected.map(owner => [owner.id, owner.uses])));
  const owners = new Map<string, Owner>();
  for (const owner of selected) for (const pattern of owner.paths) for await (const path of glob(pattern, { cwd: root })) {
    assert(!owners.has(path), `Overlapping ownership: ${path}`); owners.set(path, owner);
  }
  // Historical missing paths remain provenance; scan only current editable application source.
  const paths: string[] = [];
  for await (const path of glob(['runtime/**/*.ts', 'runtime/**/*.tsx', 'src/**/*.ts', 'src/**/*.tsx', 'plugins/**/*.ts', 'plugins/**/*.tsx', 'packages/**/*.ts', 'packages/**/*.tsx'], { cwd: root })) paths.push(path);
  const options: ts.CompilerOptions = { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023, allowImportingTsExtensions: true };
  const local = new Set(paths), runtime = new Map<string, string[]>(), specifiers = new Map<string, string[]>();
  for (const path of paths) {
    const owner = owners.get(path); assert(owner, `Unowned editable source: ${path}`);
    const outgoing: string[] = [], names: string[] = [];
    for (const entry of imports(await readFile(resolve(root, path), 'utf8'), path)) {
      assert(!entry.name.split('/').includes('_preimp'), `Production source imports staged proposal: ${path} -> ${entry.name}`);
      const resolved = ts.resolveModuleName(entry.name, resolve(root, path), options, ts.sys).resolvedModule;
      if (!entry.typeOnly) names.push(entry.name);
      if (!resolved) {
        assert(!entry.name.startsWith('.') || /\.(css|png|svg)$/.test(entry.name), `Unresolved relative import: ${path} -> ${entry.name}`);
        continue;
      }
      const target = relative(root, await realpath(resolved.resolvedFileName));
      assert(!target.split('/').includes('_preimp'), `Production source resolves to staged proposal: ${path} -> ${target}`);
      assert(!target.split('/').includes('_LAB'), `Production source imports LAB reference: ${path} -> ${target}`);
      if (local.has(target)) {
        const targetOwner = owners.get(target); assert(targetOwner, `Unowned import: ${target}`);
        boundary(owner, targetOwner, target);
        if (!entry.typeOnly) outgoing.push(target);
      }
    }
    runtime.set(path, outgoing); specifiers.set(path, names);
  }
  cycles(runtime);
  const visited = new Set<string>();
  const visitBrowser = (path: string) => {
    if (visited.has(path)) return; visited.add(path);
    assert(owners.get(path)?.group !== 'backend', `Browser reaches backend owner: ${path}`);
    for (const name of specifiers.get(path) ?? []) browserDependency(name);
    for (const next of runtime.get(path) ?? []) visitBrowser(next);
  };
  for (const path of paths) if (owners.get(path)?.group === 'browser') visitBrowser(path);
});
