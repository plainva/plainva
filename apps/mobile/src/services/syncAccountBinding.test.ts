import { beforeEach, describe, expect, it, vi } from "vitest";
import { DriveSyncTarget, OneDriveSyncTarget, DropboxSyncTarget } from "@plainva/core";
import type { CloudAccountRecord } from "@plainva/ui";
import type { MobileVault } from "./vaultService";
import type { MobileSyncProvider } from "./syncSlot";

const state = vi.hoisted(() => ({ secrets: new Map<string, unknown>(), records: [] as CloudAccountRecord[], resumed: vi.fn() }));
vi.mock("@plainva/ui", async (original) => ({
  ...await original<typeof import("@plainva/ui")>(),
  getPlatformServices: () => ({ credentials: {
    readSecret: async (key: string) => structuredClone(state.secrets.get(key) ?? null),
    writeSecret: async (key: string, value: unknown) => { state.secrets.set(key, structuredClone(value)); },
  } }),
}));
vi.mock("../platform/secureStore", () => ({ secureCredentialStore: {
  readSecret: async (key: string) => structuredClone(state.secrets.get(key) ?? null),
  writeSecret: async (key: string, value: unknown) => { state.secrets.set(key, structuredClone(value)); },
} }));
vi.mock("./cloudAccountsStore", () => ({ loadCloudAccounts: async () => state.records }));
vi.mock("./vaultRegistry", async (original) => ({ ...await original<typeof import("./vaultRegistry")>(), getActiveVaultEntry: async () => ({ id: "other-vault" }), updateVault: state.resumed }));
vi.mock("./vaultService", () => ({ getMobileVault: vi.fn(), switchVault: vi.fn() }));
vi.mock("./syncRootFolder", () => ({ readSyncRootFolder: async () => "Vault" }));
vi.mock("@plainva/core", async (original) => ({
  ...await original<typeof import("@plainva/core")>(),
  refreshDriveAccessToken: async () => ({ accessToken: "google-access", expiresIn: 3600 }),
  refreshOneDriveAccessToken: async ({ scope }: { scope: string }) => ({ accessToken: "microsoft-access", scope, expiresIn: 3600 }),
}));
import { switchProviderToAccountBroker, getMobileWorkspaceObjectStore, createProviderVault } from "./syncService";
import { accountSecretKey, forgetAccountBroker, googleScopeFor, microsoftScopeFor } from "./accountBroker";
import { bindRunTokenToAccount } from "./connectConsent";

beforeEach(() => {
  state.secrets.clear(); state.resumed.mockClear();
  state.records = [{ id: "g", family: "google", label: "Person", services: { files: { provider: "drive" } } }, { id: "m", family: "microsoft", label: "Person", services: { files: { provider: "onedrive" } } }];
  for (const id of ["g", "m"]) forgetAccountBroker("v", id);
  state.secrets.set(accountSecretKey("v", "g"), { clientId: "google-client", refreshToken: "google-refresh", scopes: googleScopeFor("files") });
  state.secrets.set(accountSecretKey("v", "m"), { clientId: "microsoft-client", refreshToken: "microsoft-refresh", scopes: microsoftScopeFor("files") });
});

