// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTemplateSettingsTo, getMobileSettings, getVaultSettings, reloadMobileSettingsForActiveVault } from "./mobileSettings";

/**
 * A vault made in the cloud gets its template's settings (finding 2026-10-12).
 *
 * The end of a file connection may wait for the person before the new vault is
 * opened (`flowVault.ts`). What the template sets — the daily folder, the
 * template folder, the daily template — used to be written only once the vault
 * was the active one, and an app that ended in between left the vault without
 * them, and nothing said so. They are the vault's own settings, so they are
 * written into it at once, and the vault on screen keeps its own.
 */

const state = vi.hoisted(() => ({ active: "local", store: new Map<string, unknown>() }));

vi.mock("@plainva/ui", async (original) => ({
  ...(await original<typeof import("@plainva/ui")>()),
  getPlatformServices: () => ({
    loadSettings: async () => ({
      get: async (key: string) => structuredClone(state.store.get(key)),
      set: async (key: string, value: unknown) => {
        state.store.set(key, structuredClone(value));
      },
      delete: async (key: string) => {
        state.store.delete(key);
      },
      save: async () => {},
    }),
  }),
}));
vi.mock("./vaultRegistry", () => ({
  LOCAL_VAULT_ID: "local",
  getActiveVaultEntry: async () => ({ id: state.active, name: "" }),
  listVaults: async () => [{ id: "local", name: "" }, { id: "fresh", name: "Notes" }],
}));

beforeEach(() => {
  state.active = "local";
  state.store.clear();
});

describe("the settings of a template, for a vault that is not open yet", () => {
  it("are in the new vault before it is opened, and the vault on screen keeps its own", async () => {
    const onScreen = getMobileSettings();

    await applyTemplateSettingsTo("fresh", { dailyNotesFolder: "Journal", templateFolder: "Vorlagen", dailyNoteTemplate: "Vorlagen/Tag.md" });

    expect(getMobileSettings().dailyFolder).toBe(onScreen.dailyFolder);
    expect(getMobileSettings().templateFolder).toBe(onScreen.templateFolder);
    expect(await getVaultSettings("fresh")).toMatchObject({ dailyFolder: "Journal", templateFolder: "Vorlagen", dailyTemplate: "Vorlagen/Tag.md" });

    // Opened later — after a restart as well: the settings are read from the store.
    state.active = "fresh";
    await reloadMobileSettingsForActiveVault();
    expect(getMobileSettings()).toMatchObject({ dailyFolder: "Journal", templateFolder: "Vorlagen", dailyTemplate: "Vorlagen/Tag.md" });
  });

  it("writes nothing for a template without settings", async () => {
    await applyTemplateSettingsTo("fresh", undefined);
    expect(state.store.size).toBe(0);
  });
});
