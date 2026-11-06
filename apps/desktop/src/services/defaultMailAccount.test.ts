import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultMailAccountForProfile,
  defaultMailAccountFromProfile,
  emptyAccountMap,
  importAccountMetadata,
  mailboxesSwitchedOn,
  PROFILE_FIELDS,
  setPlatformServices,
  type AccountImportPorts,
  type CloudAccountRecord,
  type ProfileAccountMap,
} from "@plainva/ui";
import {
  foldDuplicateMailboxes,
  isDefaultMailAccount,
  listMailAccounts,
  mailAccountsKey,
  pickDefaultMailAccount,
  replaceMailAccounts,
  type MailAccountConfig,
} from "@plainva/ui/mail";

/**
 * The default mailbox (finding 2026-11-06, M1; decision E1). Everything that
 * had to choose a mailbox without being told one took the first of the list;
 * one shared rule now decides, in both shells.
 */

const work = { id: "work" };
const home = { id: "home" };
const club = { id: "club" };

describe("pickDefaultMailAccount", () => {
  it("takes the default mailbox where nothing names one", () => {
    expect(pickDefaultMailAccount([work, home, club], "home")).toBe(home);
  });

  it("lets a named mailbox win - a draft's, a reply's, the open one", () => {
    expect(pickDefaultMailAccount([work, home, club], "home", "club")).toBe(club);
    // A named one that is gone does not count; the default does.
    expect(pickDefaultMailAccount([work, home, club], "home", "removed")).toBe(home);
  });

  it("falls back to the first when there is no default or it is gone", () => {
    expect(pickDefaultMailAccount([work, home], "")).toBe(work);
    expect(pickDefaultMailAccount([work, home], undefined)).toBe(work);
    expect(pickDefaultMailAccount([work, home], "removed")).toBe(work);
    expect(pickDefaultMailAccount([], "home")).toBeNull();
  });

  it("falls back to the first when the default's mail is switched off for the vault", () => {
    const cards = [{ id: "c-home", family: "google", label: "home@example.org", services: { mail: { mailAccountId: "home" } }, off: ["mail"] }] as unknown as CloudAccountRecord[];
    const on = mailboxesSwitchedOn([work, home, club], cards);
    expect(on.map((entry) => entry.id)).toEqual(["work", "club"]);
    expect(pickDefaultMailAccount(on, "home")).toBe(work);
  });

  it("marks the mailbox it falls to", () => {
    expect(isDefaultMailAccount([work, home], "home", "home")).toBe(true);
    expect(isDefaultMailAccount([work, home], "", "work")).toBe(true);
    expect(isDefaultMailAccount([work, home], "", "home")).toBe(false);
  });
});

describe("the default mailbox travels with the vault (E1)", () => {
  it("is a member field of the mail area, carried by both shells", () => {
    const field = PROFILE_FIELDS.find((entry) => entry.logical === "defaultMailAccount");
    expect(field).toMatchObject({ scope: "member", kind: "text", area: "mail", desktop: "store", mobile: "defaultMailAccount" });
  });

  it("leaves as the logical id and arrives as this device's id", () => {
    const map: ProfileAccountMap = { ...emptyAccountMap(), mailLocalToLogical: { "local-home": "logical-home" } };
    expect(defaultMailAccountForProfile("local-home", map)).toBe("logical-home");
    expect(defaultMailAccountForProfile("", map)).toBe("");
    expect(defaultMailAccountForProfile(undefined, map)).toBeUndefined();
    const imported = new Map([["logical-home", "other-device-home"]]);
    expect(defaultMailAccountFromProfile("logical-home", imported)).toBe("other-device-home");
    expect(defaultMailAccountFromProfile("", imported)).toBe("");
    expect(defaultMailAccountFromProfile(42, imported)).toBeUndefined();
  });
});

describe("a round trip through the settings profile", () => {
  const settings = new Map<string, unknown>();
  beforeEach(() => {
    settings.clear();
    setPlatformServices({
      loadSettings: async () => ({
        get: async <T,>(key: string) => (settings.get(key) as T | undefined) ?? null,
        set: async (key: string, value: unknown) => { settings.set(key, structuredClone(value)); },
        delete: async (key: string) => settings.delete(key),
        keys: async () => [...settings.keys()],
        save: async () => undefined,
      }),
      credentials: {
        readSecret: async () => null,
        writeSecret: async () => undefined,
        removeSecret: async () => undefined,
      },
      openExternal: async () => undefined,
    });
  });

  const row = (id: string, user: string): MailAccountConfig => ({ id, label: user, host: "imap.example.org", port: 993, user });

  it("names the same mailbox on a device where it has another id", async () => {
    // Device A: its mailboxes, its default, the document it publishes.
    const mapA: ProfileAccountMap = { ...emptyAccountMap(), mailLocalToLogical: { "a-work": "work", "a-home": "home" } };
    const published = {
      mailAccounts: [row("work", "me@work.example"), row("home", "me@home.example")],
      defaultMailAccount: defaultMailAccountForProfile("a-home", mapA),
    };
    expect(published.defaultMailAccount).toBe("home");

    // Device B knows the home mailbox under its own id.
    const B = "/vault/b";
    await replaceMailAccounts(B, [row("b-home", "me@home.example")]);
    let map = emptyAccountMap();
    const ports: AccountImportPorts = {
      listPimAccounts: async () => [],
      upsertPimAccount: async () => undefined,
      deletePimAccount: async () => undefined,
      listCalendars: async () => [],
      setCalendarSelected: async () => undefined,
      listTaskLists: async () => [],
      setTaskListSelected: async () => undefined,
      listMailAccounts: () => listMailAccounts(B),
      replaceMailAccounts: (accounts) => replaceMailAccounts(B, accounts),
      listCloudAccounts: async () => [],
      replaceCloudAccounts: async () => undefined,
      pimSecretSlot: (id) => `pim:${id}`,
      mailSecretSlot: (id) => `mail:${id}`,
      loadAccountMap: async () => map,
      saveAccountMap: async (next) => void (map = next),
    };
    const idMap = await importAccountMetadata(published, ports);
    const localDefault = defaultMailAccountFromProfile(published.defaultMailAccount, idMap.mail);
    expect(localDefault).toBe("b-home");
    expect(pickDefaultMailAccount(await listMailAccounts(B), localDefault)?.user).toBe("me@home.example");
    // And back out of B, as the logical id again.
    expect(defaultMailAccountForProfile(localDefault, map)).toBe("home");
    expect(settings.get(mailAccountsKey(B))).toBeDefined();
  });

  it("follows a folded duplicate to the entry that is kept", async () => {
    const V = "/vault/fold";
    await replaceMailAccounts(V, [row("keep", "me@home.example"), row("twin", "me@home.example")]);
    let stored = "twin";
    await foldDuplicateMailboxes(V, "keep", {
      listCards: async () => [],
      replaceCards: async () => undefined,
      defaultMailAccount: { read: async () => stored, write: async (id) => void (stored = id) },
    });
    expect(stored).toBe("keep");
  });
});
