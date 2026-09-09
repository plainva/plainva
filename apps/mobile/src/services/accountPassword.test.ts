import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginPasswordChange, resumePasswordChange, readPasswordChangeStatus, getPlatformServices, setPlatformServices, type CloudAccountRecord } from "@plainva/ui";
import { listMailAccounts, saveMailAccount, mailSecretKey, setMailPlatform, type MailAccountConfig } from "@plainva/ui/mail";

const state = vi.hoisted(() => ({
  secrets: new Map<string, string>(), settings: new Map<string, unknown>(),
  failKey: "", ackOnly: false, unavailable: false,
  probes: [] as string[], failProbe: "",
  afterProbe: async (_service: string) => {},
  beforeCas: (_key: string) => {},
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true }, registerPlugin: () => ({
  get: async ({key}: {key: string}) => { if (state.unavailable) throw Error("protected storage unavailable"); return {value: state.secrets.get(key) ?? null}; },
  set: async ({key,value}: {key: string; value: string}) => {state.secrets.set(key,value);},
  remove: async ({key}: {key: string}) => {state.secrets.delete(key);},
  compareAndSet: async (args: {key: string; expected: string | null; value: string | null}) => {
    if (state.unavailable) throw Error("protected storage unavailable");
    state.beforeCas(args.key);
    if (args.key === state.failKey) throw Error("simulated storage failure");
    if ((state.secrets.get(args.key) ?? null) !== args.expected) return {changed:false};
    if (!state.ackOnly) {if(args.value === null) state.secrets.delete(args.key); else state.secrets.set(args.key,args.value);}
    return {changed:true};
  },
}) }));
vi.mock("@capacitor/preferences", () => ({Preferences: {get: async () => ({value:null}),remove: async () => {}}}));
vi.mock("../platform/capacitorPlatform", () => ({capacitorCredentialStore: {}}));
vi.mock("./syncService", () => ({
  getStoredProvider: async (id: string) => getPlatformServices().credentials.readSecret(syncProviderSlot(id)),
  stopSyncAndDrain: async () => {}, resumeProvider: async () => {},
}));
vi.mock("./vaultRegistry", () => ({getActiveVaultEntry: async () => ({id:vault})}));
vi.mock("./pim/pimService", () => ({restartPimAccountAfterLogin: vi.fn(), listPimAccounts: async () => []}));
vi.mock("./mail/mailRuntime", () => ({notifyMailChanged: vi.fn()}));
vi.mock("../adapters/webdavHttp", () => ({allowHttpOrigin: () => {},webdavFetch: vi.fn()}));
vi.mock("@plainva/core", async (original) => ({
  ...(await original<typeof import("@plainva/core")>()),
  WebDavSyncTarget: class {async listFolders() {await probe("files"); return []; }},
  CalDavPimTarget: class {async listCalendars() {await probe("calendar"); return [{id:"calendar"}]; }},
}));

import { secureCredentialStore as credentialManager } from "../platform/secureStore";
import { syncProviderSlot } from "./syncSlot";
import { pimSecretKey } from "./pim/pimCredentials";
import { mobilePasswordChangePorts } from "./accountPassword";
const cloudAccountsRegistryKey = (id: string) => "cloudAccounts_"+id;

async function probe(service: string) {
  state.probes.push(service);
  if (state.failProbe === service) throw Error("provider rejected test password");
  await state.afterProbe(service);
}

const vault = "/password-test";
const record: CloudAccountRecord = { id: "suite", family: "fastmail", label: "Account", services: { files: { provider: "webdav" }, calendar: { pimAccountId: "calendar" }, mail: { mailAccountId: "mail" } } };
const filesKey = syncProviderSlot(vault), calendarKey = pimSecretKey(vault, "calendar"), mailKey = mailSecretKey(vault, "mail");
const ports = () => mobilePasswordChangePorts(vault, record);
const read = (key: string) => JSON.parse(state.secrets.get(key)!);
const write = (key: string, value: unknown) => state.secrets.set(key, JSON.stringify(value));
const filePassword = () => read(filesKey).creds.pass;
let previousPlatform: ReturnType<typeof getPlatformServices> | undefined;

