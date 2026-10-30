// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { offeredViewTypes, resolveOpenAction, setExtraTextExtensions, setPlatformServices, storeBackedFields, splitTextFileExtensions, type ISettingsStore } from "@plainva/ui";

/**
 * Three vault settings the desktop had and the phone did not (Sammelplan
 * § 3.169 Nr. 3): "More text files", "Allow Plainva extensions for .base
 * files" and "Mark commented passages in the note". A row alone would be a
 * switch that changes nothing; these pin that each one is a real per-vault
 * setting here, travels with the profile, and does on the phone what it does
 * on the desktop.
 */

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" },
  registerPlugin: () => ({}),
}));
vi.mock("@capacitor/status-bar", () => ({ StatusBar: { setStyle: async () => {}, setBackgroundColor: async () => {} }, Style: { Dark: "DARK", Light: "LIGHT" } }));

function fakeStore(): ISettingsStore {
  const map = new Map<string, unknown>();
  return {
    async get<T>(key: string) { return map.get(key) as T | undefined; },
    async set(key: string, value: unknown) { map.set(key, structuredClone(value)); },
    async delete(key: string) { return map.delete(key); },
    async keys() { return [...map.keys()]; },
    async save() {},
  };
}

describe("Notes & filing on the phone: the desktop's three vault settings", () => {
  it("are per-vault settings with the desktop's defaults", async () => {
    const { VAULT_KEYS, vaultDefaults } = await import("./services/mobileSettingsScope");
    for (const key of ["textFileExtensions", "extendedDatabases", "commentAnchors"] as const) expect(VAULT_KEYS).toContain(key);
    expect(vaultDefaults().textFileExtensions).toEqual([]);
    expect(vaultDefaults().extendedDatabases).toBe(true);
    expect(vaultDefaults().commentAnchors).toBe(true);
  });

  it("the .base switch travels as the boolean the desktop stores and imports", async () => {
    const field = storeBackedFields("mobile").find((f) => f.logical === "extendedDatabases");
    expect(field).toMatchObject({ kind: "boolean", mobile: "extendedDatabases" });
    const { importVaultSettings } = await import("./services/mobileSettingsSync");
    expect(importVaultSettings({ extendedDatabases: false }).patch.extendedDatabases).toBe(false);
    expect(importVaultSettings({ extendedDatabases: "no" }).skipped).toContain("invalid boolean in extendedDatabases");
  });

  it("an extension saved on the phone opens such a file as text, as on the desktop", async () => {
    setPlatformServices({
      loadSettings: async () => fakeStore(),
      credentials: { readSecret: async () => null, writeSecret: async () => {}, removeSecret: async () => {} },
      openExternal: async () => {},
    });
    setExtraTextExtensions([]);
    expect(resolveOpenAction("Script/Pilot.fountain")).toBe("external");

    const { updateMobileSettings } = await import("./services/mobileSettings");
    // What the row saves: the field's text, split like the desktop's.
    await updateMobileSettings({ textFileExtensions: splitTextFileExtensions(".Fountain; adoc") });
    expect(resolveOpenAction("Script/Pilot.fountain")).toBe("text");
    expect(resolveOpenAction("Docs/Guide.adoc")).toBe("text");

    // Taken away again: the file goes to the system again.
    await updateMobileSettings({ textFileExtensions: [] });
    expect(resolveOpenAction("Script/Pilot.fountain")).toBe("external");
  });

  it("with the .base switch off, a view's type offers only what Obsidian knows — the desktop's rule", () => {
    expect(offeredViewTypes(true).map((v) => v.type)).toEqual(["table", "list", "gallery", "board", "calendar", "timeline", "graph", "pinboard"]);
    expect(offeredViewTypes(false).map((v) => v.type)).toEqual(["table", "list", "gallery"]);
  });
});
