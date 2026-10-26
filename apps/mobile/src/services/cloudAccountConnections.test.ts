import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceConnectionError, type CloudAccountRecord } from "@plainva/ui";

let records: CloudAccountRecord[] = [];
const removed: string[] = [];
vi.mock("./cloudAccountsStore", () => ({
  loadCloudAccounts: async () => records,
  saveCloudAccounts: async (_vault: string, next: CloudAccountRecord[]) => { records = next; },
}));
vi.mock("./connectQueue", () => ({ startConnectQueue: vi.fn() }));
vi.mock("./vaultRegistry", () => ({ getActiveVaultEntry: async () => ({ id: "v1" }) }));
vi.mock("./mail/mailRuntime", () => ({ removeMobileMailAccount: async (id: string) => { removed.push(id); } }));

import { bindMailToConnection } from "./cloudAccountConnections";

/**
 * Plan "Verbinden", E7: when Google refuses Gmail, the check offers "Connect
 * with app password". The new mailbox takes the place of the refused one on
 * the same card - and only that one: a mailbox the card did not name as the
 * one to replace is still another account's change and refused.
 */
const card = (mail?: string): CloudAccountRecord => ({
  id: "card-a", family: "google", label: "anna@gmail.com",
  services: { files: { provider: "drive" }, ...(mail ? { mail: { mailAccountId: mail } } : {}) },
});

describe("binding a mailbox to a card", () => {
  beforeEach(() => { removed.length = 0; });

  it("a card without mail takes the mailbox", async () => {
    records = [card()];
    await bindMailToConnection({ vaultId: "v1", cloudAccountId: "card-a" }, "m-new");
    expect(records[0].services.mail).toEqual({ mailAccountId: "m-new" });
    expect(removed).toEqual([]);
  });

  it("replaces the mailbox Google refused, and removes it", async () => {
    records = [card("m-oauth")];
    await bindMailToConnection({ vaultId: "v1", cloudAccountId: "card-a", replacesMailAccountId: "m-oauth" }, "m-new");
    expect(records[0].services).toEqual({ files: { provider: "drive" }, mail: { mailAccountId: "m-new" } });
    expect(removed).toEqual(["m-oauth"]);
  });

  it("still refuses a mailbox it was not asked to replace", async () => {
    records = [card("m-other")];
    await expect(bindMailToConnection({ vaultId: "v1", cloudAccountId: "card-a", replacesMailAccountId: "m-oauth" }, "m-new"))
      .rejects.toBeInstanceOf(ServiceConnectionError);
    expect(records[0].services.mail).toEqual({ mailAccountId: "m-other" });
    expect(removed).toEqual([]);
  });
});
