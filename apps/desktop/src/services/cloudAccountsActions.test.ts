import { describe, it, expect, vi, beforeEach } from "vitest";
import { keychainSlotName, oauthScopeFor, type CloudAccountRecord } from "@plainva/ui";

/**
 * Regression net for the orchestration layer (control pass 2026-07-20,
 * finding #4): bindConnectResult must upsert the SAME record across a
 * retry — the registry/store pair is mocked in-memory, everything else
 * (reconcile) runs for real inside refreshCloudAccounts's replacement.
 */

const registry = new Map<string, CloudAccountRecord[]>();

vi.mock("./cloudAccounts", () => ({
  CLOUD_ACCOUNTS_EVENT: "plainva-cloud-accounts-changed",
  loadCloudAccounts: vi.fn(async (vaultPath: string) => registry.get(vaultPath) ?? []),
  saveCloudAccounts: vi.fn(async (vaultPath: string, records: CloudAccountRecord[]) => {
    registry.set(vaultPath, records);
  }),
  refreshCloudAccounts: vi.fn(async (vaultPath: string) => registry.get(vaultPath) ?? []),
}));

/** In-memory keychain so the password rotation can be observed slot by slot. */
const slots = new Map<string, unknown>();
/** Endpoints that reject the new password — drives the failure scenarios. */
const reject = new Set<string>();

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
    return { clientId: opts.clientId, clientSecret: opts.clientSecret, refreshToken: "RT", grantedScope: opts.scope ?? oauthScopeFor("google", "files")! };
  }),
}));
vi.mock("./oneDriveAuth", () => ({
  authorizeOneDrive: vi.fn(async (opts: { clientId: string; scope?: string }) => {
    consents.push({ scope: opts.scope, via: "onedrive" });
    return { clientId: opts.clientId, refreshToken: "MS-RT" };
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
  fileBrokerTokenProvider: vi.fn(async () => async () => "access"),
  getAccountToken: vi.fn(async (_v: string, id: string) => accountTokens.get(id) ?? null),
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
import { fileBrokerTokenProvider, setPendingBrokerAccount } from "./accountBroker";
import { buildDriveTarget, buildOneDriveTarget } from "./syncTargets";
import {
  bindConnectResult,
  listSyncFoldersFromSlots,
  passwordServicesOf,
  runConnectSequence,
  rerunAccountAuth,
  unifyAccountLogin,
  updateAccountPassword,
} from "./cloudAccountsActions";
import type { PimRuntime } from "./pim/pimRuntime";

describe("bindConnectResult", () => {
  beforeEach(() => registry.clear());

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
  it("clears the pending marker once the binding is written", async () => {
    accountTokens.set("minted", { clientId: "c", refreshToken: "RT" });
    vi.mocked(setPendingBrokerAccount).mockClear();
    await bindConnectResult(
      "/v",
      null,
      { family: "microsoft", services: ["calendar"] },
      { pimAccountId: "P", accountId: "minted", identity: "marco@outlook.com" },
      "card1"
    );
    const calls = vi.mocked(setPendingBrokerAccount).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1][0]).toBeNull();
  });

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
describe("Google union consent", () => {
  const runtime = { isActive: () => true, cache: { listAccounts: async () => [], setScopeState: vi.fn(), upsertAccount: vi.fn() }, worker: { start: vi.fn(), triggerImmediate: vi.fn() } } as unknown as PimRuntime;

  beforeEach(() => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    consents.length = 0;
    slots.clear();
    registry.clear();
  });

  it("asks once for files + calendar, with both scopes in one consent", async () => {
    const result = await runConnectSequence(
      "/v",
      runtime,
      { family: "google", services: ["files", "calendar"], byoClientId: "cid", googleClientSecret: "sec" },
      () => {}
    );
    expect(consents).toHaveLength(1);
    expect(consents[0].via).toBe("drive");
    expect(consents[0].scope).toContain("auth/drive");
    expect(consents[0].scope).toContain("auth/calendar");
    expect(consents[0].scope).toContain("auth/tasks");
    // Both services ended up on the same token — and that token now lives in
    // ONE place. It used to be copied into every service slot, on the reasoning
    // that Google tokens do not rotate; they do not, but the copies still
    // drifted, because renewing a service wrote its own slot and left the
    // others holding a dead token (finding 2026-07-28).
    expect(result.filesProvider).toBe("drive");
    expect(result.pimAccountId).toBe("P");
    expect(result.accountId).toBeTruthy();
    expect(accountTokens.get(result.accountId!)).toMatchObject({ refreshToken: "RT", clientSecret: "sec" });
    expect(slots.get("drive")).toMatchObject({ refreshToken: "" });
  });

  it("keeps the scope narrow when only files is selected", async () => {
    await runConnectSequence(
      "/v",
      runtime,
      { family: "google", services: ["files"], byoClientId: "cid", googleClientSecret: "sec" },
      () => {}
    );
    expect(consents).toHaveLength(1);
    // No union: the per-service flow runs with its own default scope.
    expect(consents[0].scope).toBeUndefined();
  });

  it("does not pull Drive scopes in when only the calendar is selected", async () => {
    await runConnectSequence(
      "/v",
      runtime,
      { family: "google", services: ["calendar"], byoClientId: "cid", googleClientSecret: "sec" },
      () => {}
    );
    // The calendar flow ran its own consent; no Drive scope was requested.
    expect(consents).toEqual([{ via: "pim" }]);
  });

  it("re-authenticates from the local account slot, not the registry client copy", async () => {
    const record: CloudAccountRecord = {
      id: "google-card",
      family: "google",
      label: "person@example.invalid",
      byoClientId: "foreign-profile-client",
      services: {
        files: { provider: "drive" },
        calendar: { pimAccountId: "P" },
      },
    };
    accountTokens.set(record.id, {
      clientId: "desktop-local-client",
      clientSecret: "desktop-local-secret",
      refreshToken: "desktop-local-refresh",
      scopes: "old",
    });
    slots.set("drive", {
      clientId: "other-slot-client",
      clientSecret: "other-slot-secret",
      refreshToken: "",
    });

    registry.set("/v", [record]);
    await expect(unifyAccountLogin("/v", null, record, () => undefined)).rejects.toThrow(i18n.t("cloudAccounts.loginBindingChanged"));

    expect(consents[0]).toMatchObject({ via: "drive", clientId: "desktop-local-client" });
    expect(accountTokens.get(record.id)).toMatchObject({
      clientId: "desktop-local-client",
      clientSecret: "desktop-local-secret",
      refreshToken: "desktop-local-refresh",
    });
  });
});

/**
 * Stage B / B3: Microsoft consents per account too, but its refresh token
 * ROTATES — so the union token must land in the ACCOUNT slot and never be
 * copied into the per-service slots, or the first refresh would invalidate
 * the copies of the other two services.
 */
describe("Microsoft union consent", () => {
  const runtime = { isActive: () => true, cache: { listAccounts: async () => [], setScopeState: vi.fn(), upsertAccount: vi.fn() }, worker: { start: vi.fn(), triggerImmediate: vi.fn() } } as unknown as PimRuntime;

  beforeEach(() => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    consents.length = 0;
    slots.clear();
    accountTokens.clear();
    registry.clear();
  });

  it("asks once and puts the token in the account slot, not in the service slots", async () => {
    const result = await runConnectSequence(
      "/v",
      runtime,
      { family: "microsoft", services: ["files", "calendar"] },
      () => {}
    );
    expect(consents).toHaveLength(1);
    expect(consents[0].scope).toContain("Files.ReadWrite");
    expect(consents[0].scope).toContain("Calendars.ReadWrite");

    // Account slot holds the single rotating token...
    expect(result.accountId).toBeTruthy();
    expect(accountTokens.get(result.accountId!)).toMatchObject({ refreshToken: "MS-RT" });
    // ...and the file sync slot deliberately holds none.
    expect(slots.get("drive")).toBeUndefined();
  });

  it("hands the minted account id to the registry record", async () => {
    const result = await runConnectSequence(
      "/v",
      runtime,
      { family: "microsoft", services: ["files", "calendar"] },
      () => {}
    );
    const { records, accountId } = await bindConnectResult(
      "/v",
      runtime,
      { family: "microsoft", services: ["files", "calendar"] },
      result
    );
    // Without this the account slot would belong to no account record.
    expect(accountId).toBe(result.accountId);
    expect(records.find((r) => r.id === accountId)).toBeTruthy();
  });

  it("leaves a single-service connect on its own per-service consent", async () => {
    await runConnectSequence("/v", runtime, { family: "microsoft", services: ["calendar"] }, () => {});
    // No union run: nothing was written to an account slot.
    expect(accountTokens.size).toBe(0);
  });
});

describe("re-authorising an existing card (finding 2026-07-30)", () => {
  beforeEach(() => {
    registry.clear();
    accountTokens.clear();
  });

  it("moves the freshly consented token onto the card it was granted for", async () => {
    // The card as it exists today, with a sign-in that has gone bad.
    const first = await bindConnectResult(
      "/v",
      null,
      { family: "google", services: ["calendar"] },
      { pimAccountId: "P", identity: "marco@gmail.com" }
    );
    const cardId = first.accountId;
    accountTokens.set(cardId, { clientId: "c", refreshToken: "DEAD" });

    // "Konto verwalten → neu anmelden": the union consent mints its own id and
    // writes the fresh token under it, then binds to the EXISTING card.
    accountTokens.set("minted-2", { clientId: "c", refreshToken: "FRESH" });
    await bindConnectResult(
      "/v",
      null,
      { family: "google", services: ["calendar"] },
      { accountId: "minted-2", pimAccountId: "P", identity: "marco@gmail.com" },
      cardId
    );

    // The card now holds the fresh sign-in — without this the new token
    // belonged to no account and the card kept reading the dead one, so
    // signing in again changed nothing at all.
    expect(accountTokens.get(cardId)).toMatchObject({ refreshToken: "FRESH" });
    // ...and no orphan is left behind to be picked up later.
    expect(accountTokens.has("minted-2")).toBe(false);
  });

  it("leaves a first-time connect alone: the minted id IS the card", async () => {
    accountTokens.set("minted-1", { clientId: "c", refreshToken: "FRESH" });
    const bound = await bindConnectResult(
      "/v",
      null,
      { family: "google", services: ["calendar"] },
      { accountId: "minted-1", pimAccountId: "P", identity: "neu@gmail.com" }
    );
    expect(bound.accountId).toBe("minted-1");
    expect(accountTokens.get("minted-1")).toMatchObject({ refreshToken: "FRESH" });
  });
});

describe("repairing one service keeps the others (finding 2026-07-30)", () => {
  const runtime = { isActive: () => true, cache: { listAccounts: async () => [], setScopeState: vi.fn(), upsertAccount: vi.fn() }, worker: { start: vi.fn(), triggerImmediate: vi.fn() } } as unknown as PimRuntime;
  beforeEach(() => {
    registry.clear();
    consents.length = 0;
  });

  it("consents for the whole card while connecting only the repaired service", async () => {
    // Google and Microsoft share ONE account token. Asking only for the
    // calendar would hand back a token that covers only the calendar — and
    // silently take Drive's access away. That is the most likely way an
    // account slot ends up Drive-only, which is what the 401 on calendarList
    // looked like from the outside.
    await runConnectSequence(
      "/v",
      runtime,
      {
        family: "google",
        services: ["calendar"],
        consentServices: ["files", "calendar"],
        byoClientId: "cid",
        googleClientSecret: "sec",
      },
      () => undefined
    );
    expect(consents[0].scope).toContain("auth/calendar");
    expect(consents[0].scope).toContain("auth/drive");
  });

  it("without the wider consent the account token is never even written", async () => {
    // The old shape of a single-service repair: no union consent at all, so
    // the calendar took the per-service path and the shared account slot kept
    // whatever it held — which is how a Drive-only token survives a calendar
    // sign-in.
    await runConnectSequence(
      "/v",
      runtime,
      { family: "google", services: ["calendar"], byoClientId: "cid", googleClientSecret: "sec" },
      () => undefined
    );
    expect(consents).toEqual([{ via: "pim" }]);
  });
});

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


describe("Google reconnect preserves the actual mailbox password", () => {
  beforeEach(() => reject.clear());
  it("does not clear or report an OAuth success for the independent IMAP mailbox", async () => {
    const { getPlatformServices, hasPlatformServices, setPlatformServices } = await import("@plainva/ui");
    const { saveMailAccount, getMailPassword, mailSecretKey } = await import("@plainva/ui/mail");
    const platform = hasPlatformServices() ? getPlatformServices() : undefined;
    const metadata = new Map<string, unknown>();
    const actualSecrets = new Map<string, unknown>();
    setPlatformServices({ ...platform, openExternal: async () => {},
      loadSettings: async () => ({
        get: async <T,>(key: string) => metadata.get(key) as T | undefined,
        set: async (key: string, value: unknown) => { metadata.set(key, value); },
        delete: async (key: string) => metadata.delete(key), keys: async () => [...metadata.keys()], save: async () => {},
      }),
      credentials: {
        readSecret: async <T,>(key: string) => (actualSecrets.get(key) as T) ?? null,
        writeSecret: async <T,>(key: string, value: T) => { actualSecrets.set(key, value); },
        removeSecret: async (key: string) => { actualSecrets.delete(key); },
      },
    });
    try {
      const card: CloudAccountRecord = { id: "google-gmail", family: "google", label: "Person",
        services: { calendar: { pimAccountId: "P" }, mail: { mailAccountId: "gmail" } } };
      accountTokens.set(card.id, { clientId: "client", clientSecret: "test-secret", refreshToken: "old" });
      await saveMailAccount("/v", { id: "gmail", label: "Gmail", host: "imap.gmail.com", port: 993, user: "person@example.invalid" }, "test-app-password");
      registry.set("/v", [card]);
      slots.delete("pim");
      const status = vi.fn();
      await unifyAccountLogin("/v", null, card, status);
      await expect(getMailPassword("/v", "gmail")).resolves.toBe("test-app-password");
      expect(actualSecrets.get(mailSecretKey("/v", "gmail"))).toEqual({ pass: "test-app-password" });
      expect(status.mock.calls.every(([service]) => service !== "mail")).toBe(true);
      expect(accountTokens.get(card.id)).toMatchObject({ refreshToken: "RT" });
    } finally { if (platform) setPlatformServices(platform); }
  });
});

describe("account reconnect preserves every existing source until consent is complete", () => {
  beforeEach(() => {
    registry.clear(); slots.clear(); accountTokens.clear(); reject.clear(); consents.length = 0;
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.mocked(fileBrokerTokenProvider).mockResolvedValue(async () => "access");
  });

  it.each(["google", "microsoft"] as const)("replaces the authoritative %s token for a single calendar and wakes its worker", async (family) => {
    const card: CloudAccountRecord = { id: "single", family, label: "Person", services: { calendar: { pimAccountId: "P" } } };
    registry.set("/v", [card]);
    accountTokens.set(card.id, { clientId: "client", ...(family === "google" ? { clientSecret: "secret" } : {}), refreshToken: "old" });
    slots.set("pim", { kind: family, clientId: "client", refreshToken: "" });
    const runtime = { isActive: () => true, cache: { setScopeState: vi.fn(async () => {}) }, worker: { start: vi.fn(), triggerImmediate: vi.fn(async () => {}) } };
    await rerunAccountAuth("/v", runtime as unknown as PimRuntime, card, () => {});
    expect(accountTokens.get(card.id)).toMatchObject({ refreshToken: family === "google" ? "RT" : "MS-RT", scopes: expect.any(String) });
    expect(slots.get("pim")).toMatchObject({ kind: family, clientId: "client", refreshToken: "", loginRevision: expect.any(String) });
    expect(runtime.cache.setScopeState).toHaveBeenCalledWith("P", "account", { lastError: null });
    expect(runtime.worker.start).toHaveBeenCalledTimes(1);
    expect(runtime.worker.triggerImmediate).toHaveBeenCalledTimes(1);
  });

  it("a Google partial grant leaves both old service tokens and the account token intact", async () => {
    const { authorizeDrive } = await import("./driveAuth");
    const card: CloudAccountRecord = { id: "partial", family: "google", label: "Person", services: { files: { provider: "drive" }, calendar: { pimAccountId: "P" } } };
    registry.set("/v", [card]);
    accountTokens.set(card.id, { clientId: "client", clientSecret: "secret", refreshToken: "old-account" });
    slots.set("drive", { clientId: "client", clientSecret: "secret", refreshToken: "old-files" });
    slots.set("pim", { kind: "google", clientId: "client", refreshToken: "old-calendar" });
    vi.mocked(authorizeDrive).mockResolvedValueOnce({ clientId: "client", clientSecret: "secret", refreshToken: "narrow", grantedScope: oauthScopeFor("google", "files")! });
    const status = vi.fn();
    await expect(unifyAccountLogin("/v", null, card, status)).rejects.toThrow(i18n.t("cloudAccounts.loginGrantIncomplete"));
    expect(accountTokens.get(card.id)).toMatchObject({ refreshToken: "old-account" });
    expect(slots.get("drive")).toMatchObject({ refreshToken: "old-files" });
    expect(slots.get("pim")).toMatchObject({ refreshToken: "old-calendar" });
    expect(status).toHaveBeenCalledWith("calendar", expect.objectContaining({ reason: "permissions", detail: i18n.t("cloudAccounts.loginPermissionMissing") }));
    expect(status).toHaveBeenCalledWith("files", expect.objectContaining({ detail: i18n.t("cloudAccounts.loginPermissionKept") }));
  });

  it("the first-connect wizard refuses partial Google permission before storing or connecting anything", async () => {
    const { authorizeDrive } = await import("./driveAuth");
    vi.mocked(authorizeDrive).mockResolvedValueOnce({ clientId: "client", clientSecret: "secret", refreshToken: "narrow", grantedScope: oauthScopeFor("google", "files")! });
    await expect(runConnectSequence("/v", null, { family: "google", services: ["files", "calendar"], byoClientId: "client", googleClientSecret: "secret" }, () => {})).rejects.toMatchObject({ name: "AccountGrantMissingPermissionsError" });
    expect(accountTokens.size).toBe(0); expect(slots.size).toBe(0);
  });

  it("retains a service credential changed while the browser was open", async () => {
    const { authorizeDrive } = await import("./driveAuth");
    const card: CloudAccountRecord = { id: "changed", family: "google", label: "Person", services: { calendar: { pimAccountId: "P" } } };
    registry.set("/v", [card]);
    accountTokens.set(card.id, { clientId: "client", clientSecret: "secret", refreshToken: "old" });
    slots.set("pim", { kind: "google", clientId: "client", refreshToken: "old-service" });
    vi.mocked(authorizeDrive).mockImplementationOnce(async () => {
      slots.set("pim", { kind: "google", clientId: "client", refreshToken: "independent" });
      return { clientId: "client", clientSecret: "secret", refreshToken: "late", grantedScope: oauthScopeFor("google", "calendar")! };
    });
    await expect(unifyAccountLogin("/v", null, card, () => {})).rejects.toThrow(i18n.t("cloudAccounts.loginBindingChanged"));
    expect(accountTokens.get(card.id)).toMatchObject({ refreshToken: "old" });
    expect(slots.get("pim")).toMatchObject({ refreshToken: "independent" });
  });
});


describe("shared sign-in repair offer", () => {
  it("keeps incomplete account grants repairable and excludes Gmail", async () => {
    const { canUnifyAccountLogin } = await import("./cloudAccountsActions");
    const record: CloudAccountRecord = { id: "repair-offer", label: "Person", family: "google", services: { files: { provider: "drive" }, calendar: { pimAccountId: "cal" }, mail: { mailAccountId: "gmail" } } };
    const token = { clientId: "cid", refreshToken: "old", scopes: oauthScopeFor("google", "files")! };
    accountTokens.set(record.id, token);
    expect(await canUnifyAccountLogin("vault", record)).toBe(true);
    accountTokens.set(record.id, { ...token, scopes: token.scopes + " " + oauthScopeFor("google", "calendar") });
    expect(await canUnifyAccountLogin("vault", record)).toBe(false);
    expect(await canUnifyAccountLogin("vault", { ...record, services: { calendar: record.services.calendar, mail: record.services.mail } })).toBe(false);
  });
});