describe("the real mobile file service respects its account binding", () => {
  it.each(["drive", "onedrive", "dropbox"] as const)("checks the chosen new %s destination before any vault or credential writes", async (provider) => {
    const p = { provider, creds: { clientId: "client", appKey: "app", refreshToken: "before", rootFolderName: "Chosen folder", rootPath: "/Chosen folder" } } as MobileSyncProvider;
    const prototype = provider === "drive" ? DriveSyncTarget.prototype : provider === "onedrive" ? OneDriveSyncTarget.prototype : DropboxSyncTarget.prototype;
    const before = structuredClone(state.secrets);
    const pull = vi.spyOn(prototype, "pull").mockImplementation(async function (this: DriveSyncTarget | OneDriveSyncTarget | DropboxSyncTarget) {
      const creds = Reflect.get(this, "creds") as { rootFolderName?: string; rootPath?: string };
      expect(provider === "dropbox" ? creds.rootPath : creds.rootFolderName).toBe(provider === "dropbox" ? "/Chosen folder" : "Chosen folder");
      if (this instanceof OneDriveSyncTarget || this instanceof DropboxSyncTarget) await this.onTokensRefreshed?.("access", "rotated");
      return { etagMap: new Map([["existing.md", "etag"]]) };
    });
    try {
      await expect(createProviderVault({ syncQueue: {}, syncRepo: {} } as MobileVault, p, { template: null, vaultName: "New", subfoldersHeading: "Folders" })).rejects.toThrow("new, empty cloud folder");
      expect(state.secrets).toEqual(before);
      expect(p.creds).toMatchObject({ refreshToken: provider === "drive" ? "before" : "rotated" });
    } finally { pull.mockRestore(); }
  });

  it("the connect wizard keeps a partial file grant in its own slot", async () => {
    state.secrets.delete(accountSecretKey("v", "g"));
    const files = { provider: "drive", creds: { clientId: "google-client", refreshToken: "file-only", grantedScope: googleScopeFor("files") } };
    state.secrets.set("sync_provider_mobile_v", files);
    await expect(bindRunTokenToAccount("v", "google", ["files", "calendar"])).rejects.toMatchObject({ name: "AccountGrantMissingPermissionsError" });
    expect(state.secrets.get("sync_provider_mobile_v")).toEqual(files);
    expect(state.secrets.has(accountSecretKey("v", "g"))).toBe(false);
  });

  it("the connect wizard stores an actual complete grant before detaching file credentials", async () => {
    state.secrets.delete(accountSecretKey("v", "g"));
    const scopes = `${googleScopeFor("files")} ${googleScopeFor("calendar")}`;
    state.secrets.set("sync_provider_mobile_v", { provider: "drive", creds: { clientId: "google-client", refreshToken: "union-grant", grantedScope: scopes } });
    expect(await bindRunTokenToAccount("v", "google", ["files", "calendar"])).toBe("g");
    expect(state.secrets.get(accountSecretKey("v", "g"))).toMatchObject({ refreshToken: "union-grant", scopes });
    expect(state.secrets.get("sync_provider_mobile_v")).toMatchObject({ creds: { refreshToken: "" } });
  });
  it("a calendar-only login does not clear an independently connected file account", async () => {
    const files = { provider: "onedrive", creds: { clientId: "microsoft-client", refreshToken: "independent-files" } };
    state.secrets.set("sync_provider_mobile_v", files);
    await switchProviderToAccountBroker("v", { id: "calendar", family: "google", label: "Person", services: { calendar: { pimAccountId: "p" } } }, "google-client");
    expect(state.secrets.get("sync_provider_mobile_v")).toEqual(files);
    expect(state.resumed).not.toHaveBeenCalled();
  });

  it("rejects a mismatched provider/client before clearing the file credential", async () => {
    const files = { provider: "onedrive", creds: { clientId: "microsoft-client", refreshToken: "independent-files" } };
    state.secrets.set("sync_provider_mobile_v", files);
    await expect(switchProviderToAccountBroker("v", state.records[0], "google-client")).rejects.toThrow();
    await expect(switchProviderToAccountBroker("v", state.records[1], "other-client")).rejects.toThrow();
    expect(state.secrets.get("sync_provider_mobile_v")).toEqual(files);
  });

  it("clears only a bound slot and resumes that vault", async () => {
    state.secrets.set("sync_provider_mobile_v", { provider: "onedrive", creds: { clientId: "microsoft-client", refreshToken: "old-files", rootFolderName: "Existing" } });
    await switchProviderToAccountBroker("v", state.records[1], "microsoft-client");
    expect(state.secrets.get("sync_provider_mobile_v")).toEqual({ provider: "onedrive", creds: { clientId: "microsoft-client", refreshToken: "", rootFolderName: "Existing" } });
    expect(state.resumed).toHaveBeenCalledWith("v", { paused: false });
  });

  it.each(["drive", "onedrive"] as const)("builds the actual %s target with only its own token provider", async (provider) => {
    const google = provider === "drive";
    state.secrets.set("sync_provider_mobile_v", { provider, creds: { clientId: google ? "google-client" : "microsoft-client", refreshToken: "" } });
    const prototype = google ? DriveSyncTarget.prototype : OneDriveSyncTarget.prototype;
    const download = vi.spyOn(prototype, "download").mockImplementation(async function (this: DriveSyncTarget | OneDriveSyncTarget) {
      expect(await this.accessTokenProvider?.(false)).toBe(google ? "google-access" : "microsoft-access");
      return null;
    });
    try {
      await (await getMobileWorkspaceObjectStore("v")).get(".pvws/genesis.pvgen");
      expect(download).toHaveBeenCalledTimes(1);
    } finally { download.mockRestore(); }
  });
});
