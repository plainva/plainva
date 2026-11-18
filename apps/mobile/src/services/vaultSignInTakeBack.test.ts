import { beforeEach, describe, expect, it, vi } from "vitest";
import { oauthScopeFor, type CloudAccountRecord, type OAuthAccess } from "@plainva/ui";
import type { MobileSyncProvider } from "./syncSlot";

/**
 * The phone's "Add vault" from Google or Microsoft (fifth review of O8): the
 * real `adoptAddedVaultSignIn` over the real `adoptFilesSignIn`, with the
 * stores in memory. A sign-in that does not end in a listed vault leaves no
 * grant, no card and no slot that no vault entry points to.
 */
const state = vi.hoisted(() => ({
  secrets: new Map<string, unknown>(),
  records: [] as CloudAccountRecord[],
  bindFails: false,
  saveCardsFails: false,
}));
const store = vi.hoisted(() => ({
  readSecret: async (key: string) => structuredClone(state.secrets.get(key) ?? null),
  writeSecret: async (key: string, value: unknown) => { state.secrets.set(key, structuredClone(value)); },
  removeSecret: async (key: string) => { state.secrets.delete(key); },
}));
vi.mock("@plainva/ui", async (original) => ({
  ...await original<typeof import("@plainva/ui")>(),
  getPlatformServices: () => ({ credentials: store }),
}));
vi.mock("../platform/secureStore", () => ({ secureCredentialStore: store }));
vi.mock("./cloudAccountsStore", () => ({
  CLOUD_ACCOUNTS_EVENT: "test-cloud-accounts-changed",
  loadCloudAccounts: async () => structuredClone(state.records),
  saveCloudAccounts: async (_vault: string, records: CloudAccountRecord[]) => {
    if (state.saveCardsFails) throw new Error("store full");
    state.records = structuredClone(records);
  },
}));
vi.mock("@plainva/core", async (original) => ({
  ...await original<typeof import("@plainva/core")>(),
  refreshDriveAccessToken: async () => ({ accessToken: "google-access", expiresIn: 3600, scope: oauthScopeFor("google", "files") }),
}));
vi.mock("../adapters/webdavHttp", () => ({
  webdavFetch: async () => new Response(JSON.stringify({ sub: "person", email: "person@example.test", email_verified: true })),
  allowHttpOrigin: vi.fn(),
}));
vi.mock("./syncService", async (original) => ({
  ...await original<typeof import("./syncService")>(),
  // The binding of the files slot to the card: here only whether it goes through.
  switchProviderToAccountBroker: async () => { if (state.bindFails) throw new Error("network down"); },
}));

const { adoptAddedVaultSignIn } = await import("./accountSignIn");
const { adoptAndList } = await import("./syncService");

const VAULT = "new-vault";
const SLOT = `sync_provider_mobile_${VAULT}`;
const access = { family: "google", source: "own", clientId: "google-client", clientSecret: "", flow: "browser" } as OAuthAccess;
const provider: MobileSyncProvider = { provider: "drive", creds: { clientId: "google-client", clientSecret: "", refreshToken: "consent-refresh" } } as MobileSyncProvider;
const grants = () => [...state.secrets.keys()].filter((key) => key.startsWith("account_"));

beforeEach(() => {
  state.secrets.clear();
  state.records = [];
  state.bindFails = false;
  state.saveCardsFails = false;
  state.secrets.set(SLOT, provider);
});

describe("a phone vault's sign-in that does not end in a vault takes back what it made (fifth review of O8)", () => {
  it("binding the files fails: no grant with its refresh token and no card stay", async () => {
    state.bindFails = true;
    await expect(adoptAddedVaultSignIn(VAULT, access, provider)).rejects.toThrow("network down");
    expect(state.records).toEqual([]);
    expect(grants()).toEqual([]);
  });

  it("the card cannot be written: the grant written before it goes", async () => {
    state.saveCardsFails = true;
    await expect(adoptAddedVaultSignIn(VAULT, access, provider)).rejects.toThrow("store full");
    expect(grants()).toEqual([]);
  });

  it("the vault cannot be listed: the sign-in, its card and the slot go", async () => {
    await expect(adoptAndList(VAULT, (id) => adoptAddedVaultSignIn(id, access, provider), async () => { throw new Error("registry full"); }))
      .rejects.toThrow("registry full");
    expect(state.records).toEqual([]);
    expect(grants()).toEqual([]);
    expect(state.secrets.has(SLOT)).toBe(false);
  });

  it("a listed vault keeps its sign-in", async () => {
    await adoptAndList(VAULT, (id) => adoptAddedVaultSignIn(id, access, provider), async () => undefined);
    expect(state.records).toHaveLength(1);
    expect(grants()).toEqual([`account_${state.records[0]!.id}_${VAULT}`]);
    expect(state.secrets.has(SLOT)).toBe(true);
  });

  it("a card and a grant that were there before stay as they were", async () => {
    const other: CloudAccountRecord = { id: "card-old", family: "microsoft", label: "Other", services: { calendar: { pimAccountId: "pim-o" } } };
    state.records = [other];
    state.secrets.set(`account_card-old_${VAULT}`, { refreshToken: "other" });
    state.bindFails = true;
    await expect(adoptAddedVaultSignIn(VAULT, access, provider)).rejects.toThrow("network down");
    expect(state.records).toEqual([other]);
    expect(grants()).toEqual([`account_card-old_${VAULT}`]);
  });
});
