import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * No failure on a write path is swallowed without a word (stability plan R4,
 * finding S5).
 *
 * A `.catch(() => {})` or an empty `catch {}` around a write, a deletion, a
 * rename, an index step or a store took the failure away for good: no notice,
 * no line in the diagnostics. Each such place in shipped code (desktop, phone,
 * ui, core) now does one of three things — reports it
 * (`reportBackground`/`reportingTo`), says it on screen (`reportVisible`),
 * or stays quiet with its reason written INSIDE the handler (`silent: …`).
 * This reads the source and fails on a swallowing handler around such a call
 * that has neither a handler body nor a comment saying why.
 *
 * Its reach is the calls whose name says they change something (WRITE_VERBS);
 * reads that fall back to a default are not its business. `void promise()`
 * is not either: its rejection reaches the diagnostics through each shell's
 * global `unhandledrejection` listener. New floating promises are the lint's
 * business.
 */

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const DIRS = ["apps/desktop/src", "apps/mobile/src", "packages/core/src", "packages/ui/src"];
const WRITE_VERBS = /^(write|save|delete|remove|rename|trash|persist|upload|send|append|unlink|flush|commit|move|enqueue|purge|restore|archive|replace|store|forget|clear|drop|mkdir|rmdir|copy|relocate|reindex|index|retire|rewrite|sweep|insert|upsert|put)/i;

/**
 * Handed to the strand that rebuilds the code they sit in (stability plan,
 * wave 2): the editor's save path of both shells (R6, "chain"), the desktop's
 * vault opening (L2/L3, "open") and the MCP wire (R19). Each entry is a file
 * and the call the handler swallows; an entry that no longer matches fails,
 * so the list only shrinks.
 */
const HANDED_OVER: ReadonlyArray<readonly [file: string, call: string]> = [
  ["apps/desktop/src/components/Editor.tsx", "persistText(getText())"],
  ["apps/desktop/src/components/Editor.tsx", "persistText(sessionRef.current?.view.state.doc.toString() ?? contentRef.current)"],
  ["apps/desktop/src/components/Editor.tsx", "persistText(text)"],
  ["apps/mobile/src/EditorHost.tsx", "noteSaver.flush(path, vault)"],
  ["apps/mobile/src/screens/NoteScreen.tsx", "noteSaver.flush(path, vault)"],
  ["apps/desktop/src/contexts/VaultContext.tsx", "indexer.indexComplete()"],
  ["packages/core/src/ai/mcp/stdioWire.ts", "write(answer)"],
  ["packages/core/src/ai/mcp/stdioWire.ts", "write({ jsonrpc: \"2.0\", method: \"notifications/cancelled\", params: { requestId: id, reason } })"],
  ["packages/ui/src/ai/mcpSession.ts", "this.removed(id)"],
];

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") sources(path, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") && !/^test-/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

const isConsole = (n: ts.Node) =>
  ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === "console";

/** An expression that stands for "nothing happened": a literal, an empty array or object, `undefined`, a console line. */
function inert(n: ts.Expression): boolean {
  while (ts.isAsExpression(n) || ts.isParenthesizedExpression(n) || ts.isSatisfiesExpression(n)) n = n.expression;
  if (ts.isIdentifier(n)) return n.text === "undefined";
  if ([ts.SyntaxKind.NullKeyword, ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(n.kind)) return true;
  if (ts.isStringLiteral(n) || ts.isNumericLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isVoidExpression(n)) return true;
  if (ts.isArrayLiteralExpression(n)) return n.elements.length === 0;
  if (ts.isObjectLiteralExpression(n)) return n.properties.length === 0;
  return isConsole(n);
}

function swallows(block: ts.Block): boolean {
  return block.statements.every((s) =>
    (ts.isExpressionStatement(s) && isConsole(s.expression)) || (ts.isReturnStatement(s) && (!s.expression || inert(s.expression))));
}

function calledNames(node: ts.Node, out: string[] = []): string[] {
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isIdentifier(callee)) out.push(callee.text);
    else if (ts.isPropertyAccessExpression(callee)) out.push(callee.name.text);
  }
  ts.forEachChild(node, (child) => calledNames(child, out));
  return out;
}

const writes = (node: ts.Node) => calledNames(node).some((name) => name !== "catch" && name !== "then" && name !== "finally" && WRITE_VERBS.test(name));
const commented = (sf: ts.SourceFile, node: ts.Node) => /\/\/|\/\*/.test(sf.text.slice(node.getStart(sf), node.getEnd()));

interface Swallow { file: string; line: number; call: string }

function findSwallows(): Swallow[] {
  const found: Swallow[] = [];
  for (const dir of DIRS) {
    for (const path of sources(join(ROOT, dir))) {
      const text = readFileSync(path, "utf8");
      const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const file = relative(ROOT, path).replace(/\\/g, "/");
      const visit = (n: ts.Node) => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "catch" && n.arguments.length === 1) {
          const handler = n.arguments[0]!;
          if ((ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))
            && (ts.isBlock(handler.body) ? swallows(handler.body) : inert(handler.body))
            && writes(n.expression.expression) && !commented(sf, handler)) {
            found.push({ file, line: sf.getLineAndCharacterOfPosition(n.expression.name.getStart(sf)).line + 1, call: n.expression.expression.getText(sf).split(/\s+/).join(" ") });
          }
        }
        if (ts.isTryStatement(n) && n.catchClause && swallows(n.catchClause.block) && writes(n.tryBlock) && !commented(sf, n.catchClause.block)) {
          found.push({ file, line: sf.getLineAndCharacterOfPosition(n.catchClause.getStart(sf)).line + 1, call: "try { … }" });
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
  }
  return found;
}

describe("failures on write paths (stability plan R4)", () => {
  const found = findSwallows();
  const handed = (s: Swallow) => HANDED_OVER.some(([file, call]) => file === s.file && call === s.call);

  it("are reported, said, or quiet with a written reason", () => {
    const silent = found.filter((s) => !handed(s)).map((s) => `${s.file}:${s.line} ${s.call}`);
    expect(silent, "decide each: reportingTo(area), reportVisible(...), or a `silent: why` comment inside the handler").toEqual([]);
  });

  it("hand over only places that still swallow", () => {
    const stale = HANDED_OVER.filter(([file, call]) => !found.some((s) => s.file === file && s.call === call)).map(([file, call]) => `${file} ${call}`);
    expect(stale, "take the entry out of HANDED_OVER").toEqual([]);
  });

  it("would see one (positive control)", () => {
    const sf = ts.createSourceFile("x.ts", "save().catch(() => {}); try { await writeFile(p); } catch {}", ts.ScriptTarget.Latest, true);
    const statements = sf.statements;
    const call = (statements[0] as ts.ExpressionStatement).expression as ts.CallExpression;
    const handler = call.arguments[0] as ts.ArrowFunction;
    expect(swallows(handler.body as ts.Block) && writes(call.expression)).toBe(true);
    const attempt = statements[1] as ts.TryStatement;
    expect(swallows(attempt.catchClause!.block) && writes(attempt.tryBlock)).toBe(true);
  });
});
