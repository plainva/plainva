import { beforeEach, describe, expect, it } from "vitest";
import {
  accountDisplayName,
  emptyAccountMap,
  familyLabel,
  importAccountMetadata,
  mailAccountsForProfile,
  setPlatformServices,
  type AccountImportPorts,
  type CloudAccountRecord,
  type ProfileAccountMap,
} from "@plainva/ui";
import {
  collapseMailAccountRows,
  duplicateMailboxGroups,
  foldDuplicateMailboxes,
  healMailAccounts,
  listMailAccounts,
  mailAccountsKey,
  mailboxDuplicateEntries,
  mailSecretKey,
  mergeMailAccountRows,
  captureMailAsNote,
  loadMailAccountAliases,
  repointSnoozes,
  resolveMailAccountAlias,
  sameMailAccount,
  readStoredVacation,
  removeMailAccount,
  replaceMailAccounts,
  saveStoredVacation,
  updateMailAccount,
  type MailAccountConfig,
  type MailCaptureAdapter,
  type MailMessage,
  type SnoozeEntry,
} from "@plainva/ui/mail";

/**
 * One mailbox stored several times (finding 2026-11-06, M2).
 *
 * The fixture has the shape of the vault the finding was read from: eight
 * mailbox rows, an Outlook mailbox once and one Gmail address SEVEN times under
 * one id, all IMAP, only the first of the seven with its first fetch and its
 * signature. Every address and secret here is a placeholder.
 */

const settings = new Map<string, unknown>();
const secrets = new Map<string, unknown>();
const removed: Array<[string, string, string]> = [];

beforeEach(() => {
  settings.clear();
  secrets.clear();
  removed.length = 0;
  setPlatformServices({
    loadSettings: async () => ({
      get: async <T,>(key: string) => (settings.get(key) as T | undefined) ?? null,
      set: async (key: string, value: unknown) => { settings.set(key, structuredClone(value)); },
      delete: async (key: string) => settings.delete(key),
      keys: async () => [...settings.keys()],
      save: async () => undefined,
    }),
    credentials: {
      readSecret: async <T,>(key: string) => (secrets.get(key) as T | undefined) ?? null,
      writeSecret: async (key: string, value: unknown) => { secrets.set(key, value); },
      removeSecret: async (key: string) => { secrets.delete(key); },
    },
    openExternal: async () => undefined,
    noteAccountRemoved: async (vault, kind, id) => { removed.push([vault, kind, id]); },
  });
});

const VAULT = "/vault/wiki";
const GMAIL_ID = "gmail-placeholder-id";

const outlook: MailAccountConfig = {
  id: "outlook-placeholder-id",
  label: "person@outlook.example",
  host: "outlook.office365.com",
  port: 993,
  user: "person@outlook.example",
  smtpHost: "smtp.office365.com",
  smtpPort: 587,
};
const gmail = (over: Partial<MailAccountConfig> = {}): MailAccountConfig => ({
  id: GMAIL_ID,
  label: "person@gmail.example",
  host: "imap.gmail.com",
  port: 993,
  user: "person@gmail.example",
  smtpHost: "smtp.gmail.com",
  smtpPort: 465,
  ...over,
});
/** The eight stored rows: Outlook, then Gmail seven times, the first with its stamp and signature. */
const eightRows = (): MailAccountConfig[] => [
  outlook,
  gmail({ firstFetchAt: "2026-09-30T08:00:00.000Z", signature: "Signature placeholder" }),
  ...Array.from({ length: 6 }, () => gmail()),
];

function importPorts(map: ProfileAccountMap = emptyAccountMap()) {
  const state = { map, cloud: [] as CloudAccountRecord[] };
  const api: AccountImportPorts = {
    listPimAccounts: async () => [],
    upsertPimAccount: async () => undefined,
    deletePimAccount: async () => undefined,
    listCalendars: async () => [],
    setCalendarSelected: async () => undefined,
    listTaskLists: async () => [],
    setTaskListSelected: async () => undefined,
    listMailAccounts: () => listMailAccounts(VAULT),
    replaceMailAccounts: (accounts) => replaceMailAccounts(VAULT, accounts),
    listCloudAccounts: async () => state.cloud,
    replaceCloudAccounts: async (accounts) => void (state.cloud = [...accounts]),
    pimSecretSlot: (accountId) => `pim-slot:${accountId}`,
    mailSecretSlot: (accountId) => `mail-slot:${accountId}`,
    loadAccountMap: async () => state.map,
    saveAccountMap: async (next) => void (state.map = next),
    newId: () => "generated-id",
  };
  return { state, api };
}

const stored = () => settings.get(mailAccountsKey(VAULT)) as MailAccountConfig[];

