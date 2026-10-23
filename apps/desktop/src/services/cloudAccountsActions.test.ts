import { describe, it, expect, vi, beforeEach } from "vitest";
import { keychainSlotName, oauthScopeFor, type CloudAccountRecord } from "@plainva/ui";

/**
 * Regression net for the orchestration layer (control pass 2026-07-20,
 * finding #4): bindConnectResult must upsert the SAME record across a
 * retry — the registry/store pair is mocked in-memory, everything else
 * (reconcile) runs for real inside refreshCloudAccounts's replacement.
 */

const registry = new Map<string, CloudAccountRecord[]>();
/** When set, the registry answers like the desktop store: keys sorted (serde). */
const storeOrder = vi.hoisted(() => ({ serde: false }));

vi.mock("./cloudAccounts", async () => {
  const { serdeOrdered } = await import("../test-serdeStore");
  return {
  CLOUD_ACCOUNTS_EVENT: "plainva-cloud-accounts-changed",
  loadCloudAccounts: vi.fn(async (vaultPath: string) => {
    const records = registry.get(vaultPath) ?? [];
    return storeOrder.serde ? serdeOrdered(records) : records;
  }),
  saveCloudAccounts: vi.fn(async (vaultPath: string, records: CloudAccountRecord[]) => {
    registry.set(vaultPath, records);
  }),
  refreshCloudAccounts: vi.fn(async (vaultPath: string) => registry.get(vaultPath) ?? []),
  };
});

/** In-memory keychain so the password rotation can be observed slot by slot. */
const slots = new Map<string, unknown>();
/** Endpoints that reject the new password — drives the failure scenarios. */
const reject = new Set<string>();
vi.mock("./accountCredentialStore", () => {
  const name = (key: string) => key.includes(" · Calendar · ") ? "pim" : key.match(/ · Files · (\w+) · /)?.[1] ?? key;
  return { accountCredentialStore: {
    read: async (key: string) => slots.has(name(key)) ? JSON.stringify(slots.get(name(key))) : null,
    compareAndSet: async (key: string, expected: string | null, next: string | null) => {
      const k = name(key);
      if ((slots.has(k) ? JSON.stringify(slots.get(k)) : null) !== expected) return false;
      if (next === null) slots.delete(k); else slots.set(k, JSON.parse(next));
      return true;
    },
  } };
});

vi.mock("./protectedSecrets", () => ({ protectedSecrets: {
  read: async (key: string) => {
    const source = key.includes(" · Files · webdav · ") ? "webdav" : key.includes(" · Calendar · P · ") ? "pim" : key;
    return slots.has(source) ? JSON.stringify(slots.get(source)) : null;
  },
  compareAndSet: async (key: string, expected: string | null, next: string | null) => {
    const source = key.includes(" · Files · webdav · ") ? "webdav" : key.includes(" · Calendar · P · ") ? "pim" : key;
    if (source === "pim" && reject.has("caldav-write")) throw new Error("caldav write failed");
    if ((slots.has(source) ? JSON.stringify(slots.get(source)) : null) !== expected) return false;
    if (next === null) slots.delete(source); else slots.set(source, JSON.parse(next));
    return true;
  },
} }));

