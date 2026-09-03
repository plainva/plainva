import { beforeEach, describe, expect, it } from "vitest";
import { setPlatformServices } from "@plainva/ui";

/**
 * Creating the settings-sync encryption on the phone (H2e).
 *
 * The properties under test are the ones that decide whether other devices keep
 * their access:
 *   1. a keyfile that exists locally OR remotely is never overwritten, and a
 *      failed remote probe counts as "exists" rather than "no";
 *   2. nothing is written before activation — an abandoned draft leaves no
 *      keyfile, no cached key, and its master key is zeroed;
 *   3. activation writes the keyfile and unlocks THIS device, and the resulting
 *      recovery code really opens that keyfile.
 * Runs the REAL core crypto.
 */

const prefs = new Map<string, unknown>();
const secrets = new Map<string, unknown>();

/** A settings store and keychain that live in this test, nothing more. */
function install(): void {
  setPlatformServices({
    loadSettings: async () => ({
      get: async (key: string) => prefs.get(key) as never,
      set: async (key: string, value: unknown) => { prefs.set(key, value); },
      delete: async (key: string) => prefs.delete(key),
      keys: async () => [...prefs.keys()],
      save: async () => {},
    }),
    credentials: {
      readSecret: async (key: string) => (secrets.get(key) ?? null) as never,
      writeSecret: async (key: string, value: unknown) => { secrets.set(key, value); },
      removeSecret: async (key: string) => { secrets.delete(key); },
    },
    openExternal: async () => {},
  });
}

import { parseRecoveryCode, unlockAllKeys, type IVaultAdapter } from "@plainva/core";
import {
  KeyfileAlreadyExistsError,
  KeyfileProbeFailedError,
  activatePreparedMobileEncryption,
  discardPreparedMobileEncryption,
  lockMobileEncryption,
  mobileEncryptionStatus,
  prepareMobileEncryption,
  setMobilePassphraseEveryStart,
} from "./mobileSettingsSync";
import type { MobileVault } from "./vaultService";

const KEYFILE = ".plainva/sync/keyfile.json";
const PASS = "correct horse battery";

function vaultWith(files: Record<string, string>): { vault: MobileVault; files: Record<string, string> } {
  const adapter = {
    exists: async (path: string) => path in files,
    readTextFile: async (path: string) => files[path] ?? "",
    writeTextFile: async (path: string, text: string) => { files[path] = text; },
  } as unknown as IVaultAdapter;
  return { vault: { vaultId: "v1", adapter } as unknown as MobileVault, files };
}

const noRemote = async () => false;

// Real key derivation runs in these tests. Alone they take a second each;
// under the pre-commit's parallel turbo run (core + desktop + mobile at once)
// two of them crossed the 5 s default twice in a row on 2026-09-03 with no code
// change behind them. The budget matches pimForeground.test.ts.
describe("mobile settings encryption setup", () => {
  beforeEach(async () => {
    install();
    prefs.clear();
    secrets.clear();
    await lockMobileEncryption("v1");
  });

  it("refuses when a keyfile already exists locally", async () => {
    const { vault } = vaultWith({ [KEYFILE]: "{}" });
    await expect(prepareMobileEncryption(vault, PASS, noRemote)).rejects.toBeInstanceOf(KeyfileAlreadyExistsError);
  });

  it("refuses when one exists in the cloud but has not been pulled yet", async () => {
    const { vault, files } = vaultWith({});
    await expect(prepareMobileEncryption(vault, PASS, async () => true)).rejects.toBeInstanceOf(KeyfileAlreadyExistsError);
    expect(files[KEYFILE]).toBeUndefined();
  });

  it("refuses when the cloud cannot be checked at all", async () => {
    // Offline is "cannot tell", and guessing here would lock other devices out.
    const { vault, files } = vaultWith({});
    await expect(
      prepareMobileEncryption(vault, PASS, async () => { throw new Error("offline"); }),
    ).rejects.toBeInstanceOf(KeyfileProbeFailedError);
    expect(files[KEYFILE]).toBeUndefined();
  });

  it("writes nothing while only preparing", async () => {
    const { vault, files } = vaultWith({});
    const { recoveryCode } = await prepareMobileEncryption(vault, PASS, noRemote);
    expect(recoveryCode.length).toBeGreaterThan(0);
    expect(files[KEYFILE]).toBeUndefined();
    expect(await mobileEncryptionStatus(vault)).toBe("none");
    expect([...secrets.keys()]).toEqual([]);
  });

  it("makes a discarded draft unusable and leaves nothing behind", async () => {
    const { vault, files } = vaultWith({});
    const { draftId } = await prepareMobileEncryption(vault, PASS, noRemote);
    discardPreparedMobileEncryption(draftId);
    await expect(activatePreparedMobileEncryption(vault, draftId)).rejects.toThrow(/expired/);
    expect(files[KEYFILE]).toBeUndefined();
  });

  it("keeps only the newest draft per vault", async () => {
    const { vault } = vaultWith({});
    const first = await prepareMobileEncryption(vault, PASS, noRemote);
    const second = await prepareMobileEncryption(vault, "another passphrase", noRemote);
    await expect(activatePreparedMobileEncryption(vault, first.draftId)).rejects.toThrow(/expired/);
    await activatePreparedMobileEncryption(vault, second.draftId);
    expect(await mobileEncryptionStatus(vault)).toBe("unlocked");
  });

  it("writes the keyfile on activation and unlocks this device", async () => {
    const { vault, files } = vaultWith({});
    const { draftId, recoveryCode } = await prepareMobileEncryption(vault, PASS, noRemote);
    await activatePreparedMobileEncryption(vault, draftId);

    const keyfile = JSON.parse(files[KEYFILE]);
    expect(keyfile.format).toBe("plainva-keyfile");
    expect(await mobileEncryptionStatus(vault)).toBe("unlocked");

    // The passphrase opens it…
    const keys = await unlockAllKeys(keyfile, PASS);
    expect(keys.get(keyfile.activeKeyId)).toBeTruthy();
    // …and so does the code the wizard showed, for the same key.
    expect(parseRecoveryCode(recoveryCode).keyId).toBe(keyfile.activeKeyId);
  });

  it("caches the keyring so the next app start is still unlocked", async () => {
    const { vault, files } = vaultWith({});
    const { draftId } = await prepareMobileEncryption(vault, PASS, noRemote);
    await activatePreparedMobileEncryption(vault, draftId);
    const cached = secrets.get("mkcache_mobile_v1") as { activeKeyId: string; keys: unknown[] };
    expect(cached.activeKeyId).toBe(JSON.parse(files[KEYFILE]).activeKeyId);
    expect(cached.keys).toHaveLength(1);
  });

  it("keeps the key in memory only when the passphrase is asked for on every start", async () => {
    const { vault } = vaultWith({});
    await setMobilePassphraseEveryStart("v1", true);
    const { draftId } = await prepareMobileEncryption(vault, PASS, noRemote);
    await activatePreparedMobileEncryption(vault, draftId);
    expect(secrets.get("mkcache_mobile_v1")).toBeUndefined();
  });
}, 60_000);
