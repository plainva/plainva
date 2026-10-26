import { describe, expect, it } from "vitest";
import {
  accountActsForProfile,
  emptyAccountMap,
  laterAccountAct,
  forgetRemovedLocalAccount,
  importAccountMetadata,
  mailAccountsForProfile,
  rememberRemovedAccount,
  removedAccountsForProfile,
  setPlatformServices,
  type AccountImportPorts,
  type ProfileAccountMap,
} from "@plainva/ui";
import { mailAccountsKey, saveMailAccount, type MailAccountConfig } from "@plainva/ui/mail";

/**
 * Second review of plan "Verbinden", B1: a Gmail mailbox keeps ONE id across
 * every connection (`stableGmailId`). Removing it left a tombstone for that id
 * in the settings profile; connecting it again - after E7, or simply after a
 * remove - brought the same id back, and the next profile import dropped it on
 * every device. Adding an account again now revives it, and the revival
 * travels like the deletion. Third review: the add is recorded even where no
 * tombstone is known yet, and the order of the acts is a logical counter, not
 * the clocks of the devices.
 */

const gmail: MailAccountConfig = {
  id: "gmail-0123", kind: "gmail", label: "anna@gmail.com", host: "imap.gmail.com", port: 993, user: "anna@gmail.com", smtpHost: "smtp.gmail.com", smtpPort: 465,
};
const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();

/** One device: its mailboxes and its account map, behind the importer's ports. */
function device(mail: MailAccountConfig[], name = "device") {
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
  /** What this device publishes: its mailboxes, its deletions and its acts. */
  const publish = () => ({
    mailAccounts: mailAccountsForProfile(state.mail, state.map),
    removedAccounts: removedAccountsForProfile(state.map, undefined),
    accountActs: accountActsForProfile(state.map, undefined),
  });
  const remove = (when: string) => {
    state.mail = state.mail.filter((entry) => entry.id !== gmail.id);
    state.map = rememberRemovedAccount(state.map, "mail", gmail.id, when, name);
  };
  const add = (when: string) => {
    state.mail = [...state.mail.filter((entry) => entry.id !== gmail.id), gmail];
    state.map = forgetRemovedLocalAccount(state.map, "mail", gmail.id, when, name);
  };
  return { state, ports, publish, remove, add };
}

describe("a mailbox added again under the id a deletion named (B1)", () => {
  it("stays, on this device and on the others, and a later removal still wins", async () => {
    const phone = device([gmail], "phone");
    const desktop = device([gmail], "desktop");

    // Removed on the phone; the desktop learns of it and drops it too.
    phone.remove(at(3));
    await importAccountMetadata(phone.publish(), desktop.ports);
    expect(desktop.state.mail).toEqual([]);

    // Connected again on the phone - Gmail comes back under the same id.
    phone.add(at(2));

    // The desktop still publishes the old deletion: the phone keeps its mailbox.
    await importAccountMetadata(desktop.publish(), phone.ports);
    expect(phone.state.mail.map((entry) => entry.id)).toEqual([gmail.id]);

    // The phone's document brings the mailbox back to the desktop, and the deletion goes there too.
    await importAccountMetadata(phone.publish(), desktop.ports);
    expect(desktop.state.mail.map((entry) => entry.id)).toEqual([gmail.id]);
    expect(desktop.state.map.removedLogical?.[gmail.id]).toBeUndefined();

    // Removed again later: that is the later act, and it wins everywhere.
    desktop.remove(at(1));
    await importAccountMetadata(desktop.publish(), phone.ports);
    expect(phone.state.mail).toEqual([]);
  });

  it("is added again on a device that has not heard of the removal yet (B1 a)", async () => {
    const phone = device([gmail], "phone");
    const desktop = device([gmail], "desktop");

    // Removed on the desktop; the phone has not imported anything since.
    desktop.remove(at(3));
    // On the phone the mailbox is connected again: no tombstone is known here,
    // and the add still has to be recorded, or the desktop's removal wins.
    phone.add(at(2));

    await importAccountMetadata(desktop.publish(), phone.ports);
    expect(phone.state.mail.map((entry) => entry.id)).toEqual([gmail.id]);
    await importAccountMetadata(phone.publish(), desktop.ports);
    expect(desktop.state.mail.map((entry) => entry.id)).toEqual([gmail.id]);
  });

  it("an add after a removal wins over a device whose clock runs ahead (B1 b)", async () => {
    const phone = device([gmail], "phone");
    const desktop = device([gmail], "desktop");

    // The desktop's clock is two hours fast: its removal is stamped in the future.
    desktop.remove(at(-2));
    await importAccountMetadata(desktop.publish(), phone.ports);
    expect(phone.state.mail).toEqual([]);

    // The phone, having seen that removal, adds the mailbox back NOW.
    phone.add(at(0));
    await importAccountMetadata(desktop.publish(), phone.ports);
    expect(phone.state.mail.map((entry) => entry.id)).toEqual([gmail.id]);
    await importAccountMetadata(phone.publish(), desktop.ports);
    expect(desktop.state.mail.map((entry) => entry.id)).toEqual([gmail.id]);

    // And the desktop removing it again after that is the newer act once more.
    desktop.remove(at(-2));
    await importAccountMetadata(desktop.publish(), phone.ports);
    expect(phone.state.mail).toEqual([]);
  });

  it("a removal from a build without counters ranks below any act (the limit, B1 c)", async () => {
    const phone = device([], "phone");
    phone.add(at(5));
    // An older build only writes the id and a moment - even a later moment.
    await importAccountMetadata({ mailAccounts: [], removedAccounts: { [gmail.id]: at(1) } }, phone.ports);
    expect(phone.state.mail.map((entry) => entry.id)).toEqual([gmail.id]);
    // Without any act for the id, that removal still holds.
    const other = device([gmail], "other");
    await importAccountMetadata({ mailAccounts: [], removedAccounts: { [gmail.id]: at(1) } }, other.ports);
    expect(other.state.mail).toEqual([]);
  });
});

