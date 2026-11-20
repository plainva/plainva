import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F57's switch-over on a desktop that comes from 0.8.7 (review of F57, round
 * two, O-1): a password that came through the settings sync is marked as
 * imported under the name 0.8.7 gave it, and the mark reaches the new name
 * only in a secrets round, after the vault opened. "Imported" is recognised
 * under either name, before and after the record is sealed: such a password
 * proves nothing, and its address asks once. Built on the reviewer's cases
 * U0 to U3, with the real import record.
 */
const state = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  secrets: new Map<string, unknown>(),
  pimRows: [] as Array<{ id: string; provider: string; config: Record<string, unknown> }>,
  mailboxes: [] as Array<Record<string, unknown>>,
  keychainThrows: false,
}));
const store = {
  get: async (k: string) => structuredClone(state.settings.get(k)), set: async (k: string, v: unknown) => void state.settings.set(k, structuredClone(v)),
  delete: async (k: string) => void state.settings.delete(k), keys: async () => [...state.settings.keys()], save: async () => undefined,
};
vi.mock("./settingsStore", () => ({ getSettingsStore: async () => store }));
vi.mock("./cloudAccounts", () => ({ loadCloudAccounts: async () => [] }));
vi.mock("./CredentialManager", () => ({
  credentialManager: {
    readSecretStrict: async (k: string) => { if (state.keychainThrows) throw new Error("keychain locked"); return state.secrets.get(k) ?? null; },
    // The key of the marks, from the app process (secure_store.rs has its own tests).
    secretsMarkKey: async (fresh: string) => fresh,
    readSecret: async (k: string) => (state.keychainThrows ? null : state.secrets.get(k) ?? null),
  },
}));
vi.mock("@plainva/ui/mail", async (original) => ({
  ...(await original<typeof import("@plainva/ui/mail")>()),
  listMailAccounts: async () => state.mailboxes,
}));
vi.mock("@plainva/core", async (original) => ({
  ...(await original<typeof import("@plainva/core")>()),
  PimCacheRepository: class { async listAccounts() { return state.pimRows; } async listCalendars() { return []; } },
}));

import { canonicalSecretId } from "@plainva/core";
import { calDavSecretBinding, familyOfCalDavUrl, familyOfImapHost, getPlatformServices, imapSecretBinding, isEndpointConfirmedIn, setPlatformServices } from "@plainva/ui";
import { mailSecretKey } from "@plainva/ui/mail";
import { settleVaultEndpointConfirmations } from "./endpointConfirmationSettle";
import { slot } from "./keychainSlots";

const b64 = (p: string) => btoa(unescape(encodeURIComponent(p)));
const CAL = "http://192.168.1.10/dav";
const cal = () => calDavSecretBinding(familyOfCalDavUrl(CAL) ?? "webdav", CAL, "anna");
const imap = () => imapSecretBinding(familyOfImapHost("192.168.1.20") ?? "imap", "192.168.1.20", 993, "anna");
const oldId = (b: ReturnType<typeof cal>, type: string) => canonicalSecretId({ ...b, secretType: type as never, user: b.user.toLowerCase() });
const entry = (b: ReturnType<typeof cal>, type: string) => ({ hash: "plain", entryRev: 1, updatedAt: "2026-11-01T00:00:00.000Z", deviceId: "other", binding: { ...b, secretType: type, user: b.user.toLowerCase() } });

let n = 0;
beforeEach(() => {
  let previous: ReturnType<typeof getPlatformServices> | undefined;
  try { previous = getPlatformServices(); } catch { previous = undefined; }
  setPlatformServices({ ...previous, loadSettings: async () => store } as never);
  state.settings.clear(); state.secrets.clear(); state.pimRows = []; state.mailboxes = []; state.keychainThrows = false;
});

function setup(vault: string) {
  state.pimRows = [{ id: "cal", provider: "caldav", config: { url: CAL, user: "anna" } }];
  state.secrets.set(slot.calendar(vault, "cal"), JSON.parse(JSON.stringify({ kind: "caldav", url: CAL, user: "anna", pass: "from-other-device" })));
  state.mailboxes = [{ id: "mb", kind: "imap", host: "192.168.1.20", port: 993, user: "anna", email: "anna@home" }];
  state.secrets.set(mailSecretKey(vault, "mb"), { pass: "from-other-device" });
}
async function result(vault: string) {
  await settleVaultEndpointConfirmations(vault, {} as never);
  return { caldav: await isEndpointConfirmedIn(vault, "http://192.168.1.10:80"), imap: await isEndpointConfirmedIn(vault, "imap://192.168.1.20:993") };
}
const oldRecord = () => ({
  entries: { [oldId(cal(), "caldav-password")]: entry(cal(), "caldav-password"), [oldId(imap(), "imap-password")]: entry(imap(), "imap-password") },
  imported: { [oldId(cal(), "caldav-password")]: true, [oldId(imap(), "imap-password")]: true }, quarantine: {},
});

