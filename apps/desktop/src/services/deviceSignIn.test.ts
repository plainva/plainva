import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatformServices } from "@plainva/ui";
import { setMailPassword } from "@plainva/ui/mail";
import { deviceCredentialKey, deviceSignInState } from "./deviceSignIn";

/**
 * P2 — the desktop side of "is this account signed in on THIS device?".
 *
 * The rule is shared with mobile; what is NOT shared is where each shell keeps
 * its slots. These tests pin the two things that decide whether the desktop
 * surface tells the truth: that it looks in the desktop's own slot names, and
 * that signing in writes the credential WITHOUT touching the account record.
 */

const readSecret = vi.fn<(key: string) => Promise<unknown>>();
const writeSecret = vi.fn<(key: string, value: unknown) => Promise<void>>();
const settingsSet = vi.fn<(key: string, value: unknown) => Promise<void>>();

function install(): void {
  setPlatformServices({
    loadSettings: async () => ({
      get: async () => undefined,
      set: (key: string, value: unknown) => settingsSet(key, value),
      delete: async () => true,
      keys: async () => [],
      save: async () => {},
    }),
    credentials: {
      readSecret: (key: string) => readSecret(key) as Promise<never>,
      writeSecret: (key: string, value: unknown) => writeSecret(key, value),
      removeSecret: async () => {},
    },
    openExternal: async () => {},
  });
}

beforeEach(() => {
  readSecret.mockReset();
  writeSecret.mockReset();
  settingsSet.mockReset();
  install();
});

const VAULT = "/home/marco/Vaults/wiki";

describe("desktop device sign-in", () => {
  it("reads the desktop slot names, which are not the mobile ones", async () => {
    // The desktop keys by (base64) vault PATH, mobile by vault id. A single
    // shared builder would report every working desktop account as "not signed
    // in" — the exact failure this module exists to prevent.
    const b64 = btoa(unescape(encodeURIComponent(VAULT)));
    expect(deviceCredentialKey("mail", VAULT, "acc-1")).toBe(`mail_acc-1_${b64}`);
    expect(deviceCredentialKey("pim", VAULT, "acc-1")).toBe(`pim_acc-1_${b64}`);
    // ...and specifically NOT the mobile shape, which puts the vault first.
    expect(deviceCredentialKey("pim", VAULT, "acc-1")).not.toBe(`pim_${VAULT}_acc-1`);
  });

  it("treats an unreadable slot as 'sign in', never as an error", async () => {
    readSecret.mockRejectedValue(new Error("keychain locked"));
    await expect(deviceSignInState("mail", VAULT, "acc-1")).resolves.toBe("signin");
  });

  it("reports a mailbox with a stored password as active", async () => {
    readSecret.mockResolvedValue({ pass: "hunter2" });
    await expect(deviceSignInState("mail", VAULT, "acc-1")).resolves.toBe("active");
  });

  it("signing in stores the credential and leaves the account record alone", async () => {
    // The metadata arrived over the settings sync and may be NEWER on another
    // device. Writing it back while signing in would push this device's stale
    // copy over it — signing in is a statement about this device only.
    await setMailPassword(VAULT, "acc-1", "hunter2");
    expect(writeSecret).toHaveBeenCalledWith(`mail_acc-1_${btoa(unescape(encodeURIComponent(VAULT)))}`, { pass: "hunter2" });
    expect(settingsSet).not.toHaveBeenCalled();
  });
});
