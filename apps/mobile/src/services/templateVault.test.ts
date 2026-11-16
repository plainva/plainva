import { beforeEach, describe, expect, it, vi } from "vitest";
import { templateVaultName } from "@plainva/ui";

const registry = vi.hoisted(() => ({ entry: { id: "local", name: "" } as { id: string; name: string } | null, fail: false }));
vi.mock("./vaultRegistry", () => ({
  getActiveVaultEntry: async () => {
    if (registry.fail) throw new Error("registry unreadable");
    return registry.entry;
  },
}));
vi.mock("./mobileSettings", () => ({ getMobileSettings: () => ({ dailyFolder: "Daily", dailyFormat: "YYYY-MM-DD" }) }));
vi.mock("@plainva/ui/i18n", () => ({ default: { t: (key: string) => (key === "mobile.vaultLocal" ? "On this device" : key) } }));

import { phoneTemplateVault } from "./templateVault";

/** `{{vault}}` is the name the vault goes by in the app, on both shells (B25). */
describe("phoneTemplateVault", () => {
  beforeEach(() => {
    registry.entry = { id: "local", name: "" };
    registry.fail = false;
  });

  it("names the vault by its entry in the vault list", async () => {
    registry.entry = { id: "v1", name: " Studio " };
    expect(await phoneTemplateVault()).toEqual({ name: "Studio", dailyFolder: "Daily", dailyFormat: "YYYY-MM-DD" });
  });

  it("an entry without a name is called what the vault list shows for it", async () => {
    expect((await phoneTemplateVault()).name).toBe("On this device");
  });

  it("a name the caller knows wins; a registry that cannot be read still answers", async () => {
    expect((await phoneTemplateVault("Given")).name).toBe("Given");
    registry.fail = true;
    expect((await phoneTemplateVault()).name).toBe("Plainva");
  });

  it("is the shared rule the desktop names its vault by", () => {
    expect(templateVaultName("  Work ", "Folder")).toBe("Work");
    expect(templateVaultName("", "Folder")).toBe("Folder");
    expect(templateVaultName(null, "Folder")).toBe("Folder");
  });
});
