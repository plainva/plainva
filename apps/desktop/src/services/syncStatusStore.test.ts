// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { captureSyncErrorSnapshot, syncStatusStore } from "./syncStatusStore";

describe("syncStatusStore reason threading (Stilllegen P2)", () => {
  beforeEach(() => syncStatusStore.reset());

  it("carries the fatal-protocol reason into the error history + capture", () => {
    syncStatusStore.set({ status: "error", message: "manifest missing", provider: "onedrive", reason: "manifest-invalid" });
    const latest = syncStatusStore.getLatestError();
    expect(latest?.reason).toBe("manifest-invalid");
    expect(captureSyncErrorSnapshot()?.reason).toBe("manifest-invalid");
  });

  it("leaves reason undefined for ordinary failures", () => {
    syncStatusStore.set({ status: "error", message: "network down", provider: "webdav" });
    expect(syncStatusStore.getLatestError()?.reason).toBeUndefined();
  });
});

/**
 * P3: a failure that KNOWS it needs a sign-in says so, instead of leaving the
 * dialog to guess it from the message — the guess reads German and English
 * words only, so the same failure in Japanese would have offered a retry that
 * cannot possibly help.
 */
describe("syncStatusStore authRecoverable", () => {
  beforeEach(() => syncStatusStore.reset());

  it("carries the flag into the history and the capture", () => {
    syncStatusStore.set({ status: "error", message: "この端末は…", provider: "drive", authRecoverable: true });

    expect(syncStatusStore.getLatestError()?.authRecoverable).toBe(true);
    expect(captureSyncErrorSnapshot()?.authRecoverable).toBe(true);
  });

  it("does not stick to the next status", () => {
    syncStatusStore.set({ status: "error", message: "sign in", provider: "drive", authRecoverable: true });
    syncStatusStore.set({ status: "idle", message: null, provider: "drive" });
    syncStatusStore.set({ status: "error", message: "network down", provider: "drive" });

    // Merging the snapshot would have carried the flag over and sent a plain
    // network hiccup to the settings instead of offering a retry.
    expect(syncStatusStore.get().authRecoverable).toBeUndefined();
    expect(syncStatusStore.getLatestError()?.authRecoverable).toBeUndefined();
  });

  it("survives an update that only changes progress", () => {
    syncStatusStore.set({ status: "error", message: "sign in", provider: "drive", authRecoverable: true });
    syncStatusStore.set({ progress: { phase: "pull", current: 1, total: 2 } });

    expect(syncStatusStore.get().authRecoverable).toBe(true);
  });
});
