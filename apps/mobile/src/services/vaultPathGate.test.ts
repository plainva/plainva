// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMobileSettings, updateMobileSettings } from "./mobileSettings";

/**
 * No folder or file setting on the phone points under `.plainva` or out of
 * the vault (open-items plan 3.127 no. 4). The field asks first
 * (`FolderField`); a folder picked in the browser, which lists `.plainva` as
 * well, and every other write of the settings meet one gate in
 * `updateMobileSettings`. Notes under `.plainva` are not indexed, not synced
 * and get no versions.
 */

const state = vi.hoisted(() => ({ store: new Map<string, unknown>(), errors: [] as string[] }));

vi.mock("@plainva/ui", async (original) => {
  const ui = await original<typeof import("@plainva/ui")>();
  return {
    ...ui,
    refuseVaultPathSetting: (value: string) => {
      if (ui.isVaultPathSetting(value)) return false;
      state.errors.push(value);
      return true;
    },
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
  };
});
vi.mock("./vaultRegistry", () => ({
  LOCAL_VAULT_ID: "local",
  getActiveVaultEntry: async () => ({ id: "local", name: "" }),
  listVaults: async () => [{ id: "local", name: "" }],
}));

beforeEach(() => {
  state.store.clear();
  state.errors.length = 0;
});

describe("a vault path set on the phone (3.127 no. 4)", () => {
  it("is refused under .plainva and said; the other values of the same write go through", async () => {
    const before = getMobileSettings().dailyFolder;
    await updateMobileSettings({ dailyFolder: ".plainva/Daily", dailyFormat: "YYYY/MM-DD" });
    expect(getMobileSettings().dailyFolder).toBe(before);
    expect(getMobileSettings().dailyFormat).toBe("YYYY/MM-DD");
    expect(state.errors).toEqual([".plainva/Daily"]);
  });

  it("is refused out of the vault, and taken inside it", async () => {
    await updateMobileSettings({ templateFolder: "../Elsewhere" });
    expect(state.errors).toEqual(["../Elsewhere"]);
    await updateMobileSettings({ templateFolder: "Vorlagen" });
    expect(getMobileSettings().templateFolder).toBe("Vorlagen");
  });
});

describe("the template rules set on the phone (P10, 3.127 no. 4)", () => {
  it("are refused where a folder or a template points under .plainva, and taken inside the vault", async () => {
    const before = getMobileSettings().folderTemplates;
    await updateMobileSettings({ folderTemplates: [{ folder: ".plainva/x", template: "Templates/A.md" }] });
    expect(getMobileSettings().folderTemplates).toEqual(before);
    await updateMobileSettings({ typeTemplates: [{ type: "Person", template: ".plainva/T.md" }] });
    expect(state.errors).toEqual([".plainva/x", ".plainva/T.md"]);
    await updateMobileSettings({ folderTemplates: [{ folder: "Projects", template: "Templates/A.md" }] });
    expect(getMobileSettings().folderTemplates).toEqual([{ folder: "Projects", template: "Templates/A.md" }]);
  });
});
