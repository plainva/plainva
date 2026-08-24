import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { CloudAccountRecord, StoredAccountToken } from "@plainva/ui";

const secrets = new Map<string, StoredAccountToken>();
const cloudRecords: CloudAccountRecord[] = [];

/** A token endpoint whose answer names the provider that was asked. */
const tokenReply = (accessToken: string) => ({
  ok: true,
  json: async () => ({ access_token: accessToken, expires_in: 3600 }),
});

vi.mock("./CredentialManager", () => ({
  credentialManager: {
    readSecret: async (key: string) => secrets.get(key) ?? null,
    writeSecret: async (key: string, value: StoredAccountToken) => {
      secrets.set(key, structuredClone(value));
    },
  },
}));
/**
 * Per-vault registries, for the stage-D cases. Everything written before
 * multi-window used one vault, so an unknown path keeps answering with the
 * shared list rather than making every existing test name a vault.
 */
const cloudByVault = new Map<string, CloudAccountRecord[]>();
vi.mock("./cloudAccounts", () => ({
  loadCloudAccounts: async (vaultPath: string) => cloudByVault.get(vaultPath) ?? cloudRecords,
}));

const settings = new Map<string, unknown>();
vi.mock("./settingsStore", () => ({
  getSettingsStore: async () => ({
    get: async <T,>(k: string) => settings.get(k) as T | undefined,
    set: async (k: string, v: unknown) => {
      settings.set(k, v);
    },
    save: async () => {},
  }),
}));
vi.mock("./authFetch", () => ({ microsoftAuthFetch: vi.fn(async () => tokenReply("AT-MICROSOFT")) }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn(async () => tokenReply("AT-GOOGLE")) }));

import { microsoftAuthFetch } from "./authFetch";
import {
  accountSecretKey,
  brokerFamily,
  brokerTokenProvider,
  describeBrokerLookup,
  forgetAccountBroker,
  getAccountBroker,
  googleScopeFor,
  microsoftScopeFor,
  microsoftUnionScope,
  replaceAccountClientRegistration,
  resetGrantSharingForTests,
  setPendingBrokerAccount,
} from "./accountBroker";

/**
 * The union scope is what the wizard sends to Microsoft for an account that
 * connects several services at once. Every per-service scope set ends in
 * offline_access, so a naive concatenation would repeat it — Entra tolerates
 * that, but the consent screen and the stored scope string should stay clean.
 */
describe("microsoft account scopes", () => {
  it("merges the selected services without repeating shared scopes", () => {
    const union = microsoftUnionScope(["files", "calendar", "mail"]);
    const parts = union.split(" ");
    expect(new Set(parts).size).toBe(parts.length);
    expect(parts).toContain("offline_access");
    expect(parts.filter((p) => p === "offline_access")).toHaveLength(1);
    expect(union).toContain("Files.ReadWrite");
    expect(union).toContain("Calendars.ReadWrite");
    expect(union).toContain("Mail.Send");
  });

  it("keeps a single service narrow", () => {
    const union = microsoftUnionScope(["calendar"]);
    expect(union).toContain("Calendars.ReadWrite");
    expect(union).not.toContain("Files.ReadWrite");
    expect(union).not.toContain("Mail.Send");
  });

  it("rejects an unknown audience instead of requesting a silent empty scope", () => {
    expect(() => microsoftScopeFor("contacts")).toThrow(/unknown audience/);
  });

  it("keys the account slot per vault, like every other credential", () => {
    const a = accountSecretKey("/vault/one", "acc1");
    const b = accountSecretKey("/vault/two", "acc1");
    expect(a).not.toBe(b);
    // Since P6 the name is readable; what it must still carry is the account,
    // so two accounts in one vault cannot land on the same entry.
    expect(a).toContain("acc1");
    expect(a).not.toBe(accountSecretKey("/vault/one", "acc2"));
  });

  it("stores a changed client without the old grant in the same local slot", async () => {
    const key = accountSecretKey("/vault/one", "acc1");
    secrets.set(key, {
      clientId: "old-client",
      clientSecret: "old-secret",
      refreshToken: "old-refresh",
      scopes: "files calendar",
    });

    await expect(replaceAccountClientRegistration("/vault/one", "acc1", {
      clientId: "new-client",
      clientSecret: "new-secret",
    })).resolves.toBe(true);
    expect(secrets.get(key)).toEqual({
      clientId: "new-client",
      clientSecret: "new-secret",
      refreshToken: "",
    });
  });
});

