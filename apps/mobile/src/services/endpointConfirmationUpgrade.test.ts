import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F57's switch-over on a phone that comes from 0.8.7 (review of F57, round
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
  pimCreds: new Map<string, unknown>(),
  mailboxes: [] as Array<Record<string, unknown>>,
}));
vi.mock("./syncService", () => ({ getStoredProvider: async () => null }));
vi.mock("./pim/pimService", () => ({ listPimAccounts: async () => state.pimRows, isPimRuntimeReady: () => false }));
vi.mock("./pim/pimCredentials", () => ({
  getPimCredentials: async (_v: string, id: string) => state.pimCreds.get(id) ?? null,
  pimSecretKey: (v: string, id: string) => `pim_${v}_${id}`,
}));
vi.mock("@plainva/ui/mail", () => ({
  listMailAccounts: async () => state.mailboxes,
  mailAccountKind: (a: { kind?: string }) => a.kind ?? "imap",
  mailSecretKey: (v: string, id: string) => `mail_${v}_${id}`,
  legacyMailSecretKey: (v: string, id: string) => `mailold_${v}_${id}`,
  hasCachedMail: async () => false,
}));
vi.mock("@plainva/core", async (original) => ({
  ...(await original<typeof import("@plainva/core")>()),
  PimCacheRepository: class { async listAccounts() { return state.pimRows; } async listCalendars() { return []; } },
}));

import { canonicalSecretId } from "@plainva/core";
import { calDavSecretBinding, familyOfCalDavUrl, familyOfImapHost, getPlatformServices, imapSecretBinding, isEndpointConfirmedIn, setPlatformServices } from "@plainva/ui";
import { settleVaultEndpointConfirmations } from "./endpointConfirmationSettle";

const CAL = "http://192.168.1.10/dav";
const cal = () => calDavSecretBinding(familyOfCalDavUrl(CAL) ?? "webdav", CAL, "anna");
const imap = () => imapSecretBinding(familyOfImapHost("192.168.1.20") ?? "imap", "192.168.1.20", 993, "anna");
// The names 0.8.7 gave them (bridgeIdOf in secretsPort.ts): the old type, the user lower-cased.
const oldId = (b: ReturnType<typeof cal>, type: string) => canonicalSecretId({ ...b, secretType: type as never, user: b.user.toLowerCase() });
const entry = (b: ReturnType<typeof cal>, type: string) => ({ hash: "plain", entryRev: 1, updatedAt: "2026-11-01T00:00:00.000Z", deviceId: "other-phone", binding: { ...b, secretType: type, user: b.user.toLowerCase() } });

let n = 0;
beforeEach(() => {
  let previous: ReturnType<typeof getPlatformServices> | undefined;
  try { previous = getPlatformServices(); } catch { previous = undefined; }
  setPlatformServices({
    ...previous,
    loadSettings: async () => ({
      get: async (k: string) => structuredClone(state.settings.get(k)), set: async (k: string, v: unknown) => void state.settings.set(k, structuredClone(v)),
      delete: async (k: string) => void state.settings.delete(k), keys: async () => [...state.settings.keys()], save: async () => undefined,
    }),
    credentials: {
      readSecret: async (k: string) => state.secrets.get(k) ?? null,
      writeSecret: async (k: string, v: unknown) => void state.secrets.set(k, v),
      removeSecret: async (k: string) => void state.secrets.delete(k),
    },
  } as never);
  state.settings.clear(); state.secrets.clear(); state.pimRows = []; state.pimCreds.clear(); state.mailboxes = [];
});

function setup(vaultId: string) {
  state.pimRows = [{ id: "cal", provider: "caldav", config: { url: CAL, user: "anna" } }];
  state.pimCreds.set("cal", { kind: "caldav", url: CAL, user: "anna", pass: "from-other-device" });
  state.mailboxes = [{ id: "mb", kind: "imap", host: "192.168.1.20", port: 993, user: "anna" }];
  state.secrets.set(`mail_${vaultId}_mb`, { pass: "from-other-device" });
}

