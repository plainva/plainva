import { describe, it, expect } from "vitest";
import { clearLegacyClient, recordLegacyClient, type SyncDiagnostics } from "@plainva/ui";

/**
 * The legacy record only ever grew. A finding recorded once outlived its cause,
 * so the warning stayed up while the cleanup button truthfully answered
 * "nothing to remove" — the exact loop Marco was stuck in (2026-08-19).
 */

const at = "2026-08-19T10:00:00Z";

describe("legacy findings", () => {
  it("drops a finding a cycle proved gone", () => {
    const recorded = recordLegacyClient({}, at, "legacy-google-client-entry");
    expect(recorded.legacyClient?.reasons).toEqual(["legacy-google-client-entry"]);

    expect(clearLegacyClient(recorded, "legacy-google-client-entry").legacyClient).toBeUndefined();
  });

  it("keeps the findings it did not observe", () => {
    // The secrets cycle can only speak about the secrets document. Clearing the
    // profile finding along with it would hide a condition nobody looked at.
    let d: SyncDiagnostics = recordLegacyClient({}, at, "legacy-google-client-entry");
    d = recordLegacyClient(d, at, "legacy-profile-capability-remote");

    const after = clearLegacyClient(d, "legacy-google-client-entry");
    expect(after.legacyClient?.reasons).toEqual(["legacy-profile-capability-remote"]);
  });

  it("leaves an untouched record alone", () => {
    const d = recordLegacyClient({}, at, "legacy-profile-capability-remote");
    expect(clearLegacyClient(d, "legacy-google-client-entry")).toBe(d);
    expect(clearLegacyClient({}, "legacy-google-client-entry").legacyClient).toBeUndefined();
  });
});
