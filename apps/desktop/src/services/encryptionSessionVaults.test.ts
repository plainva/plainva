import { beforeEach, describe, it, expect, vi } from "vitest";

/**
 * TWO VAULTS, ONE ENCRYPTED (multi-window stage D, plan § 5.5).
 *
 * With two vaults open at once, "the unlocked master key" stops being a single
 * thing. The caches here were keyed by vault path from the beginning, so this is
 * an ASSURANCE rather than a rebuild — and it is worth pinning precisely because
 * the file reads as if there were one session: a later `const current` would
 * hand vault B the key of vault A, and nothing else in the app would notice.
 *
 * What must hold: an unlocked vault does not unlock its neighbour, each vault
 * reads its own keychain slot, and locking one leaves the other unlocked.
 */
const secrets = new Map<string, unknown>();
vi.mock("./CredentialManager", () => ({
  credentialManager: {
    readSecret: async (key: string) => secrets.get(key) ?? null,
    writeSecret: async (key: string, value: unknown) => {
      secrets.set(key, value);
    },
    removeSecret: async (key: string) => {
      secrets.delete(key);
    },
  },
}));
vi.mock("./settingsStore", () => ({
  getSettingsStore: async () => ({
    get: async () => undefined,
    set: async () => {},
    save: async () => {},
  }),
}));

import { toBase64 } from "@plainva/core";
import { getMemoryMasterKey, loadCachedMasterKey, lockVault } from "./encryptionSession";
import { slot } from "./keychainSlots";

const A = "/vault-a";
const B = "/vault-b";
const keyOf = (n: number) => new Uint8Array(32).fill(n);

describe("the unlocked master key belongs to its vault", () => {
  beforeEach(async () => {
    secrets.clear();
    await lockVault(A);
    await lockVault(B);
    secrets.set(slot.encryption(A), { keyId: "key-a", mk: toBase64(keyOf(1)) });
  });

  it("does not hand a second vault the first one's key", async () => {
    const a = await loadCachedMasterKey(A);
    expect(a?.keyId).toBe("key-a");
    // B has no cached key of its own: it stays locked, whatever A is doing.
    expect(await loadCachedMasterKey(B)).toBeNull();
  });

  it("keeps two unlocked vaults apart", async () => {
    secrets.set(slot.encryption(B), { keyId: "key-b", mk: toBase64(keyOf(2)) });
    expect((await loadCachedMasterKey(A))?.keyId).toBe("key-a");
    expect((await loadCachedMasterKey(B))?.keyId).toBe("key-b");
  });

  /**
   * Deliberately asked of the MEMORY session rather than of
   * `loadCachedMasterKey`: that one falls back to the keychain, so it answers
   * "could B be unlocked again" — which stays true even if locking A had wiped
   * every session in the process. The question here is whether B is STILL
   * unlocked.
   */
  it("locks one vault without locking the other", async () => {
    secrets.set(slot.encryption(B), { keyId: "key-b", mk: toBase64(keyOf(2)) });
    await loadCachedMasterKey(A);
    await loadCachedMasterKey(B);

    await lockVault(A);

    expect(getMemoryMasterKey(A)).toBeNull();
    expect(getMemoryMasterKey(B)?.keyId).toBe("key-b");
    // And A really is locked: its keychain copy is gone too.
    expect(await loadCachedMasterKey(A)).toBeNull();
  });
});