/**
 * Google joined the broker on 2026-07-28. Its consent always covered the whole
 * account, but the token was copied into each service slot — and a renewal then
 * reached one copy while the others kept a dead one, which is how a vault ended
 * up syncing files while its calendar reported invalid_grant.
 */
describe("google account scopes", () => {
  it("serves the two audiences a Google account can have", () => {
    expect(googleScopeFor("files")).toContain("auth/drive");
    expect(googleScopeFor("calendar")).toContain("auth/calendar");
  });

  it("refuses a mail token: Gmail is IMAP with an app password, not OAuth", () => {
    expect(() => googleScopeFor("mail")).toThrow(/unknown Google audience/);
  });

  it("names exactly the families that can share one token", () => {
    expect(brokerFamily("microsoft")).toBe("microsoft");
    expect(brokerFamily("google")).toBe("google");
    // Dropbox carries one service, the catalog suites use passwords — neither
    // has anything to share.
    expect(brokerFamily("dropbox")).toBeNull();
    expect(brokerFamily("webdav")).toBeNull();
    expect(brokerFamily("fastmail")).toBeNull();
  });
});

/**
 * The regression stage B introduced for Google, and the reason a calendar broke
 * on an account whose file sync kept working (finding 2026-07-30).
 *
 * Google ignores the scope of a refresh_token grant, and drive/calendar are
 * disjoint scope sets — so a Drive-only account token can NEVER serve the
 * calendar. Preferring it over the calendar's own per-service sign-in turned a
 * working account into a permanent 401 that no amount of signing in could fix.
 */
describe("google account tokens are only used for the services they cover", () => {
  const V = "/vault";
  const card: CloudAccountRecord = {
    id: "g1",
    family: "google",
    label: "marco@gmail.com",
    services: { files: { provider: "drive" }, calendar: { pimAccountId: "p1" } },
  };

  function given(scopes: string | undefined) {
    cloudRecords.length = 0;
    cloudRecords.push(card);
    secrets.clear();
    secrets.set(accountSecretKey(V, card.id), { clientId: "cid", refreshToken: "RT", ...(scopes ? { scopes } : {}) });
  }

  it("does not hand a drive-only sign-in to the calendar", async () => {
    given(googleScopeFor("files"));
    expect(await brokerTokenProvider(V, "calendar")).toBeUndefined();
    // File sync, which that consent DID cover, keeps using it.
    expect(await brokerTokenProvider(V, "files")).toBeTypeOf("function");
  });

  it("uses the shared sign-in once the consent covers the calendar", async () => {
    given(`${googleScopeFor("files")} ${googleScopeFor("calendar")}`);
    expect(await brokerTokenProvider(V, "calendar")).toBeTypeOf("function");
  });

  // Unprovable is not permission. Every writer records the scopes; a slot that
  // does not must step aside for the service's own sign-in rather than claim a
  // service it may not cover.
  it("does not claim a service on a slot whose scopes are unknown", async () => {
    given(undefined);
    expect(await brokerTokenProvider(V, "calendar")).toBeUndefined();
  });

  it("says WHY the calendar has no sign-in, instead of leaving a bare 401", async () => {
    given(googleScopeFor("files"));
    expect(await describeBrokerLookup(V, "calendar")).toMatch(/other services only/);
  });
});

/**
 * WHICH account is asking matters as soon as a vault holds two accounts of a
 * broker family — which is exactly what "one login for the whole Google
 * account" made normal. Asking only "a calendar token for this vault" answered
 * with the first card that had one, so a Microsoft calendar could be handed the
 * Google account's token and answer 401 (finding 2026-07-30).
 */