describe("same-id rows are one mailbox", () => {
  it("every read sees the eight rows as two mailboxes, keeping the first fetch and the signature", async () => {
    settings.set(mailAccountsKey(VAULT), eightRows());
    const rows = await listMailAccounts(VAULT);
    expect(rows.map((row) => row.id)).toEqual([outlook.id, GMAIL_ID]);
    expect(rows[1]).toMatchObject({ firstFetchAt: "2026-09-30T08:00:00.000Z", signature: "Signature placeholder" });
  });

  it("the vault-open heal writes the folded list once, and then has nothing to do", async () => {
    settings.set(mailAccountsKey(VAULT), eightRows());
    expect(await healMailAccounts(VAULT)).toBe(true);
    expect(stored().map((row) => row.id)).toEqual([outlook.id, GMAIL_ID]);
    expect(stored()[1].signature).toBe("Signature placeholder");
    expect(await healMailAccounts(VAULT)).toBe(false);
  });

  it("a field only a later copy set is kept, and the earlier first fetch wins", () => {
    const merged = mergeMailAccountRows(
      gmail({ firstFetchAt: "2026-10-02T00:00:00.000Z", senders: ["a@x.example"], signatures: { "a@x.example": "A" } }),
      gmail({ firstFetchAt: "2026-09-30T00:00:00.000Z", sieveHost: "sieve.example", senders: ["b@x.example"], signatures: { "b@x.example": "B" } }),
    );
    expect(merged).toMatchObject({
      id: GMAIL_ID,
      firstFetchAt: "2026-09-30T00:00:00.000Z",
      sieveHost: "sieve.example",
      senders: ["a@x.example", "b@x.example"],
      signatures: { "a@x.example": "A", "b@x.example": "B" },
    });
    // A list without repeats is handed back as it is.
    const plain = [outlook, gmail()];
    expect(collapseMailAccountRows(plain)).toBe(plain);
  });

  it("no write path stores one id twice", async () => {
    await replaceMailAccounts(VAULT, eightRows());
    expect(stored()).toHaveLength(2);
    settings.set(mailAccountsKey(VAULT), eightRows());
    await updateMailAccount(VAULT, GMAIL_ID, { label: "Private" });
    expect(stored().map((row) => [row.id, row.label])).toEqual([[outlook.id, outlook.label], [GMAIL_ID, "Private"]]);
  });

  it("removing one mailbox leaves the other standing", async () => {
    settings.set(mailAccountsKey(VAULT), eightRows());
    await removeMailAccount(VAULT, GMAIL_ID);
    expect((await listMailAccounts(VAULT)).map((row) => row.id)).toEqual([outlook.id]);
    settings.set(mailAccountsKey(VAULT), eightRows());
    await removeMailAccount(VAULT, outlook.id);
    expect((await listMailAccounts(VAULT)).map((row) => row.id)).toEqual([GMAIL_ID]);
  });

  it("the profile export carries each mailbox once", async () => {
    settings.set(mailAccountsKey(VAULT), eightRows());
    expect(mailAccountsForProfile(await listMailAccounts(VAULT), emptyAccountMap())).toHaveLength(2);
  });
});

describe("the settings import folds rows of one mailbox", () => {
  it("a document with three rows of one address leaves one row, and importing it twice changes nothing", async () => {
    settings.set(mailAccountsKey(VAULT), [outlook, gmail({ firstFetchAt: "2026-09-30T08:00:00.000Z" })]);
    const { api } = importPorts();
    const document = {
      mailAccounts: [
        outlook,
        gmail({ id: "old-imap-1", signature: "Signature placeholder" }),
        gmail({ id: "old-imap-2" }),
        gmail({ id: "old-imap-3", senders: ["alias@gmail.example"] }),
      ],
    };
    await importAccountMetadata(document, api);
    const once = structuredClone(stored());
    expect(once.map((row) => row.id)).toEqual([outlook.id, GMAIL_ID]);
    // Every set field survives, and the stamp this device had is not taken back.
    expect(once[1]).toMatchObject({ signature: "Signature placeholder", senders: ["alias@gmail.example"], firstFetchAt: "2026-09-30T08:00:00.000Z" });

    await importAccountMetadata(document, api);
    expect(stored()).toEqual(once);
  });

  it("a document carrying one id seven times leaves one row on a device that never had it", async () => {
    const { api } = importPorts();
    await importAccountMetadata({ mailAccounts: eightRows() }, api);
    expect(stored().map((row) => row.id)).toEqual([outlook.id, GMAIL_ID]);
    expect(stored()[1]).toMatchObject({ firstFetchAt: "2026-09-30T08:00:00.000Z", signature: "Signature placeholder" });
  });
});