vi.mock("./CredentialManager", () => ({
  credentialManager: {
    readSecret: vi.fn(async (key: string) => slots.get(key) ?? null),
    writeSecret: vi.fn(async (key: string, value: unknown) => {
      slots.set(key, value);
    }),
    removeSecret: vi.fn(async (key: string) => {
      slots.delete(key);
    }),
    getWebDavCredentials: vi.fn(async () => slots.get("webdav") ?? null),
    getDriveCredentials: vi.fn(async () => slots.get("drive") ?? null),
    getOneDriveCredentials: vi.fn(async () => slots.get("onedrive") ?? null),
    getDropboxCredentials: vi.fn(async () => slots.get("dropbox") ?? null),
    getS3Credentials: vi.fn(async () => slots.get("s3") ?? null),
    saveOneDriveCredentials: vi.fn(async (_v: string, creds: unknown) => {
      slots.set("onedrive", creds);
    }),
    saveDriveCredentials: vi.fn(async (_v: string, creds: unknown) => {
      slots.set("drive", creds);
    }),
    clearWebDavCredentials: vi.fn(async () => undefined),
    clearDriveCredentials: vi.fn(async () => undefined),
    clearOneDriveCredentials: vi.fn(async () => undefined),
    clearDropboxCredentials: vi.fn(async () => undefined),
    clearS3Credentials: vi.fn(async () => undefined),
    saveWebDavCredentials: vi.fn(async (_v: string, creds: unknown) => {
      if (reject.has("webdav-write")) throw new Error("webdav write failed");
      slots.set("webdav", creds);
    }),
  },
}));
vi.mock("./mail/mailAccounts", () => ({ listMailAccounts: vi.fn(async () => []), mailAccountKind: () => "imap" }));
vi.mock("./mail/graphMail", () => ({}));
// The mail module is the real one; only the question a connect asks Graph for
// the new mailbox's address is answered here.
vi.mock("@plainva/ui/mail", async (original) => ({
  ...(await original<typeof import("@plainva/ui/mail")>()),
  graphMailAddress: vi.fn(async () => "marco@outlook.com"),
}));

vi.mock("./syncTargets", () => ({
  buildWebDavTarget: vi.fn((creds: { pass: string }) => ({
    listFolders: async () => {
      if (reject.has("webdav")) throw new Error("webdav login failed");
      return [creds.pass];
    },
  })),
  buildS3Target: vi.fn(),
  buildDriveTarget: vi.fn(),
  buildOneDriveTarget: vi.fn(),
  buildDropboxTarget: vi.fn(),
}));

/** Records every OAuth consent so the union run can be counted. */
const consents: { scope?: string; via: string; clientId?: string }[] = [];
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn(async (url: string) => new Response(JSON.stringify(
  url.includes("googleapis.com") ? { sub: "google-person", email: "person@example.invalid", email_verified: true } : { id: "microsoft-person", mail: "marco@outlook.com" },
))) }));

vi.mock("./pim/pimAccounts", () => ({
  checkCalDavLogin: vi.fn(async () => {
    if (reject.has("caldav")) throw new Error("caldav login failed");
  }),
  connectCalDavAccount: vi.fn(),
  connectGoogleAccount: vi.fn(async (_r: unknown, _v: string, opts: { refreshToken?: string }) => {
    // Without a handed-down token this would run its own browser consent.
    if (!opts.refreshToken) consents.push({ via: "pim" });
    return { id: "P", label: "marco@gmail.com" };
  }),
  connectMicrosoftAccount: vi.fn(async () => ({ id: "P", label: "marco@outlook.com" })),
  removePimAccount: vi.fn(),
}));

vi.mock("./driveAuth", () => ({
  authorizeDrive: vi.fn(async (opts: { clientId: string; clientSecret: string; scope?: string }) => {
    consents.push({ scope: opts.scope, via: "drive", clientId: opts.clientId });
    return { clientId: opts.clientId, clientSecret: opts.clientSecret, refreshToken: "RT", accessToken: "google-access", grantedScope: opts.scope ?? oauthScopeFor("google", "files")! };
  }),
}));
vi.mock("./oneDriveAuth", () => ({
  authorizeOneDrive: vi.fn(async (opts: { clientId: string; scope?: string }) => {
    consents.push({ scope: opts.scope, via: "onedrive" });
    return { clientId: opts.clientId, refreshToken: "MS-RT", accessToken: "microsoft-access" };
  }),
}));

