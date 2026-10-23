import { beforeEach, describe, expect, it, vi } from "vitest";
import { oauthScopeFor, setPlatformServices } from "@plainva/ui";
import { listMailAccounts, setMailPlatform, mailSecretKey } from "@plainva/ui/mail";
import type { MailTransport } from "@plainva/ui/mail";
import { connectMicrosoftMail, listMobileMailAccounts, startMobileMail, stopMobileMail } from "./mailRuntime";
import { clearConnectQueue, startConnectQueue } from "../connectQueue";
import { accountSecretKey, forgetAccountBroker } from "../accountBroker";
import { refreshOneDriveAccessToken } from "@plainva/core";

/**
 * The one integration risk of G1: a Microsoft consent started for MAIL must
 * end up as a mail account — not as a calendar account. Both flows share a
 * single custom-scheme redirect and a single handler (feinplan G0.2), so this
 * drives the real modules end to end and only fakes the network.
 */

const { opened } = vi.hoisted(() => ({ opened: [] as string[] }));
vi.mock("@capacitor/browser", () => ({
  Browser: {
    open: async ({ url }: { url: string }) => {
      opened.push(url);
    },
    close: async () => {},
  },
}));

// Hoisted: vi.mock factories run before module-level consts exist.
const { addPimAccount } = vi.hoisted(() => ({ addPimAccount: vi.fn() }));
vi.mock("../pim/pimService", () => ({ addPimAccount }));
vi.mock("../vaultService", () => ({ getMobileVault: async () => ({ vaultId: "v1" }), switchVault: vi.fn() }));
vi.mock("../vaultRegistry", () => ({ getActiveVaultEntry: async () => ({ id: "v1" }), LOCAL_VAULT_ID: "local" }));
vi.mock("../../adapters/webdavHttp", () => ({ webdavFetch: async () => new Response(JSON.stringify({ id: "subject", mail: "someone@contoso.com" })) }));

vi.mock("@plainva/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@plainva/core")>()),
  exchangeOneDriveCode: async () => ({ refreshToken: "refresh-1", accessToken: "access-1" }),
  refreshOneDriveAccessToken: vi.fn(async ({ scope }: { scope?: string }) => ({ accessToken: "shared-access", expiresIn: 3600, scope })),
}));

const settings = new Map<string, unknown>();
const secrets = new Map<string, unknown>();
vi.mock("../../platform/secureStore", () => ({ secureCredentialStore: {
  readSecret: async (key: string) => secrets.get(key) ?? null,
  writeSecret: async (key: string, value: unknown) => { secrets.set(key, value); },
  removeSecret: async (key: string) => { secrets.delete(key); },
} }));

function installPlatform(): void {
  setPlatformServices({
    loadSettings: async () => ({
      get: async <T,>(k: string) => settings.get(k) as T | undefined,
      set: async (k: string, v: unknown) => void settings.set(k, v),
      delete: async (k: string) => settings.delete(k),
      keys: async () => [...settings.keys()],
      save: async () => {},
    }),
    credentials: {
      readSecret: async <T,>(k: string) => (secrets.get(k) ?? null) as T | null,
      writeSecret: async (k: string, v: unknown) => void secrets.set(k, v),
      removeSecret: async (k: string) => void secrets.delete(k),
    },
    openExternal: async () => {},
  });
  // Graph answers /me with the mailbox address; the IMAP half must never be
  // touched on this path, so it throws if anything reaches for it.
  const throwing = new Proxy({} as MailTransport, {
    get: () => () => {
      throw new Error("the Microsoft path must not use the IMAP transport");
    },
  });
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const api: typeof fetch = async () => json({ mail: "someone@contoso.com" });
  // The token endpoint answers like the real one. It used to hand back the
  // Graph body, i.e. no access_token at all — which only worked because the
  // code accepted that and sent "Bearer undefined" to a fake that did not care
  // (finding 2026-07-30).
  const token: typeof fetch = async () => json({ access_token: "at-1", refresh_token: "refresh-1", expires_in: 3600 });
  setMailPlatform({ transport: throwing, http: { api, token } });
}

// The runtime and the OAuth handler both announce themselves with a DOM
// event; these tests run in node, so give them somewhere to fire.
if (typeof globalThis.window === "undefined") {
  const stub = Object.assign(new EventTarget(), {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  });
  Object.defineProperty(globalThis, "window", { value: stub, configurable: true });
}

