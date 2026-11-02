// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { toast, toastStore } from "@plainva/ui";
import { armLeaveGuard, armedLeaveGuards, disarmLeaveGuard, foreignInputArmed, resetLeaveGuard } from "./leaveGuard";
import { currentMobileDialog, dismissMobileDialog } from "./mobileDialogs";
import { resetScreenStepsForTest, takeScreen } from "./screenStep";
import type { MobileVault } from "./vaultService";

/**
 * The vault switch and the vault reload of the phone (finding 2026-10-22,
 * § 3.139 Nr. 2, 5 and 7), run as written: the functions are lifted out of
 * `vaultService.ts`; the sync, the registry and the settings are stand-ins.
 */

const source = readFileSync(resolve("src/services/vaultService.ts"), "utf8");
const file = ts.createSourceFile("vaultService.ts", source, ts.ScriptTarget.Latest, true);
const NAMES = ["switchVault", "switchTo", "resumeOnScreen", "retireBoot", "reloadActiveMobileVault", "offerReload"];
const parts: string[] = [];
ts.forEachChild(file, (node) => {
  if (ts.isFunctionDeclaration(node) && node.name && NAMES.includes(node.name.text)) parts.push(node.getText(file).replace(/^export /, ""));
});
// The helpers are named so that a run against an older vaultService.ts still loads (the red half of the evidence).
const found = parts.map((part) => /function (\w+)/.exec(part)?.[1]);
for (const name of ["switchVault", "retireBoot", "reloadActiveMobileVault"]) if (!found.includes(name)) throw new Error(`${name} missing`);
const compiled = ts.transpileModule(
  "let bootPromise = Promise.resolve(initial); let bootSettled = true; let bootAbort = null; let previousVaultId = null; let switching = null;\n" +
    "const ABANDON_BOOT_AFTER_MS = 2000; const RELOAD_STEP = \"vault-reload\";\n" +
    parts.join("\n") +
    "\nreturn { switchVault, reloadActiveMobileVault, boot: () => bootPromise, setBoot: (p) => { bootPromise = p; bootSettled = true; } };",
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;

const vault = (id: string) => ({ vaultId: id, dispose: vi.fn(async () => {}) }) as unknown as MobileVault & { dispose: ReturnType<typeof vi.fn> };

function harness(start: string) {
  let active = start;
  const events: Array<string | undefined> = [];
  const syncStarted: string[] = [];
  const order: string[] = [];
  const deps = {
    initial: vault(start),
    noteSaver: { flushAll: vi.fn(async () => {}) },
    stopSyncAndDrain: vi.fn(async () => { order.push("stop"); }),
    setActiveVault: vi.fn(async (id: string) => { order.push(`active:${id}`); active = id; }),
    reloadMobileSettingsForActiveVault: vi.fn(async () => {}),
    getActiveVaultEntry: async () => ({ id: active, name: "" }),
    startSyncIfConfigured: vi.fn(async (v: MobileVault) => { syncStarted.push(v.vaultId); }),
    foreignInputArmed,
    armedLeaveGuards,
    takeScreen,
    i18n: { t: (key: string) => key },
    window: { dispatchEvent: (event: CustomEvent<{ id?: string }>) => { events.push(event.detail?.id); return true; } },
    CustomEvent,
    console: { error: () => {} },
  };
  const api = new Function(...Object.keys(deps), compiled)(...Object.values(deps)) as {
    switchVault(id: string): Promise<void>;
    reloadActiveMobileVault(own?: string | readonly string[]): Promise<boolean>;
    boot(): Promise<MobileVault> | null;
    setBoot(p: Promise<MobileVault>): void;
  };
  return { ...api, deps, events, syncStarted, order, active: () => active };
}

beforeEach(() => {
  resetLeaveGuard();
});
afterEach(() => {
  resetScreenStepsForTest();
  toast.clearAll();
  resetLeaveGuard();
});

describe("a vault switch", () => {
  it("is one switch for two flows that end in the same vault", async () => {
    // A sign-in coming back to its vault and a connect run activating it.
    const h = harness("notes");
    const first = h.switchVault("work");
    const second = h.switchVault("work");
    await Promise.all([first, second]);
    // THE DEFECT: each switched for itself — the second dropped the stacks again
    // and nulled the boot the first had begun.
    expect(h.events, "the stacks are dropped once").toEqual(["work"]);
    expect(h.deps.setActiveVault).toHaveBeenCalledTimes(1);
  });

  it("does a switch to another vault after the one under way, not across it", async () => {
    const h = harness("notes");
    await Promise.all([h.switchVault("work"), h.switchVault("travel")]);
    expect(h.events).toEqual(["work", "travel"]);
    expect(h.active()).toBe("travel");
  });

  it("that fails leaves the vault on screen active and its sync running", async () => {
    const h = harness("notes");
    h.deps.reloadMobileSettingsForActiveVault.mockRejectedValueOnce(new Error("settings unreadable"));
    await expect(h.switchVault("work")).rejects.toThrow("settings unreadable");
    // The list named a vault that was never started, and the sync stayed stopped.
    expect(h.active(), "the vault list names the vault on screen again").toBe("notes");
    expect(h.syncStarted, "the stopped sync runs again").toEqual(["notes"]);
    expect(h.events, "nothing was switched").toEqual([]);
    expect(h.deps.initial.dispose).not.toHaveBeenCalled();
  });

  it("that fails while stopping the sync starts it again", async () => {
    const h = harness("notes");
    h.deps.stopSyncAndDrain.mockRejectedValueOnce(new Error("drain failed"));
    await expect(h.switchVault("work")).rejects.toThrow("drain failed");
    expect(h.active()).toBe("notes");
    expect(h.deps.setActiveVault).not.toHaveBeenCalled();
    expect(h.syncStarted).toEqual(["notes"]);
  });

  it("that succeeds does not start the old vault's sync", async () => {
    const h = harness("notes");
    await h.switchVault("work");
    expect(h.syncStarted).toEqual([]);
    expect(h.events).toEqual(["work"]);
  });
});

describe("a vault reload", () => {
  const MESSAGE = { id: "mail-compose", message: "The draft will not be saved." };
  const offers = () => toastStore.get().filter((item) => item.action !== undefined);

  it("reloads at once when nothing is at stake", async () => {
    const h = harness("notes");
    expect(await h.reloadActiveMobileVault("security-area")).toBe(true);
    expect(h.events).toEqual(["notes"]);
  });

  it("is not held back by the input of the screen it began on", async () => {
    const h = harness("notes");
    armLeaveGuard({ id: "security-area", message: "The credentials will be lost." });
    expect(await h.reloadActiveMobileVault("security-area")).toBe(true);
    expect(h.events).toEqual(["notes"]);
  });

  it("waits behind a message begun while it ran, and goes once the message is gone", async () => {
    const h = harness("notes");
    armLeaveGuard(MESSAGE);
    // THE DEFECT: the reload dropped every stack, and the message with them.
    expect(await h.reloadActiveMobileVault("security-area")).toBe(false);
    expect(h.events, "no stack was dropped").toEqual([]);
    expect(h.deps.stopSyncAndDrain).not.toHaveBeenCalled();
    expect(offers().map((o) => o.message)).toEqual(["mobile.vaultReloadOffer"]);

    disarmLeaveGuard(MESSAGE.id);
    await vi.waitFor(() => expect(h.events).toEqual(["notes"]));
    expect(offers(), "the notice went with the reload").toEqual([]);
  });

  it("goes at the notice's button once the message is given up, though its guard stands until the screen goes", async () => {
    const h = harness("notes");
    armLeaveGuard(MESSAGE);
    expect(await h.reloadActiveMobileVault("security-area")).toBe(false);
    const notice = offers()[0];
    notice.action!.run();
    toast.dismiss(notice.id);
    await new Promise((r) => setTimeout(r, 0));
    const dialog = currentMobileDialog();
    expect(dialog?.kind).toBe("confirm");
    if (dialog?.kind !== "confirm") throw new Error("no question");
    dialog.resolve(true);
    dismissMobileDialog(dialog);
    // "Discard" keeps the guard armed (the composer is still mounted); the reload must not wait for it again.
    await vi.waitFor(() => expect(h.events).toEqual(["notes"]));
    expect(offers()).toEqual([]);
  });

  it("waits too when the message was begun while the sync drained", async () => {
    const h = harness("notes");
    h.deps.stopSyncAndDrain.mockImplementationOnce(async () => { armLeaveGuard(MESSAGE); });
    expect(await h.reloadActiveMobileVault()).toBe(false);
    expect(h.events).toEqual([]);
    expect(h.deps.initial.dispose, "the vault on screen keeps working").not.toHaveBeenCalled();
    disarmLeaveGuard(MESSAGE.id);
    await vi.waitFor(() => expect(h.events).toEqual(["notes"]));
  });

  it("that waited does not reload a vault switched away from meanwhile", async () => {
    const h = harness("notes");
    armLeaveGuard(MESSAGE);
    expect(await h.reloadActiveMobileVault()).toBe(false);
    await h.switchVault("work");
    h.events.length = 0;
    disarmLeaveGuard(MESSAGE.id);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.events).toEqual([]);
  });
});
