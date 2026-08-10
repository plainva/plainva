import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Net for the desktop secrets port (P3, 2026-08-10).
 *
 * Two things have to hold at once, and they pull in opposite directions:
 *
 *   1. A MAIL password must travel even when no calendar runtime is up. The
 *      desktop used to demand one before it built ANY candidate, so a vault
 *      without a running PIM runtime silently never transported a mail
 *      credential at all.
 *   2. Dropping that demand must not turn "no runtime" into "the user deleted
 *      every calendar account". Without a runtime the candidate list is no
 *      longer empty (the mail accounts are in it), so the port's
 *      `looksUnavailable` guard does NOT fire — a CalDAV credential would have
 *      been declared deleted and removed on every other device. Exactly the
 *      failure class this whole effort exists to remove.
 */

const VAULT = "/vaults/wiki";

const store = new Map<string, unknown>();
vi.mock("./settingsStore", () => ({
  getSettingsStore: vi.fn(async () => ({
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: unknown) => void store.set(key, value),
    save: async () => undefined,
  })),
}));

const slots = new Map<string, unknown>();
vi.mock("./CredentialManager", () => ({
  credentialManager: {
    readSecret: vi.fn(async (key: string) => slots.get(key) ?? null),
    writeSecret: vi.fn(async (key: string, value: unknown) => void slots.set(key, value)),
    removeSecret: vi.fn(async (key: string) => void slots.delete(key)),
  },
}));

vi.mock("./cloudAccounts", () => ({ loadCloudAccounts: vi.fn(async () => []) }));

type MailRow = { id: string; label: string; host: string; port: number; user: string };
let mailAccounts: MailRow[] = [];
vi.mock("@plainva/ui/mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plainva/ui/mail")>();
  return { ...actual, listMailAccounts: vi.fn(async () => mailAccounts) };
});

let pimCreds: unknown = null;
vi.mock("./pim/pimCredentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pim/pimCredentials")>();
  return { ...actual, getPimCredentials: vi.fn(async () => pimCreds) };
});

import { createDesktopSecretsPort } from "./settingsSecrets";
import { mailSecretKey } from "@plainva/ui/mail";
import { pimSecretKey } from "./pim/pimCredentials";
import type { PimRuntime } from "./pim/pimRuntime";

const CALDAV_URL = "https://cloud.example.com/remote.php/dav";

/** A runtime serving exactly one CalDAV account. */
const runtimeWithCalendar = (): PimRuntime =>
  ({
    cache: {
      listAccounts: async () => [
        { id: "pim-1", provider: "caldav", label: "Cloud", config: { url: CALDAV_URL, user: "marco" } },
      ],
    },
  }) as unknown as PimRuntime;

beforeEach(() => {
  store.clear();
  slots.clear();
  mailAccounts = [];
  pimCreds = null;
});

describe("desktop secrets port without a calendar runtime (P3)", () => {
  it("still offers the mail password when no PIM runtime is running", async () => {
    mailAccounts = [
      { id: "mail-1", label: "Gmail", host: "imap.gmail.com", port: 993, user: "marco@example.com" },
    ];
    slots.set(mailSecretKey(VAULT, "mail-1"), { pass: "app-password" });

    const bundle = await createDesktopSecretsPort(VAULT, null).exportBundle();

    const entries = Object.values(bundle.entries);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.binding.service).toBe("mail");
    expect(entries[0]?.binding.user).toBe("marco@example.com");
  });

  it("does not declare calendar credentials deleted while the runtime is absent", async () => {
    mailAccounts = [
      { id: "mail-1", label: "Gmail", host: "imap.gmail.com", port: 993, user: "marco@example.com" },
    ];
    slots.set(mailSecretKey(VAULT, "mail-1"), { pass: "app-password" });
    slots.set(pimSecretKey(VAULT, "pim-1"), { kind: "caldav", url: CALDAV_URL, user: "marco", pass: "caldav-pass" });
    pimCreds = { kind: "caldav", url: CALDAV_URL, user: "marco", pass: "caldav-pass" };

    // With the runtime the calendar credential is known and published.
    const withRuntime = await createDesktopSecretsPort(VAULT, runtimeWithCalendar()).exportBundle();
    expect(Object.keys(withRuntime.entries)).toContain("pim-1");

    // Runtime gone (vault not active, still booting): the calendar account is
    // simply not visible from here. That is ignorance, not a deletion.
    const withoutRuntime = await createDesktopSecretsPort(VAULT, null).exportBundle();
    expect(withoutRuntime.entries["pim-1"]?.tombstone).toBeUndefined();
  });
});
