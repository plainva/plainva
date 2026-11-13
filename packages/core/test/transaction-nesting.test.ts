import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * No transaction is opened inside another one's body, and waited for there
 * (finding 2026-10-12) — and a body runs its statements through its own
 * handle (Datensicherheit D3).
 *
 * Both shells' database adapters make a second transaction WAIT for the one
 * that is open: the desktop's always has, with a queue in front of its pool;
 * the phone's has since its plugin turned out to refuse the second outright —
 * it was refused, and whatever it was for was lost. On a queue, a transaction
 * opened inside another one's body and waited for there waits for the turn its
 * own caller holds: a deadlock, and every write to the database after it waits
 * with it. A batch sent to the adapter is a transaction of its own on the phone
 * as well; sent through the body's handle (`tx`), it runs in the body's.
 *
 * Since D3 the phone's adapter makes a single write sent to the adapter itself
 * wait for the open transaction too, so that it never runs in it and goes down
 * with it. A body that sends a write to the adapter instead of its handle
 * therefore waits for itself (the phone's adapter gives up after a minute and
 * names the body; under the unit tests after two seconds).
 *
 * The bodies of transactions live in the database layer — the files below, and
 * a file that opens a transaction anywhere else has to be added to them. In
 * the body of every `transaction(…)` this looks for
 *  - another `transaction(…)`,
 *  - a statement (`execute`, `query`, `queryOne`) or a batch (`runBatch`,
 *    `runStatementsAtomic`) that is not sent through the body's handle — or a
 *    writer the body declares for itself (the full scan's buffer),
 *  - a call of a function or method of the database layer that runs
 *    statements, without handing it the body's handle (or such a writer),
 *  - a call of a function or method of the database layer that opens a
 *    transaction or sends a batch of its own — directly or through one that
 *    does, matched by name — without handing it the handle;
 *  - a write through the vault's chain (finding 2026-10-19, from the review of
 *    the change): its entry in the sync queue is a transaction that waits for
 *    the one open, and the write waits for its entry;
 *  - closing the database, which on the phone waits for the transactions
 *    asked for before it.
 * What it cannot see: a function handed in from outside and called in a body
 * (a hook, a callback) — the rule for those stands in
 * `IDatabaseAdapter.transaction`: what reacts with database work of its own
 * runs after the transaction —, a helper outside these files that runs
 * statements, sends a batch or writes through the chain, and what a helper
 * that was handed the handle does with it further down (the runtime check
 * of the phone's adapter and of the tests' real SQLite catches a write there).
 * Names are matched, not types.
 */

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const ROOTS = ["packages/core/src", "packages/ui/src", "apps/mobile/src", "apps/desktop/src"];
const DATABASE_LAYER = [
  "packages/core/src/db/Schema.ts",
  "packages/core/src/db/batch.ts",
  "packages/core/src/db/lossyTextBaseMigration.ts",
  "packages/core/src/db/pathIdentityMigration.ts",
  "packages/core/src/pim/PimCacheRepository.ts",
  "packages/core/src/sync/SyncQueue.ts",
  "packages/core/src/vault/SyncStateRepository.ts",
  "packages/core/src/vault/VaultIndexer.ts",
  "packages/core/src/workspace/state.ts",
  "packages/ui/src/mail/mailCache.ts",
];
const BATCHES = new Set(["runBatch", "runStatementsAtomic"]);
/** A statement of the database adapter is no transaction, whatever else shares its name. */
const STATEMENTS = new Set(["execute", "query", "queryOne", "initialize"]);
/** The statements that run SQL, on the adapter or on a handle. */
const SQL = new Set(["execute", "query", "queryOne"]);
/** What waits for the database's turns without being a transaction: a write through the vault's chain, and closing. */
const WAITS_FOR_A_TURN = new Set([
  "writeTextFile", "writeBinaryFile", "writeEditorText", "writeTextFileChange", "updateTextFile", "deleteItem", "renameItem", "createDir",
  "resolveConflict", "preserveConflict", "updateVaultText", "replaceVaultText", "writeNoteProperty", "close",
]);

const parse = (name: string, text: string) =>
  ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

