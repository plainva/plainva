import { describe, expect, it } from "vitest";
import { PROFILE_FIELDS, profileDefault } from "@plainva/ui";
import { vaultDefaults, VAULT_KEYS, pickVault } from "./services/mobileSettingsScope";

/**
 * The calendar's database selection has to reach the phone (S18b).
 *
 * The whole point of putting it in the vault rather than on the device is that
 * both machines show the same calendar. That claim is only worth something if
 * the field is actually carried — a catalog entry alone does not prove arrival,
 * and `calendarOverlays` is a `json` field, which the phone's generic importer
 * cannot take. It travels the way the template rules do, and this pins it.
 */

describe("calendar overlay selection travels", () => {
  it("is a vault field in the shared catalog", () => {
    const field = PROFILE_FIELDS.find((f) => f.logical === "calendarOverlays");
    expect(field).toBeDefined();
    expect(field?.scope).toBe("vault");
    // "own": the phone carries it itself, like the template rules — the generic
    // binding only understands the scalar kinds.
    expect(field?.mobile).toBe("own");
    expect(field?.kind).toBe("json");
  });

  it("is a real per-vault setting on the phone, defaulting to nothing shown", () => {
    expect(VAULT_KEYS).toContain("calendarOverlays");
    expect(vaultDefaults().calendarOverlays).toEqual([]);
    expect(profileDefault("calendarOverlays")).toEqual([]);
  });

  it("keeps a stored selection and falls back to empty when absent", () => {
    expect(pickVault({ calendarOverlays: ["P.base#Plan"] }).calendarOverlays).toEqual(["P.base#Plan"]);
    expect(pickVault({}).calendarOverlays).toEqual([]);
  });
});
