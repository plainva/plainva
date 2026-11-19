// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import i18n from "@plainva/ui/i18n";
import { closeWaitNoteName, toast, toastStore, waitWithDeadline } from "@plainva/ui";
import { armedLeaveGuards, foreignInputArmed, resetLeaveGuard } from "./leaveGuard";
import { resetScreenStepsForTest, takeScreen } from "./screenStep";
import type { MobileVault } from "./vaultService";
import { retiredBoot } from "./bootRetirement";

/**
 * Removing a vault on the phone (`deleteVault`), run as written: the
 * functions are lifted out of `vaultService.ts`; the sync, the registry and
 * the storage are stand-ins. Its start ends in any case — also one still
 * opening after the deadline — and nothing of the vault is removed while its
 * runtime runs. Never two runtimes at one vault, and none at a removed one.
 */

const source = readFileSync(resolve("src/services/vaultService.ts"), "utf8");
const file = ts.createSourceFile("vaultService.ts", source, ts.ScriptTarget.Latest, true);
const NAMES = ["deleteVault", "switchVault", "switchTo", "settleBeforeClosing", "leaveVault", "resumeOnScreen", "retireBoot"];
const parts: string[] = [];
ts.forEachChild(file, (node) => {
  if (ts.isFunctionDeclaration(node) && node.name && NAMES.includes(node.name.text)) parts.push(node.getText(file).replace(/^export /, ""));
});
const found = parts.map((part) => /function (\w+)/.exec(part)?.[1]);
for (const name of ["deleteVault", "switchVault", "retireBoot"]) if (!found.includes(name)) throw new Error(`${name} missing`);
const compiled = ts.transpileModule(
  "let bootPromise = null; let bootSettled = true; let bootAbort = null; let previousVaultId = null; let switching = null;\n" +
    "const ABANDON_BOOT_AFTER_MS = 2000; const closingVaults = new Map(); const LOCAL_VAULT_ID = \"local\";\n" +
    parts.join("\n") +
    "\nreturn { deleteVault, setBoot: (p, settled) => { bootPromise = p; bootSettled = settled; } };",
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;

const hanging = <T = void>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const vault = (id: string, ended: () => Promise<void> = async () => {}) =>
  ({ vaultId: id, db: null, callOff: vi.fn(), ended: vi.fn(ended), dispose: vi.fn(async () => {}) }) as unknown as MobileVault & { callOff: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };

function harness(active: string) {
  let now = active;
  const removed: string[] = [];
  const deps = {
    retiredBoot,
    noteSaver: { flushAll: vi.fn(async () => {}), pendingPaths: () => [] as string[] },
    waitWithDeadline, closeWaitNoteName, flushDraftsBeforeClosing: async () => {},
    getVaultEntry: async (id: string) => ({ id, name: "Work" }),
    reportingTo: () => () => {},
    stopSyncAndDrain: vi.fn(async () => {}),
    setActiveVault: vi.fn(async (id: string) => { now = id; }),
    reloadMobileSettingsForActiveVault: vi.fn(async () => {}),
    getActiveVaultEntry: async () => ({ id: now, name: "" }),
    startSyncIfConfigured: vi.fn(async () => {}),
    foreignInputArmed, armedLeaveGuards, takeScreen,
    PimCacheRepository: class { listAccounts = async () => []; },
    readPublicationIds: async () => [],
    isExternalVault: () => false,
    getVaultFolderPlugin: () => ({ release: async () => {} }),
    removeDataFolder: vi.fn(async (path: string) => { removed.push(path); }),
    reportBackground: () => {},
    forgetVaultData: async () => [],
    removeVault: vi.fn(async () => {}),
    i18n: { t: (key: string) => key },
    window: { dispatchEvent: () => true },
    CustomEvent,
    console: { error: () => {} },
  };
  const api = new Function(...Object.keys(deps), compiled)(...Object.values(deps)) as {
    deleteVault(id: string): Promise<string[]>;
    setBoot(p: Promise<MobileVault>, settled: boolean): void;
  };
  return { ...api, deps, removed, active: () => now };
}

const messages = () => toastStore.get().map((t) => t.message);

beforeEach(async () => {
  await i18n.changeLanguage("en");
  resetLeaveGuard();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  resetScreenStepsForTest();
  toast.clearAll();
});

describe("removing a vault on the phone", () => {
  it("ends a start still opening after the deadline, and removes the vault only once it answered and its runtime ended", async () => {
    const h = harness("work");
    const boot = hanging<MobileVault>();
    h.setBoot(boot.promise, false);
    let removing = false;
    const removal = h.deleteVault("work").then(() => { removing = true; });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(messages()).toContain(i18n.t("closing.openingGaveUp", { vault: "Work" }));
    await vi.advanceTimersByTimeAsync(5_000);
    // THE DEFECT: after the deadline the removal went on beside the start, which still opened the vault and its sync.
    expect(h.active(), "its start is ended: the local vault is the active one").toBe("local");
    expect(h.removed, "nothing removed while it may still open").toEqual([]);

    const ended = hanging();
    const late = vault("work", () => ended.promise);
    boot.resolve(late);
    await vi.advanceTimersByTimeAsync(0);
    expect(late.ended, "its runtime is called off and waited for").toHaveBeenCalled();
    expect(h.removed, "nothing removed while its runtime runs").toEqual([]);
    expect(removing).toBe(false);

    ended.resolve();
    await removal;
    expect(h.removed).toEqual(["vaults/work"]);
  });

  it("of the open vault whose sync step hangs: called off after the deadline, removed once the step's call ended", async () => {
    const h = harness("work");
    const open = vault("work");
    h.setBoot(Promise.resolve(open), true);
    const step = hanging();
    h.deps.stopSyncAndDrain.mockImplementationOnce(() => step.promise);
    let removing = false;
    const removal = h.deleteVault("work").then(() => { removing = true; });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(open.callOff).toHaveBeenCalled();
    expect(messages()).toContain(i18n.t("closing.syncGaveUp", { vault: "Work" }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(removing).toBe(false);
    expect(h.removed).toEqual([]);

    step.resolve();
    await removal;
    expect(open.ended).toHaveBeenCalled();
    expect(h.removed).toEqual(["vaults/work"]);
  });

  it("waits for a pending save within the deadline (text 4), and the removal still goes only after it", async () => {
    const h = harness("work");
    const open = vault("work");
    h.setBoot(Promise.resolve(open), true);
    const save = hanging();
    h.deps.noteSaver.flushAll.mockImplementation(() => save.promise);
    h.deps.noteSaver.pendingPaths = () => ["Inbox/Plan.md"];
    let removing = false;
    const removal = h.deleteVault("work").then(() => { removing = true; });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(messages()).toContain(i18n.t("closing.savingGaveUp", { name: "Plan" }));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(open.callOff, "a local write is never overtaken").not.toHaveBeenCalled();
    expect(removing).toBe(false);
    save.resolve();
    await removal;
    expect(h.removed).toEqual(["vaults/work"]);
  });
});
