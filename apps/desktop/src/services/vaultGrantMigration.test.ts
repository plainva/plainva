import { describe, expect, it } from "vitest";
import { migrateVaultAccountGrants, vaultGrantMigrationDiagnostic, type CloudAccountRecord, type CloudServiceId } from "@plainva/ui";

/**
 * The vault-wide pass of account sign-in plan K2: every calendar and mailbox
 * of a Google or Microsoft card hands a sign-in of its own to the card when
 * the vault opens. The migration of one service is `migrateAccountGrant`
 * (tested in accountGrantMigration.test.ts); here, which services the pass
 * asks for and what it says.
 */

const google: CloudAccountRecord = { id: "g", family: "google", label: "anna@example.com", services: { files: { provider: "drive" }, calendar: { pimAccountId: "cal-g" }, mail: { mailAccountId: "mail-g" } } };
const microsoft: CloudAccountRecord = { id: "m", family: "microsoft", label: "bert@example.com", services: { mail: { mailAccountId: "mail-m" } } };
const webdav: CloudAccountRecord = { id: "w", family: "webdav", label: "cloud.example.org", services: { files: { provider: "webdav" }, calendar: { pimAccountId: "cal-w" } } };

describe("migrateVaultAccountGrants", () => {
  it("asks for the calendar and the mailbox of every Google and Microsoft card, never for files or other families", async () => {
    const asked: string[] = [];
    const results = await migrateVaultAccountGrants({
      cards: async () => [google, microsoft, webdav],
      migrate: async (record, service) => { asked.push(`${record.id}:${service}`); return "absent"; },
    });
    expect(asked).toEqual(["g:calendar", "g:mail", "m:mail"]);
    expect(results.every((r) => r.outcome === "absent")).toBe(true);
  });

  it("keeps going past a service that fails, and names the failure", async () => {
    const results = await migrateVaultAccountGrants({
      cards: async () => [google],
      migrate: async (_record, service: CloudServiceId) => {
        if (service === "calendar") throw new Error("The provider account could not be verified. Existing sign-ins were kept.");
        return "migrated";
      },
    });
    expect(results).toEqual([
      { cardId: "g", family: "google", service: "calendar", outcome: "failed", detail: "The provider account could not be verified. Existing sign-ins were kept." },
      { cardId: "g", family: "google", service: "mail", outcome: "migrated" },
    ]);
  });

  it("says nothing when every service already was the card's, one line otherwise - without addresses", () => {
    expect(vaultGrantMigrationDiagnostic([{ cardId: "g", family: "google", service: "calendar", outcome: "absent" }])).toBeNull();
    const line = vaultGrantMigrationDiagnostic([
      { cardId: "g", family: "google", service: "calendar", outcome: "migrated" },
      { cardId: "m", family: "microsoft", service: "mail", outcome: "failed", detail: "bert@example.com refused" },
    ]);
    expect(line).toBe("account grants moved to cards: google calendar=migrated microsoft mail=failed");
    expect(line).not.toContain("@");
  });
});
