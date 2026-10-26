import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudAccountRecord } from "@plainva/ui";

const pimRows: unknown[] = [];
const mailRows: unknown[] = [];
let records: CloudAccountRecord[] = [];
let entry = { id: "v1", name: "wiki", provider: "drive" };

vi.mock("./vaultRegistry", () => ({ getActiveVaultEntry: async () => entry }));
vi.mock("./pim/pimService", () => ({ listPimAccounts: async () => pimRows }));
vi.mock("./mail/mailRuntime", () => ({ listMobileMailAccounts: async () => mailRows }));
vi.mock("./cloudAccountsStore", () => ({ loadCloudAccounts: async () => records }));
vi.mock("./deviceSignInState", () => ({ deviceSignInStates: async () => new Map() }));
// What each service slot says on this device, and the card's own grant.
const pimStates = new Map<string, "active" | "signin">();
vi.mock("./deviceSignIn", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./deviceSignIn")>()),
  deviceSignInStates: async (kind: string, _vault: string, ids: string[]) =>
    new Map(ids.map((id) => [id, kind === "pim" ? pimStates.get(id) ?? "signin" : "signin"])),
}));
const grants = new Map<string, unknown>();
vi.mock("./accountBroker", () => ({ getAccountToken: async (_vault: string, accountId: string) => grants.get(accountId) ?? null }));
// The reachability rule has its own tests (fileSyncAccess.test.ts); here the
// file connection is simply assumed to work, so the fold is what is measured.
let filesReachable = true;
vi.mock("./fileSyncAccess", () => ({
  readStoredProvider: async () => (filesReachable ? { provider: "drive", creds: { refreshToken: "r" } } : null),
  filesViaBrokerToken: async () => false,
  resolveMobileFileAccess: () => ({ ready: filesReachable, blocked: !filesReachable }),
}));

import { loadAccountCards } from "./cloudAccountCards";

/**
 * Cards fold on the verified identity, and the files card names the ACCOUNT.
 *
 * Both were claimed in a comment long before they were true: the key came from
 * the label, and the files card carried the VAULT name — so a Google account
 * whose files and calendar were two cards could never be recognised as one,
 * on the one device where the merge would have helped most (finding
 * 2026-08-19).
 */
describe("loadAccountCards", () => {
  const identity = { issuer: "google", subject: "sub-1" };

  beforeEach(() => {
    pimRows.length = 0;
    mailRows.length = 0;
    records = [];
    entry = { id: "v1", name: "wiki", provider: "drive" };
    pimStates.clear();
    grants.clear();
  });

  it("folds a files card and a calendar card of the same verified account", async () => {
    records = [
      {
        id: "acc-1",
        family: "google",
        label: "me@example.com",
        verifiedProviderIdentity: identity,
        services: { files: { provider: "drive", vaultId: "v1" } },
      } as unknown as CloudAccountRecord,
    ];
    pimRows.push({
      id: "pim-1",
      provider: "google",
      label: "Anders benannt",
      config: { plainvaVerifiedProviderIdentity: identity },
    });

    const { cards } = await loadAccountCards();

    expect(cards).toHaveLength(1);
    expect(cards[0].services.sort()).toEqual(["calendar", "files"]);
    // And it is the account's address, with the vault as the second line.
    expect(cards[0].label).toBe("me@example.com");
    expect(cards[0].subtitle).toBe("wiki");
  });

  it("keeps the vault name when the account has no identity yet", async () => {
    const { cards } = await loadAccountCards();
    expect(cards[0].label).toBe("wiki");
    expect(cards[0].subtitle).toBeUndefined();
  });

  it("never folds two different accounts of the same family", async () => {
    pimRows.push(
      { id: "a", provider: "google", label: "Privat", config: { plainvaVerifiedProviderIdentity: identity } },
      { id: "b", provider: "google", label: "Arbeit", config: { plainvaVerifiedProviderIdentity: { issuer: "google", subject: "sub-2" } } },
    );
    entry = { id: "v1", name: "wiki", provider: "" };
    const { cards } = await loadAccountCards();
    expect(cards).toHaveLength(2);
  });
  it("says so when the file connection is configured but unreachable here", async () => {
    // The failure the phone used to hide: the registry knows the provider, so
    // the card claimed a connection while nothing came through.
    records = [];
    filesReachable = false;
    const { cards } = await loadAccountCards();
    filesReachable = true;
    expect(cards).toHaveLength(1);
    expect(cards[0].signIn).toBe("expired");
  });

  /**
   * The card's state is the card's own sign-in (plan "Verbinden", V0). The
   * TestFlight build 144 showed a yellow "anmelden" on a Google card that was
   * signed in and syncing: its state was folded from the per-service slots,
   * and a calendar without a slot of its own decided for the whole card.
   */
  it("reads a signed-in Google card as signed in although its calendar has no slot here", async () => {
    records = [{ id: "acc-1", family: "google", label: "me@example.com", verifiedProviderIdentity: identity, services: { files: { provider: "drive" }, calendar: { pimAccountId: "pim-1" } } } as unknown as CloudAccountRecord];
    pimRows.push({ id: "pim-1", provider: "google", label: "me@example.com", config: { plainvaVerifiedProviderIdentity: identity } });
    grants.set("acc-1", { clientId: "c", refreshToken: "r" });
    const { cards } = await loadAccountCards();
    expect(cards).toHaveLength(1);
    expect(cards[0].signIn).toBe("active");
  });

  it("reads a card signed out on this device as needing a sign-in, whatever its emptied service slots say", async () => {
    entry = { id: "v1", name: "wiki", provider: "" };
    records = [{ id: "acc-1", family: "google", label: "me@example.com", verifiedProviderIdentity: identity, services: { calendar: { pimAccountId: "pim-1" } } } as unknown as CloudAccountRecord];
    pimRows.push({ id: "pim-1", provider: "google", label: "me@example.com", config: { plainvaVerifiedProviderIdentity: identity } });
    // The calendar's slot exists (with the refresh token K2 emptied), the card's grant does not.
    pimStates.set("pim-1", "active");
    const { cards } = await loadAccountCards();
    expect(cards[0].signIn).toBe("signin");
  });

  it("keeps the rule of its services for a card without a sign-in of its own", async () => {
    entry = { id: "v1", name: "wiki", provider: "" };
    pimRows.push({ id: "pim-1", provider: "caldav", label: "me@icloud.com", config: { url: "https://caldav.icloud.com" } });
    pimStates.set("pim-1", "active");
    const { cards } = await loadAccountCards();
    expect(cards[0].signIn).toBe("active");
  });
});
