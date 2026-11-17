import { describe, expect, it } from "vitest";
import { CODE_ROOTS, sourceTexts } from "./test-sourceTree";

/**
 * Whether two password accounts (CalDAV, WebDAV, Nextcloud) are one is decided
 * in ONE place: `samePasswordAccount` and the row functions beside it in
 * `packages/ui/src/lib/passwordAccounts.ts` (GitHub issue 174, review
 * 2026-11-17). A second comparison elsewhere — the phone compared a card's
 * label in lower case, and since a share run passes the label it just typed,
 * that said yes to every row: "Alice" got the sign-in, the settings and the
 * calendars of "alice" — undoes the rule without anybody noticing.
 *
 * This guard finds such comparisons in shipped code: an account's label or
 * user compared in lower case, or a row's `config.url` / `config.user`
 * compared directly. Each one that is NOT a password-account comparison is
 * listed below with the reason; anything new fails until it either goes
 * through the rule or is listed.
 */

const ACCOUNT_FILES = /(account|pim|mail|secret|caldav|cloud|auth|google|graph|connect)/i;
const LOWER_CASE_COMPARE = /\.toLowerCase\(\)\s*[!=]==|[!=]==\s*[^;&|?]*\.toLowerCase\(\)/;
const ACCOUNT_FIELD = /\.(label|user)\b/;
const ROW_FIELD_COMPARE = /config\??\.(url|user)\s*[!=]==/;
const TYPEOF_ROW_FIELD = /typeof\s+[\w.?]*config\??\.(url|user)\s*[!=]==/;

/** File, a fragment of the line, and why it is not a password-account comparison. */
const ALLOWED: ReadonlyArray<readonly [file: string, fragment: string, reason: string]> = [
  ["packages/core/src/settingsSync/secretsBundle.ts", "binding.user === binding.user.toLowerCase()", "asks whether a secret entry was written by a client up to 0.8.7, compares nothing"],
  ["apps/mobile/src/services/pim/pimService.ts", "source.label.trim().toLowerCase() !== profile?.label?.trim().toLowerCase()", "Google/Microsoft: an e-mail address the provider vouches for"],
  ["apps/mobile/src/services/pim/pimService.ts", "source.label.trim().toLowerCase() === resolvedLabel.trim().toLowerCase()", "the Google/Microsoft branch: a CalDAV row goes through samePimPasswordAccount above it"],
  ["apps/mobile/src/services/accountVaultTransfer.ts", "record.label.trim().toLowerCase() !== profile?.label?.trim().toLowerCase()", "Google/Microsoft: an e-mail address the provider vouches for"],
  ["packages/ui/src/lib/accountLoginGrant.ts", "record.label.trim().toLowerCase() !== profile.label?.trim().toLowerCase()", "Google/Microsoft: an e-mail address the provider vouches for"],
  ["apps/mobile/src/services/googleNativeAuthorization.ts", "expected.nativeGoogle.email.toLowerCase() !== profile.label.toLowerCase()", "Google: an e-mail address the provider vouches for"],
  ["packages/ui/src/mail/gmailAccount.ts", "expected.label.trim().toLowerCase() !== profile.label.toLowerCase()", "Gmail: an e-mail address Google vouches for"],
  ["packages/ui/src/mail/gmailAccount.ts", "token.nativeGoogle.email.toLowerCase() !== profile.label.toLowerCase()", "Gmail: an e-mail address Google vouches for"],
  ["packages/ui/src/mail/gmailAccount.ts", "bound.user.toLowerCase() === profile.label!.toLowerCase()", "Gmail: an e-mail address Google vouches for"],
  ["packages/ui/src/mail/gmailAccount.ts", "mail.user.toLowerCase() === profile.label!.toLowerCase()", "Gmail: an e-mail address Google vouches for"],
  ["apps/mobile/src/services/mail/mailRuntime.ts", "record.label.trim().toLowerCase() !== address.trim().toLowerCase()", "Microsoft mail: an e-mail address the provider vouches for"],
  ["apps/mobile/src/services/mail/mailRuntime.ts", "a.user.toLowerCase(", "Microsoft mail: an e-mail address the provider vouches for"],
  ["apps/mobile/src/screens/MailAccountsScreen.tsx", "record.label.trim().toLowerCase() !== v.user.trim().toLowerCase()", "a mailbox is one account in any case of its address (mailIdentity)"],
  ["apps/mobile/src/screens/MailAccountsScreen.tsx", "accounts.find(a => mailAccountKind(a) === \"imap\"", "a mailbox is one account in any case of its address (mailIdentity)"],
  ["packages/ui/src/mail/graphMail.ts", "addr.toLowerCase() === account.user.trim().toLowerCase()", "hides the mailbox's own address among the recipients, decides no account"],
];

function findings(): string[] {
  const out: string[] = [];
  for (const { rel, text } of sourceTexts(CODE_ROOTS, "shipped")) {
    if (!ACCOUNT_FILES.test(rel)) continue;
    if (rel === "packages/ui/src/lib/passwordAccounts.ts") continue;
    text.split("\n").forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
      const lowerCase = LOWER_CASE_COMPARE.test(line) && ACCOUNT_FIELD.test(line);
      const rowField = ROW_FIELD_COMPARE.test(line) && !TYPEOF_ROW_FIELD.test(line);
      if (lowerCase || rowField) out.push(`${rel}:${index + 1}: ${trimmed}`);
    });
  }
  return out;
}

describe("account comparisons outside the one rule (GitHub issue 174)", () => {
  it("every comparison of an account's label, user or address is the rule, or listed with why it is not a password account", () => {
    const unlisted = findings().filter((finding) => !ALLOWED.some(([file, fragment]) => finding.startsWith(`${file}:`) && finding.includes(fragment)));
    expect(unlisted).toEqual([]);
  });

  it("lists nothing that is no longer there", () => {
    const all = findings();
    const stale = ALLOWED.filter(([file, fragment]) => !all.some((finding) => finding.startsWith(`${file}:`) && finding.includes(fragment)));
    expect(stale.map(([file, fragment]) => `${file}: ${fragment}`)).toEqual([]);
  });
});
