import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F57's switch-over on a desktop whose keychain is not there at all (Linux
 * without a Secret Service): the passwords live in the credentials file,
 * CredentialManager's documented fallback, and the switch-over must finish
 * there — an empty slot is empty, not an error (review of F57, round two,
 * O-2). A keychain that is there but does not answer stays an error. These run
 * the REAL `CredentialManager.readSecretStrict`; only Tauri is replaced.
 * Built on the reviewer's case K1.
 */
const state = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  file: new Map<string, unknown>(),
  keychainError: "Platform secure storage failure: no secret service",
  pimRows: [] as Array<{ id: string; provider: string; config: Record<string, unknown> }>,
  mailboxes: [] as Array<Record<string, unknown>>,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
    throw new Error(`${cmd}: ${state.keychainError}`);
  },
}));
const plain = (map: Map<string, unknown>) => ({
  get: async (k: string) => structuredClone(map.get(k)),
  set: async (k: string, v: unknown) => void map.set(k, structuredClone(v)),
  delete: async (k: string) => void map.delete(k),
  keys: async () => [...map.keys()],
  save: async () => undefined,
});
vi.mock("@tauri-apps/plugin-store", () => ({
  Store: class {},
  load: async (path: string) => plain(path === "credentials.bin" ? state.file : state.settings),
}));
vi.mock("./settingsStore", () => ({ STORE_KEY: "plainva-settings.json", getSettingsStore: async () => plain(state.settings) }));
vi.mock("./settingsSecrets", () => ({ importedSecretSlots: async () => new Set<string>() }));
vi.mock("@plainva/ui/mail", async (original) => ({ ...(await original<typeof import("@plainva/ui/mail")>()), listMailAccounts: async () => state.mailboxes }));
vi.mock("@plainva/core", async (original) => ({
  ...(await original<typeof import("@plainva/core")>()),
  PimCacheRepository: class {
    async listAccounts() {
      return state.pimRows;
    }
    async listCalendars() {
      return [];
    }
  },
}));

import { getPlatformServices, isEndpointConfirmedIn, setPlatformServices } from "@plainva/ui";
import { mailSecretKey } from "@plainva/ui/mail";
import { credentialManager } from "./CredentialManager";
import { settleVaultEndpointConfirmations } from "./endpointConfirmationSettle";
import { slot } from "./keychainSlots";

let n = 0;
beforeEach(() => {
  let previous: ReturnType<typeof getPlatformServices> | undefined;
  try {
    previous = getPlatformServices();
  } catch {
    previous = undefined;
  }
  setPlatformServices({ ...previous, loadSettings: async () => plain(state.settings) } as never);
  state.settings.clear();
  state.file.clear();
  state.keychainError = "Platform secure storage failure: no secret service";
  state.pimRows = [];
  state.mailboxes = [];
});

function typedHere(v: string) {
  state.pimRows = [{ id: "cal", provider: "caldav", config: { url: "http://192.168.1.10/dav", user: "anna" } }];
  state.mailboxes = [{ id: "mb", kind: "imap", host: "192.168.1.20", port: 993, user: "anna", email: "a@b" }];
  state.file.set(slot.calendar(v, "cal"), { kind: "caldav", url: "http://192.168.1.10/dav", user: "anna", pass: "typed-here" });
  state.file.set(mailSecretKey(v, "mb"), { pass: "typed-here" });
}
const confirmed = async (v: string) => ({ caldav: await isEndpointConfirmedIn(v, "http://192.168.1.10:80"), imap: await isEndpointConfirmedIn(v, "imap://192.168.1.20:993") });

describe("the switch-over on a desktop without a keychain", () => {
  it("finishes: passwords typed here, in the credentials file, are confirmed and nothing asks after the update", async () => {
    const v = `/v${++n}`;
    typedHere(v);
    await settleVaultEndpointConfirmations(v, {} as never);
    expect(await confirmed(v)).toEqual({ caldav: true, imap: true });
  });

  it("reads an empty slot as empty where the key of the marks was made in the file", async () => {
    state.settings.set("settingsSyncSecretsMarkKeyHome", "file");
    state.keychainError = "Couldn't access platform secure storage: locked";
    await expect(credentialManager.readSecretStrict("nothing-here")).resolves.toBeNull();
  });

  it("keeps a keychain that is there but does not answer an error, and confirms nothing", async () => {
    const v = `/v${++n}`;
    typedHere(v);
    state.file.clear();
    state.keychainError = "Couldn't access platform secure storage: locked";
    await expect(credentialManager.readSecretStrict("nothing-here")).rejects.toThrow("locked");
    await expect(settleVaultEndpointConfirmations(v, {} as never)).rejects.toThrow("locked");
    expect(await confirmed(v)).toEqual({ caldav: false, imap: false });
  });

  it("keeps it an error where the keychain is noted as the home, whatever the keychain says", async () => {
    state.settings.set("settingsSyncSecretsMarkKeyHome", "keychain");
    await expect(credentialManager.readSecretStrict("nothing-here")).rejects.toThrow("Platform secure storage failure");
  });
});
