import { describe, expect, it } from "vitest";
import {
  emptyAccountMap,
  forgetRemovedLocalAccount,
  importAccountMetadata,
  mailAccountsForProfile,
  rememberRemovedAccount,
  removedAccountsForProfile,
  revivedAccountsForProfile,
  setPlatformServices,
  type AccountImportPorts,
  type ProfileAccountMap,
} from "@plainva/ui";
import { saveMailAccount, type MailAccountConfig } from "@plainva/ui/mail";

/**
 * Second review of plan "Verbinden", B1: a Gmail mailbox keeps ONE id across
 * every connection (`stableGmailId`). Removing it left a tombstone for that id
 * in the settings profile; connecting it again - after E7, or simply after a
 * remove - brought the same id back, and the next profile import dropped it on
 * every device. Adding an account again now revives it, and the revival
 * travels like the deletion: for each id the later act wins.
 */

const gmail: MailAccountConfig = {
  id: "gmail-0123", kind: "gmail", label: "anna@gmail.com", host: "imap.gmail.com", port: 993, user: "anna@gmail.com", smtpHost: "smtp.gmail.com", smtpPort: 465,
};
const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();

/** One device: its mailboxes and its account map, behind the importer's ports. */
function device(mail: MailAccountConfig[]) {
  const state = { mail: [...mail], map: emptyAccountMap() as ProfileAccountMap };
  const ports: AccountImportPorts = {
    listPimAccounts: async () => [],
    upsertPimAccount: async () => undefined,
    deletePimAccount: async () => undefined,
    listCalendars: async () => [],
    setCalendarSelected: async () => undefined,
    listTaskLists: async () => [],
    setTaskListSelected: async () => undefined,
    listMailAccounts: async () => state.mail,
    replaceMailAccounts: async (accounts) => { state.mail = [...accounts]; },
    listCloudAccounts: async () => [],
    replaceCloudAccounts: async () => undefined,
    pimSecretSlot: (id) => `pim:${id}`,
    mailSecretSlot: (id) => `mail:${id}`,
    loadAccountMap: async () => state.map,
    saveAccountMap: async (map) => { state.map = map; },
  };
  /** What this device publishes: its mailboxes, its deletions and its revivals. */
  const publish = () => ({
    mailAccounts: mailAccountsForProfile(state.mail, state.map),
    removedAccounts: removedAccountsForProfile(state.map, undefined),
    revivedAccounts: revivedAccountsForProfile(state.map, undefined),
  });
  return { state, ports, publish };
}

describe("a mailbox added again under the id a deletion named (B1)", () => {
  it("stays, on this device and on the others, and a later removal still wins", async () => {
    const phone = device([gmail]);
    const desktop = device([gmail]);

    // Removed on the phone; the desktop learns of it and drops it too.
    phone.state.mail = [];
    phone.state.map = rememberRemovedAccount(phone.state.map, "mail", gmail.id, at(3));
    await importAccountMetadata(phone.publish(), desktop.ports);
    expect(desktop.state.mail).toEqual([]);

    // Connected again on the phone - Gmail comes back under the same id.
    phone.state.mail = [gmail];
    phone.state.map = forgetRemovedLocalAccount(phone.state.map, "mail", gmail.id, at(2));

    // The desktop still publishes the old deletion: the phone keeps its mailbox.
    await importAccountMetadata(desktop.publish(), phone.ports);
    expect(phone.state.mail.map((entry) => entry.id)).toEqual([gmail.id]);

    // The phone's document brings the mailbox back to the desktop, and the deletion goes there too.
    await importAccountMetadata(phone.publish(), desktop.ports);
    expect(desktop.state.mail.map((entry) => entry.id)).toEqual([gmail.id]);
    expect(desktop.state.map.removedLogical?.[gmail.id]).toBeUndefined();

    // Removed again later: that is the later act, and it wins everywhere.
    desktop.state.mail = [];
    desktop.state.map = rememberRemovedAccount(desktop.state.map, "mail", gmail.id, at(1));
    await importAccountMetadata(desktop.publish(), phone.ports);
    expect(phone.state.mail).toEqual([]);
  });
});

describe("adding a mailbox", () => {
  it("revives a deletion of its id, whatever path saved it", async () => {
    const settings = new Map<string, unknown>();
    const secrets = new Map<string, unknown>();
    const added: Array<[string, string, string]> = [];
    setPlatformServices({
      loadSettings: async () => ({
        get: async <T,>(key: string) => (settings.get(key) as T | undefined) ?? null,
        set: async (key: string, value: unknown) => { settings.set(key, value); },
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
      noteAccountAdded: async (vault, kind, id) => { added.push([vault, kind, id]); },
    });
    await saveMailAccount("/v", { ...gmail, kind: undefined, id: "imap-1" }, "app-password");
    expect(added).toEqual([["/v", "mail", "imap-1"]]);
  });
});
