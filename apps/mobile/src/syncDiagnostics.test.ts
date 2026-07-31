import { describe, expect, it } from "vitest";
import {
  diagnosticsState,
  emptyDiagnostics,
  normalizeSyncDiagnostics,
  profileDeviceState,
  recordError,
  recordLegacyClient,
  recordProfileExchange,
  recordSecretsError,
  recordSecretsResult,
  recordSkipped,
} from "@plainva/ui";

/**
 * The finding was not "settings do not arrive" but "nobody can tell whether
 * they did". These tests pin the silent states and keep checks, downloads,
 * applies, actual uploads and redacted secret outcomes separate.
 */
describe("settings-sync diagnostics", () => {
  it("calls a device that is switched off 'off', even when the vault is locked", () => {
    expect(profileDeviceState({ enabled: false, encrypted: true, unlocked: false, everRan: false })).toBe("off");
  });

  it("names the lock when the vault is encrypted and this device has no key", () => {
    expect(profileDeviceState({ enabled: true, encrypted: true, unlocked: false, everRan: true })).toBe("locked");
  });

  it("distinguishes 'waiting' from 'running' by whether a cycle ever completed", () => {
    expect(profileDeviceState({ enabled: true, encrypted: false, unlocked: false, everRan: false })).toBe("waiting");
    expect(profileDeviceState({ enabled: true, encrypted: false, unlocked: false, everRan: true })).toBe("running");
  });

  it("derives 'everRan' from a completed check", () => {
    const opts = { enabled: true, encrypted: false, unlocked: true };
    expect(diagnosticsState(emptyDiagnostics(), opts)).toBe("waiting");
    expect(diagnosticsState(recordProfileExchange(emptyDiagnostics(), "2026-07-28T10:00:00.000Z", {
      checked: { fields: 9, names: ["theme"] },
    }), opts)).toBe("running");
  });

  it("stores check, download, applied fields and real upload separately", () => {
    const first = recordProfileExchange(emptyDiagnostics(), "2026-07-28T10:00:00.000Z", {
      checked: { fields: 12, names: ["mailAccounts", "theme"] },
      downloaded: { fields: 12, names: ["mailAccounts", "theme"], deviceId: "device-b" },
      applied: { fields: 1, names: ["mailAccounts"], deviceId: "device-b" },
      uploaded: { fields: 12, names: ["mailAccounts", "theme"] },
    });
    const second = recordProfileExchange(first, "2026-07-28T10:01:00.000Z", {
      checked: { fields: 12, names: ["mailAccounts", "theme"] },
      downloaded: { fields: 12, names: ["mailAccounts", "theme"], deviceId: "device-b" },
    });

    expect(second.lastCheck?.at).toBe("2026-07-28T10:01:00.000Z");
    expect(second.lastDownload?.at).toBe("2026-07-28T10:01:00.000Z");
    expect(second.lastApply).toEqual({
      at: "2026-07-28T10:00:00.000Z",
      fields: 1,
      names: ["mailAccounts"],
      deviceId: "device-b",
    });
    expect(second.lastUpload?.at).toBe("2026-07-28T10:00:00.000Z");
  });

  it("clears the last error on the next successful check", () => {
    const failed = recordError(emptyDiagnostics(), "2026-07-28T09:00:00.000Z", "invalid mail account metadata");
    expect(failed.lastError?.message).toContain("invalid");
    expect(recordProfileExchange(failed, "2026-07-28T10:00:00.000Z", {
      checked: { fields: 9, names: [] },
    }).lastError).toBeUndefined();
  });

  it("clears the refusal list when an import refuses nothing", () => {
    const d = recordSkipped(emptyDiagnostics(), "2026-07-28T09:00:00.000Z", ["invalid boolean in mailRemoteImages"]);
    expect(d.skipped?.reasons).toHaveLength(1);
    expect(recordSkipped(d, "2026-07-28T10:00:00.000Z", []).skipped).toBeUndefined();
  });

  it("caps a runaway refusal list", () => {
    const many = Array.from({ length: 40 }, (_, i) => `invalid row ${i}`);
    expect(recordSkipped(emptyDiagnostics(), "2026-07-28T10:00:00.000Z", many).skipped?.reasons).toHaveLength(20);
  });

  it("persists only redacted secret counts and reason codes", () => {
    const raw = {
      entries: [
        { logicalId: "mail/person@example.invalid/imap-password", status: "imported" as const },
        {
          logicalId: "mail/person@example.invalid/smtp-password",
          status: "rejected" as const,
          reason: "binding-mismatch" as const,
        },
      ],
      imported: ["mail/person@example.invalid/imap-password"],
      unchanged: [],
      rejected: ["mail/person@example.invalid/smtp-password"],
      stale: [],
      errors: [],
      unknownAccounts: [],
      legacyEntries: [],
    };
    const d = recordSecretsResult(emptyDiagnostics(), "2026-07-28T10:00:00.000Z", raw);
    expect(d.lastSecrets).toEqual({
      at: "2026-07-28T10:00:00.000Z",
      imported: 1,
      unchanged: 0,
      rejected: 1,
      stale: 0,
      errors: 0,
      waiting: 0,
      legacy: 0,
      reasons: [{ reason: "binding-mismatch", count: 1 }],
    });
    expect(JSON.stringify(d)).not.toContain("person@example.invalid");
  });

  it("keeps redacted secret failures and legacy publishers separate", () => {
    const failed = recordSecretsError(emptyDiagnostics(), "2026-07-28T10:00:00.000Z", "invalid-or-unreadable-bundle");
    const legacy = recordLegacyClient(failed, "2026-07-28T10:01:00.000Z", "legacy-google-client-entry");
    expect(legacy.lastSecrets?.reasons).toEqual([{ reason: "invalid-or-unreadable-bundle", count: 1 }]);
    expect(legacy.legacyClient?.reasons).toEqual(["legacy-google-client-entry"]);
  });

  it("does not reinterpret an old client's export timestamp as a verified upload", () => {
    const old = normalizeSyncDiagnostics({
      lastExport: { at: "2026-07-28T09:00:00.000Z", fields: 9 },
      lastImport: { at: "2026-07-28T09:01:00.000Z", fields: 1, names: ["theme"] },
    });
    expect(old.lastCheck?.at).toBe("2026-07-28T09:00:00.000Z");
    expect(old.lastApply?.at).toBe("2026-07-28T09:01:00.000Z");
    expect(old.lastUpload).toBeUndefined();
    expect(old.previousClientActivity).toBe(true);
  });
});
