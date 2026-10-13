import ts from "typescript";

/**
 * Where a source file reads a text file and writes it back by itself, and
 * where it builds a pair of read and write to hand on.
 *
 * For the guards of both shells and of the shared package that keep every
 * change of a file that exists on the ONE entry of the vault's chain
 * (`readChangeWrite.test.ts`, finding 2026-10-12): `updateVaultText` — on the
 * phone `vaultOps.update` — reads the file inside the chain's gate, so the
 * change starts from the file as it lies there. A writer that reads the file
 * itself and hands the chain the whole text has also just read it, but the
 * chain is not told, and judges it like an editor that held an old text:
 * its text went in place of the user's own version of a note with an open
 * conflict, and a note somebody else had changed was refused with a conflict
 * copy.
 *
 * Read from the syntax tree, so a call spread over several lines says the same
 * as one on a single line. Two shapes:
 *
 *   reads and writes <path> in <function>   · one function calls a read and a
 *       write of a text file with the same path expression
 *   a pair of read and write without the entry   · an object literal that
 *       carries a write of a text file and no entry for a change
 */

export interface Finding {
  /** What stands there, without its line — the key of a guard's list. */
  what: string;
  /** 1-based line. */
  line: number;
}

/** The methods a text file is read with: an adapter's, the phone's `vaultOps`, a shell's own pair. */
const READS = new Set(["readTextFile", "read"]);
/** The methods a whole text is written with. */
const WRITES = new Set(["writeTextFile", "write", "save", "saveEditorText", "writeNoteText"]);
/** The names a pair's write goes under in an object literal, and its entry for a change. */
const PAIR_WRITES = new Set(["writeTextFile"]);
const PAIR_ENTRIES = new Set(["updateTextFile"]);

type FunctionLike = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;
const isFunctionLike = (node: ts.Node): node is FunctionLike =>
  ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);

/** The name a function goes under where it is declared: its own, the variable or property it is kept as. */
function nameOf(fn: FunctionLike, source: ts.SourceFile): string {
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.name) return fn.name.getText(source);
  let at: ts.Node = fn;
  while (at.parent) {
    const parent = at.parent;
    if (ts.isVariableDeclaration(parent) && parent.initializer && contains(parent.initializer, fn)) return parent.name.getText(source);
    if (ts.isPropertyAssignment(parent)) return parent.name.getText(source);
    if (isFunctionLike(parent)) return `${nameOf(parent, source)} (callback)`;
    at = parent;
  }
  return "(anonymous)";
}
const contains = (outer: ts.Node, inner: ts.Node): boolean => inner.pos >= outer.pos && inner.end <= outer.end;

/**
 * The path a read or write names. An adapter's methods take it first
 * (`readTextFile(path)`, `writeTextFile(path, text)`); the phone's `vaultOps`
 * take the vault first (`read(v, path)`, `save(v, path, text)`).
 */
function pathOf(call: ts.CallExpression, method: string, write: boolean, source: ts.SourceFile): string | null {
  const args = call.arguments;
  const vaultFirst = method === "read" ? args.length >= 2 : (method === "save" || method === "saveEditorText") && args.length >= 3;
  const at = vaultFirst ? 1 : 0;
  if (args.length < at + (write ? 2 : 1)) return null;
  return args[at].getText(source).replace(/\s+/g, " ");
}

/**
 * The functions of a file that read a text file and write a whole text to the
 * same path. Calls inside a nested function belong to that function.
 */
export function readsAndWrites(file: string, text: string): Finding[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: Finding[] = [];
  const visit = (fn: FunctionLike): void => {
    const read = new Map<string, number>();
    const written = new Map<string, number>();
    const walk = (node: ts.Node): void => {
      if (isFunctionLike(node) && node !== fn) return;
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const isRead = READS.has(method), isWrite = WRITES.has(method);
        if (isRead || isWrite) {
          const path = pathOf(node, method, isWrite, source);
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          if (path !== null) (isWrite ? written : read).set(path, (isWrite ? written : read).get(path) ?? line);
        }
      }
      ts.forEachChild(node, walk);
    };
    if (fn.body) walk(fn.body);
    for (const [path, line] of written) {
      if (read.has(path)) found.push({ what: `reads and writes ${path} in ${nameOf(fn, source)}`, line });
    }
  };
  (function all(node: ts.Node): void {
    if (isFunctionLike(node)) visit(node);
    ts.forEachChild(node, all);
  })(source);
  return found;
}

/**
 * The object literals of a file that carry a write of a text file under an
 * adapter's name and no entry for a change — a pair somebody is handed and
 * will read and write through.
 */
export function pairsWithoutEntry(file: string, text: string): Finding[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: Finding[] = [];
  (function all(node: ts.Node): void {
    if (ts.isObjectLiteralExpression(node)) {
      const names = node.properties.map((p) => (p.name ? p.name.getText(source) : ""));
      // A spread may bring the entry along (`{ ...vaultTextFiles(vault), rename }`); what is spread is listed where it is built.
      const spreads = node.properties.some(ts.isSpreadAssignment);
      if (names.some((n) => PAIR_WRITES.has(n)) && !names.some((n) => PAIR_ENTRIES.has(n)) && !spreads) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        let owner = "(top level)";
        for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
          if (isFunctionLike(at)) { owner = nameOf(at, source); break; }
          if (ts.isVariableDeclaration(at) && !isInsideFunction(at)) { owner = at.name.getText(source); break; }
        }
        found.push({ what: `a pair of read and write without the entry, in ${owner}`, line });
      }
    }
    ts.forEachChild(node, all);
  })(source);
  return found;
}
function isInsideFunction(node: ts.Node): boolean {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) if (isFunctionLike(at)) return true;
  return false;
}

/** Findings as a guard's list keys them: what stands there, and how often. */
export function counted(findings: readonly Finding[]): Map<string, number[]> {
  const byWhat = new Map<string, number[]>();
  for (const { what, line } of findings) byWhat.set(what, [...(byWhat.get(what) ?? []), line]);
  return byWhat;
}
