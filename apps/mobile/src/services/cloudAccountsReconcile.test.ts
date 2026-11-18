import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeAccountMap, rememberRemovedAccount, type CloudAccountRecord } from "@plainva/ui";

/**
 * Sammelplan § 3.105: on the phone nothing reconciled the account cards any
 * more (the one caller sat in the settings export until 31.07.), so a card
 * kept naming a mailbox that was removed, and two cards on one mailbox both
 * stayed. The open vault's cards now follow its calendars and mailboxes.
 */

const stored = new Map<string, unknown>();
let mailboxes: { id: string; label: string; user: string; host: string; kind: "microsoft" }[] = [];
let calendars: { id: string; provider: "microsoft"; label: string; config: Record<string, unknown> }[] = [];
let activeVault = { id: "v1", provider: undefined as string | undefined };
let heldAfterRebuild = false;

vi.mock("@plainva/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@plainva/ui")>()),
  getPlatformServices: () => ({
    loadSettings: async () => ({
      get: async (key: string) => stored.get(key),
      set: async (key: string, value: unknown) => { stored.set(key, structuredClone(value)); },
      delete: async (key: string) => { stored.delete(key); },
      save: async () => undefined,
    }),
  }),
}));
vi.mock("@plainva/ui/mail", () => ({
  listMailAccounts: async () => mailboxes,
  mailAccountKind: (account: { kind?: string }) => account.kind ?? "imap",
}));
vi.mock("./pim/pimService", () => ({ listPimAccounts: async () => calendars, pimAccountsHeldAfterRebuild: async () => heldAfterRebuild }));
vi.mock("./vaultRegistry", () => ({ getActiveVaultEntry: async () => activeVault }));

import { loadCloudAccounts, refreshCloudAccounts, startCloudAccountsReconcile } from "./cloudAccountsStore";
import { accountMapKey } from "./profileAccountMap";

const cardsKey = "cloudAccounts_v1";
const card = (id: string, services: CloudAccountRecord["services"]): CloudAccountRecord => ({ id, family: "microsoft", label: "anna@example.com", services });
const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