describe("rows of one address under different ids go before the person", () => {
  const card = (over: Partial<CloudAccountRecord> = {}): CloudAccountRecord => ({
    id: "card-google",
    family: "google",
    label: "person@gmail.example",
    services: { mail: { mailAccountId: "gmail-b" }, calendar: { pimAccountId: "pim-1" }, files: { provider: "drive" } },
    ...over,
  });

  it("finds each address stored under more than one id, and nothing else", () => {
    expect(duplicateMailboxGroups(eightRows())).toEqual([]);
    expect(duplicateMailboxGroups([outlook, gmail({ id: "gmail-a" }), gmail({ id: "gmail-b", user: "PERSON@gmail.example " })]))
      .toEqual([{ identity: "imap|imap.gmail.com|993|person@gmail.example", accountIds: ["gmail-a", "gmail-b"] }]);
  });

  it("names each entry by its card and its sign-in on this device", async () => {
    settings.set(mailAccountsKey(VAULT), [gmail({ id: "gmail-a" }), gmail({ id: "gmail-b" })]);
    secrets.set(mailSecretKey(VAULT, "gmail-b"), { pass: "placeholder" });
    const [group] = await mailboxDuplicateEntries(VAULT, [card()]);
    expect(group.map((entry) => [entry.account.id, entry.signedIn, entry.card?.id ?? null])).toEqual([
      ["gmail-a", false, null],
      ["gmail-b", true, "card-google"],
    ]);
  });

  it("keeping one points the card's mail at it and leaves calendar and files where they were", async () => {
    settings.set(mailAccountsKey(VAULT), [outlook, gmail({ id: "gmail-a" }), gmail({ id: "gmail-b", signature: "Signature placeholder", firstFetchAt: "2026-09-30T08:00:00.000Z" })]);
    secrets.set(mailSecretKey(VAULT, "gmail-b"), { pass: "placeholder" });
    await saveStoredVacation(VAULT, "gmail-b", { enabled: true, message: "Away" });
    let cards = [card(), card({ id: "card-outlook", family: "microsoft", label: outlook.user, services: { mail: { mailAccountId: outlook.id } } })];

    const dropped = await foldDuplicateMailboxes(VAULT, "gmail-a", {
      listCards: async () => cards,
      replaceCards: async (next) => void (cards = next),
    });

    expect(dropped).toEqual(["gmail-b"]);
    const rows = await listMailAccounts(VAULT);
    expect(rows.map((row) => row.id)).toEqual([outlook.id, "gmail-a"]);
    expect(rows[1]).toMatchObject({ signature: "Signature placeholder", firstFetchAt: "2026-09-30T08:00:00.000Z" });
    // Mail, calendar and files of the card hit rows that exist.
    expect(cards[0].services).toEqual({ mail: { mailAccountId: "gmail-a" }, calendar: { pimAccountId: "pim-1" }, files: { provider: "drive" } });
    expect(rows.some((row) => row.id === cards[0].services.mail!.mailAccountId)).toBe(true);
    expect(cards[1].services.mail!.mailAccountId).toBe(outlook.id);
    // The sign-in the kept entry lacked comes along; the removed one leaves its tombstone and no slot.
    expect(secrets.get(mailSecretKey(VAULT, "gmail-a"))).toEqual({ pass: "placeholder" });
    expect(secrets.has(mailSecretKey(VAULT, "gmail-b"))).toBe(false);
    expect(removed).toEqual([[VAULT, "mail", "gmail-b"]]);
    expect(await readStoredVacation(VAULT, "gmail-a")).toEqual({ enabled: true, message: "Away" });
  });

  it("the kept entry keeps its own sign-in and its own fields", async () => {
    settings.set(mailAccountsKey(VAULT), [gmail({ id: "gmail-a", label: "Mine", signature: "Own" }), gmail({ id: "gmail-b", signature: "Other" })]);
    secrets.set(mailSecretKey(VAULT, "gmail-a"), { pass: "own" });
    secrets.set(mailSecretKey(VAULT, "gmail-b"), { pass: "other" });
    await foldDuplicateMailboxes(VAULT, "gmail-a", { listCards: async () => [], replaceCards: async () => undefined });
    expect(secrets.get(mailSecretKey(VAULT, "gmail-a"))).toEqual({ pass: "own" });
    expect(await listMailAccounts(VAULT)).toEqual([gmail({ id: "gmail-a", label: "Mine", signature: "Own" })]);
  });

  it("an entry that is gone is refused, and a mailbox without twins changes nothing", async () => {
    settings.set(mailAccountsKey(VAULT), [outlook]);
    const ports = { listCards: async () => [], replaceCards: async () => { throw new Error("must not write"); } };
    await expect(foldDuplicateMailboxes(VAULT, "missing", ports)).rejects.toThrow("mailbox-fold-target-missing");
    expect(await foldDuplicateMailboxes(VAULT, outlook.id, ports)).toEqual([]);
  });
});