function shippedSources(): ts.SourceFile[] {
  const files: ts.SourceFile[] = [];
  for (const root of ROOTS) {
    for (const entry of readdirSync(join(REPO, root), { recursive: true, encoding: "utf8" })) {
      const path = entry.split("\\").join("/");
      if (!/\.tsx?$/.test(path) || /\.(test|spec)\.tsx?$/.test(path) || path.endsWith(".d.ts")) continue;
      const file = join(REPO, root, path);
      files.push(parse(relative(REPO, file).split("\\").join("/"), readFileSync(file, "utf8")));
    }
  }
  return files;
}

const calledName = (call: ts.CallExpression): string | null => {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
};

const isTransactionCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "transaction"
  && node.arguments.length > 0 && (ts.isArrowFunction(node.arguments[0]) || ts.isFunctionExpression(node.arguments[0]));

const lineOf = (node: ts.Node, source: ts.SourceFile) => `${source.fileName}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;

/** `node` is the handle a transaction gives its body: the first parameter of an enclosing body, by name. */
function isHandle(node: ts.Node): boolean {
  if (!ts.isIdentifier(node)) return false;
  for (let up: ts.Node | undefined = node.parent; up; up = up.parent) {
    if ((ts.isArrowFunction(up) || ts.isFunctionExpression(up)) && up.parent && isTransactionCall(up.parent) && up.parent.arguments[0] === up) {
      const first = up.parameters[0];
      if (first && ts.isIdentifier(first.name) && first.name.text === node.text) return true;
    }
  }
  return false;
}

/** The names `body` declares itself: a statement through one of them goes where the body says (the full scan's buffer). */
function declaredIn(body: ts.Node): { all: Set<string>; typed: Set<string> } {
  const all = new Set<string>();
  const typed = new Set<string>();
  (function visit(node: ts.Node) {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isIdentifier(node.name)) {
      all.add(node.name.text);
      if (ts.isVariableDeclaration(node) && node.type) typed.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  })(body);
  return { all, typed };
}

/** Where a statement or batch goes: the receiver of `x.execute(…)`, the first argument of `runStatementsAtomic(x, …)`. */
function targetOf(call: ts.CallExpression): ts.Node | null {
  if (calledName(call) === "runStatementsAtomic") return call.arguments[0] ?? null;
  return ts.isPropertyAccessExpression(call.expression) ? call.expression.expression : null;
}

/** The functions and methods the files define, by name, with their bodies. */
function bodiesByName(sources: ts.SourceFile[]): Map<string, Array<{ body: ts.Node; source: ts.SourceFile }>> {
  const bodies = new Map<string, Array<{ body: ts.Node; source: ts.SourceFile }>>();
  const add = (name: string, body: ts.Node | undefined, source: ts.SourceFile) => {
    if (body) bodies.set(name, [...(bodies.get(name) ?? []), { body, source }]);
  };
  for (const source of sources) {
    (function visit(node: ts.Node) {
      if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name && (ts.isIdentifier(node.name) || ts.isPrivateIdentifier(node.name))) {
        add(node.name.text, node.body, source);
      } else if ((ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node)) && ts.isIdentifier(node.name)
        && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
        add(node.name.text, node.initializer.body, source);
      }
      ts.forEachChild(node, visit);
    })(source);
  }
  return bodies;
}

/**
 * Every name of the database layer that runs a statement somewhere else than
 * through a handle or a variable of its own: called in a body, it has to be
 * handed the body's handle.
 */
function statementUsers(layer: ts.SourceFile[]): Set<string> {
  const users = new Set<string>();
  for (const [name, found] of bodiesByName(layer)) {
    if (STATEMENTS.has(name) || BATCHES.has(name) || name === "transaction") continue;
    const runs = found.some(({ body }) => {
      const own = new Set<string>();
      (function collect(node: ts.Node) {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) own.add(node.name.text);
        ts.forEachChild(node, collect);
      })(body);
      let yes = false;
      (function visit(node: ts.Node) {
        if (yes || isTransactionCall(node)) return;
        if (ts.isCallExpression(node) && SQL.has(calledName(node) ?? "")) {
          const target = targetOf(node);
          if (target && !isHandle(target) && !(ts.isIdentifier(target) && own.has(target.text))) yes = true;
        }
        ts.forEachChild(node, visit);
      })(body);
      return yes;
    });
    if (runs) users.add(name);
  }
  return users;
}

interface BodyRules {
  /** What the body declares itself. */
  declared: { all: Set<string>; typed: Set<string> };
  /** The names that run statements and must be handed the body's handle. */
  users: Set<string>;
}

/**
 * What in `body` opens a transaction or sends a batch of its own, given the names known to do so — and, where
 * `rules` are given (the body of a transaction), what sends a statement elsewhere than through the body's handle,
 * what calls a statement user without it, and what waits for the database's turn. That last is looked for in a
 * body only, not followed through the functions that do it: a write below the chain or a file handle's `close`
 * shares the names.
 */
function opensIn(body: ts.Node, source: ts.SourceFile, opening: Set<string>, rules?: BodyRules): string[] {
  const found: string[] = [];
  const throughTheHandle = (node: ts.Node | null): boolean =>
    !!node && (isHandle(node) || (!!rules && ts.isIdentifier(node) && rules.declared.all.has(node.text)));
  const handsTheHandle = (call: ts.CallExpression): boolean =>
    call.arguments.some((arg) => isHandle(arg) || (!!rules && ts.isIdentifier(arg) && rules.declared.typed.has(arg.text)));
  (function visit(node: ts.Node) {
    if (isTransactionCall(node)) {
      found.push(`${lineOf(node, source)} opens another transaction`);
      return;
    }
    if (ts.isCallExpression(node)) {
      const name = calledName(node);
      if (name && BATCHES.has(name)) {
        if (!throughTheHandle(targetOf(node))) found.push(`${lineOf(node, source)} sends a batch (${name}) of its own instead of through the transaction's handle`);
      } else if (rules && name && SQL.has(name)) {
        if (!throughTheHandle(targetOf(node))) found.push(`${lineOf(node, source)} sends a statement (${name}) to the adapter instead of the transaction's handle`);
      } else if (rules && name && WAITS_FOR_A_TURN.has(name)) {
        found.push(`${lineOf(node, source)} calls ${name}, which waits for the database's turn`);
      } else if (name && !STATEMENTS.has(name) && opening.has(name) && !handsTheHandle(node)) {
        found.push(`${lineOf(node, source)} calls ${name}, which opens a transaction`);
      } else if (rules && name && rules.users.has(name) && !handsTheHandle(node)) {
        found.push(`${lineOf(node, source)} calls ${name}, which runs statements, without the transaction's handle`);
      }
    }
    ts.forEachChild(node, visit);
  })(body);
  return found;
}

