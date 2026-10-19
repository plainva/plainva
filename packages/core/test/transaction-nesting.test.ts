import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * No transaction is opened inside another one's body, and waited for there
 * (finding 2026-10-12).
 *
 * Both shells' database adapters make a second transaction WAIT for the one
 * that is open: the desktop's always has, with a queue in front of its pool;
 * the phone's has since its plugin turned out to refuse the second outright —
 * it was refused, and whatever it was for was lost. On a queue, a transaction
 * opened inside another one's body and waited for there waits for the turn its
 * own caller holds: a deadlock, and every write to the database after it waits
 * with it. A batch is a transaction of its own on the phone as well, unless
 * its caller sends it from inside its own transaction and says so
 * (`{ inOpenTransaction: true }`, `IDatabaseAdapter.runBatch`).
 *
 * The bodies of transactions live in the database layer — the files below, and
 * a file that opens a transaction anywhere else has to be added to them. In
 * the body of every `transaction(…)` this looks for
 *  - another `transaction(…)`,
 *  - a batch (`runBatch`, `runStatementsAtomic`) that does not say it runs in
 *    the open transaction,
 *  - a call of a function or method of the database layer that opens a
 *    transaction or sends such a batch — directly or through one that does,
 *    matched by name;
 *  - a write through the vault's chain (finding 2026-10-19, from the review of
 *    the change): its entry in the sync queue is a transaction that waits for
 *    the one open, and the write waits for its entry;
 *  - closing the database, which on the phone waits for the transactions
 *    asked for before it.
 * What it cannot see: a function handed in from outside and called in a body
 * (a hook, a callback) — the rule for those stands in
 * `IDatabaseAdapter.transaction`: what reacts with database work of its own
 * runs after the transaction —, and a helper outside these files that sends a
 * batch or writes through the chain, and a function of these files that
 * writes through the chain and is called in a body (writes and closing are
 * looked for in the body only). Names are matched, not types.
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

/** A batch whose caller says it runs in the open transaction: the word in the call, or in the constant it names. */
function saysItRunsInside(call: ts.CallExpression, source: ts.SourceFile): boolean {
  const options = call.arguments[calledName(call) === "runBatch" ? 1 : 2];
  if (!options) return false;
  const marked = (text: string) => /inOpenTransaction\s*:\s*true/.test(text);
  if (marked(options.getText(source))) return true;
  if (!ts.isIdentifier(options)) return false;
  let found = false;
  (function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === options.text && node.initializer) {
      found ||= marked(node.initializer.getText(source));
    }
    ts.forEachChild(node, visit);
  })(source);
  return found;
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
 * What in `body` opens a transaction or sends a batch of its own, given the names known to do so — and, where
 * `turns` says so, what waits for the database's turn. That last is looked for in a body only, not followed
 * through the functions that do it: a write below the chain or a file handle's `close` shares the names.
 */
function opensIn(body: ts.Node, source: ts.SourceFile, opening: Set<string>, turns = true): string[] {
  const found: string[] = [];
  (function visit(node: ts.Node) {
    if (isTransactionCall(node)) {
      found.push(`${lineOf(node, source)} opens another transaction`);
      return;
    }
    if (ts.isCallExpression(node)) {
      const name = calledName(node);
      if (name && BATCHES.has(name)) {
        if (!saysItRunsInside(node, source)) found.push(`${lineOf(node, source)} sends a batch (${name}) that does not say it runs in the open transaction`);
      } else if (name && turns && WAITS_FOR_A_TURN.has(name)) {
        found.push(`${lineOf(node, source)} calls ${name}, which waits for the database's turn`);
      } else if (name && !STATEMENTS.has(name) && opening.has(name)) {
        found.push(`${lineOf(node, source)} calls ${name}, which opens a transaction`);
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
      if (found.some(({ body, source }) => opensIn(body, source, opening, false).length > 0)) {
        opening.add(name);
        grew = true;
      }
    }
  }
  return opening;
}

/** What opens a transaction or sends a batch of its own inside the body of a transaction. */
function nested(layer: ts.SourceFile[]): string[] {
  const opening = openers(layer);
  const found: string[] = [];
  for (const source of layer) {
    (function visit(node: ts.Node) {
      if (isTransactionCall(node)) {
        for (const what of opensIn(node.arguments[0], source, opening)) found.push(`the transaction at ${lineOf(node, source)}: ${what}`);
      }
      ts.forEachChild(node, visit);
    })(source);
  }
  return found;
}

describe("no transaction inside another one's body", () => {
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

  it("finds none in the app", () => {
    expect(nested(layer)).toEqual([]);
  });

  it("would find one — directly, through a method that opens one, through a batch that does not say where it runs, a write through the chain and closing", () => {
    const planted = parse("planted.ts", [
      "class Planted {",
      "  async direct() { await this.db.transaction(async () => { await this.db.transaction(async () => {}); }); }",
      "  async throughAMethod() { await this.db.transaction(async () => { await this.queue.queueWrite('a.md'); }); }",
      "  async aBatch() { await this.db.transaction(async () => { await runStatementsAtomic(this.db, []); }); }",
      "  async aBatchThatSaysSo() { await this.db.transaction(async () => { await runStatementsAtomic(this.db, [], { inOpenTransaction: true }); }); }",
      "  async aStatement() { await this.db.transaction(async () => { await this.db.execute('DELETE FROM t'); }); }",
      "  async aWrite() { await this.db.transaction(async () => { await this.files.writeTextFile('a.md', 'text'); }); }",
      "  async closing() { await this.db.transaction(async () => { await this.db.close(); }); }",
      "}",
      "class Queue { async queueWrite(path: string) { await this.db.transaction(async () => {}); } }",
    ].join("\n"));
    expect(nested([planted])).toEqual([
      "the transaction at planted.ts:2: planted.ts:2 opens another transaction",
      "the transaction at planted.ts:3: planted.ts:3 calls queueWrite, which opens a transaction",
      "the transaction at planted.ts:4: planted.ts:4 sends a batch (runStatementsAtomic) that does not say it runs in the open transaction",
      "the transaction at planted.ts:7: planted.ts:7 calls writeTextFile, which waits for the database's turn",
      "the transaction at planted.ts:8: planted.ts:8 calls close, which waits for the database's turn",
    ]);
  });
});