/** Account-wide token slot, so the union path can be observed. */
const accountTokens = new Map<string, unknown>();
vi.mock("./accountBroker", () => ({
  microsoftUnionScope: (a: string[]) => a.map((x) => oauthScopeFor("microsoft", x)).join(" "),
  saveAccountToken: vi.fn(async (_v: string, id: string, token: unknown) => {
    accountTokens.set(id, token);
  }),
  clearAccountToken: vi.fn(async (_v: string, id: string) => {
    accountTokens.delete(id);
  }),
  setPendingBrokerAccount: vi.fn(),
  claimPendingMailbox: vi.fn(),
  fileBrokerTokenProvider: vi.fn(async () => async () => "access"),
  getAccountToken: vi.fn(async (_v: string, id: string) => accountTokens.get(id) ?? null),
  getAccountBroker: vi.fn(() => ({ getAccessToken: vi.fn(async () => "verified-access") })),
  brokerFamily: (family: string) => (family === "microsoft" || family === "google" ? family : null),
  googleScopeFor: (a: string) => oauthScopeFor("google", a),
}));
vi.mock("./dropboxAuth", () => ({ authorizeDropbox: vi.fn() }));

vi.mock("./pim/pimCredentials", () => ({
  pimSecretKey: (vault: string, id: string) => keychainSlotName({ vaultKey: vault, service: "calendar", account: id }),
  getPimCredentials: vi.fn(async () => slots.get("pim") ?? null),
  savePimCredentials: vi.fn(async (_v: string, _id: string, creds: unknown) => {
    if (reject.has("caldav-write")) throw new Error("caldav write failed");
    slots.set("pim", creds);
  }),
}));
vi.mock("./settingsStore", () => ({ getSettingsStore: vi.fn(async () => ({ get: async () => null, set: async () => undefined, save: async () => undefined })) }));

import i18n from "@plainva/ui/i18n";
import { fileBrokerTokenProvider } from "./accountBroker";
import { buildDriveTarget, buildOneDriveTarget } from "./syncTargets";
import {
  announceCredentials,
  holdCredentialsAnnouncements,
  bindConnectResult,
  listSyncFoldersFromSlots,
  passwordServicesOf,
  updateAccountPassword,
} from "./cloudAccountsActions";
import type { PimRuntime } from "./pim/pimRuntime";

