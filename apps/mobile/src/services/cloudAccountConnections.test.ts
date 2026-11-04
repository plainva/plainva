import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceConnectionError, type CloudAccountRecord } from "@plainva/ui";

let records: CloudAccountRecord[] = [];
const replaced: Array<[string, string]> = [];
vi.mock("./cloudAccountsStore", () => ({
  loadCloudAccounts: async () => records,
  saveCloudAccounts: async (_vault: string, next: CloudAccountRecord[]) => { records = next; },
}));
vi.mock("./connectQueue", () => ({ startConnectQueue: vi.fn() }));
vi.mock("./vaultRegistry", () => ({ getActiveVaultEntry: async () => ({ id: "v1" }) }));
vi.mock("./mail/mailRuntime", () => ({ replaceMobileMailbox: async (from: string, to: string) => { replaced.push([from, to]); } }));
// The mailboxes this vault holds.
let mailboxes: string[] = [];
vi.mock("@plainva/ui/mail", () => ({ listMailAccounts: async () => mailboxes.map((id) => ({ id })) }));

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
  beforeEach(() => { replaced.length = 0; mailboxes = ["m-new", "m-oauth", "m-other"]; });

  it("a card without mail takes the mailbox", async () => {
    records = [card()];
    await bindMailToConnection({ vaultId: "v1", cloudAccountId: "card-a" }, "m-new");
    expect(records[0].services.mail).toEqual({ mailAccountId: "m-new" });
    expect(replaced).toEqual([]);
  });

  it("replaces the mailbox Google refused, carrying its settings over (review finding 1)", async () => {
    records = [card("m-oauth")];
    await bindMailToConnection({ vaultId: "v1", cloudAccountId: "card-a", replacesMailAccountId: "m-oauth" }, "m-new");
    expect(records[0].services).toEqual({ files: { provider: "drive" }, mail: { mailAccountId: "m-new" } });
    expect(replaced).toEqual([["m-oauth", "m-new"]]);
  });

  it("a card still naming a removed mailbox takes the new one (Sammelplan § 3.105)", async () => {
    // Mail removed at this card, then connected again: the card kept the old reference.
    records = [card("m-removed")];
    mailboxes = ["m-new"];
    await bindMailToConnection({ vaultId: "v1", cloudAccountId: "card-a" }, "m-new");
    expect(records[0].services.mail).toEqual({ mailAccountId: "m-new" });
  });

  it("takes the mailbox off a card the reconcile wrote for it meanwhile (Sammelplan § 3.107 Nr. 1)", async () => {
    const stray: CloudAccountRecord = { id: "stray", family: "google", label: "anna@gmail.com", services: { mail: { mailAccountId: "m-new" } } };
    records = [stray, card()];
    await bindMailToConnection({ vaultId: "v1", cloudAccountId: "card-a" }, "m-new");
    expect(records.map((r) => r.id)).toEqual(["card-a"]);
    expect(records[0].services.mail).toEqual({ mailAccountId: "m-new" });
  });

  it("still refuses a mailbox it was not asked to replace", async () => {
    records = [card("m-other")];
    await expect(bindMailToConnection({ vaultId: "v1", cloudAccountId: "card-a", replacesMailAccountId: "m-oauth" }, "m-new"))
      .rejects.toBeInstanceOf(ServiceConnectionError);
    expect(records[0].services.mail).toEqual({ mailAccountId: "m-other" });
    expect(replaced).toEqual([]);
  });
});
