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
});
