import test from 'node:test';
import assert from 'node:assert/strict';
import { glob, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { parseObservation } from '../packages/automation-contracts/src/browser.ts';

test('v2 observation contract bounds targets, rejects legacy locators and strips unrelated fields', () => {
  assert.throws(() => parseObservation({ version: 1, targets: [] }), /v2/);
  assert.throws(() => parseObservation({ version: 2, partial: false, targets: [{ locator: '#button' }] }), /target/);
  assert.throws(() => parseObservation({ version: 2, partial: false, targets: Array(201).fill({}) }), /v2/);
  const expected = { version: 2, partial: false, targets: [{ ref: 'seen', frameId: 'frame', role: 'button', name: 'Save' }] };
  assert.deepEqual(parseObservation({ ...expected, privateData: 'discard', targets: [{ ...expected.targets[0], value: 'discard' }] }), expected);
});

test('automation source has canonical owners, acyclic public imports and no renderer/server reachability', async () => {
  const root = process.cwd();
  const owners = JSON.parse(execFileSync('/usr/bin/python3', ['-I', '-B', '.agents/data/definitions.py', 'ownership', '--root', root], { encoding: 'utf8' }));
  const assigned = new Map();
  for (const owner of owners) for (const pattern of owner.paths) for await (const path of glob(pattern)) assigned.set(path, owner);
  const graph = new Map();
  for await (const path of glob(['plugins/browser/src/**/*.mjs', 'plugins/agentic/src/**/*.mjs', 'apps/automation-desktop/*.mjs'])) {
    const owner = assigned.get(path); assert(owner, `Unowned automation source: ${path}`);
    const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const outgoing = [];
    const visit = node => {
      let specifier;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) specifier = node.moduleSpecifier.text;
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (ts.isStringLiteral(node.arguments[0])) specifier = node.arguments[0].text;
        else {
          assert.equal(path, 'apps/automation-desktop/main.mjs');
          assert.equal(node.arguments[0].getText(source), 'pathToFileURL(process.env.AUTOMATION_PUPPETEER).href', 'Only the trusted pinned runtime loader may use a computed import');
        }
      }
      if (specifier?.startsWith('.')) {
        const target = relative(root, resolve(path, '..', specifier));
        const targetOwner = assigned.get(target); assert(targetOwner, `Unowned import ${target}`);
        if (targetOwner.id !== owner.id) {
          assert(owner.uses.includes(targetOwner.id), `${owner.id} must declare ${targetOwner.id}`);
          assert(targetOwner.public.includes(target), `Private import ${target}`);
        }
        outgoing.push(target);
      }
      if (path.endsWith('/renderer.mjs') && specifier) assert.fail(`Standalone renderer must use only the preload contract: ${specifier}`);
      ts.forEachChild(node, visit);
    };
    visit(source); graph.set(path, outgoing);
  }
  const active = new Set(), done = new Set();
  function visit(path) {
    assert(!active.has(path), `Automation import cycle at ${path}`);
    if (done.has(path)) return;
    active.add(path); for (const target of graph.get(path) || []) visit(target); active.delete(path); done.add(path);
  }
  for (const path of graph.keys()) visit(path);
});