describe("the order of two acts on one id", () => {
  const act = (kind: "removed" | "revived", counter: number, when: string, deviceId: string) => ({ act: kind, counter, at: when, device: deviceId });

  it("is the counter first, however the clocks stand", () => {
    expect(laterAccountAct(act("removed", 1, at(-5), "a"), act("revived", 2, at(5), "b")).act).toBe("revived");
  });

  it("is the moment for acts that did not see each other, then the device, the same either way round", () => {
    const early = act("removed", 1, at(2), "a");
    const late = act("revived", 1, at(1), "b");
    expect(laterAccountAct(early, late)).toBe(late);
    expect(laterAccountAct(late, early)).toBe(late);
    const sameMoment = at(1);
    const fromA = act("revived", 1, sameMoment, "a");
    const fromB = act("removed", 1, sameMoment, "b");
    expect(laterAccountAct(fromA, fromB)).toBe(fromB);
    expect(laterAccountAct(fromB, fromA)).toBe(fromB);
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

  it("records nothing for a new password of a mailbox that is here: a removal made elsewhere still wins (fourth review, finding 2)", async () => {
    const phone = device([gmail], "phone");
    const desktop = device([gmail], "desktop");
    const imap: MailAccountConfig = { ...gmail, kind: undefined, id: "imap-1" };
    phone.state.mail = [imap];
    desktop.state.mail = [imap];
    // The phone's store holds the mailbox the edit is about.
    const settings = new Map<string, unknown>([[mailAccountsKey("/v"), [imap]]]);
    const secrets = new Map<string, unknown>();
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
      // The phone's hook, as the shell wires it: an add becomes an act in its map.
      noteAccountAdded: async (_vault, kind, id) => { phone.state.map = forgetRemovedLocalAccount(phone.state.map, kind, id, at(1), "phone"); },
    });

    // Removed on the desktop; the phone has not imported it yet.
    desktop.state.mail = [];
    desktop.state.map = rememberRemovedAccount(desktop.state.map, "mail", imap.id, at(3), "desktop");
    // On the phone the person types a new password into the mailbox that is still there.
    await saveMailAccount("/v", imap, "new-password");

    await importAccountMetadata(desktop.publish(), phone.ports);
    expect(phone.state.mail).toEqual([]);
    await importAccountMetadata(phone.publish(), desktop.ports);
    expect(desktop.state.mail).toEqual([]);
  });
});
