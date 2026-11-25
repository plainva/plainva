import { describe, expect, it } from "vitest";
import { shippedSources } from "./test-sourceTree";

/**
 * Every way a calendar account (CalDAV) or a mailbox (IMAP) — or the stored
 * password of one — goes away, with what it is (review 2026-11-25, F64).
 *
 * A tombstone in the secrets sync deletes a password on every other device,
 * so it comes from one act only: "Remove account" (`retireSecret`). For years
 * it came from a comparison of lists instead, and every way an account left
 * a device without being removed — an address repaired, two rows folded, the
 * profile taking it away — took the password of every other device with it.
 * This guard holds the inventory: each line in shipped code that removes a
 * row or a slot of either kind is listed below with its class, counted per
 * line. A new one fails until it is listed; a line listed as "remove" must go
 * through the act, and only the listed lines may reach it.
 *
 * Classes:
 *  - remove: "Remove account" (also of a mailbox a failed setup left behind) —
 *    the act, through `removePimAccount` / `removeMailAccountOnPurpose`.
 *  - remove-step: a step inside that act, run in the same line as the
 *    secrets rounds (`retireSecret(…, remove)`).
 *  - merge, repair, profile, undo, forget, signed-out, rollback, port, other:
 *    an account leaves a device without being removed; no tombstone.
 */

type Kind = "caldav" | "imap" | "any";
type Class = "remove" | "remove-step" | "merge" | "repair" | "profile" | "undo" | "forget" | "signed-out" | "rollback" | "port" | "other";