describe("the broker answers for the account that is asking", () => {
  const V = "/vault";

  beforeEach(() => {
    cloudRecords.length = 0;
    secrets.clear();
    cloudRecords.push(
      {
        id: "g1",
        family: "google",
        label: "marco@gmail.com",
        services: { files: { provider: "drive" }, calendar: { pimAccountId: "pim-google" } },
      },
      {
        id: "m1",
        family: "microsoft",
        label: "marco@outlook.com",
        services: { calendar: { pimAccountId: "pim-ms" }, mail: { mailAccountId: "mail-ms" } },
      }
    );
    secrets.set(accountSecretKey(V, "g1"), {
      clientId: "gid",
      refreshToken: "RT-G",
      scopes: `${googleScopeFor("files")} ${googleScopeFor("calendar")}`,
    });
    secrets.set(accountSecretKey(V, "m1"), { clientId: "mid", refreshToken: "RT-M", scopes: "Calendars.ReadWrite" });
  });

  it("gives each calendar its own account, not whichever card comes first", async () => {
    const forGoogle = await brokerTokenProvider(V, "calendar", "pim-google");
    const forMicrosoft = await brokerTokenProvider(V, "calendar", "pim-ms");
    expect(forGoogle).toBeTypeOf("function");
    expect(forMicrosoft).toBeTypeOf("function");
    // Different accounts must not share one broker: that is the mix-up itself.
    expect(forGoogle).not.toBe(forMicrosoft);
  });

  it("hands a calendar no token at all rather than a stranger's", async () => {
    expect(await brokerTokenProvider(V, "calendar", "pim-unknown")).toBeUndefined();
  });

  /**
   * While an account is being connected, its token exists before its registry
   * record does — that is what the pending marker is for. The background workers
   * do not pause for it, so the marker must never answer for a subsystem that
   * already belongs to another card: a Google calendar handed the Microsoft
   * access token gets 401 UNAUTHENTICATED, which reads like a revoked sign-in
   * (finding 2026-07-30).
   */
  describe("while another account is being connected", () => {
    beforeEach(() => {
      forgetAccountBroker(V, "g1");
      forgetAccountBroker(V, "m1");
      setPendingBrokerAccount({ vaultPath: V, accountId: "m1", family: "microsoft" });
    });
    afterEach(() => setPendingBrokerAccount(null));

    it("leaves the Google calendar on its own account", async () => {
      const provider = await brokerTokenProvider(V, "calendar", "pim-google");
      expect(await provider?.(false)).toBe("AT-GOOGLE");
    });

    it("still serves the connect it belongs to", async () => {
      // No card claims this subsystem yet — exactly the mid-connect case.
      const provider = await brokerTokenProvider(V, "calendar", "pim-just-created");
      expect(await provider?.(false)).toBe("AT-MICROSOFT");
    });
  });
});

/**
 * TWO VAULTS, ONE ACCOUNT (multi-window stage D, plan § 5.5).
 *
 * A refresh token does not belong to a vault, it belongs to a GRANT: the
 * provider-verified identity plus the local OAuth client that minted it. Two
 * vaults holding the same account therefore hold the same grant in two slots —
 * and Microsoft and Dropbox rotate on every refresh, so the second vault's
 * renewal invalidates the first vault's stored token. Before stage D that could
 * not happen, because only one vault was ever open.
 *
 * Both halves are needed, and neither replaces the other: the gate covers the
 * CONCURRENT case (both windows renew in the same second — one round trip, one
 * answer), the write-through covers the SEQUENTIAL one (an hour later the other
 * vault renews from a token that has since been rotated away, and it also heals
 * a vault that is currently closed).
 */
