import { describe, expect, it } from "vitest";
import { emptyAccountMap, importAccountMetadata, type AccountImportPorts } from "@plainva/ui";
import type { MailAccountConfig } from "@plainva/ui/mail";

/**
 * Review 2026-11-18, A1: the settings import used to take host, port and the
 * SMTP and Sieve servers of the shared document for a mailbox this device
 * already has — and the stored IMAP password went to whatever server the
 * document named. The rule of `confirmedAccess` for CalDAV holds for mail
 * too: a mailbox this device has keeps its own servers; the document's apply
 * to a device that does not have it yet.
 *
 * The phone runs the same shared import (`importAccountMetadata`) and sends
 * through the same `mailCredentials`, which takes host and port from this
 * row: this is the phone's run of the desktop's test of the same name.
 */

function ports(initial: MailAccountConfig[]) {
  let mail = initial;
  let map = { ...emptyAccountMap(), mailLocalToLogical: { m1: "L-m" } } as ReturnType<typeof emptyAccountMap>;
  const p = {
    listPimAccounts: async () => [],
    upsertPimAccount: async () => undefined,
    deletePimAccount: async () => undefined,
    listCalendars: async () => [],
    setCalendarSelected: async () => undefined,
    listTaskLists: async () => [],
    setTaskListSelected: async () => undefined,
    listMailAccounts: async () => mail,
    replaceMailAccounts: async (next: MailAccountConfig[]) => { mail = next; },
    listCloudAccounts: async () => [],
    replaceCloudAccounts: async () => undefined,
    pimSecretSlot: (id: string) => `pim:${id}`,
    mailSecretSlot: (id: string) => `mail:${id}`,
    loadAccountMap: async () => map,
    saveAccountMap: async (next: typeof map) => { map = next; },
    deviceId: async () => "d1",
  } as unknown as AccountImportPorts;
  return { ports: p, mail: () => mail };
}

const servers = (rows: MailAccountConfig[]) => rows.map((m) => [m.id, m.host, m.port, m.smtpHost, m.smtpPort, m.sieveHost]);

describe("importing the settings of a mailbox", () => {
  it("keeps this device's servers for a mailbox it has, whatever the document names", async () => {
    const own: MailAccountConfig = { id: "m1", label: "anna@good.example", host: "imap.good.example", port: 993, user: "anna@good.example", smtpHost: "smtp.good.example", smtpPort: 465 };
    const device = ports([own]);
    await importAccountMetadata(
      { mailAccounts: [{ ...own, id: "L-m", label: "Anna", host: "evil.example", port: 143, smtpHost: "evil.example", smtpPort: 25, sieveHost: "evil.example", sievePort: 4190 }], cloudAccounts: [] },
      device.ports,
    );
    expect(servers(device.mail())).toEqual([["m1", "imap.good.example", 993, "smtp.good.example", 465, undefined]]);
    expect(device.mail()[0].label).toBe("Anna");
  });

  it("takes the document's servers for a mailbox this device does not have yet", async () => {
    const device = ports([]);
    await importAccountMetadata(
      { mailAccounts: [{ id: "L-new", label: "bob@b.example", host: "imap.b.example", port: 993, user: "bob@b.example", smtpHost: "smtp.b.example", smtpPort: 587 }], cloudAccounts: [] },
      device.ports,
    );
    expect(servers(device.mail()).map((row) => row.slice(1))).toEqual([["imap.b.example", 993, "smtp.b.example", 587, undefined]]);
  });
});
