import { describe, expect, it } from "vitest";
import {
  GRAPH_MAIL_SCOPES,
  brokerCardsFor,
  brokeredSubsystemId,
  describeBrokerLookup,
  type CloudAccountRecord,
  type StoredAccountToken,
} from "@plainva/ui";

/**
 * Which card may answer for one subsystem account — the rule both shells'
 * brokers share (finding 2026-10-12).
 *
 * The shells' own tests ask it through their brokers (`accountBroker.test.ts`,
 * `mail/mailSignIn.test.ts`, and the phone's twins). This holds the rule
 * itself, and above all its one hard edge: a question that does not say who
 * is asking gets no card. That edge is the whole finding — as an option, the
 * asking account could be left out, and "a mail token for this vault" was
 * answered with the first card that carried mail.
 */

const mailCard = (id: string, mailAccountId: string, family: CloudAccountRecord["family"] = "microsoft"): CloudAccountRecord => ({
  id,
  family,
  label: `${id}@example.org`,
  services: { mail: { mailAccountId } },
});

const records: CloudAccountRecord[] = [
  mailCard("card-a", "box-a"),
  mailCard("card-b", "box-b"),
  { id: "card-cal", family: "microsoft", label: "cal@example.org", services: { calendar: { pimAccountId: "box-a" } } },
  mailCard("card-g", "box-g", "google"),
  // An app-password mailbox of a suite: it carries mail, and has no broker.
  mailCard("card-suite", "box-suite", "fastmail"),
  { id: "card-files", family: "microsoft", label: "files@example.org", services: { files: { provider: "onedrive" } } },
];

describe("the cards that may answer for one subsystem account", () => {
  it("are the ones that point at exactly the account that asks", () => {
    expect(brokerCardsFor(records, "mail", "box-a").map((r) => r.id)).toEqual(["card-a"]);
    expect(brokerCardsFor(records, "mail", "box-b").map((r) => r.id)).toEqual(["card-b"]);
    expect(brokerCardsFor(records, "mail", "box-g").map((r) => r.id)).toEqual(["card-g"]);
  });

  it("are none when nobody says who is asking", () => {
    // The fault itself: this answered with every card that carries mail.
    expect(brokerCardsFor(records, "mail", "")).toEqual([]);
    expect(brokerCardsFor(records, "calendar", "")).toEqual([]);
    expect(brokerCardsFor(records, "mail", undefined as unknown as string)).toEqual([]);
  });

  it("are none for an account no card points at", () => {
    expect(brokerCardsFor(records, "mail", "box-unknown")).toEqual([]);
  });

  it("keep the services apart: a calendar reference is not a mailbox", () => {
    // The same id under another service answers for that service only.
    expect(brokerCardsFor(records, "calendar", "box-a").map((r) => r.id)).toEqual(["card-cal"]);
    expect(brokeredSubsystemId(records[2], "mail")).toBeUndefined();
  });

  it("leave out a family that has no broker, and files altogether", () => {
    expect(brokerCardsFor(records, "mail", "box-suite")).toEqual([]);
    expect(brokerCardsFor(records, "files", "onedrive")).toEqual([]);
  });

  it("are all of them when two cards point at one mailbox, in their order", () => {
    // A settings import can leave two; the broker tries each, so one without
    // a sign-in does not shadow the one that has it.
    const twice = [...records, mailCard("card-a-again", "box-a")];
    expect(brokerCardsFor(twice, "mail", "box-a").map((r) => r.id)).toEqual(["card-a", "card-a-again"]);
  });
});

describe("why the broker did not answer", () => {
  const grant: StoredAccountToken = { clientId: "client", refreshToken: "sign-in-a", scopes: GRAPH_MAIL_SCOPES };
  const ports = {
    records: async () => records,
    // Only the first card holds a sign-in.
    token: async (accountId: string) => (accountId === "card-a" ? grant : null),
  };

  it("speaks of the asking account's card, not of the first one that has a sign-in", async () => {
    // card-a holds one. That says nothing about box-b.
    await expect(describeBrokerLookup(ports, "mail", "box-b")).resolves.toMatch(/1 cloud account\(s\) carry this service, but none holds the shared sign-in/);
  });

  it("says that no account carries a mailbox no card points at", async () => {
    await expect(describeBrokerLookup(ports, "mail", "box-unknown")).resolves.toMatch(/no cloud account carries it/);
    await expect(describeBrokerLookup(ports, "mail", "")).resolves.toMatch(/no cloud account carries it/);
  });

  it("explains instead of failing when the registry cannot be read", async () => {
    const broken = { ...ports, records: async () => { throw new Error("store locked"); } };
    await expect(describeBrokerLookup(broken, "mail", "box-a")).resolves.toMatch(/could not be read \(store locked\)/);
  });
});