describe("bindConnectResult", () => {
  beforeEach(() => {
    registry.clear();
    storeOrder.serde = false;
  });

  /**
   * The desktop store returns `{ calendar, files }` for a written
   * `{ files, calendar }`. The check after saving compared JSON text, so every
   * files + calendar binding — Drive + calendar, OneDrive + calendar, WebDAV +
   * CalDAV — failed with "storageFailed", and the calendar was never switched
   * on (finding 2026-09-24).
   */
  it.each([
    ["google", "drive"],
    ["microsoft", "onedrive"],
    ["webdav", "webdav"],
  ] as const)("binds files + calendar of a %s account against the desktop's key order", async (family, provider) => {
    storeOrder.serde = true;
    const upsertAccount = vi.fn(async () => undefined);
    const runtime = {
      isActive: () => true,
      cache: { listAccounts: async () => [{ id: "P", provider: "caldav", label: "", config: {}, enabled: false }], upsertAccount, setScopeState: vi.fn() },
      worker: { start: vi.fn(), triggerImmediate: vi.fn() },
    } as unknown as PimRuntime;
    const { records } = await bindConnectResult(
      "/v",
      runtime,
      { family, services: ["files", "calendar"] },
      { filesProvider: provider, pimAccountId: "P", identity: "m.muster@example.invalid" },
    );
    expect(records).toHaveLength(1);
    expect(records[0].services).toEqual({ files: { provider }, calendar: { pimAccountId: "P" } });
    // The calendar is switched on — the step the failed check used to skip.
    expect(upsertAccount).toHaveBeenCalledWith(expect.objectContaining({ id: "P", enabled: true }));
  });

  it("adds files to an existing calendar + mail account against the desktop's key order", async () => {
    storeOrder.serde = true;
    registry.set("/v", [{ id: "card", family: "google", label: "m@gmail.com", services: { calendar: { pimAccountId: "P" }, mail: { mailAccountId: "M" } } }]);
    const { records } = await bindConnectResult(
      "/v",
      null,
      { family: "google", services: ["files"] },
      { filesProvider: "drive", identity: "m@gmail.com" },
      "card",
    );
    expect(records.find((r) => r.id === "card")?.services).toEqual({ calendar: { pimAccountId: "P" }, mail: { mailAccountId: "M" }, files: { provider: "drive" } });
  });

  it("a retry binds into the SAME account record instead of minting a duplicate", async () => {
    // First attempt: calendar connected, mail failed → partial bind.
    const first = await bindConnectResult(
      "/v",
      null,
      { family: "microsoft", services: ["calendar", "mail"] },
      { pimAccountId: "P", identity: "marco@outlook.com" }
    );
    expect(first.records).toHaveLength(1);
    expect(first.accountId).toBe(first.records[0].id);

    // Retry: mail now succeeds; the wizard passes the id of the first bind.
    const second = await bindConnectResult(
      "/v",
      null,
      { family: "microsoft", services: ["calendar", "mail"] },
      { pimAccountId: "P", mailAccountId: "M", identity: "marco@outlook.com" },
      first.accountId
    );
    expect(second.accountId).toBe(first.accountId);
    expect(second.records).toHaveLength(1);
    expect(second.records[0].services).toEqual({
      calendar: { pimAccountId: "P" },
      mail: { mailAccountId: "M" },
    });
  });

  /**
   * The marker tells the broker where a just-minted token lives while the
   * registry record is still being written. Left standing afterwards, it makes
   * EVERY service of the vault draw that account's token — which is how adding
   * an Outlook account broke the Google calendar with a 401 until the Outlook
   * account was deleted again (finding 2026-07-30).
   */
  it("a fresh files bind strips the files reference from every other record", async () => {
    registry.set("/v", [
      { id: "old", family: "dropbox", label: "", services: { files: { provider: "dropbox" } } },
    ]);
    const { records } = await bindConnectResult(
      "/v",
      null,
      { family: "webdav", flavor: "nextcloud", services: ["files"] },
      { filesProvider: "webdav", identity: "marco@cloud.example.org" }
    );
    const old = records.find((r) => r.id === "old");
    expect(old?.services.files).toBeUndefined();
    expect(records.find((r) => r.family === "webdav")?.services.files).toEqual({ provider: "webdav" });
  });
});

/**
 * Stage B / B1: one password change reaches every password-backed service of
 * the account. The ordering guarantee is the point — a half-updated account
 * (files reachable, calendar locked out) is exactly what must not happen.
 */
