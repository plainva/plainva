import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatformServices } from "@plainva/ui";
import { mailSecretKey } from "@plainva/ui/mail";
import {
  deviceCredentialKey,
  deviceSignInState,
  deviceSignInStates,
  isOAuthProvider,
} from "./deviceSignIn";

/**
 * The helper answers ONE question — "is this account signed in on THIS
 * device?" — for calendar accounts today and for the mobile mail client that
 * follows directly (plan P7 / E8). These tests pin the two decisions that make
 * it safe to share: which slot it reads, and that it never turns a storage
 * problem into an error the UI has to handle.
 */

const readSecret = vi.fn<(key: string) => Promise<unknown>>();

function install(): void {
  setPlatformServices({
    loadSettings: async () => ({
      get: async () => undefined,
      set: async () => {},
      delete: async () => true,
      keys: async () => [],
      save: async () => {},
    }),
    credentials: {
      readSecret: (key: string) => readSecret(key) as Promise<never>,
      writeSecret: async () => {},
      removeSecret: async () => {},
    },
    openExternal: async () => {},
  });
}

beforeEach(() => {
  readSecret.mockReset();
  install();
});

describe("deviceCredentialKey", () => {
  it("reads the same slots the two subsystems already write", () => {
    // Pinned on purpose: if a slot name ever drifts, the badge would silently
    // claim "not signed in" for a perfectly working account.
    expect(deviceCredentialKey("pim", "v1", "acc")).toBe("pim_v1_acc");
    // Mail must match the SHARED builder in @plainva/ui/mail, not a
    // restatement — the shape is `mail_<account>_<base64(vault)>`.
    expect(deviceCredentialKey("mail", "v1", "acc")).toBe(mailSecretKey("v1", "acc"));
  });
});

describe("deviceSignInState", () => {
  it("reports 'active' when a credential exists on this device", async () => {
    readSecret.mockResolvedValue({ kind: "caldav" });
    await expect(deviceSignInState("pim", "v1", "acc")).resolves.toBe("active");
    expect(readSecret).toHaveBeenCalledWith("pim_v1_acc");
  });

  it("reports 'signin' for a synced account without a local credential", async () => {
    readSecret.mockResolvedValue(null);
    await expect(deviceSignInState("pim", "v1", "acc")).resolves.toBe("signin");
  });

  it("treats an unreadable slot as 'signin', never as an error", async () => {
    // A broken keystore entry needs exactly the same fix as a missing one, and
    // the screen must keep rendering — so the read never rejects outward.
    readSecret.mockRejectedValue(new Error("keystore unavailable"));
    await expect(deviceSignInState("mail", "v1", "acc")).resolves.toBe("signin");
  });
});

describe("deviceSignInStates", () => {
  it("maps every account id, mixed states included", async () => {
    readSecret.mockImplementation(async (key: string) => (key === "pim_v1_a" ? { kind: "google" } : null));
    const states = await deviceSignInStates("pim", "v1", ["a", "b"]);
    expect(states.get("a")).toBe("active");
    expect(states.get("b")).toBe("signin");
  });
});

describe("isOAuthProvider", () => {
  it("separates 'can never travel' from 'did not travel'", () => {
    // OAuth sign-ins are structurally per-device; static credentials merely
    // depend on the secrets sync being on. The wording differs, so the check
    // has to be explicit rather than "everything that is missing is OAuth".
    expect(isOAuthProvider("google")).toBe(true);
    expect(isOAuthProvider("microsoft")).toBe(true);
    expect(isOAuthProvider("caldav")).toBe(false);
    expect(isOAuthProvider("imap")).toBe(false);
  });
});