describe("mobile mail runtime", () => {
  beforeEach(async () => {
    settings.clear();
    secrets.clear();
    opened.length = 0;
    addPimAccount.mockClear();
    installPlatform();
    await clearConnectQueue();
    forgetAccountBroker("v1", "shared");
    vi.mocked(refreshOneDriveAccessToken).mockClear();
  });

  async function prepareSharedMail() {
    settings.set("cloudAccounts_v1", [{ id: "shared", family: "microsoft", label: "someone@contoso.com",
      verifiedProviderIdentity: { issuer: "microsoft", subject: "subject" }, services: { files: { provider: "onedrive" } } }]);
    secrets.set(accountSecretKey("v1", "shared"), { clientId: "client", refreshToken: "existing-grant",
      scopes: `${oauthScopeFor("microsoft", "files")} ${oauthScopeFor("microsoft", "mail")}` });
    startMobileMail({ vaultId: "v1" } as never);
    await startConnectQueue("microsoft", ["mail"], { vaultId: "v1", cloudAccountId: "shared" });
  }

  it("adds mail through an existing file grant without a second browser consent", async () => {
    await prepareSharedMail();
    await connectMicrosoftMail();
    const mail = (await listMobileMailAccounts())[0];
    expect(mail.user).toBe("someone@contoso.com");
    expect(opened).toHaveLength(0);
    expect(secrets.get(mailSecretKey("v1", mail.id))).toEqual({ refreshToken: "" });
    expect(secrets.get(accountSecretKey("v1", "shared"))).toMatchObject({ refreshToken: "existing-grant" });
  });

  it("asks the one sign-in for everything the card carries plus mail when its grant expired", async () => {
    // The card signs in once for all its services (account sign-in plan E2):
    // asking for mail alone would hand back a grant that no longer covers files.
    await prepareSharedMail();
    vi.mocked(refreshOneDriveAccessToken).mockRejectedValueOnce(new Error("invalid_grant"));
    await connectMicrosoftMail();
    expect(opened).toHaveLength(1);
    const url = new URL(opened[0]);
    expect(url.searchParams.get("scope")).toContain("Mail.ReadWrite");
    expect(url.searchParams.get("scope")).toContain("Files.ReadWrite");
    expect(url.searchParams.get("login_hint")).toBe("someone@contoso.com");
    expect(secrets.get(accountSecretKey("v1", "shared"))).toMatchObject({ refreshToken: "existing-grant" });
    expect(await listMobileMailAccounts()).toHaveLength(0);
  });

  it("does not turn a storage or network failure into another consent", async () => {
    await prepareSharedMail();
    vi.mocked(refreshOneDriveAccessToken).mockRejectedValueOnce(new Error("offline"));
    await expect(connectMicrosoftMail()).rejects.toThrow("offline");
    expect(opened).toHaveLength(0);
    expect(await listMobileMailAccounts()).toHaveLength(0);
  });

  it("asks the one sign-in for a Microsoft mailbox that no card covers yet", async () => {
    startMobileMail({ vaultId: "v1" } as never);
    await connectMicrosoftMail();
    expect(opened).toHaveLength(1);
    expect(new URL(opened[0]).searchParams.get("scope")).toContain("Mail.ReadWrite");
    // The transaction carries the prepared sign-in through a cold start.
    expect(secrets.get("pim_oauth_pending_tx")).toMatchObject({ purpose: "signin", signIn: { requested: ["mail"] } });
    expect(addPimAccount).not.toHaveBeenCalled();
  });

  it("keeps mail accounts out of the vault they do not belong to", async () => {
    startMobileMail({ vaultId: "v1" } as never);
    settings.set(`mailAccounts_${btoa("v1")}`, [{ id: "a1", label: "A", host: "", port: 0, user: "", kind: "microsoft" }]);
    settings.set(`mailAccounts_${btoa("v2")}`, [{ id: "b1", label: "B", host: "", port: 0, user: "", kind: "microsoft" }]);

    expect((await listMobileMailAccounts()).map((a) => a.id)).toEqual(["a1"]);

    startMobileMail({ vaultId: "v2" } as never);
    expect((await listMobileMailAccounts()).map((a) => a.id)).toEqual(["b1"]);

    // No vault open: no accounts, rather than the last vault's list.
    stopMobileMail();
    expect(await listMobileMailAccounts()).toEqual([]);
    expect(await listMailAccounts("v1")).toHaveLength(1); // the store itself is untouched
  });
});
