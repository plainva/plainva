// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { noteFullTextDamage, readFullTextDamage, type IDatabaseAdapter } from "@plainva/core";
import { closeWaitNoteName, indexDatabaseRebuildOffered, waitWithDeadline } from "@plainva/ui";
import { armLeaveGuard, armedLeaveGuards, disarmLeaveGuard, foreignInputArmed, resetLeaveGuard } from "./leaveGuard";
import { resetScreenStepsForTest, takeScreen } from "./screenStep";
import { retiredBoot } from "./bootRetirement";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";

/**
 * The search's "Rebuild index" on the phone (`rebuildActiveIndexDatabase`),
 * run as written: the functions are lifted out of `vaultService.ts`, the
 * sync, the registry and the database files are stand-ins. It takes the
 * strip's way — the same set-aside — and the open vault is closed the
 * ordinary way first: the notes saved, the cycle drained, the database
 * closed; only then is the file set aside, and the vault opens again. Never
 * in an encrypted workspace, never without a failed attempt of the open.
 */

const source = readFileSync(resolve("src/services/vaultService.ts"), "utf8");
const file = ts.createSourceFile("vaultService.ts", source, ts.ScriptTarget.Latest, true);
const NAMES = ["retireBoot", "settleBeforeClosing", "leaveVault", "reloadActiveMobileVault", "offerReload", "rebuildActiveIndexDatabase", "rebuildOpenMobileIndexDatabase"];
const parts: string[] = [];
ts.forEachChild(file, (node) => {
  if (ts.isFunctionDeclaration(node) && node.name && NAMES.includes(node.name.text)) parts.push(node.getText(file).replace(/^export /, ""));
});
const compiled = ts.transpileModule(
  "let bootPromise = Promise.resolve(initial); let bootSettled = true; let bootAbort = null;\n" +
    "const ABANDON_BOOT_AFTER_MS = 2000; const closingVaults = new Map(); const RELOAD_STEP = \"vault-reload\"; const LOCAL_VAULT_ID = \"local\";\n" +
    parts.join("\n") +
    "\nreturn { rebuildActiveIndexDatabase };",
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;

async function harness(opts: { workspace?: boolean; failed?: boolean } = {}) {
  const order: string[] = [];
  const db: IDatabaseAdapter = await realSqlite();
  if (opts.failed !== false) {
    await db.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES ('full_text_damaged', ?)`, [JSON.stringify({ at: "2026-11-18T10:00:00.000Z", failed: { at: "2026-11-18T10:05:00.000Z", count: 1, reason: "(code: 11) database disk image is malformed" } })]);
  } else {
    await noteFullTextDamage(db);
  }
  const vault = {
    vaultId: "v1",
    db,
    indexDatabaseFailure: null,
    isEncryptedWorkspace: !!opts.workspace,
    ended: vi.fn(async () => {}), dispose: vi.fn(async () => { order.push("dispose"); }),
  };
  const deps = {
    retiredBoot,
    initial: vault,
    noteSaver: { flushAll: vi.fn(async () => { order.push("save"); }), pendingPaths: () => [] },
    // The close's deadline (`settleBeforeClosing`), as in the module; its notice and its draft flush are not what is asked here.
    waitWithDeadline, closeWaitNoteName, flushDraftsBeforeClosing: async () => {}, getVaultEntry: async () => ({ name: "" }),
    reportingTo: () => () => {},
    stopSyncAndDrain: vi.fn(async () => { order.push("drain"); }),
    getActiveVaultEntry: async () => ({ id: "v1", name: "" }),
    setAsideMobileIndexDatabase: vi.fn(async (name: string) => { order.push(`set aside ${name}`); return `${name}.broken-1`; }),
    indexDatabaseRebuildOffered,
    readFullTextDamage,
    foreignInputArmed,
    armedLeaveGuards,
    takeScreen,
    i18n: { t: (key: string) => key },
    window: { dispatchEvent: () => { order.push("open"); return true; } },
    CustomEvent,
    console: { error: () => {} },
  };
  const api = new Function(...Object.keys(deps), compiled)(...Object.values(deps)) as { rebuildActiveIndexDatabase(): Promise<boolean> };
  return { ...api, order, deps };
}

beforeEach(() => resetLeaveGuard());
afterEach(() => {
  resetScreenStepsForTest();
  resetLeaveGuard();
});

describe("the phone's search \"Rebuild index\"", () => {
  it("closes the vault the ordinary way, sets the file aside only then, and opens the vault again", async () => {
    const h = await harness();
    expect(await h.rebuildActiveIndexDatabase()).toBe(true);
    expect(h.order).toEqual(["save", "drain", "dispose", "set aside plainva-v1", "open"]);
  });

  it("does nothing in an encrypted workspace, nor where the open's attempt did not fail", async () => {
    const workspace = await harness({ workspace: true });
    expect(await workspace.rebuildActiveIndexDatabase()).toBe(false);
    expect(workspace.order).toEqual([]);
    const noted = await harness({ failed: false });
    expect(await noted.rebuildActiveIndexDatabase()).toBe(false);
    expect(noted.order).toEqual([]);
  });

  it("with unsaved input elsewhere it waits, and the set-aside waits with it", async () => {
    const h = await harness();
    armLeaveGuard({ id: "composer", message: "The draft will be lost." });
    expect(await h.rebuildActiveIndexDatabase()).toBe(false);
    expect(h.order, "nothing closed, nothing set aside").not.toContain("set aside plainva-v1");
    disarmLeaveGuard("composer");
  });

  it("opens the vault again where the set-aside fails, and says why", async () => {
    const h = await harness();
    h.deps.setAsideMobileIndexDatabase.mockImplementationOnce(async () => { throw new Error("busy"); });
    await expect(h.rebuildActiveIndexDatabase()).rejects.toThrow("busy");
    expect(h.order).toEqual(["save", "drain", "dispose", "open"]);
  });
});
