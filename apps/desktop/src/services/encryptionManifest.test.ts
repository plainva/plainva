// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const storeValues: Record<string, unknown> = {};
vi.mock("./settingsStore", () => ({
  getSettingsStore: async () => ({
    get: async <T,>(k: string) => storeValues[k] as T | undefined,
    set: async (k: string, v: unknown) => {
      storeValues[k] = v;
    },
    delete: async (k: string) => {
      delete storeValues[k];
    },
    keys: async () => Object.keys(storeValues),
    save: async () => {},
  }),
}));

import { clearConnectionState, connectionIdFor, loadConnectionState, saveConnectionState } from "./encryptionManifest";
import { perVaultStoreSuffix } from "./vaultForget";

const CONNECTION = connectionIdFor("onedrive", "Plainva");

describe("connection E2E pin teardown (Stilllegen P1)", () => {
  beforeEach(() => {
    for (const k of Object.keys(storeValues)) delete storeValues[k];
  });

  it("round-trips and then clears the connection pin", async () => {
    await saveConnectionState({ connectionId: CONNECTION, knownEncrypted: true, lastGeneration: 3, expectedKeyId: "k1" });
    expect((await loadConnectionState(CONNECTION)).knownEncrypted).toBe(true);
    // Exactly one stored key, and it is the connection-keyed pin (not path-keyed).
    const [pinKey] = Object.keys(storeValues);
    expect(pinKey).toBe(`e2eState_${btoa("onedrive:plainva")}`);

    await clearConnectionState(CONNECTION);
    expect(storeValues[pinKey]).toBeUndefined();
    // A fresh load falls back to trust-on-first-use, not the stale flag.
    expect((await loadConnectionState(CONNECTION)).knownEncrypted).toBe(false);
  });

  it("the pin is keyed by the connection, so the per-vault suffix sweep never reaches it", () => {
    // This is why forgetVaultData needs a dedicated clear step: the pin ends in
    // `_<b64(connectionId)>`, never `_<b64(vaultPath)>`.
    const pinKey = `e2eState_${btoa("onedrive:plainva")}`;
    for (const vaultPath of ["C:/Vaults/Mein Vault", "C:/Vaults/Plainva", "/home/me/Plainva"]) {
      expect(pinKey.endsWith(perVaultStoreSuffix(vaultPath))).toBe(false);
    }
  });
});