describe("account password rotation", () => {
  const nextcloud: CloudAccountRecord = {
    id: "A",
    family: "webdav",
    flavor: "nextcloud",
    label: "marco@cloud.example.org",
    services: { files: { provider: "webdav" }, calendar: { pimAccountId: "P" } },
  };
  const runtime = { isActive: () => true, cache: { setScopeState: vi.fn() }, worker: { start: vi.fn(), triggerImmediate: vi.fn() } } as unknown as PimRuntime;

  beforeEach(() => {
    // The success path announces the credential change to the app shell.
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    slots.clear();
    reject.clear();
    registry.set("/v", [nextcloud]);
    slots.set("webdav", { url: "https://cloud.example.org/dav", user: "marco", pass: "old" });
    slots.set("pim", { kind: "caldav", url: "https://cloud.example.org/caldav", user: "marco", pass: "old" });
  });

  it("classifies which services carry a password", () => {
    expect(passwordServicesOf(nextcloud)).toEqual(["files", "calendar"]);
    // Drive and Google calendar are OAuth; Gmail deliberately stays IMAP.
    expect(
      passwordServicesOf({
        id: "G",
        family: "google",
        label: "",
        services: { files: { provider: "drive" }, calendar: { pimAccountId: "P" }, mail: { mailAccountId: "M" } },
      })
    ).toEqual(["mail"]);
    // Microsoft is OAuth end to end.
    expect(
      passwordServicesOf({
        id: "M",
        family: "microsoft",
        label: "",
        services: { files: { provider: "onedrive" }, calendar: { pimAccountId: "P" }, mail: { mailAccountId: "M" } },
      })
    ).toEqual([]);
  });

  it("writes the new password to every service once all of them verified", async () => {
    const seen: string[] = [];
    await updateAccountPassword("/v", runtime, nextcloud, "new", (service, st) => seen.push(`${service}:${st.state}`));
    expect(slots.get("webdav")).toMatchObject({ pass: "new" });
    expect(slots.get("pim")).toMatchObject({ pass: "new", kind: "caldav" });
    expect(seen).toEqual(["files:pending", "calendar:pending", "files:ok", "calendar:ok"]);
  });

  it("writes NOTHING when a single service rejects the password", async () => {
    reject.add("caldav");
    await expect(updateAccountPassword("/v", runtime, nextcloud, "new", () => {})).rejects.toMatchObject({ phase: "verification", service: "calendar" });
    expect(slots.get("webdav")).toMatchObject({ pass: "old" });
    expect(slots.get("pim")).toMatchObject({ pass: "old" });
  });

  it("keeps an already confirmed slot and a resumable journal when a later write fails", async () => {
    reject.add("caldav-write");
    await expect(updateAccountPassword("/v", runtime, nextcloud, "new", () => {})).rejects.toMatchObject({ phase: "storage", service: "calendar" });
    expect(slots.get("webdav")).toMatchObject({ pass: "new" });
    expect(slots.get("pim")).toMatchObject({ pass: "old" });
    expect([...slots.values()].some((value) => (value as { version?: number }).version === 1)).toBe(true);
  });
});

/**
 * Stage B / B2: Google consents per ACCOUNT, so files + calendar together must
 * cost ONE browser round trip carrying the union of both scopes — and ticking
 * one service alone must never widen that scope.
 */
describe("listSyncFoldersFromSlots", () => {
  /**
   * The folder picker was the last place still assuming the pre-stage-B world:
   * it demanded the per-service refresh token, which a union-consent account
   * deliberately leaves EMPTY. A reconnected Drive vault could therefore not
   * set its cloud folder at all — the field is read-only, so the picker is the
   * only way in (finding 2026-08-19).
   */
  beforeEach(() => {
    slots.clear();
    vi.mocked(fileBrokerTokenProvider).mockReset();
    vi.mocked(buildDriveTarget).mockReset();
    vi.mocked(buildOneDriveTarget).mockReset();
  });

  it("browses a broker-backed Drive account although its own slot holds no token", async () => {
    slots.set("drive", { clientId: "cid", clientSecret: "sec", refreshToken: "" });
    vi.mocked(fileBrokerTokenProvider).mockResolvedValue(async () => "AT");
    vi.mocked(buildDriveTarget).mockReturnValue({
      listFolders: async () => ["Notizen"],
    } as unknown as ReturnType<typeof buildDriveTarget>);

    await expect(listSyncFoldersFromSlots("/v", "drive", "")).resolves.toEqual(["Notizen"]);
    // The provider must REACH the target: without it the target would try to
    // refresh on its own with an empty token and fail on the first request.
    expect(typeof vi.mocked(buildDriveTarget).mock.calls[0][1]).toBe("function");
  });

  it("hands the rotation to the broker instead of persisting it twice (OneDrive)", async () => {
    slots.set("onedrive", { clientId: "cid", refreshToken: "" });
    vi.mocked(fileBrokerTokenProvider).mockResolvedValue(async () => "AT");
    vi.mocked(buildOneDriveTarget).mockReturnValue({
      listFolders: async () => ["Vault"],
    } as unknown as ReturnType<typeof buildOneDriveTarget>);

    await expect(listSyncFoldersFromSlots("/v", "onedrive", "")).resolves.toEqual(["Vault"]);
    const [, onRotate, provider] = vi.mocked(buildOneDriveTarget).mock.calls[0];
    expect(onRotate).toBeUndefined(); // the account owns the refresh token
    expect(typeof provider).toBe("function");
  });

  it("asks for a sign-in when neither the slot nor the broker carries file access", async () => {
    slots.set("drive", { clientId: "cid", clientSecret: "sec", refreshToken: "" });
    vi.mocked(fileBrokerTokenProvider).mockResolvedValue(undefined);

    // Not the bare "not connected" of old: the sentence has to say that a
    // sign-in is missing, because that is what the person has to do.
    await expect(listSyncFoldersFromSlots("/v", "drive", "")).rejects.toThrow(
      i18n.t("settings.pickerNoFileAccess")
    );
  });
});


