import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * The Tauri doubles of the E2E suite, reused by the screenshot walk.
 *
 * Each spec installs its double inline, as the first `page.addInitScript(() =>
 * { … })` of its `test.beforeEach` (or of a named helper such as onboarding's
 * `firstRunShell`). Copying those bodies into the walk would leave two doubles
 * that drift apart; moving them out of the specs would touch every spec. So
 * the walk READS them from the spec at run time: the TypeScript parser finds
 * the arrow function, the compiler turns it into plain JavaScript, and the walk
 * installs that. When a spec's double changes, the next walk photographs the
 * changed one. A spec that no longer has that shape fails the walk loudly.
 */

const E2E = join(dirname(fileURLToPath(import.meta.url)), '..', 'e2e');

function isAddInitScript(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'addInitScript'
    && node.arguments.length > 0
    && (ts.isArrowFunction(node.arguments[0]!) || ts.isFunctionExpression(node.arguments[0]!));
}

function firstInitScript(within: ts.Node): ts.Node | null {
  let found: ts.Node | null = null;
  const walk = (node: ts.Node) => {
    if (found) return;
    if (isAddInitScript(node)) { found = node.arguments[0]!; return; }
    ts.forEachChild(node, walk);
  };
  walk(within);
  return found;
}

/**
 * The double of `spec` as a script string for `page.addInitScript({ content })`.
 * `from` names where to look: `beforeEach` (the default) or a function name.
 */
export function specMock(spec: string, from: string = 'beforeEach'): string {
  const file = join(E2E, spec);
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  let scope: ts.Node | null = null;
  const find = (node: ts.Node) => {
    if (scope) return;
    if (from === 'beforeEach' && ts.isCallExpression(node) && node.expression.getText(source) === 'test.beforeEach') scope = node;
    else if (from !== 'beforeEach' && ts.isFunctionDeclaration(node) && node.name?.text === from) scope = node;
    if (!scope) ts.forEachChild(node, find);
  };
  find(source);
  const fn = scope ? firstInitScript(scope) : null;
  if (!fn) throw new Error(`${spec}: no page.addInitScript(() => …) in ${from} — the walk reads the spec's Tauri double from there`);
  const js = ts.transpileModule(`(${fn.getText(source)})();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return js;
}