beforeEach(async () => {
  try { previousPlatform = getPlatformServices(); } catch { previousPlatform = undefined; }
  state.secrets.clear(); state.settings.clear(); state.probes = []; state.failProbe = "";
  state.failKey = ""; state.ackOnly = false; state.unavailable = false;
  state.afterProbe = async () => {}; state.beforeCas = () => {};
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  setPlatformServices({ ...previousPlatform, credentials: credentialManager, loadSettings: async () => ({
    get: async <T,>(key: string) => structuredClone(state.settings.get(key)) as T | undefined,
    set: async (key: string, value: unknown) => { state.settings.set(key, structuredClone(value)); },
    delete: async (key: string) => state.settings.delete(key), keys: async () => [...state.settings.keys()], save: async () => {},
  }) } as Parameters<typeof setPlatformServices>[0]);
  setMailPlatform({ transport: { checkLogin: async () => { await probe("mail"); return []; } } } as never);
  state.settings.set(cloudAccountsRegistryKey(vault), [structuredClone(record)]);
  write(filesKey, { provider: "webdav", creds: { url: "https://files.example.invalid", user: "user", pass: "old-files" } });
  write(calendarKey, { kind: "caldav", url: "https://calendar.example.invalid", user: "user", pass: "old-calendar" });
  await saveMailAccount(vault, { id: "mail", label: "Before", host: "imap.example.invalid", port: 993, user: "user", signature: "Before" }, "old-mail");
});
afterEach(() => { if (previousPlatform) setPlatformServices(previousPlatform); vi.unstubAllGlobals(); });

describe("password repair through actual account and protected credential slots", () => {
  it("updates all three actual slots even while the calendar vault is closed", async () => {
    await beginPasswordChange(ports(), "new-password");
    expect(state.probes).toEqual(["files", "calendar", "mail"]);
    expect(filePassword()).toBe("new-password");
    expect(read(calendarKey)).toMatchObject({ pass: "new-password", loginRevision: expect.any(String) });
    expect(read(mailKey)).toEqual({ pass: "new-password" });
    expect(await readPasswordChangeStatus(ports())).toBeNull();
  });

  it("resumes the real second and third slots from a new controller after a partial write", async () => {
    state.failKey = calendarKey;
    await expect(beginPasswordChange(ports(), "new-password")).rejects.toThrow();
    expect(filePassword()).toBe("new-password");
    expect(read(calendarKey).pass).toBe("old-calendar");
    expect(await readPasswordChangeStatus(ports())).toMatchObject({ phase: "repair", services: { files: "confirmed" } });
    state.failKey = "";
    await resumePasswordChange(ports());
    expect(read(calendarKey).pass).toBe("new-password");
    expect(read(mailKey).pass).toBe("new-password");
    expect(state.probes).toEqual(["files", "calendar", "mail"]);
  });

  it("a missing calendar credential is not silently skipped", async () => {
    state.secrets.delete(calendarKey);
    await expect(beginPasswordChange(ports(), "new-password")).rejects.toMatchObject({ phase: "missing", service: "calendar" });
    expect(filePassword()).toBe("old-files");
    expect(read(mailKey).pass).toBe("old-mail");
  });

  it("verifies every endpoint before writing any credential", async () => {
    state.failProbe = "mail";
    await expect(beginPasswordChange(ports(), "new-password")).rejects.toMatchObject({ phase: "verification", service: "mail" });
    expect(filePassword()).toBe("old-files");
    expect(read(calendarKey).pass).toBe("old-calendar");
    expect(await readPasswordChangeStatus(ports())).toBeNull();
  });

  it("keeps mail metadata edited while its password is being checked", async () => {
    state.afterProbe = async (service) => {
      if (service !== "mail") return;
      const account = (await listMailAccounts(vault))[0];
      await saveMailAccount(vault, { ...account, label: "Renamed", signature: "New signature" }, "old-mail");
    };
    await beginPasswordChange(ports(), "new-password");
    expect((await listMailAccounts(vault))[0]).toMatchObject({ label: "Renamed", signature: "New signature" });
    expect(read(mailKey)).toEqual({ pass: "new-password" });
  });

  it("does not apply a verified password to an endpoint edited during verification", async () => {
    state.afterProbe = async (service) => {
      if (service !== "mail") return;
      const account: MailAccountConfig = (await listMailAccounts(vault))[0];
      await saveMailAccount(vault, { ...account, host: "other.example.invalid" }, "independent");
    };
    await expect(beginPasswordChange(ports(), "new-password")).rejects.toMatchObject({ phase: "changed", service: "mail" });
    expect(filePassword()).toBe("old-files");
    expect(read(mailKey).pass).toBe("independent");
  });

  it("native CAS preserves a password saved by another window immediately before the write", async () => {
    state.beforeCas = (key) => { if (key === calendarKey) write(key, { ...read(key), pass: "independent" }); };
    await expect(beginPasswordChange(ports(), "new-password")).rejects.toMatchObject({ phase: "changed", service: "calendar" });
    expect(filePassword()).toBe("new-password");
    expect(read(calendarKey).pass).toBe("independent");
  });

  it("requires protected journal storage and a read-back acknowledgement", async () => {
    state.ackOnly = true;
    await expect(beginPasswordChange(ports(), "new-password")).rejects.toMatchObject({ phase: "storage" });
    expect(filePassword()).toBe("old-files");
    state.ackOnly = false; state.unavailable = true;
    await expect(beginPasswordChange(ports(), "new-password")).rejects.toMatchObject({ phase: "storage" });
    expect(filePassword()).toBe("old-files");
  });
});
