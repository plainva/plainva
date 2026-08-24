// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/api/path", () => ({
  join: async (...parts: string[]) => parts.join("/"),
  appDataDir: async () => "/appdata",
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async () => true,
  mkdir: async () => {},
  readDir: async () => [],
  remove: async () => {},
}));

import { isZipRunning, runVaultZipBackup } from "./vaultZipBackup";

const store = { get: async () => undefined, set: async () => {}, save: async () => {} } as never;

// The run resolves the destination and creates the folder before it invokes
// Rust, so the invocation lands a few microtasks in — waiting for it is what
// makes "while the first one still runs" the actual state under test.
const untilInvoked = (n: number) => vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(n));

/**
 * Two open vaults, two archives (multi-window stage D).
 *
 * The guard against a second run existed before this stage and was a single
 * process-wide flag — correct while a process could only hold one vault. With
 * two it stopped being a guard and became a queue: whichever vault started
 * first blocked the other, and the block was invisible, because "already
 * running" reads like an answer about the vault you asked about.
 */
describe("the ZIP guard across open vaults", () => {
  beforeEach(() => invoke.mockReset());

  it("lets the second vault archive while the first one still runs", async () => {
    let finishA: () => void = () => {};
    invoke.mockImplementationOnce(
      () => new Promise((r) => (finishA = () => r({ zip_path: "/a.zip", file_count: 1, skipped: [] }))),
    );
    invoke.mockResolvedValueOnce({ zip_path: "/b.zip", file_count: 1, skipped: [] });

    const a = runVaultZipBackup({ vaultPath: "/work", store });
    await untilInvoked(1);
    const b = await runVaultZipBackup({ vaultPath: "/home", store });

    expect(b).toMatchObject({ ok: true, zipPath: "/b.zip" });
    finishA();
    await expect(a).resolves.toMatchObject({ ok: true });
  });

  it("still refuses to archive the SAME vault twice at once", async () => {
    let finish: () => void = () => {};
    invoke.mockImplementationOnce(
      () => new Promise((r) => (finish = () => r({ zip_path: "/a.zip", file_count: 1, skipped: [] }))),
    );

    const first = runVaultZipBackup({ vaultPath: "/work", store });
    await untilInvoked(1);
    // Two Rust invocations writing one archive is the failure the guard is for.
    expect(await runVaultZipBackup({ vaultPath: "/work", store })).toEqual({ ok: false, error: "already-running" });
    expect(invoke).toHaveBeenCalledTimes(1);
    finish();
    await first;
  });

  it("reports the running state per vault, not for the process", async () => {
    let finish: () => void = () => {};
    invoke.mockImplementationOnce(
      () => new Promise((r) => (finish = () => r({ zip_path: "/a.zip", file_count: 1, skipped: [] }))),
    );
    const run = runVaultZipBackup({ vaultPath: "/work", store });
    await untilInvoked(1);
    // The scheduler asks this before its tick; a process-wide answer would skip
    // the other vault's daily archive for as long as this one takes.
    expect(isZipRunning("/work")).toBe(true);
    expect(isZipRunning("/home")).toBe(false);
    finish();
    await run;
    expect(isZipRunning("/work")).toBe(false);
  });
});
