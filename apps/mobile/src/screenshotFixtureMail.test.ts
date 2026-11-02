import { describe, expect, it } from "vitest";
import { legacyMailSecretKey } from "@plainva/ui/mail";
// @ts-expect-error - a plain .mjs script of the screenshot tool, without types
import { fixtureStorage } from "../scripts/screenshot-fixture.mjs";

/**
 * The screenshot fixture's mail sign-ins are the ones the app reads (Sammelplan
 * § 3.108).
 *
 * The phone reads a mailbox's sign-in under `mail_<account>_<base64 vault>`
 * (`legacyMailSecretKey`; the web store prefixes `secret_`), and an IMAP
 * password as `pass`. The fixture laid the team vault's mailbox down under the
 * reversed name `mail_<vault>_<account>` with a `password`: that mailbox was
 * signed out in every picture, against the comment above it, and two probes
 * and an E2E were misled by it. A second, reversed slot for the local vault
 * was said to be "current" and was read by nothing.
 */
describe("the screenshot fixture's mail sign-ins", () => {
  const storage = fixtureStorage() as Record<string, unknown>;
  const mailboxes = Object.entries(storage)
    .filter(([key]) => key.startsWith("mailAccounts_"))
    .flatMap(([key, list]) => (list as Array<{ id: string; kind?: string }>).map((account) => ({ vault: decodeURIComponent(escape(atob(key.slice("mailAccounts_".length)))), account })));

  it("lies under the name the mail module reads, for every mailbox, with the field it reads", () => {
    expect(mailboxes.length).toBeGreaterThanOrEqual(2);
    for (const { vault, account } of mailboxes) {
      const slot = storage[`secret_${legacyMailSecretKey(vault, account.id)}`] as Record<string, unknown> | undefined;
      expect(slot, `${account.id} in ${vault}`).toBeDefined();
      if (account.kind === "microsoft") expect(slot).toHaveProperty("refreshToken");
      else expect(slot).toHaveProperty("pass");
    }
  });

  it("holds no mail slot that nothing reads", () => {
    const read = new Set(mailboxes.map(({ vault, account }) => `secret_${legacyMailSecretKey(vault, account.id)}`));
    const slots = Object.keys(storage).filter((key) => key.startsWith("secret_mail_"));
    expect(slots.filter((key) => !read.has(key))).toEqual([]);
  });
});
