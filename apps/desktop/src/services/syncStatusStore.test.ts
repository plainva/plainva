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
