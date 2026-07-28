import { describe, expect, it } from "vitest";
import {
  diagnosticsState,
  emptyDiagnostics,
  profileDeviceState,
  recordError,
  recordExport,
  recordImport,
  recordSkipped,
} from "@plainva/ui";

/**
 * The finding was not "settings do not arrive" but "nobody can tell whether
 * they did". These tests pin the three states that look like a working sync
 * from the outside, and the rule that a fixed refusal stops accusing the user.
 */
describe("settings-sync diagnostics", () => {
  it("calls a device that is switched off 'off', even when the vault is locked", () => {
    // Telling someone to enter a passphrase for a sync they switched off would
    // send them down the wrong path.
    expect(profileDeviceState({ enabled: false, encrypted: true, unlocked: false, everRan: false })).toBe("off");
  });

  it("names the lock when the vault is encrypted and this device has no key", () => {
    expect(profileDeviceState({ enabled: true, encrypted: true, unlocked: false, everRan: true })).toBe("locked");
  });

  it("distinguishes 'waiting' from 'running' by whether a cycle ever completed", () => {
    expect(profileDeviceState({ enabled: true, encrypted: false, unlocked: false, everRan: false })).toBe("waiting");
    expect(profileDeviceState({ enabled: true, encrypted: false, unlocked: false, everRan: true })).toBe("running");
  });

  it("derives 'everRan' from the record itself", () => {
    const opts = { enabled: true, encrypted: false, unlocked: true };
    expect(diagnosticsState(emptyDiagnostics(), opts)).toBe("waiting");
    expect(diagnosticsState(recordExport(emptyDiagnostics(), "2026-07-28T10:00:00.000Z", 9), opts)).toBe("running");
  });

  it("keeps the peer and the field count of the last import", () => {
    const d = recordImport(emptyDiagnostics(), "2026-07-28T10:00:00.000Z", 12, "device-b");
    expect(d.lastImport).toEqual({ at: "2026-07-28T10:00:00.000Z", fields: 12, deviceId: "device-b" });
  });

  it("clears the last error on the next success", () => {
    const failed = recordError(emptyDiagnostics(), "2026-07-28T09:00:00.000Z", "invalid mail account metadata");
    expect(failed.lastError?.message).toContain("invalid");
    expect(recordExport(failed, "2026-07-28T10:00:00.000Z", 9).lastError).toBeUndefined();
  });

  it("clears the refusal list when an import refuses nothing", () => {
    const d = recordSkipped(emptyDiagnostics(), "2026-07-28T09:00:00.000Z", ["invalid boolean in mailRemoteImages"]);
    expect(d.skipped?.reasons).toHaveLength(1);
    expect(recordSkipped(d, "2026-07-28T10:00:00.000Z", []).skipped).toBeUndefined();
  });

  it("caps a runaway refusal list — past twenty it is a structural fault, not a bad row", () => {
    const many = Array.from({ length: 40 }, (_, i) => `invalid row ${i}`);
    expect(recordSkipped(emptyDiagnostics(), "2026-07-28T10:00:00.000Z", many).skipped?.reasons).toHaveLength(20);
  });
});
