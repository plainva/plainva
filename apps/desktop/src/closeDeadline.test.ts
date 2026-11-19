// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import i18n from "@plainva/ui/i18n";
import { toast, toastStore, waitWithDeadline } from "@plainva/ui";

/**
 * Closing, switching or reloading a vault waits within a deadline, in both
 * shells (`waitWithDeadline`): a notice after 5 s naming what it waits for,
 * going on after 30 s and saying so — and then the vault's runtime is called
 * off (`createVaultCallOff`) before the next one starts.
 */

// The desktop package's folder is where its tests run.
const ROOT = resolve(process.cwd(), "..", "..");
const messages = () => toastStore.get().map((t) => t.message);

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  toast.clearAll();
});

describe("the deadline of a close", () => {
  it("says nothing where the work ends in time", async () => {
    let done!: () => void;
    const waited = waitWithDeadline(new Promise<void>((r) => (done = r)), () => ({ kind: "sync", vault: "Notes" }));
    await vi.advanceTimersByTimeAsync(4_000);
    done();
    expect(await waited).toBe("done");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(messages()).toEqual([]);
  });

  it("names what it waits for after 5 s, takes that notice down when the work ends, and passes a failure on", async () => {
    let fail!: (e: Error) => void;
    const waited = waitWithDeadline(new Promise<void>((_, reject) => (fail = reject)), () => ({ kind: "sync", vault: "Notes" }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(messages()).toEqual([i18n.t("closing.syncWait", { vault: "Notes" })]);
    fail(new Error("disk"));
    await expect(waited).rejects.toThrow("disk");
    expect(messages()).toEqual([]);
  });

  it("goes on after 30 s and says what now happens; several notes are counted", async () => {
    const waited = waitWithDeadline(new Promise<void>(() => undefined), () => ({ kind: "saving", names: ["A", "B", "C"] }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(messages()).toEqual([i18n.t("closing.savingWaitMany", { count: 3 })]);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await waited).toBe("gave-up");
    expect(messages()).toEqual([i18n.t("closing.savingGaveUpMany", { count: 3 })]);
  });

  it("is how both shells close: saves and the sync step within it, and the runtime called off where it gave up", () => {
    const desktop = readFileSync(join(ROOT, "apps/desktop/src/contexts/VaultContext.tsx"), "utf8");
    const teardown = desktop.slice(desktop.indexOf("const teardownVault = async"), desktop.indexOf("const teardownVaultRef"));
    expect(teardown).toMatch(/flushDrafts\(path\)[\s\S]*waitWithDeadline\(settlePendingWrites\(path\)[\s\S]*waitWithDeadline\(background[\s\S]*if \(gaveUp\) fence\?\.callOff\(\);[\s\S]*noteVaultTeardown\(path, drain\)/);
    // The next open waits for the drain, which ends within the deadline now.
    expect(desktop).toMatch(/awaitVaultTeardown\(path\)/);
    // Every runtime is fenced from its start.
    expect(desktop).toMatch(/const callOff = createVaultCallOff\(\);[\s\S]*callOff\.storage\(new TauriVaultAdapter\(path\)\)[\s\S]*callOff\.database\(openedDatabase\)/);

    const phone = readFileSync(join(ROOT, "apps/mobile/src/services/vaultService.ts"), "utf8");
    const settle = phone.slice(phone.indexOf("async function settleBeforeClosing"), phone.indexOf("async function switchTo"));
    expect(settle).toMatch(/flushDraftsBeforeClosing\(current\)[\s\S]*waitWithDeadline\(noteSaver\.flushAll\(\)[\s\S]*waitWithDeadline\(stopSyncAndDrain\(\)[\s\S]*if \(gaveUp\) current\?\.callOff\(\);/);
    for (const name of ["async function switchTo", "export async function reloadActiveMobileVault"]) {
      const body = phone.slice(phone.indexOf(name), phone.indexOf("\n}\n", phone.indexOf(name)));
      expect(body, name).toContain("await settleBeforeClosing(current);");
      expect(body, name).not.toContain("await noteSaver.flushAll();");
    }
    expect(phone).toMatch(/const callOff = createVaultCallOff\(\);[\s\S]*callOff\.storage\(opened\)[\s\S]*callOff\.database\(/);
    expect(phone).toMatch(/waitWithDeadline\(opened, \(\) => \(\{ kind: "opening"/);
  });
});
