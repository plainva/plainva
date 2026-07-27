import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CloudAccountRecord } from "@plainva/ui";

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

vi.mock("./pim/pimAccounts", () => ({
  checkCalDavLogin: vi.fn(async () => {
    if (reject.has("caldav")) throw new Error("caldav login failed");
  }),
  connectCalDavAccount: vi.fn(),
  connectGoogleAccount: vi.fn(),
  connectMicrosoftAccount: vi.fn(),
  removePimAccount: vi.fn(),
}));

vi.mock("./pim/pimCredentials", () => ({
  getPimCredentials: vi.fn(async () => slots.get("pim") ?? null),
  savePimCredentials: vi.fn(async (_v: string, _id: string, creds: unknown) => {
    if (reject.has("caldav-write")) throw new Error("caldav write failed");
    slots.set("pim", creds);
  }),
}));
vi.mock("./settingsStore", () => ({ getSettingsStore: vi.fn(async () => ({ get: async () => null, set: async () => undefined, save: async () => undefined })) }));

import { bindConnectResult, passwordServicesOf, updateAccountPassword } from "./cloudAccountsActions";
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
  const runtime = { worker: { triggerImmediate: vi.fn() } } as unknown as PimRuntime;

  beforeEach(() => {
    // The success path announces the credential change to the app shell.
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    slots.clear();
    reject.clear();
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
    await expect(updateAccountPassword("/v", runtime, nextcloud, "new", () => {})).rejects.toThrow(/caldav login failed/);
    expect(slots.get("webdav")).toMatchObject({ pass: "old" });
    expect(slots.get("pim")).toMatchObject({ pass: "old" });
  });

  it("rolls back an already written slot when a later write fails", async () => {
    reject.add("caldav-write");
    await expect(updateAccountPassword("/v", runtime, nextcloud, "new", () => {})).rejects.toThrow(/caldav write failed/);
    // The files slot was written first and must be back on the old secret.
    expect(slots.get("webdav")).toMatchObject({ pass: "old" });
    expect(slots.get("pim")).toMatchObject({ pass: "old" });
  });
});