describe("shared sign-in repair offer", () => {
  it("keeps incomplete account grants repairable and excludes Gmail", async () => {
    const { canUnifyAccountLogin } = await import("./cloudAccountsActions");
    // The mailbox list is read through the platform's settings: an empty one
    // here (the old Gmail-only tests used to leave theirs behind).
    const { setPlatformServices } = await import("@plainva/ui");
    setPlatformServices({
      openExternal: async () => {},
      loadSettings: async () => ({ get: async () => undefined, set: async () => {}, delete: async () => false, keys: async () => [], save: async () => {} }),
      credentials: { readSecret: async () => null, writeSecret: async () => {}, removeSecret: async () => {} },
    } as never);
    const record: CloudAccountRecord = { id: "repair-offer", label: "Person", family: "google", services: { files: { provider: "drive" }, calendar: { pimAccountId: "cal" }, mail: { mailAccountId: "gmail" } } };
    const token = { clientId: "cid", refreshToken: "old", scopes: oauthScopeFor("google", "files")! };
    accountTokens.set(record.id, token);
    expect(await canUnifyAccountLogin("vault", record)).toBe(true);
    accountTokens.set(record.id, { ...token, scopes: token.scopes + " " + oauthScopeFor("google", "calendar") });
    expect(await canUnifyAccountLogin("vault", record)).toBe(false);
    expect(await canUnifyAccountLogin("vault", { ...record, services: { calendar: record.services.calendar, mail: record.services.mail } })).toBe(false);
  });
});

describe("held credential announcements", () => {
  // The wizard and an account's detail show a sign-in's result service by
  // service; the vault reload that new sync credentials trigger used to put
  // the settings back on the account list before the result was ever seen
  // (finding 2026-10-23). While such a surface is open the announcement waits.
  const heard: boolean[] = [];
  const listener = (event: Event) => heard.push(!!(event as CustomEvent<{ isNewConnection: boolean }>).detail.isNewConnection);
  beforeEach(() => {
    heard.length = 0;
    // The unit environment has no window; an event target stands in for it.
    const target = new EventTarget();
    target.addEventListener("plainva-credentials-saved", listener);
    vi.stubGlobal("window", target);
    return () => vi.unstubAllGlobals();
  });

  it("sends at once without a hold", () => {
    announceCredentials(false);
    expect(heard).toEqual([false]);
  });

  it("sends once, when the last hold is released, and remembers a new connection", () => {
    const outer = holdCredentialsAnnouncements();
    const inner = holdCredentialsAnnouncements();
    announceCredentials(true);
    announceCredentials(false);
    expect(heard).toEqual([]);
    inner();
    expect(heard).toEqual([]);
    outer();
    expect(heard).toEqual([true]);
    // A release called twice (an effect cleanup run again) changes nothing.
    outer();
    announceCredentials(false);
    expect(heard).toEqual([true, false]);
  });

  it("sends nothing on release when nothing was announced", () => {
    holdCredentialsAnnouncements()();
    expect(heard).toEqual([]);
  });
});
