// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { captureSyncErrorSnapshot, syncStatusStore } from "./syncStatusStore";

/** Every existing assertion is about one vault; stage D only names it. */
const V = "/vault";

describe("syncStatusStore reason threading (Stilllegen P2)", () => {
  beforeEach(() => syncStatusStore.resetAll());

  it("carries the fatal-protocol reason into the error history + capture", () => {
    syncStatusStore.set(V, { status: "error", message: "manifest missing", provider: "onedrive", reason: "manifest-invalid" });
    const latest = syncStatusStore.getLatestError(V);
    expect(latest?.reason).toBe("manifest-invalid");
    expect(captureSyncErrorSnapshot(V)?.reason).toBe("manifest-invalid");
  });

  it("leaves reason undefined for ordinary failures", () => {
    syncStatusStore.set(V, { status: "error", message: "network down", provider: "webdav" });
    expect(syncStatusStore.getLatestError(V)?.reason).toBeUndefined();
  });
});

/**
 * P3: a failure that KNOWS it needs a sign-in says so, instead of leaving the
 * dialog to guess it from the message — the guess reads German and English
 * words only, so the same failure in Japanese would have offered a retry that
 * cannot possibly help.
 */
describe("syncStatusStore authRecoverable", () => {
  beforeEach(() => syncStatusStore.resetAll());

  it("carries the flag into the history and the capture", () => {
    syncStatusStore.set(V, { status: "error", message: "この端末は…", provider: "drive", authRecoverable: true });

    expect(syncStatusStore.getLatestError(V)?.authRecoverable).toBe(true);
    expect(captureSyncErrorSnapshot(V)?.authRecoverable).toBe(true);
  });

  it("does not stick to the next status", () => {
    syncStatusStore.set(V, { status: "error", message: "sign in", provider: "drive", authRecoverable: true });
    syncStatusStore.set(V, { status: "idle", message: null, provider: "drive" });
    syncStatusStore.set(V, { status: "error", message: "network down", provider: "drive" });

    // Merging the snapshot would have carried the flag over and sent a plain
    // network hiccup to the settings instead of offering a retry.
    expect(syncStatusStore.get(V).authRecoverable).toBeUndefined();
    expect(syncStatusStore.getLatestError(V)?.authRecoverable).toBeUndefined();
  });

  it("survives an update that only changes progress", () => {
    syncStatusStore.set(V, { status: "error", message: "sign in", provider: "drive", authRecoverable: true });
    syncStatusStore.set(V, { progress: { phase: "pull", current: 1, total: 2 } });

    expect(syncStatusStore.get(V).authRecoverable).toBe(true);
  });
});

/**
 * Two vaults open at once (multi-window stage D).
 *
 * The store used to hold one snapshot per PROCESS, which was true while a
 * process could hold one vault. With two, the failure is not a crash: the
 * second worker's every poll overwrites the first one's status, so a status bar
 * calmly reports a vault its window does not show.
 */
describe("two vaults in one process (stage D)", () => {
  beforeEach(() => syncStatusStore.resetAll());

  it("keeps each vault's status to itself", () => {
    syncStatusStore.set("/A", { status: "syncing", message: null, provider: "webdav" });
    syncStatusStore.set("/B", { status: "error", message: "no route to host", provider: "dropbox" });

    expect(syncStatusStore.get("/A").status).toBe("syncing");
    expect(syncStatusStore.get("/A").provider).toBe("webdav");
    expect(syncStatusStore.get("/B").status).toBe("error");
    expect(syncStatusStore.get("/B").message).toBe("no route to host");
  });

  it("keeps each vault's error history to itself", () => {
    syncStatusStore.set("/A", { status: "error", message: "A failed", provider: "webdav" });
    syncStatusStore.set("/B", { status: "error", message: "B failed", provider: "dropbox" });

    expect(syncStatusStore.getErrorHistory("/A").map((e) => e.message)).toEqual(["A failed"]);
    expect(syncStatusStore.getErrorHistory("/B").map((e) => e.message)).toEqual(["B failed"]);
    // The dialog's capture is per vault too — it is what the sync-error window
    // shows, and showing the other vault's failure would send the user to the
    // wrong provider's settings.
    expect(captureSyncErrorSnapshot("/A")?.message).toBe("A failed");
  });

  it("forgets only the vault that closed", () => {
    syncStatusStore.set("/A", { status: "error", message: "A failed" });
    syncStatusStore.set("/B", { status: "syncing", message: null });

    syncStatusStore.reset("/A");

    expect(syncStatusStore.get("/A").status).toBe("idle");
    expect(syncStatusStore.getErrorHistory("/A")).toEqual([]);
    expect(syncStatusStore.get("/B").status).toBe("syncing");
  });

  it("reads no vault as idle rather than as somebody else's status", () => {
    syncStatusStore.set("/A", { status: "error", message: "A failed" });
    // The splash has no sync to report; borrowing the last vault's would paint
    // an error over a screen with no vault behind it.
    expect(syncStatusStore.get(null).status).toBe("idle");
    expect(syncStatusStore.getErrorHistory(null)).toEqual([]);
  });
});
