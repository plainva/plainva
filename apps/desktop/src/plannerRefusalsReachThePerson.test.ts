import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * Every refusal of a planner reaches the person, in both shells (third and
 * fourth review of 11.11.). A planner refuses while the index is not whole;
 * twice a surface called one without catching it — a move in the desktop's
 * tree, "rename entry" of a database — and the refusal went to the
 * diagnostics only. Every call of a planner on a surface sits in a `try` with
 * a `catch`, or carries a `.catch`, or is listed here with why it needs neither.
 */
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ROOTS = ["apps/desktop/src", "apps/mobile/src"];
const PLANNERS = new Set([
  "renameToName", "moveItems", "renameFileWithLinkUpdates", "fillMissingProperty", "fillBaseProperty", "notesCarryingProperty",
  "generateIndexForFolder", "appendWikiLink", "applyInlineLink", "createBrokenLinkTarget", "removeLinksTo",
  "addRelationLink", "buildDeletionPlan", "buildDesktopDeletionPlan", "buildMobileDeletionPlan", "scanVaultOkf", "scanVaultOkfVersion",
  "readWholeViewRows", "wholeViewRows", "renameReport",
]);
/**
 * `file:planner@where` (the property, method or function the call is made in)
 * → why the call needs no catch of its own: a shared caller catches what it
 * throws and says it. Named by the place, so a new call in the same file is
 * looked at again.
 */
const CAUGHT_ELSEWHERE: Record<string, string> = {
  "apps/desktop/src/components/BaseViewer.tsx:renameToName@rename":
    "a new board entry's rename: finalizePinboardEntry catches it, and the dialog says its renameError (pinboardEntry.ts)",
  "apps/desktop/src/components/ai/useDesktopAi.ts:renameToName@rename":
    "the assistant's rename after a yes: the write tools' `asked` hands a refusal of the index to the conversation with its reason (aiWriteTools.test.ts)",
  "apps/desktop/src/components/ai/useDesktopAi.ts:moveItems@move":
    "the assistant's move after a yes: as its rename, through `asked` (aiWriteTools.test.ts)",
  "apps/desktop/src/components/settings/SyncPage.tsx:renameToName@rename":
    "\"Keep both\" of a name collision: resolveNameCollisionCases catches each case and counts it as skipped in what the notice says",
  "apps/desktop/src/components/tasks/TaskNamesNotice.tsx:renameToName@renameNote":
    "the task name cleanup: runTaskNameCleanup puts the stored path back and rethrows, useTaskNameCleanup hands it to the notice's onError",
  "apps/mobile/src/components/TaskNamesNotice.tsx:renameReport@renameNote":
    "the task name cleanup, as on the desktop: useTaskNameCleanup hands it to the notice's onError",
};

/**
 * The function a call is made in, by name: a declared function or method by
 * its own, an arrow or function expression by the property or variable it is.
 */
function whereOf(node: ts.Node): string {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (!ts.isFunctionLike(n)) continue;
    const named = ts.isArrowFunction(n) || ts.isFunctionExpression(n) ? n.parent : n;
    const name = (named as { name?: ts.Node }).name;
    if (name && ts.isIdentifier(name)) return name.text;
  }
  return "";
}

function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(join(REPO, dir))) {
      if (name === "node_modules" || name === "dist") continue;
      const rel = `${dir}/${name}`;
      if (statSync(join(REPO, rel)).isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.|\.spec\.|\.d\.ts$/.test(name)) out.push(rel);
    }
  };
  for (const root of ROOTS) walk(root);
  return out;
}

function calleeName(call: ts.CallExpression): string | null {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
}

/** Inside a `try` that has a `catch`, or chained into `.catch(...)` / `.then(_, onRejected)`. */
function caught(node: ts.Node): boolean {
  for (let n: ts.Node = node; n.parent; n = n.parent) {
    const p = n.parent;
    if (ts.isTryStatement(p) && p.tryBlock === n && p.catchClause) return true;
    if (ts.isPropertyAccessExpression(p) && p.expression === n && ts.isCallExpression(p.parent)) {
      if (p.name.text === "catch") return true;
      if (p.name.text === "then" && p.parent.arguments.length >= 2) return true;
    }
    // Stop at a function boundary: a caller's catch is not this call's.
    if (ts.isFunctionLike(p) && !ts.isArrowFunction(p) && p !== node) return false;
    if (ts.isArrowFunction(p) || ts.isFunctionExpression(p)) {
      // `await x` returned by an arrow handed to something that catches: follow it up.
      const outer = p.parent;
      if (outer && ts.isCallExpression(outer) && outer.arguments.includes(p as ts.Expression)) continue;
      return false;
    }
  }
  return false;
}

describe("a planner's refusal reaches the person on every surface of both shells", () => {
  it("every call of a planner is caught where it is made, or says why not", () => {
    const uncaught: string[] = [];
    for (const file of sources()) {
      if (!/\/(components|screens|lib|hooks)\//.test(file) && !/\/(App|AppShell|EditorHost|TagsScreen|BookmarksScreen)\.tsx$/.test(file)) continue;
      const text = readFileSync(join(REPO, file), "utf8");
      if (![...PLANNERS].some((p) => text.includes(p))) continue;
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (n: ts.Node) => {
        if (ts.isCallExpression(n)) {
          const name = calleeName(n);
          if (name && PLANNERS.has(name) && !caught(n) && !(`${relative(REPO, join(REPO, file))}:${name}@${whereOf(n)}` in CAUGHT_ELSEWHERE)) {
            uncaught.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} ${name}`);
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(uncaught).toEqual([]);
  });

  it("names no call that is not there any more", () => {
    const made = new Set<string>();
    for (const file of sources()) {
      const text = readFileSync(join(REPO, file), "utf8");
      if (![...PLANNERS].some((p) => text.includes(p))) continue;
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (n: ts.Node) => {
        if (ts.isCallExpression(n)) {
          const name = calleeName(n);
          if (name && PLANNERS.has(name)) made.add(`${file}:${name}@${whereOf(n)}`);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(Object.keys(CAUGHT_ELSEWHERE).filter((key) => !made.has(key))).toEqual([]);
  });
});