describe("what still names a folded entry finds the kept one", () => {
  const twins = () => [gmail({ id: "gmail-a" }), gmail({ id: "gmail-b" })];
  const ports = (extra: Record<string, unknown> = {}) => ({ listCards: async () => [], replaceCards: async () => undefined, ...extra });

  it("moves the messages put aside in a removed entry onto the kept one", async () => {
    settings.set(mailAccountsKey(VAULT), twins());
    let snoozes: unknown = [
      { account: "gmail-b", folder: "INBOX", id: "7", until: 2000 },
      { account: "gmail-a", folder: "INBOX", id: "7", until: 1000 },
      { account: outlook.id, folder: "INBOX", id: "7", until: 1000 },
    ];
    let place = "gmail-b";
    await foldDuplicateMailboxes(VAULT, "gmail-a", ports({
      snoozes: { read: async () => snoozes, write: async (next: SnoozeEntry[]) => void (snoozes = next) },
      rememberedMailbox: { read: async () => place, write: async (id: string) => void (place = id) },
    }));
    // The same message under both entries is one entry, the later return winning.
    expect(snoozes).toEqual([
      { account: "gmail-a", folder: "INBOX", id: "7", until: 2000 },
      { account: outlook.id, folder: "INBOX", id: "7", until: 1000 },
    ]);
    expect(place).toBe("gmail-a");
  });

  it("leaves snoozes of other mailboxes as they are", () => {
    const state: SnoozeEntry[] = [{ account: "work", folder: "INBOX", id: "1", until: 5 }];
    expect(repointSnoozes(state, "gmail-a", ["gmail-b"])).toBe(state);
  });

  it("records the removed id as standing for the kept one, chains included", async () => {
    settings.set(mailAccountsKey(VAULT), [gmail({ id: "gmail-a" }), gmail({ id: "gmail-b" }), gmail({ id: "gmail-c" })]);
    await foldDuplicateMailboxes(VAULT, "gmail-b", ports());
    expect(await loadMailAccountAliases(VAULT)).toEqual({ "gmail-a": "gmail-b", "gmail-c": "gmail-b" });
    // An older alias that pointed at an id folded now follows on.
    expect(resolveMailAccountAlias({ old: "gmail-a", "gmail-a": "gmail-b" }, "old")).toBe("gmail-b");
    expect(resolveMailAccountAlias({ x: "y", y: "x" }, "x")).toBe("x");
    expect(sameMailAccount({ "gmail-a": "gmail-b" }, "gmail-a", "gmail-b")).toBe(true);
    expect(sameMailAccount({ "gmail-a": "gmail-b" }, "gmail-a", "gmail-a")).toBe(true);
    expect(sameMailAccount({}, "gmail-a", "gmail-b")).toBe(false);
    expect(sameMailAccount({}, undefined, "gmail-b")).toBe(false);
  });

  it("a note filed from a removed entry is found again, not filed a second time", async () => {
    const files = new Map<string, string>();
    const adapter: MailCaptureAdapter = {
      readTextFile: async (path) => {
        const content = files.get(path);
        if (content === undefined) throw new Error("not found");
        return content;
      },
      writeTextFile: async (path, content) => void files.set(path, content),
      exists: async (path) => files.has(path),
      createDir: async () => undefined,
    };
    const message: MailMessage = { id: "4711", subject: "Invoice", from: "a@example.org", to: "person@gmail.example", dateTs: Date.UTC(2026, 10, 6, 9), text: "Hello", html: null, attachments: [] };
    const first = await captureMailAsNote({ adapter, message, accountId: "gmail-b", mailbox: "INBOX", folder: "Mail" });
    // Folded: gmail-b is gone, gmail-a is kept.
    const again = await captureMailAsNote({ adapter, message, accountId: "gmail-a", mailbox: "INBOX", folder: "Mail", accountAliases: { "gmail-b": "gmail-a" } });
    expect(again).toEqual({ path: first.path, created: false, filled: false });
    expect(files.size).toBe(1);
    // Without the alias it would have been a second note.
    const without = await captureMailAsNote({ adapter, message, accountId: "gmail-a", mailbox: "INBOX", folder: "Mail" });
    expect(without.created).toBe(true);
  });
});

describe("an account in one line names its provider", () => {
  it("a Dropbox card opened with a Gmail address does not read like the Google card", () => {
    const dropbox = accountDisplayName({ family: "dropbox", label: "person@gmail.example" });
    const google = accountDisplayName({ family: "google", label: "person@gmail.example" });
    expect(dropbox).toBe(`${familyLabel("dropbox")} · person@gmail.example`);
    expect(dropbox).not.toBe(google);
    expect(accountDisplayName({ family: "dropbox", label: "  " })).toBe(familyLabel("dropbox"));
  });
});