describe("two vaults holding the same account", () => {
  const A = "/vault-a";
  const B = "/vault-b";
  // What the provider itself confirmed — issuer + subject, not the label.
  const IDENTITY = { issuer: "https://login.microsoftonline.com/common/v2.0", subject: "aad-42" };

  /** The same account, connected in both vaults, with the same client. */
  function given(opts?: { identityInB?: unknown; clientIdInB?: string }) {
    const inB = opts && "identityInB" in opts ? opts.identityInB : IDENTITY;
    cloudByVault.set(A, [
      {
        id: "a1",
        family: "microsoft",
        label: "marco@outlook.com",
        verifiedProviderIdentity: IDENTITY,
        services: { files: { provider: "onedrive" } },
      } as CloudAccountRecord,
    ]);
    cloudByVault.set(B, [
      {
        id: "b1",
        family: "microsoft",
        label: "marco@outlook.com",
        ...(inB ? { verifiedProviderIdentity: inB } : {}),
        services: { files: { provider: "onedrive" } },
      } as CloudAccountRecord,
    ]);
    secrets.set(accountSecretKey(A, "a1"), { clientId: "cid", refreshToken: "RT-1" });
    secrets.set(accountSecretKey(B, "b1"), { clientId: (opts && opts.clientIdInB) || "cid", refreshToken: "RT-1" });
    settings.set("lastVaultPaths", [A, B]);
  }

  /** A Microsoft answer that rotates the refresh token, as it really does. */
  function rotatesOnce() {
    vi.mocked(microsoftAuthFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "AT-1", refresh_token: "RT-2", expires_in: 3600 }),
    } as never);
  }

  beforeEach(() => {
    cloudRecords.length = 0;
    cloudByVault.clear();
    secrets.clear();
    settings.clear();
    forgetAccountBroker(A, "a1");
    forgetAccountBroker(B, "b1");
    resetGrantSharingForTests();
    vi.mocked(microsoftAuthFetch).mockClear();
  });

  afterEach(() => {
    vi.mocked(microsoftAuthFetch).mockReset();
    vi.mocked(microsoftAuthFetch).mockImplementation(async () => tokenReply("AT-MICROSOFT") as never);
  });

  it("renews the shared sign-in once, not once per vault", async () => {
    given();
    const [tokenA, tokenB] = await Promise.all([
      getAccountBroker(A, "a1").getAccessToken("files"),
      getAccountBroker(B, "b1").getAccessToken("files"),
    ]);
    expect(tokenA).toBe("AT-MICROSOFT");
    expect(tokenB).toBe("AT-MICROSOFT");
    // One round trip: the second window waits for the first one's answer
    // instead of asking Microsoft for a grant that is being rotated right now.
    expect(vi.mocked(microsoftAuthFetch)).toHaveBeenCalledTimes(1);
  });

  it("carries a rotated sign-in into the other vault's slot", async () => {
    given();
    rotatesOnce();

    await getAccountBroker(A, "a1").getAccessToken("files");

    expect(secrets.get(accountSecretKey(A, "a1"))?.refreshToken).toBe("RT-2");
    // The other vault was never asked and may not even be open — its slot still
    // has to hold the token that works, or its next sync fails with a sign-in
    // error nobody caused.
    expect(secrets.get(accountSecretKey(B, "b1"))?.refreshToken).toBe("RT-2");
  });

  it("heals a vault that is only in the recents list", async () => {
    given();
    settings.set("lastVaultPaths", [A]);
    settings.set("recentVaults", [B]);
    rotatesOnce();

    await getAccountBroker(A, "a1").getAccessToken("files");
    expect(secrets.get(accountSecretKey(B, "b1"))?.refreshToken).toBe("RT-2");
  });

  /**
   * A refresh token is bound to the client that minted it, so a slot with a
   * different client ID is a different grant even for the same person — handing
   * it the rotated token would swap a working sign-in for one the provider
   * rejects.
   *
   * The protection lies TWICE (the grant key carries the client id, and the
   * slot is compared again before it is written), so the red counter-check only
   * falls when both are removed. That is deliberate: this test measures the
   * behaviour, not one particular guard.
   */
  it("leaves a slot with a different client registration alone", async () => {
    given({ clientIdInB: "other-cid" });
    rotatesOnce();

    await getAccountBroker(A, "a1").getAccessToken("files");
    expect(secrets.get(accountSecretKey(B, "b1"))?.refreshToken).toBe("RT-1");
  });

  /**
   * A label is not an identity. Two people in one company are easily called the
   * same thing, and the settings sync refuses to merge on a label for exactly
   * that reason — so an account without a provider-confirmed identity shares
   * nothing.
   */
  it("shares nothing when the identity is not provider-confirmed", async () => {
    given({ identityInB: null });
    rotatesOnce();

    await getAccountBroker(A, "a1").getAccessToken("files");
    expect(secrets.get(accountSecretKey(B, "b1"))?.refreshToken).toBe("RT-1");
    // The vault that DID the refresh keeps its own working token regardless.
    expect(secrets.get(accountSecretKey(A, "a1"))?.refreshToken).toBe("RT-2");
  });

  /**
   * The fan-out is a courtesy to the other vaults; the home slot is the one that
   * must not be lost. A registry that cannot be read (a vault on a drive that is
   * not plugged in) may therefore not take the refresh down with it.
   */
  it("still finishes the refresh when another vault cannot be read", async () => {
    given();
    cloudByVault.set(B, new Proxy([] as CloudAccountRecord[], {
      get() {
        throw new Error("drive is not there");
      },
    }));
    rotatesOnce();

    await expect(getAccountBroker(A, "a1").getAccessToken("files")).resolves.toBe("AT-1");
    expect(secrets.get(accountSecretKey(A, "a1"))?.refreshToken).toBe("RT-2");
  });
});