/** Every name of the database layer that opens a transaction or sends a batch of its own — directly, or through one that does. */
function openers(layer: ts.SourceFile[]): Set<string> {
  const bodies = bodiesByName(layer);
  const opening = new Set<string>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, found] of bodies) {
      // An adapter's own `transaction` and the batch helpers are what the rule is about.
      if (opening.has(name) || name === "transaction" || BATCHES.has(name)) continue;
      if (found.some(({ body, source }) => opensIn(body, source, opening).length > 0)) {
        opening.add(name);
        grew = true;
      }
    }
  }
  return opening;
}

/** What opens a transaction, sends a batch of its own or sends a statement past its handle inside the body of a transaction. */
function nested(layer: ts.SourceFile[]): string[] {
  const opening = openers(layer);
  const users = statementUsers(layer);
  const found: string[] = [];
  for (const source of layer) {
    (function visit(node: ts.Node) {
      if (isTransactionCall(node)) {
        const body = node.arguments[0];
        for (const what of opensIn(body, source, opening, { declared: declaredIn(body), users })) {
          found.push(`the transaction at ${lineOf(node, source)}: ${what}`);
        }
      }
      ts.forEachChild(node, visit);
    })(source);
  }
  return found;
}

describe("no transaction inside another one's body, and every statement of a body through its handle", () => {
  const sources = shippedSources();
  const layer = sources.filter((source) => DATABASE_LAYER.includes(source.fileName));

  it("every file that opens a transaction belongs to the database layer this reads", () => {
    const opening = sources.filter((source) => {
      let yes = false;
      (function visit(node: ts.Node) {
        yes ||= isTransactionCall(node);
        if (!yes) ts.forEachChild(node, visit);
      })(source);
      return yes;
    }).map((source) => source.fileName);
    // A new one: add it to DATABASE_LAYER, and the bodies of its transactions are read like these.
    expect(opening.filter((file) => !DATABASE_LAYER.includes(file))).toEqual([]);
    expect(layer.map((source) => source.fileName).sort()).toEqual([...DATABASE_LAYER].sort());
  });

  it("knows what opens one: the sync queue, the index, the calendar cache, the mail cache, the migrations, the encrypted workspace's batches", () => {
    const opening = openers(layer);
    for (const name of [
      "queueWrite", "queueDelete", "queueRename", "markSynced", "enqueueLocalOnlyFiles",
      "indexFile", "indexPath", "inspectPath", "reconcileFolder", "relocatePathInIndex", "indexVaultFull",
      "deleteAccount", "restoreAccount", "reassignAccountRows", "restoreCachedMail",
      "migratePathIdentity", "flagLossyTextBases", "reservePrepared", "commitQueued",
    ]) {
      expect(opening.has(name), name).toBe(true);
    }
  });

  it("knows what runs statements and has to be handed the handle in a body: the index's helpers, the sync rows", () => {
    const users = statementUsers(layer);
    for (const name of ["loadBulkLookups", "isVanishedAppleDouble", "rowIdFor", "deleteIndexRows", "getSyncState", "getAllStates", "deleteSyncState", "recordSyncedBase"]) {
      expect(users.has(name), name).toBe(true);
    }
  });

  it("finds none in the app", () => {
    expect(nested(layer)).toEqual([]);
  });

  it("would find one — directly, through a method that opens one, a batch or a statement past the handle, a helper without it, a write through the chain and closing", () => {
    const planted = parse("planted.ts", [
      "class Planted {",
      "  async direct() { await this.db.transaction(async () => { await this.db.transaction(async () => {}); }); }",
      "  async throughAMethod() { await this.db.transaction(async () => { await this.queue.queueWrite('a.md'); }); }",
      "  async aBatch() { await this.db.transaction(async () => { await runStatementsAtomic(this.db, []); }); }",
      "  async onTheHandle() { await this.db.transaction(async (tx) => { await tx.execute('DELETE FROM t'); await tx.runBatch([]); const flush = () => runStatementsAtomic(tx, []); await flush(); }); }",
      "  async aStatement() { await this.db.transaction(async (tx) => { await this.db.execute('DELETE FROM t'); }); }",
      "  async aWrite() { await this.db.transaction(async () => { await this.files.writeTextFile('a.md', 'text'); }); }",
      "  async closing() { await this.db.transaction(async () => { await this.db.close(); }); }",
      "  async aHelper() { await this.db.transaction(async (tx) => { await this.forget('a.md'); await this.forget('b.md', tx); const sink: Writer = { execute: async () => {} }; await this.forget('c.md', sink); }); }",
      "  async forget(path: string, sql = this.db) { await sql.execute('DELETE FROM t WHERE p = ?', [path]); await this.db.query('SELECT 1'); }",
      "}",
      "class Queue { async queueWrite(path: string) { await this.db.transaction(async () => {}); } }",
    ].join("\n"));
    expect(nested([planted])).toEqual([
      "the transaction at planted.ts:2: planted.ts:2 opens another transaction",
      "the transaction at planted.ts:3: planted.ts:3 calls queueWrite, which opens a transaction",
      "the transaction at planted.ts:4: planted.ts:4 sends a batch (runStatementsAtomic) of its own instead of through the transaction's handle",
      "the transaction at planted.ts:6: planted.ts:6 sends a statement (execute) to the adapter instead of the transaction's handle",
      "the transaction at planted.ts:7: planted.ts:7 calls writeTextFile, which waits for the database's turn",
      "the transaction at planted.ts:8: planted.ts:8 calls close, which waits for the database's turn",
      "the transaction at planted.ts:9: planted.ts:9 calls forget, which runs statements, without the transaction's handle",
    ]);
  });
});
