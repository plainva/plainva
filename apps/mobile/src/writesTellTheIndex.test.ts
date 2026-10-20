import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Whatever file the phone writes itself, its index hears of it then — not at
 * the next full scan (finding 2026-10-12).
 *
 * The phone has no watcher; its index knows what the app tells it, through
 * one door (`MobileVault.reindexPaths`, services/pathReindex.ts). A photo or a
 * file put into a note, a voice memo, a mail's attachment saved, a mail filed
 * as a note or as `.eml`, the attachments of something shared to Plainva: on
 * disk and queued for the sync, and unknown to search, to the tree and to
 * every list drawn from the index until the next full scan — which on a phone
 * comes with a return to the app or a pull to refresh.
 *
 * Text written through the vault's own save (`vaultOps.save`,
 * `vaultTextFiles`) tells the index on its way; what writes bytes, or hands
 * the vault's chain to a helper that files something, says it itself. This
 * reads every source of the phone for those calls and asks that the function
 * making the call also calls the door — or names the reason it does not.
 */

const WRITERS = new Set([
  "writeBinaryFile",
  "importAttachment",
  "saveMailAttachment",
  "captureMailAsNote",
  "saveEmlFile",
  "importSharedContent",
]);

/** Calls that do not tell the index themselves, and why that is right. */
const ELSEWHERE: Record<string, string> = {
  "services/vaultService.ts: writeBinaryFile":
    "a copy of a file a workspace member may not change, kept under .plainva/workspace/forks — an internal path the index never holds",
  "services/shareImport.ts: writeBinaryFile":
    "the import names every attachment it writes (onFileWritten); the share inbox tells the index of them with the note",
};

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

/**
 * The function a call belongs to: the nearest one — passing over a function
 * that is a property of an object literal, an adapter method handed to a
 * helper (`{ writeBinaryFile: (p, bytes) => vault.files.writeBinaryFile(p, bytes) }`):
 * that call belongs to whoever built the object.
 */
function owner(node: ts.Node): ts.Node | null {
  for (let at = node.parent; at; at = at.parent) {
    if (!ts.isFunctionLike(at)) continue;
    if (ts.isPropertyAssignment(at.parent) && ts.isObjectLiteralExpression(at.parent.parent)) continue;
    return at;
  }
  return null;
}

interface Site {
  where: string;
  name: string;
  tells: boolean;
}

function writerSites(): Site[] {
  const root = join(process.cwd(), "src");
  const sites: Site[] = [];
  for (const file of sources(root)) {
    const text = readFileSync(file, "utf8");
    if (![...WRITERS].some((name) => text.includes(name))) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const rel = relative(root, file).split("\\").join("/");
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
        if (WRITERS.has(name)) {
          const unit = owner(node);
          const body = unit ? unit.getText(source) : text;
          sites.push({ where: `${rel}: ${name}`, name, tells: /\breindexPaths\s*\(/.test(body) });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return sites;
}

describe("whatever the phone writes itself, its index hears of it then (finding 2026-10-12)", () => {
  const sites = writerSites();

  it("finds the writers (the scan reads what it should)", () => {
    const where = new Set(sites.map((s) => s.where));
    for (const expected of [
      "EditorHost.tsx: importAttachment",
      "EditorHost.tsx: writeBinaryFile",
      "components/JournalCaptureSheet.tsx: importAttachment",
      "components/JournalCaptureSheet.tsx: writeBinaryFile",
      "screens/MailMessageScreen.tsx: saveMailAttachment",
      "screens/MailMessageScreen.tsx: captureMailAsNote",
      "screens/MailMessageScreen.tsx: saveEmlFile",
      "screens/MailListScreen.tsx: captureMailAsNote",
      "components/ShareInbox.tsx: importSharedContent",
    ]) {
      expect(where.has(expected), expected).toBe(true);
    }
  });

  it("every one of them calls the door in the same function — or the reason is written down", () => {
    const silent = sites.filter((s) => !s.tells && !ELSEWHERE[s.where]).map((s) => s.where);
    expect(silent).toEqual([]);
  });

  it("a reason written down still names a call that exists", () => {
    const where = new Set(sites.map((s) => s.where));
    for (const key of Object.keys(ELSEWHERE)) expect(where.has(key), key).toBe(true);
  });
});
