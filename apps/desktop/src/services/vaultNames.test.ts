import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The name a vault goes by in Plainva (Sammelplan § 3.169 Nr. 3): a setting of
 * its own beside the vault's other per-vault keys, so "forget this vault"
 * sweeps it; the folder's name where there is none.
 */

const stored = new Map<string, unknown>();
vi.mock("./settingsStore", () => ({
  getSettingsStore: async () => ({
    get: async (key: string) => stored.get(key) ?? null,
    set: async (key: string, value: unknown) => void stored.set(key, value),
    delete: async (key: string) => void stored.delete(key),
    save: async () => undefined,
  }),
}));

const { forgetVaultName, renameVault, vaultFolderLabel, vaultLabel, vaultNameKey } = await import("./vaultNames");
const { perVaultStoreSuffix } = await import("./vaultForget");

describe("vault names", () => {
  beforeEach(() => stored.clear());

  it("calls a vault after its folder until it is given a name", async () => {
    expect(vaultFolderLabel("C:\\Users\\me\\Notes")).toBe("Notes");
    expect(vaultFolderLabel("/home/me/Work/")).toBe("Work");
    expect(vaultLabel("/home/me/Work")).toBe("Work");

    await renameVault("/home/me/Work", "  Day job  ");
    expect(vaultLabel("/home/me/Work")).toBe("Day job");
    expect(stored.get(vaultNameKey("/home/me/Work"))).toBe("Day job");
  });

  it("keeps the name where forget-this-vault sweeps: a key with the vault's suffix", () => {
    expect(vaultNameKey("/home/me/Work").endsWith(perVaultStoreSuffix("/home/me/Work"))).toBe(true);
  });

  it("an empty name, or the folder's own, takes the setting away", async () => {
    await renameVault("/home/me/Work", "Day job");
    await renameVault("/home/me/Work", "Work");
    expect(stored.has(vaultNameKey("/home/me/Work"))).toBe(false);
    expect(vaultLabel("/home/me/Work")).toBe("Work");

    await renameVault("/home/me/Work", "Day job");
    await renameVault("/home/me/Work", "   ");
    expect(stored.has(vaultNameKey("/home/me/Work"))).toBe(false);
  });

  it("forgets a name in this window once the vault is forgotten", async () => {
    await renameVault("/v", "Named");
    forgetVaultName("/v");
    expect(vaultLabel("/v")).toBe("v");
  });
});