describe("the phone reconciles its account cards (Sammelplan § 3.105)", () => {
  let stop: (() => void) | null = null;
  beforeEach(() => {
    stored.clear();
    mailboxes = [];
    calendars = [];
    activeVault = { id: "v1", provider: undefined };
    heldAfterRebuild = false;
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("CustomEvent", class extends Event { constructor(type: string) { super(type); } });
  });
  afterEach(() => {
    stop?.();
    stop = null;
    vi.unstubAllGlobals();
  });

  it("when the vault opens, a card loses the reference to a mailbox that was removed", async () => {
    calendars = [{ id: "pim-1", provider: "microsoft", label: "anna@example.com", config: {} }];
    stored.set(cardsKey, [card("card-a", { calendar: { pimAccountId: "pim-1" }, mail: { mailAccountId: "mail-gone" } })]);

    stop = startCloudAccountsReconcile("v1", () => true);
    await settle();

    expect((await loadCloudAccounts("v1"))[0].services).toEqual({ calendar: { pimAccountId: "pim-1" } });
  });

  it("after a mailbox is removed, its card follows without a restart", async () => {
    mailboxes = [{ id: "mail-1", label: "anna@example.com", user: "anna@example.com", host: "", kind: "microsoft" }];
    calendars = [{ id: "pim-1", provider: "microsoft", label: "anna@example.com", config: {} }];
    stored.set(cardsKey, [card("card-a", { calendar: { pimAccountId: "pim-1" }, mail: { mailAccountId: "mail-1" } })]);
    stop = startCloudAccountsReconcile("v1", () => true);
    await settle();
    expect((await loadCloudAccounts("v1"))[0].services.mail).toEqual({ mailAccountId: "mail-1" });

    mailboxes = [];
    window.dispatchEvent(new CustomEvent("m-mail-changed"));
    await settle();

    expect((await loadCloudAccounts("v1"))[0].services).toEqual({ calendar: { pimAccountId: "pim-1" } });
  });

  it("of two cards naming one mailbox, the second loses it", async () => {
    mailboxes = [{ id: "mail-1", label: "anna@example.com", user: "anna@example.com", host: "", kind: "microsoft" }];
    stored.set(cardsKey, [card("card-a", { mail: { mailAccountId: "mail-1" } }), card("card-b", { mail: { mailAccountId: "mail-1" } })]);

    stop = startCloudAccountsReconcile("v1", () => true);
    await settle();

    expect((await loadCloudAccounts("v1")).map((r) => r.id)).toEqual(["card-a"]);
  });

  it("keeps the calendar references while the calendar list cannot be read yet", async () => {
    stored.set(cardsKey, [card("card-a", { calendar: { pimAccountId: "pim-1" } })]);

    stop = startCloudAccountsReconcile("v1", () => false);
    await settle();

    expect((await loadCloudAccounts("v1"))[0].services).toEqual({ calendar: { pimAccountId: "pim-1" } });
  });

  it("keeps the calendar references while a rebuilt index database has none of its accounts back yet", async () => {
    // Rebuilt at the start: the calendar rows went with the database, and the settings sync has not brought them yet.
    heldAfterRebuild = true;
    stored.set(cardsKey, [card("card-a", { calendar: { pimAccountId: "pim-1" } })]);
    stop = startCloudAccountsReconcile("v1", () => true);
    await settle();
    expect(await loadCloudAccounts("v1")).toEqual([card("card-a", { calendar: { pimAccountId: "pim-1" } })]);
  });

  it("one of two accounts back after the rebuild: the other's card keeps its reference too", async () => {
    heldAfterRebuild = true;
    calendars = [{ id: "pim-1", provider: "microsoft", label: "anna@example.com", config: {} }];
    stored.set(cardsKey, [card("card-a", { calendar: { pimAccountId: "pim-1" } }), { ...card("card-b", { calendar: { pimAccountId: "pim-2" } }), label: "ben@example.com" }]);
    stop = startCloudAccountsReconcile("v1", () => true);
    await settle();
    expect((await loadCloudAccounts("v1")).map((c) => [c.id, c.services.calendar?.pimAccountId])).toEqual([["card-a", "pim-1"], ["card-b", "pim-2"]]);
  });

  it("held after the rebuild, an account removed on this device does not keep its card's reference", async () => {
    heldAfterRebuild = true;
    calendars = [{ id: "pim-1", provider: "microsoft", label: "anna@example.com", config: {} }];
    stored.set(cardsKey, [card("card-a", { calendar: { pimAccountId: "pim-1" } }), { ...card("card-b", { calendar: { pimAccountId: "pim-2" }, mail: { mailAccountId: "mail-2" } }), label: "ben@example.com" }]);
    mailboxes = [{ id: "mail-2", label: "ben@example.com", user: "ben@example.com", host: "", kind: "microsoft" }];
    // Removed here in this window: the row is gone and the tombstone is written (`noteAccountRemovedLocally`).
    stored.set(accountMapKey("v1"), rememberRemovedAccount(normalizeAccountMap(null), "pim", "pim-2"));
    stop = startCloudAccountsReconcile("v1", () => true);
    await settle();
    const cards = await loadCloudAccounts("v1");
    expect(cards.find((c) => c.id === "card-a")?.services.calendar).toEqual({ pimAccountId: "pim-1" });
    expect(cards.find((c) => c.id === "card-b")?.services).toEqual({ mail: { mailAccountId: "mail-2" } });
  });

  it("keeps a files reference when another vault is the open one", async () => {
    activeVault = { id: "v2", provider: "drive" };
    stored.set(cardsKey, [card("card-a", { files: { provider: "onedrive" } })]);

    await refreshCloudAccounts("v1", true);

    expect((await loadCloudAccounts("v1"))[0].services).toEqual({ files: { provider: "onedrive" } });
  });

  it("stops listening when the vault closes", async () => {
    mailboxes = [{ id: "mail-1", label: "anna@example.com", user: "anna@example.com", host: "", kind: "microsoft" }];
    stored.set(cardsKey, [card("card-a", { mail: { mailAccountId: "mail-1" } })]);
    stop = startCloudAccountsReconcile("v1", () => true);
    await settle();
    stop();
    stop = null;

    mailboxes = [];
    window.dispatchEvent(new CustomEvent("m-mail-changed"));
    await settle();

    expect((await loadCloudAccounts("v1"))[0].services.mail).toEqual({ mailAccountId: "mail-1" });
  });
});
