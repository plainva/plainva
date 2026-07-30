import { beforeEach, describe, it, expect, vi } from "vitest";
import type { CloudAccountRecord, StoredAccountToken } from "@plainva/ui";

const secrets = new Map<string, StoredAccountToken>();
const cloudRecords: CloudAccountRecord[] = [];

vi.mock("./CredentialManager", () => ({
  credentialManager: { readSecret: async (key: string) => secrets.get(key) ?? null },
}));
vi.mock("./cloudAccounts", () => ({ loadCloudAccounts: async () => cloudRecords }));
vi.mock("./authFetch", () => ({ microsoftAuthFetch: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

import {
  accountSecretKey,
  brokerFamily,
  brokerTokenProvider,
  describeBrokerLookup,
  googleScopeFor,
  microsoftScopeFor,
  microsoftUnionScope,
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
    expect(a.startsWith("account_acc1_")).toBe(true);
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
});
