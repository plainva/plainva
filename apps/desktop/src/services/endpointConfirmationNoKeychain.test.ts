import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F57's switch-over on a desktop whose keychain is not there at all (Linux
 * without a Secret Service): the passwords live in the credentials file,
 * CredentialManager's documented fallback, and the switch-over must finish
 * there — an empty slot is empty, not an error (review of F57, round two,
 * O-2). Which home the device has is the app process's note, decided before
 * the switch-over reads (`ensureMarkKeyHome`, behind the sealing at start);
 * no error text decides it, and without a note the switch-over waits for the
 * next start (round three, O-C). These run the REAL
 * `CredentialManager.readSecretStrict`; only Tauri and the app process's
 * answer are replaced. Built on the reviewer's case K1.
 */
const HOME = "settingsSyncSecretsMarkKeyHome";
const state = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  file: new Map<string, unknown>(),
  keychainError: "Platform secure storage failure: no secret service",
  /** What the app process notes as the key's home when asked; null = it cannot decide (an error). */
  homeOnEnsure: "file" as "file" | "keychain" | null,
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
vi.mock("./settingsSecrets", () => ({
  importedSecretSlots: async () => new Set<string>(),
  ensureMarkKeyHome: async () => {
    if (state.settings.has(HOME)) return;
    if (!state.homeOnEnsure) throw new Error("keychain locked while marks exist");
    state.settings.set(HOME, state.homeOnEnsure);
  },
}));
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

import { getPlatformServices, isEndpointConfirmedIn, sealSecretsAtStart, setPlatformServices } from "@plainva/ui";
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
  state.homeOnEnsure = "file";
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
  it("finishes once the app process noted the file as the home: passwords typed here are confirmed, nothing asks after the update", async () => {
    const v = `/v${++n}`;
    typedHere(v);
    await settleVaultEndpointConfirmations(v, {} as never);
    expect(state.settings.get(HOME)).toBe("file");
    expect(await confirmed(v)).toEqual({ caldav: true, imap: true });
  });

  it("reads an empty slot as empty where the key of the marks was made in the file", async () => {
    state.settings.set(HOME, "file");
    state.keychainError = "Couldn't access platform secure storage: locked";
    await expect(credentialManager.readSecretStrict("nothing-here")).resolves.toBeNull();
  });

  it("decides nothing by an error text: without the note, an unreachable keychain is an error", async () => {
    await expect(credentialManager.readSecretStrict("nothing-here")).rejects.toThrow("Platform secure storage failure");
  });

  it("keeps a keychain that is the home but does not answer an error, and confirms nothing", async () => {
    const v = `/v${++n}`;
    typedHere(v);
    state.file.clear();
    state.settings.set(HOME, "keychain");
    state.keychainError = "Couldn't access platform secure storage: locked";
    await expect(settleVaultEndpointConfirmations(v, {} as never)).rejects.toThrow("locked");
    expect(await confirmed(v)).toEqual({ caldav: false, imap: false });
  });

  it("does not switch over while the home cannot be decided, and does at the next start", async () => {
    const v = `/v${++n}`;
    typedHere(v);
    state.homeOnEnsure = null;
    await expect(settleVaultEndpointConfirmations(v, {} as never)).rejects.toThrow("keychain locked while marks exist");
    expect(await confirmed(v)).toEqual({ caldav: false, imap: false });
    state.homeOnEnsure = "file";
    await settleVaultEndpointConfirmations(v, {} as never);
    expect(await confirmed(v)).toEqual({ caldav: true, imap: true });
  });

  it("runs behind a sealing at start that began before it, and reads no slot until it is done", async () => {
    const v = `/v${++n}`;
    typedHere(v);
    let release!: () => void;
    const sealing = sealSecretsAtStart(() => new Promise<void>((resolve) => { release = resolve; }));
    const settle = settleVaultEndpointConfirmations(v, {} as never);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(state.settings.has(HOME)).toBe(false);
    release();
    await sealing;
    await settle;
    expect(await confirmed(v)).toEqual({ caldav: true, imap: true });
  });
});