async function result(vaultId: string) {
  await settleVaultEndpointConfirmations({ vaultId, db: {} as never });
  return { caldav: await isEndpointConfirmedIn(vaultId, "http://192.168.1.10:80"), imap: await isEndpointConfirmedIn(vaultId, "imap://192.168.1.20:993") };
}

describe("the switch-over after an update from 0.8.7: phone coming from 0.8.7", () => {
  it("U0 control: imported, record of this version -> asked", async () => {
    const v = `v${++n}`; setup(v);
    state.settings.set(`settingsSyncSecretMarksMobile_${v}`, { entries: {}, imported: { [canonicalSecretId(cal())]: true, [canonicalSecretId(imap())]: true }, quarantine: {} });
    const r = await result(v);
    expect(r).toEqual({ caldav: false, imap: false });
  });
  it("U1: imported on 0.8.7, record under the name 0.8.7 wrote -> must be asked", async () => {
    const v = `v${++n}`; setup(v);
    state.settings.set(`settingsSyncSecretMetaMobile_${v}`, {
      entries: { [oldId(cal(), "caldav-password")]: entry(cal(), "caldav-password"), [oldId(imap(), "imap-password")]: entry(imap(), "imap-password") },
      imported: { [oldId(cal(), "caldav-password")]: true, [oldId(imap(), "imap-password")]: true }, quarantine: {},
    });
    const r = await result(v);
    expect(r).toEqual({ caldav: false, imap: false });
  });
  it("U2: imported on 0.8.7, record moved to this version's name by the seal at start -> must be asked", async () => {
    const v = `v${++n}`; setup(v);
    state.settings.set(`settingsSyncSecretMarksMobile_${v}`, {
      entries: { [oldId(cal(), "caldav-password")]: entry(cal(), "caldav-password"), [oldId(imap(), "imap-password")]: entry(imap(), "imap-password") },
      imported: { [oldId(cal(), "caldav-password")]: true, [oldId(imap(), "imap-password")]: true }, quarantine: {},
    });
    const r = await result(v);
    expect(r).toEqual({ caldav: false, imap: false });
  });
  it("U3 control: typed here (no import mark) -> confirmed", async () => {
    const v = `v${++n}`; setup(v);
    const r = await result(v);
    expect(r).toEqual({ caldav: true, imap: true });
  });
  it("R1: a mailbox without a password here -> not confirmed", async () => {
    const v = `v${++n}`;
    state.mailboxes = [{ id: "mb", kind: "imap", host: "192.168.1.20", port: 993, user: "anna" }];
    const r = await result(v);
    expect(r.imap).toBe(false);
  });
  it("R2: unreadable import record -> settle throws, nothing confirmed, not settled", async () => {
    const v = `v${++n}`; setup(v);
    state.settings.set(`settingsSyncSecretMarksMobile_${v}`, "garbage-that-throws");
    const origGet = state.settings.get.bind(state.settings);
    state.settings.get = ((k: string) => { if (k.startsWith("settingsSyncSecretMarksMobile_")) throw new Error("store unreadable"); return origGet(k); }) as never;
    let threw = false;
    try { await settleVaultEndpointConfirmations({ vaultId: v, db: {} as never }); } catch { threw = true; }
    state.settings.get = origGet as never;
    const r = { caldav: await isEndpointConfirmedIn(v, "http://192.168.1.10:80"), imap: await isEndpointConfirmedIn(v, "imap://192.168.1.20:993") };
    const settledKey = [...state.settings.keys()].find((k) => k.startsWith("endpointConfirmations_"));
    expect(threw).toBe(true);
    expect(r).toEqual({ caldav: false, imap: false });
    expect(settledKey ? (state.settings.get(settledKey) as { settled?: boolean }).settled : undefined).toBeFalsy();
  });
});
