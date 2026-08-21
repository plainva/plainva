import { describe, expect, it } from "vitest";
import {
  diagnosticsState,
  emptyDiagnostics,
  normalizeSyncDiagnostics,
  profileDeviceState,
  noteSettingsSyncFailure,
  recordError,
  SETTINGS_SYNC_FAILURES_BEFORE_ERROR,
  settingsSyncFailureIsWaiting,
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

  it("T13 security gate: redacts credentials before a profile error is persisted", () => {
    const failed = recordError(
      emptyDiagnostics(),
      "2026-07-28T09:00:00.000Z",
      'provider rejected clientId="desktop-client-marker" token=grant-marker',
    );
    const persisted = JSON.stringify(failed);
    expect(persisted).not.toContain("desktop-client-marker");
    expect(persisted).not.toContain("grant-marker");
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

/**
 * A settings sync that shouts at the first dropped request (finding 2026-08-21).
 *
 * The file sync learned in 0.6.6 to tell "worth waiting out" from "an answer".
 * The sideband did not: EVERY throw became a red toast carrying the raw
 * provider sentence — including the ones whose own wording called them a retry
 * — and the dedupe behind it lived in memory, so a timeout announced itself
 * again at every app start. These pin the shared decision both shells now use.
 */
describe("a failed settings-sync cycle decides between waiting and answering", () => {
  const AT = "2026-08-21T09:14:00.000Z";
  const timeout = () => new Error("request timed out after 30000ms");
  const revoked = () => new Error("invalid_grant: token has been expired or revoked");

  it("waits out the first two transient failures and says nothing", () => {
    let d = emptyDiagnostics();
    const first = noteSettingsSyncFailure(d, AT, timeout());
    expect(first.failure.kind).toBe("transient");
    expect(first.failure.streak).toBe(1);
    expect(first.failure.escalate).toBe(false);
    expect(first.failure.announce).toBe(false);
    d = first.diagnostics;
    // The record carries the waiting state, so the card can show it without a toast.
    expect(settingsSyncFailureIsWaiting(d.lastError)).toBe(true);
    expect(d.lastError?.reported).toBeUndefined();

    const second = noteSettingsSyncFailure(d, AT, timeout());
    expect(second.failure.streak).toBe(2);
    expect(second.failure.announce).toBe(false);
  });

  it("turns red on the third failure in a row", () => {
    let d = emptyDiagnostics();
    for (let i = 0; i < 2; i += 1) d = noteSettingsSyncFailure(d, AT, timeout()).diagnostics;
    const third = noteSettingsSyncFailure(d, AT, timeout());
    expect(third.failure.streak).toBe(SETTINGS_SYNC_FAILURES_BEFORE_ERROR);
    expect(third.failure.escalate).toBe(true);
    expect(third.failure.announce).toBe(true);
    expect(settingsSyncFailureIsWaiting(third.diagnostics.lastError)).toBe(false);
    expect(third.diagnostics.lastError?.reported).toBe(true);
  });

  it("never waits out a revoked sign-in", () => {
    // Waiting cannot fix this one, and staying quiet about it is the single
    // thing this rule must never do.
    const out = noteSettingsSyncFailure(emptyDiagnostics(), AT, revoked());
    expect(out.failure.kind).toBe("fatal");
    expect(out.failure.escalate).toBe(true);
    expect(out.failure.announce).toBe(true);
  });

  it("says the same thing once, across restarts", () => {
    // The old dedupe was a module-level Map: the process dying re-armed it, so
    // the same timeout was announced at every single app start.
    const first = noteSettingsSyncFailure(emptyDiagnostics(), AT, revoked());
    expect(first.failure.announce).toBe(true);
    // A fresh process reads the SAME durable record back.
    const restarted = JSON.parse(JSON.stringify(first.diagnostics));
    const again = noteSettingsSyncFailure(restarted, AT, revoked());
    expect(again.failure.escalate).toBe(true);
    expect(again.failure.announce).toBe(false);
  });

  it("speaks again when the failure is a different one", () => {
    const first = noteSettingsSyncFailure(emptyDiagnostics(), AT, revoked());
    const other = noteSettingsSyncFailure(first.diagnostics, AT, new Error("403 forbidden"));
    expect(other.failure.announce).toBe(true);
  });

  it("re-arms itself on the next successful exchange", () => {
    // No second store to keep in step: a success clears the whole record, and
    // with it the streak and the "already said" flag.
    const failed = noteSettingsSyncFailure(emptyDiagnostics(), AT, revoked()).diagnostics;
    const ok = recordProfileExchange(failed, "2026-08-21T09:20:00.000Z", {
      checked: { fields: 3, names: ["a", "b", "c"] },
    });
    expect(ok.lastError).toBeUndefined();
    const later = noteSettingsSyncFailure(ok, "2026-08-21T09:25:00.000Z", revoked());
    expect(later.failure.streak).toBe(1);
    expect(later.failure.announce).toBe(true);
  });

  it("keeps a record written before this change red", () => {
    // Those carry no `kind`; they were shown as errors when they were written,
    // and a silent downgrade would hide a real one.
    expect(settingsSyncFailureIsWaiting({ at: AT, message: "boom" })).toBe(false);
  });

  it("keeps a credential out of the durable record", () => {
    // A WebDAV failure carries the whole request URL, and that URL carries the
    // password. This record survives restarts and rides along in the diagnostic
    // export, so the redaction is not decoration.
    const out = noteSettingsSyncFailure(
      emptyDiagnostics(),
      AT,
      new Error("PROPFIND https://marco:hunter2@cloud.example.com/remote.php failed"),
    );
    expect(out.failure.message).not.toContain("hunter2");
    expect(out.diagnostics.lastError?.message).not.toContain("hunter2");
    // Still says which server, or the message helps nobody.
    expect(out.failure.message).toContain("cloud.example.com");
  });

  it("carries the message through even when the provider threw a bare string", () => {
    // A native WebView rejection is often not an Error; the old path produced
    // "[object Object]" for those, which is the failure telling you nothing.
    const out = noteSettingsSyncFailure(emptyDiagnostics(), AT, { code: "ETIMEDOUT", message: "network unreachable" });
    expect(out.failure.message).toContain("network unreachable");
  });
});