const ROW: Record<Exclude<Kind, "any">, RegExp> = {
  caldav: /\.deleteAccount\(|\bdeletePimAccount\(|\bclearPimCredentials\(|\bremovePimAccount\(/g,
  imap: /\bremoveMailAccount\(|\bremoveMailAccountOnPurpose\(|\breplaceMailAccounts\(|\bremoveMailSecret\(/g,
};
/** The slot names of each kind. */
const SLOT: Record<Exclude<Kind, "any">, RegExp> = {
  caldav: /pimSecretKey\(|slot\.calendar\(|pimSecretSlot\(|\bkey\(vaultId/,
  imap: /mailSecretKey\(|mailSecretSlot\(/,
};
const SLOT_REMOVAL = /removeSecret\(|removeSlot\(/;
/** A slot removed by a name held in a variable: any kind. */
const ANY_SLOT_REMOVAL = /removeSecret\((slot|entry\.slot)\)/;
const DEFINITION = /^\s*(export\s+)?(async\s+)?function\s|^\s*\w+\([^)]*\):\s*Promise<void>;\s*$/;

const ALLOWED: ReadonlyArray<readonly [file: string, fragment: string, kind: Kind, calls: number, cls: Class]> = [
  // "Remove account"
  ["apps/desktop/src/services/cloudAccountsActions.ts", "await removePimAccount(runtime, vaultPath, record.services.calendar.pimAccountId);", "caldav", 1, "remove"],
  ["apps/desktop/src/services/cloudAccountsActions.ts", "await removeMailAccountOnPurpose(vaultPath, record.services.mail.mailAccountId);", "imap", 1, "remove"],
  ["apps/mobile/src/services/accountSignOut.ts", "await removePimAccount(card.pimAccountId);", "caldav", 1, "remove"],
  ["apps/mobile/src/services/mail/mailRuntime.ts", "await removeMailAccountOnPurpose(vaultId, accountId);", "imap", 1, "remove"],
  ["packages/ui/src/mail/orphanedMailAccounts.ts", "await removeMailAccountOnPurpose(vaultKey, accountId);", "imap", 1, "remove"],
  ["apps/desktop/src/services/pim/pimAccounts.ts", "await runtime.cache.deleteAccount(accountId);", "caldav", 1, "remove-step"],
  ["apps/desktop/src/services/pim/pimAccounts.ts", "await clearPimCredentials(vaultPath, accountId).catch(reportingTo(\"pim:remove-credentials\"));", "caldav", 1, "remove-step"],
  ["apps/mobile/src/services/pim/pimService.ts", "await clearPimCredentials(current.vaultId, accountId);", "caldav", 1, "remove-step"],
  ["apps/mobile/src/services/pim/pimService.ts", "await current.cache.deleteAccount(accountId);", "caldav", 1, "remove-step"],
  ["packages/ui/src/mail/mailAccounts.ts", "await removeMailAccount(vaultPath, accountId);", "imap", 1, "remove-step"],
  // The sinks themselves: a row's slot goes with it, for whichever reason the row goes.
  ["apps/desktop/src/services/pim/pimCredentials.ts", "await removeSlot(credentialManager, slot.calendar(vaultPath, accountId)", "caldav", 1, "other"],
  ["apps/mobile/src/services/pim/pimCredentials.ts", "await getPlatformServices().credentials.removeSecret(key(vaultId, accountId));", "caldav", 1, "other"],
  ["packages/ui/src/mail/mailAccounts.ts", "await removeSlot(", "imap", 1, "other"],
  // Folded into another row, or a duplicate given up
  ["packages/ui/src/mail/mailboxDuplicates.ts", "for (const id of dropIds) await removeMailAccount(vaultPath, id);", "imap", 1, "merge"],
  ["packages/ui/src/lib/passwordAccounts.ts", "await ports.deleteAccount(id);", "caldav", 1, "merge"],
  ["apps/desktop/src/services/pim/pimAccounts.ts", "deleteAccount: (id) => { assertPimRuntime(runtime); return runtime.cache.deleteAccount(id); },", "caldav", 1, "merge"],
  ["apps/mobile/src/services/pim/pimService.ts", "deleteAccount: (id) => { assertCurrent(); return owner.cache.deleteAccount(id); },", "caldav", 1, "merge"],
  ["packages/ui/src/lib/accountRepairCleanup.ts", "for (const accountId of cleanup.pimAccountIds) await resources.pimCache.deleteAccount(accountId);", "caldav", 1, "merge"],
  ["packages/ui/src/lib/accountRepairCleanup.ts", "await resources.replaceMailAccounts(mailAccounts.filter((account) => !removed.has(account.id)));", "imap", 1, "merge"],
  ["packages/ui/src/lib/accountRepairCleanup.ts", "await resources.credentials.removeSecret(resources.pimSecretSlot(accountId));", "caldav", 1, "merge"],
  ["packages/ui/src/lib/accountRepairCleanup.ts", "await resources.credentials.removeSecret(resources.mailSecretSlot(accountId));", "imap", 1, "merge"],
  ["apps/desktop/src/services/accountRepair.ts", "replaceMailAccounts: (accounts) => replaceMailAccounts(vaultPath, accounts),", "imap", 1, "port"],
  ["apps/mobile/src/services/accountRepair.ts", "replaceMailAccounts: (accounts) => replaceMailAccounts(vaultId, accounts),", "imap", 1, "port"],
  // Repaired: a connect taken into an existing row, a refused mailbox replaced
  ["packages/ui/src/lib/accountProfile.ts", "await ports.deleteAccount(opts.freshId).catch(reportingTo(\"account:adopt\"));", "caldav", 1, "repair"],
  ["apps/desktop/src/services/pim/pimAccounts.ts", "clearCredentials: (v, id) => { assertPimRuntime(runtime); return clearPimCredentials(v, id); },", "caldav", 1, "repair"],
  ["apps/desktop/src/services/pim/pimAccounts.ts", "deleteAccount: (id) => { assertPimRuntime(runtime); return runtime.cache.deleteAccount(id); },", "caldav", 1, "repair"],
  ["apps/mobile/src/services/pim/pimService.ts", "clearCredentials: (v, accountId) => { assertCurrent(); return clearPimCredentials(v, accountId); },", "caldav", 1, "repair"],
  ["apps/mobile/src/services/pim/pimService.ts", "deleteAccount: (accountId) => { assertCurrent(); return owner.cache.deleteAccount(accountId); },", "caldav", 1, "repair"],
  ["packages/ui/src/mail/mailboxReplacement.ts", "await removeMailAccount(vaultPath, replacedId);", "imap", 1, "repair"],
  // Taken away by the settings profile (the removal came from another device), and its undo
  ["packages/ui/src/lib/accountProfile.ts", "await ports.deletePimAccount(local).catch(reportingTo(\"account:profile-removal\"));", "caldav", 1, "profile"],
  ["packages/ui/src/lib/accountProfile.ts", "await ports.replaceMailAccounts([", "imap", 1, "profile"],
  ["packages/ui/src/lib/accountProfile.ts", "await ports.removeMailSecret(gone.id).catch(reportingTo(\"account:profile-removal\"));", "imap", 1, "profile"],
  ["apps/desktop/src/services/settingsProfile.ts", "if (cache) await cache.deleteAccount(accountId);", "caldav", 1, "profile"],
  ["apps/desktop/src/services/settingsProfile.ts", "await clearPimCredentials(vaultPath, accountId).catch(reportingTo(\"pim:remove-credentials\"));", "caldav", 1, "profile"],
  ["apps/desktop/src/services/settingsProfile.ts", "replaceMailAccounts: (accounts) => replaceMailAccounts(vaultPath, accounts),", "imap", 1, "profile"],
  ["apps/desktop/src/services/settingsProfile.ts", "removeMailSecret: (accountId) => removeSlot(credentialManager, mailSecretKey(vaultPath, accountId)", "imap", 1, "profile"],
  ["apps/desktop/src/services/settingsProfile.ts", "if (!previousIds.has(current.id)) await context.pimRuntime.cache.deleteAccount(current.id);", "caldav", 1, "profile"],
  ["apps/mobile/src/services/mobileSettingsSync.ts", "if (cache) await cache.deleteAccount(accountId);", "caldav", 1, "profile"],
  ["apps/mobile/src/services/mobileSettingsSync.ts", "await clearPimCredentials(vaultId, accountId).catch(reportingTo(\"credentials:pim-clear\"));", "caldav", 1, "profile"],
  ["apps/mobile/src/services/mobileSettingsSync.ts", "replaceMailAccounts: (accounts) => replaceMailAccounts(vaultId, accounts),", "imap", 1, "profile"],
  ["apps/mobile/src/services/mobileSettingsSync.ts", "removeMailSecret: (accountId) => removeSlot(getPlatformServices().credentials, mailSecretKey(vaultId, accountId)", "imap", 1, "profile"],
  ["apps/mobile/src/services/profileImportJournal.ts", "await replaceMailAccounts(", "imap", 1, "profile"],
  ["apps/mobile/src/services/profileImportJournal.ts", "for (const row of currentRows) if (!kept.has(row.id)) await cache.deleteAccount(row.id);", "caldav", 1, "profile"],
  // An unfinished connect undone
  ["apps/desktop/src/services/cloudAccountsActions.ts", "await removeMailAccount(vaultPath, id).catch(reportingTo(\"mail:undo-connect\"));", "imap", 1, "undo"],
  ["apps/mobile/src/screens/MailAccountsScreen.tsx", "else await removeMailAccount(vault, account.id);", "imap", 1, "undo"],
  ["apps/mobile/src/services/mail/mailRuntime.ts", "else await removeMailAccount(vault, id);", "imap", 1, "undo"],
  ["apps/mobile/src/services/pim/pimService.ts", "else await clearPimCredentials(owner.vaultId, connectedId);", "caldav", 1, "undo"],
  // A slot by a name in a variable
  ["packages/ui/src/mail/mailAccounts.ts", "if (previousSecret) await credentials.writeSecret(slot, previousSecret); else await credentials.removeSecret(slot);", "any", 1, "rollback"],
  ["packages/ui/src/lib/accountRepairCleanup.ts", "if (entry.value === null) await resources.credentials.removeSecret(entry.slot);", "any", 1, "rollback"],
  ["packages/ui/src/lib/accountRepairCleanup.ts", "await resources.replaceMailAccounts(journal.mailAccounts);", "imap", 1, "rollback"],
  ["apps/desktop/src/services/vaultForget.ts", "slots.map((slot) => credentialManager.removeSecret(slot))", "any", 1, "forget"],
  // Settings › stored access: as "Sign out on this device" (maintainer, 2026-11-18)
  ["apps/desktop/src/services/storedCredentials.ts", "await credentialManager.removeSecret(slot);", "any", 1, "signed-out"],
  // The secrets port's own slot access: it never empties the slot of an account still here (`secretsPort.ts`)
  ["apps/desktop/src/services/settingsSecrets.ts", "removeSlot: (slot) => credentialManager.removeSecret(slot),", "any", 1, "port"],
  ["apps/mobile/src/services/mobileSecretsPort.ts", "removeSlot: (slot) => getPlatformServices().credentials.removeSecret(slot),", "any", 1, "port"],
  // Not an account slot: the keys of an encrypted workspace
  ["apps/desktop/src/services/workspaceSecurity/workspaceKeychain.ts", "await credentialManager.removeSecret(slot);", "any", 1, "other"],
  ["apps/mobile/src/services/mobileWorkspaceSecurity.ts", "await secureCredentialStore.removeSecret(slot);", "any", 1, "other"],
];

/** The only lines that reach the act (`retireSecret`): "Remove account" of either kind, in either shell. */
const RETIRE = /\bretire(?:Secret|CalDavSecret|ImapSecret)\(|\.retireMailSecret\b|\bretireMailSecret:/g;
const RETIRING: ReadonlyArray<readonly [file: string, fragment: string]> = [
  ["apps/desktop/src/services/pim/pimAccounts.ts", "await retireCalDavSecret(vaultPath, url, user, take);"],
  ["apps/mobile/src/services/pim/pimService.ts", "await retireCalDavSecret(vaultId, url, user, take);"],
  ["apps/desktop/src/services/settingsSecrets.ts", "await retireSecret(retiredStore(vaultPath), calDavSecretBinding("],
  ["apps/desktop/src/services/settingsSecrets.ts", "await retireSecret(retiredStore(vaultPath), imapSecretBinding("],
  ["apps/mobile/src/services/mobileSecretsPort.ts", "await retireSecret(retiredStore(vaultId), calDavSecretBinding("],
  ["apps/mobile/src/services/mobileSecretsPort.ts", "await retireSecret(retiredStore(vaultId), imapSecretBinding("],
  ["apps/desktop/src/main.tsx", "retireMailSecret: (vaultKey, mailbox, remove) =>"],
  ["apps/mobile/src/main.tsx", "retireMailSecret: (vaultKey, mailbox, remove) =>"],
  ["packages/ui/src/mail/mailAccounts.ts", "const retire = getPlatformServices().retireMailSecret;"],
];

interface Found {
  rel: string;
  line: number;
  kind: Kind;
  calls: number;
  text: string;
}

function removals(): Found[] {
  const out: Found[] = [];
  for (const { rel, text } of shippedSources()) {
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (DEFINITION.test(line)) return;
      for (const kind of ["caldav", "imap"] as const) {
        const calls = line.match(ROW[kind])?.length ?? 0;
        const joined = line.trimEnd().endsWith("(") ? [line, ...lines.slice(i + 1, i + 4)].join(" ") : line;
        const slot = SLOT_REMOVAL.test(line) && SLOT[kind].test(joined) ? 1 : 0;
        if (calls + slot > 0) out.push({ rel, line: i + 1, kind, calls: calls + slot, text: line.trim() });
      }
      if (ANY_SLOT_REMOVAL.test(line)) out.push({ rel, line: i + 1, kind: "any", calls: 1, text: line.trim() });
    });
  }
  return out;
}

describe("every way a calendar account or a mailbox goes away is listed with what it is (F64)", () => {
  const found = removals();
  const listed = (item: Found) => ALLOWED.filter(([file, fragment, kind]) => file === item.rel && kind === item.kind && item.text.includes(fragment));

  it("each line that removes a row or a slot is listed, with as many calls as it holds", () => {
    const unlisted = found.filter((item) => listed(item).length === 0).map((item) => `${item.rel}:${item.line} [${item.kind}] ${item.text}`);
    expect(unlisted).toEqual([]);
    const miscounted = found
      .filter((item) => listed(item).length > 0 && !listed(item).some(([, , , calls]) => calls === item.calls))
      .map((item) => `${item.rel}:${item.line} [${item.kind}] ${item.calls} calls: ${item.text}`);
    expect(miscounted).toEqual([]);
  });

  it("every listed line still exists", () => {
    const stale = ALLOWED.filter(([file, fragment, kind]) => !found.some((item) => item.rel === file && item.kind === kind && item.text.includes(fragment)));
    expect(stale).toEqual([]);
  });

  it("\"Remove account\" goes through the act, and nothing else does", () => {
    // A line of the class "remove" calls the function that holds the act.
    for (const [file, fragment, kind, , cls] of ALLOWED) {
      if (cls !== "remove") continue;
      expect(fragment, file).toMatch(kind === "caldav" ? /\bremovePimAccount\(/ : /\bremoveMailAccountOnPurpose\(/);
    }
    // ...and those functions retire, with the row's removal inside the act.
    const text = new Map(shippedSources().map(({ rel, text: body }) => [rel, body]));
    const body = (rel: string, start: string) => {
      const all = text.get(rel)!;
      const from = all.indexOf(start);
      expect(from, `${rel}: ${start}`).toBeGreaterThanOrEqual(0);
      return all.slice(from, all.indexOf("\n}\n", from));
    };
    expect(body("apps/desktop/src/services/pim/pimAccounts.ts", "export async function removePimAccount(")).toMatch(/retireRemovedCalDavSecret\(runtime, vaultPath, accountId, take\)/);
    expect(body("apps/mobile/src/services/pim/pimService.ts", "export async function removePimAccount(")).toMatch(/retireRemovedCalDavSecret\(current\.vaultId, accountId, take\)/);
    expect(body("packages/ui/src/mail/mailAccounts.ts", "export async function removeMailAccountOnPurpose(")).toMatch(/await retire\(vaultPath, \{[^}]+\}, take\)/);
    // Every line that reaches the act is one of the listed ones.
    const reaching: string[] = [];
    for (const [rel, all] of text) {
      all.split("\n").forEach((line, i) => {
        if (DEFINITION.test(line) || !RETIRE.test(line)) return;
        RETIRE.lastIndex = 0;
        if (!RETIRING.some(([file, fragment]) => file === rel && line.includes(fragment))) reaching.push(`${rel}:${i + 1} ${line.trim()}`);
      });
      RETIRE.lastIndex = 0;
    }
    expect(reaching).toEqual([]);
  });
});