describe("the switch-over after an update from 0.8.7: desktop coming from 0.8.7", () => {
  it("U0 control: imported, record of this version -> asked", async () => {
    const v = `/v${++n}`; setup(v);
    state.settings.set(`settingsSyncSecretMarks_${b64(v)}`, { entries: {}, imported: { [canonicalSecretId(cal())]: true, [canonicalSecretId(imap())]: true }, quarantine: {} });
    const r = await result(v);
    expect(r).toEqual({ caldav: false, imap: false });
  });
  it("U1: imported on 0.8.7 (record under 0.8.7's name) -> must be asked", async () => {
    const v = `/v${++n}`; setup(v);
    state.settings.set(`settingsSyncSecretMeta_${b64(v)}`, oldRecord());
    const r = await result(v);
    expect(r).toEqual({ caldav: false, imap: false });
  });
  it("U2: imported on 0.8.7, sealed to this version's name at start -> must be asked", async () => {
    const v = `/v${++n}`; setup(v);
    state.settings.set(`settingsSyncSecretMarks_${b64(v)}`, oldRecord());
    const r = await result(v);
    expect(r).toEqual({ caldav: false, imap: false });
  });
  it("U3 control: typed here -> confirmed", async () => {
    const v = `/v${++n}`; setup(v);
    const r = await result(v);
    expect(r).toEqual({ caldav: true, imap: true });
  });
  it("R3: keychain does not answer -> nothing confirmed, next start runs again", async () => {
    const v = `/v${++n}`; setup(v);
    state.keychainThrows = true;
    let threw = false;
    try { await result(v); } catch { threw = true; }
    const before = { caldav: await isEndpointConfirmedIn(v, "http://192.168.1.10:80"), imap: await isEndpointConfirmedIn(v, "imap://192.168.1.20:993") };
    state.keychainThrows = false;
    const after = await result(v);
    expect(threw).toBe(true);
    expect(before).toEqual({ caldav: false, imap: false });
    expect(after).toEqual({ caldav: true, imap: true });
  });
  it("an import record that cannot be read: the switch-over throws, nothing is confirmed, the next start runs it again", async () => {
    const v = `/v${++n}`; setup(v);
    const origGet = state.settings.get.bind(state.settings);
    state.settings.get = ((k: string) => { if (k.startsWith("settingsSyncSecretMarks_")) throw new Error("store unreadable"); return origGet(k); }) as never;
    let threw = false;
    try { await settleVaultEndpointConfirmations(v, {} as never); } catch { threw = true; }
    state.settings.get = origGet as never;
    expect(threw).toBe(true);
    expect({ caldav: await isEndpointConfirmedIn(v, "http://192.168.1.10:80"), imap: await isEndpointConfirmedIn(v, "imap://192.168.1.20:993") }).toEqual({ caldav: false, imap: false });
    expect(await result(v)).toEqual({ caldav: true, imap: true });
  });

  it("R4: a mailbox without a password here -> not confirmed", async () => {
    const v = `/v${++n}`;
    state.mailboxes = [{ id: "mb", kind: "imap", host: "192.168.1.20", port: 993, user: "anna", email: "a@b" }];
    const r = await result(v);
    expect(r.imap).toBe(false);
  });
});

const NEWHOST = "192.168.1.30";
const imapNew = () => imapSecretBinding(familyOfImapHost(NEWHOST) ?? "imap", NEWHOST, 993, "anna");
describe("the import mark hangs at the password, not at its address (review of F57, round three, O-A)", () => {
  for (const key of ["settingsSyncSecretMeta_", "settingsSyncSecretMarks_"]) {
    it(`DU5 ${key}: imported for .20, the mailbox moved to .30 by the profile, the same password remembered there: asked`, async () => {
      const v = `/w${++n}`;
      state.mailboxes = [{ id: "mb", kind: "imap", host: NEWHOST, port: 993, user: "anna", email: "anna@home" }];
      state.secrets.set(mailSecretKey(v, "mb"), { pass: "from-other-device" });
      state.settings.set(`${key}${b64(v)}`, {
        entries: { [oldId(imap(), "imap-password")]: entry(imap(), "imap-password"), [oldId(imapNew(), "imap-password")]: entry(imapNew(), "imap-password") },
        imported: { [oldId(imap(), "imap-password")]: true }, quarantine: {},
      });
      await settleVaultEndpointConfirmations(v, {} as never);
      expect(await isEndpointConfirmedIn(v, `imap://${NEWHOST}:993`)).toBe(false);
    });
  }

  it("a mailbox typed here beside an imported one of another user stays proven", async () => {
    const v = `/w${++n}`;
    state.mailboxes = [
      { id: "mine", kind: "imap", host: NEWHOST, port: 993, user: "bert", email: "bert@home" },
      { id: "mb", kind: "imap", host: "192.168.1.20", port: 993, user: "anna", email: "anna@home" },
    ];
    state.secrets.set(mailSecretKey(v, "mine"), { pass: "typed-here" });
    state.secrets.set(mailSecretKey(v, "mb"), { pass: "from-other-device" });
    state.settings.set(`settingsSyncSecretMarks_${b64(v)}`, { entries: { [oldId(imap(), "imap-password")]: entry(imap(), "imap-password") }, imported: { [oldId(imap(), "imap-password")]: true }, quarantine: {} });
    await settleVaultEndpointConfirmations(v, {} as never);
    expect(await isEndpointConfirmedIn(v, `imap://${NEWHOST}:993`)).toBe(true);
    expect(await isEndpointConfirmedIn(v, "imap://192.168.1.20:993")).toBe(false);
  });

  it("a mark it cannot read is doubt, and doubt asks", async () => {
    const v = `/w${++n}`;
    state.mailboxes = [{ id: "mine", kind: "imap", host: NEWHOST, port: 993, user: "bert", email: "bert@home" }];
    state.secrets.set(mailSecretKey(v, "mine"), { pass: "typed-here" });
    state.settings.set(`settingsSyncSecretMarks_${b64(v)}`, { entries: {}, imported: { "an id of an older form": true }, quarantine: {} });
    await settleVaultEndpointConfirmations(v, {} as never);
    expect(await isEndpointConfirmedIn(v, `imap://${NEWHOST}:993`)).toBe(false);
  });
});
