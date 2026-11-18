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
 * This guard finds such comparisons in shipped code without guessing their
 * shape (review 2026-11-18: a pattern for the one case missed
 * `toLocaleLowerCase`, a comparison over two lines, a folded `Set`, …): EVERY
 * call that folds case in an account file is listed below with its reason
 * and counted per line, and a row's `config.url` / `config.user` is never
 * compared directly. Anything new fails until it goes through the rule or is
 * listed.
 */

/**
 * The account files: by AREA — calendars and their accounts, the settings
 * sync, both shells' calendar services (review 2026-11-18: `confirmedAccess.ts`
 * fell through a list of file names) — and by name elsewhere.
 */
const ACCOUNT_AREAS = ["packages/core/src/pim/", "packages/core/src/settingsSync/", "apps/desktop/src/services/pim/", "apps/mobile/src/services/pim/"];
const ACCOUNT_NAMES = /(account|secret|caldav|connect|auth|signin|credential|PimTarget|pimService|pimAccounts|mailRuntime|gmail|graphMail|settingsSecrets|connectionId)[^/]*$/i;
const isAccountFile = (rel: string) => ACCOUNT_AREAS.some((area) => rel.startsWith(area)) || ACCOUNT_NAMES.test(rel);
/** Every call that folds the case of a text: lower, upper, locale-aware, or a comparison that ignores it. */
const FOLDING_CALL = /\.to(?:Locale)?(?:Lower|Upper)Case\(|sensitivity\s*:/g;
const ROW_FIELD_COMPARE = /config\??\.(url|user)\s*[!=]==/;
const TYPEOF_ROW_FIELD = /typeof\s+[\w.?]*config\??\.(url|user)\s*[!=]==/;

/**
 * Every case-folding call in an account file (review 2026-11-18): file, a
 * fragment of its line, how many calls that line holds, and why it is not a
 * comparison of password accounts. Counted per line, so a second call on a
 * listed line, a comparison split over two lines or a new helper is caught
 * as well as a new line.
 */
const ALLOWED: ReadonlyArray<readonly [file: string, fragment: string, calls: number, reason: string]> = [
  ["apps/desktop/src/services/authFetch.ts", "(init?.method ?? \"GET\").toUpperCase()", 1, "a protocol keyword (HTTP method, iCalendar value, content type, token type), not an account"],
  ["apps/mobile/src/screens/MailAccountsScreen.tsx", "record.label.trim().toLowerCase() !== v.user.trim().toLowerCase()", 2, "a mailbox is one account in any case of its address (mailIdentity)"],
  ["apps/mobile/src/screens/MailAccountsScreen.tsx", "accounts.find(a => mailAccountKind(a) === \"imap\"", 2, "a mailbox is one account in any case of its address (mailIdentity)"],
  ["apps/mobile/src/services/accountVaultTransfer.ts", "record.label.trim().toLowerCase() !== profile?.label?.trim().toLowerCase()", 2, "Google/Microsoft: an e-mail address the provider vouches for"],
  ["apps/mobile/src/services/googleNativeAuthorization.ts", "expected.nativeGoogle.email.toLowerCase() !== profile.label.toLowerCase()", 2, "Google: an e-mail address the provider vouches for"],
  ["apps/mobile/src/services/mail/mailRuntime.ts", "record.label.trim().toLowerCase() !== address.trim().toLowerCase()", 2, "Microsoft mail: an e-mail address the provider vouches for"],
  ["apps/mobile/src/services/mail/mailRuntime.ts", "a.user.toLowerCase() === address.toLowerCase()", 2, "Microsoft mail: an e-mail address the provider vouches for"],
  ["apps/mobile/src/services/pim/pimService.ts", "source.label.trim().toLowerCase() !== profile?.label?.trim().toLowerCase()", 2, "Google/Microsoft: an e-mail address the provider vouches for"],
  ["apps/mobile/src/services/pim/pimService.ts", "source.label.trim().toLowerCase() === resolvedLabel.trim().toLowerCase()", 2, "the Google/Microsoft branch: a CalDAV row goes through samePimPasswordAccount above it"],
  ["packages/core/src/ai/mcp/oauthRules.ts", "raw.token_type.toLowerCase() !== \"bearer\"", 1, "a protocol keyword (HTTP method, iCalendar value, content type, token type), not an account"],
  ["packages/core/src/pim/CalDavPimTarget.ts", "this.creds.user.toLowerCase()", 1, "the signed-in user as an e-mail address, to find oneself among an event's attendees; decides no account"],
  ["packages/core/src/pim/CalDavPimTarget.ts", ".toUpperCase() === \"COMPLETED\"", 1, "a protocol keyword (HTTP method, iCalendar value, content type, token type), not an account"],
  ["packages/core/src/pim/CalDavPimTarget.ts", "getParameter(\"related\")", 1, "a protocol keyword (HTTP method, iCalendar value, content type, token type), not an account"],
  ["packages/core/src/pim/CalDavPimTarget.ts", "\"TRANSPARENT\"", 1, "a protocol keyword (HTTP method, iCalendar value, content type, token type), not an account"],
  ["packages/core/src/pim/CalDavPimTarget.ts", "switch ((partstat ?? \"\").toUpperCase())", 1, "a protocol keyword (HTTP method, iCalendar value, content type, token type), not an account"],
  ["packages/core/src/pim/CalDavPimTarget.ts", "String(p.getFirstValue() ?? \"\").toLowerCase()", 1, "an attendee or organizer address in an event, matched against the mailbox; decides no account"],
  ["packages/core/src/pim/CalDavPimTarget.ts", "const me = selfEmail.toLowerCase()", 1, "an attendee or organizer address in an event, matched against the mailbox; decides no account"],
  ["packages/core/src/pim/CalDavPimTarget.ts", "getFirstPropertyValue(\"status\") ?? \"\").toUpperCase()", 1, "a protocol keyword (HTTP method, iCalendar value, content type, token type), not an account"],
  ["packages/core/src/pim/CalDavPimTarget.ts", "names.add(name.toUpperCase())", 1, "a protocol keyword (HTTP method, iCalendar value, content type, token type), not an account"],
  ["packages/core/src/pim/DevicePimTarget.ts", "r.rrule.toUpperCase().startsWith(\"RRULE\")", 1, "a protocol keyword (HTTP method, iCalendar value, content type, token type), not an account"],
  ["packages/core/src/pim/GooglePimTarget.ts", "const norm = hex.toLowerCase()", 1, "a colour value"],
  ["packages/core/src/pim/GooglePimTarget.ts", "r.toUpperCase().startsWith(\"RRULE\")", 1, "a protocol keyword (HTTP method, iCalendar value, content type, token type), not an account"],
  ["packages/core/src/pim/GraphPimTarget.ts", "(body.contentType ?? \"\").toLowerCase() === \"html\"", 1, "a protocol keyword (HTTP method, iCalendar value, content type, token type), not an account"],
  ["packages/core/src/pim/GraphPimTarget.ts", "const organizerAddr = item.organizer?.emailAddress?.address?.toLowerCase()", 1, "an attendee or organizer address in an event, matched against the mailbox; decides no account"],
  ["packages/core/src/pim/GraphPimTarget.ts", "a.emailAddress?.address?.toLowerCase() === organizerAddr", 1, "an attendee or organizer address in an event, matched against the mailbox; decides no account"],
  ["packages/core/src/pim/eventSubstance.ts", ".map((part) => part.trim().toUpperCase())", 1, "the text of an event (HTML, a recurrence rule), not an account"],
  ["packages/core/src/pim/htmlToMarkdown.ts", "const key = entity.toLowerCase()", 1, "the text of an event (HTML, a recurrence rule), not an account"],
  ["packages/core/src/pim/htmlToMarkdown.ts", "entity[1].toLowerCase() === \"x\"", 1, "the text of an event (HTML, a recurrence rule), not an account"],
  ["packages/core/src/pim/htmlToMarkdown.ts", ".exec(value)?.[1]?.toLowerCase()", 1, "the text of an event (HTML, a recurrence rule), not an account"],
  ["packages/core/src/pim/htmlToMarkdown.ts", "char.charCodeAt(0).toString(16).toUpperCase()", 1, "the text of an event (HTML, a recurrence rule), not an account"],
  ["packages/core/src/pim/htmlToMarkdown.ts", "attribute(node, \"checked\").toLowerCase() === \"true\"", 1, "the text of an event (HTML, a recurrence rule), not an account"],
  ["packages/core/src/pim/htmlToMarkdown.ts", "map(value => value.trim().toLowerCase())", 1, "the text of an event (HTML, a recurrence rule), not an account"],
  ["packages/core/src/pim/htmlVisibleText.ts", "node.nodeName.toLowerCase()", 1, "the text of an event (HTML, a recurrence rule), not an account"],
  ["packages/core/src/pim/htmlVisibleText.ts", "declaration.slice(0, colon).trim().toLowerCase()", 1, "the text of an event (HTML, a recurrence rule), not an account"],
  ["packages/core/src/pim/htmlVisibleText.ts", "declaration.slice(colon + 1).trim().toLowerCase()", 1, "the text of an event (HTML, a recurrence rule), not an account"],
  ["packages/core/src/pim/recurrence.ts", "`FREQ=${r.freq.toUpperCase()}`", 1, "the text of an event (HTML, a recurrence rule), not an account"],
  ["packages/core/src/pim/recurrence.ts", "kv.slice(0, eq).trim().toUpperCase()", 1, "the text of an event (HTML, a recurrence rule), not an account"],
  ["packages/core/src/pim/recurrence.ts", "(map.get(\"FREQ\") ?? \"\").toUpperCase()", 1, "the text of an event (HTML, a recurrence rule), not an account"],
  ["packages/core/src/pim/recurrence.ts", "s.trim().toUpperCase()", 1, "the text of an event (HTML, a recurrence rule), not an account"],
  ["packages/core/src/settingsSync/connectionId.ts", "trimChars(remoteRoot.trim(), \"/\").toLowerCase()", 1, "the fingerprint of a files connection (provider and folder), not a password account"],
  ["packages/core/src/settingsSync/connectionId.ts", "provider.trim().toLowerCase()", 1, "the fingerprint of a files connection (provider and folder), not a password account"],
  ["packages/core/src/settingsSync/secretsBundle.ts", "parsed.protocol.toLowerCase()", 1, "scheme and host of an address are case-insensitive by definition"],
  ["packages/core/src/settingsSync/secretsBundle.ts", "parsed.hostname.toLowerCase()", 1, "scheme and host of an address are case-insensitive by definition"],
  ["packages/core/src/settingsSync/secretsBundle.ts", "const folded = user.toLowerCase()", 1, "the secret name a device up to 0.8.7 used, kept for a lower-case user; the exact user is part of every other name"],
  ["packages/core/src/settingsSync/secretsBundle.ts", "service === \"mail\" ? exact.toLowerCase() : exact", 1, "a mailbox is one account in any case of its address (mailIdentity)"],
  ["packages/core/src/settingsSync/secretsBundle.ts", "binding.user === binding.user.toLowerCase()", 1, "asks whether a secret entry was written by a client up to 0.8.7, compares nothing"],
  ["packages/core/src/settingsSync/secretsBundle.ts", "user.toLowerCase() === observedUser.toLowerCase()", 2, "the explicit \"fold\" mode: only for an entry up to 0.8.7 (a unique match) and to hold back a tombstone in doubt"],
  ["packages/ui/src/lib/accountLoginGrant.ts", "record.label.trim().toLowerCase() !== profile.label?.trim().toLowerCase()", 2, "Google/Microsoft: an e-mail address the provider vouches for"],
  ["packages/ui/src/lib/accountProfile.ts", "candidate.issuer.trim().toLowerCase()", 1, "an OAuth issuer address"],
  ["packages/ui/src/lib/accountProfile.ts", "a.host.trim().toLowerCase(), a.port, a.user.trim().toLowerCase()", 2, "a mailbox is one account in any case of its address (mailIdentity)"],
  ["packages/ui/src/lib/accountRepair.ts", "const label = account.label.trim().toLocaleLowerCase()", 1, "only a question: a pair it finds is offered for review, never merged by itself"],
  ["packages/ui/src/lib/accountRepair.ts", "const label = row.label.trim().toLocaleLowerCase()", 1, "only a question: a pair it finds is offered for review, never merged by itself"],
  ["packages/ui/src/lib/authErrors.ts", "const text = message.toLowerCase();", 2, "an error message, matched against known wording"],
  ["packages/ui/src/lib/cloudAccounts.ts", "const trimmed = (label ?? \"\").trim().toLowerCase()", 1, "identityKey: an e-mail address in any case; it joins cards only for Google and Microsoft (cardIdentityKey), elsewhere it only asks whether a label is an address"],
  ["packages/ui/src/lib/cloudAccounts.ts", "isSimpleEmail(mail.user.trim().toLowerCase())", 2, "asks whether a mailbox user is an e-mail address, compares nothing"],
  ["packages/ui/src/lib/cloudAccountsLabels.ts", "label.toLocaleLowerCase() !== provider.toLocaleLowerCase()", 2, "search text or a display label; decides no account"],
  ["packages/ui/src/lib/commentAuthor.ts", "(first + second).toUpperCase()", 1, "search text or a display label; decides no account"],
  ["packages/ui/src/lib/connectAccess.ts", "imapHost?.trim().toLowerCase()", 1, "scheme and host of an address are case-insensitive by definition"],
  ["packages/ui/src/lib/connectAccess.ts", "const q = query.trim().toLowerCase()", 1, "search text or a display label; decides no account"],
  ["packages/ui/src/lib/connectAccess.ts", "preset.label.toLowerCase().includes(q)", 1, "search text or a display label; decides no account"],
  ["packages/ui/src/lib/connectAccess.ts", "label(provider).toLowerCase().includes(q)", 1, "search text or a display label; decides no account"],
  ["packages/ui/src/lib/oauthAccess.ts", "platform.toUpperCase()", 1, "the name of a build variable"],
  ["packages/ui/src/lib/secretsPort.ts", "user: secretBindingUser(user).toLowerCase()", 1, "a mailbox is one account in any case of its address (mailIdentity)"],
  ["packages/ui/src/lib/secretsPort.ts", "user: candidate.binding.user.toLowerCase() })", 1, "the name a device up to 0.8.7 knows a secret by, only read, never written (oldNameId)"],
  ["packages/ui/src/mail/gmailAccount.ts", "expected.label.trim().toLowerCase() !== profile.label.toLowerCase()", 2, "Gmail: an e-mail address Google vouches for"],
  ["packages/ui/src/mail/gmailAccount.ts", "token.nativeGoogle.email.toLowerCase() !== profile.label.toLowerCase()", 2, "Gmail: an e-mail address Google vouches for"],
  ["packages/ui/src/mail/gmailAccount.ts", "bound.user.toLowerCase() === profile.label!.toLowerCase()", 2, "Gmail: an e-mail address Google vouches for"],
  ["packages/ui/src/mail/gmailAccount.ts", "mail.user.toLowerCase() === profile.label!.toLowerCase()", 2, "Gmail: an e-mail address Google vouches for"],
  ["packages/ui/src/mail/graphMail.ts", "const n = name.trim().toLowerCase()", 1, "a mail folder's name, mapped to its role"],
  ["packages/ui/src/mail/graphMail.ts", "(h.name ?? \"\").toLowerCase() === name.toLowerCase()", 2, "a protocol keyword (HTTP method, iCalendar value, content type, token type), not an account"],
  ["packages/ui/src/mail/graphMail.ts", "(m.body?.contentType ?? \"\").toLowerCase() === \"html\"", 1, "a protocol keyword (HTTP method, iCalendar value, content type, token type), not an account"],
  ["packages/ui/src/mail/graphMail.ts", "addr.toLowerCase() === account.user.trim().toLowerCase()", 2, "hides the mailbox's own address among the recipients, decides no account"],
  ["packages/ui/src/mail/mailAccounts.ts", "(firstAngleValue(value) ?? value).trim().toLowerCase()", 1, "a mailbox is one account in any case of its address (mailIdentity)"],
];

interface FoldingLine {
  rel: string;
  line: number;
  calls: number;
  text: string;
}

function foldingLines(): FoldingLine[] {
  const out: FoldingLine[] = [];
  for (const { rel, text } of sourceTexts(CODE_ROOTS, "shipped")) {
    if (!isAccountFile(rel) || rel === "packages/ui/src/lib/passwordAccounts.ts") continue;
    text.split("\n").forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
      const calls = line.match(FOLDING_CALL)?.length ?? 0;
      if (calls) out.push({ rel, line: index + 1, calls, text: trimmed });
    });
  }
  return out;
}

function rowFieldComparisons(): string[] {
  const out: string[] = [];
  for (const { rel, text } of sourceTexts(CODE_ROOTS, "shipped")) {
    if (!isAccountFile(rel) || rel === "packages/ui/src/lib/passwordAccounts.ts") continue;
    text.split("\n").forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
      if (ROW_FIELD_COMPARE.test(line) && !TYPEOF_ROW_FIELD.test(line)) out.push(`${rel}:${index + 1}: ${trimmed}`);
    });
  }
  return out;
}

describe("account comparisons outside the one rule (GitHub issue 174)", () => {
  const found = foldingLines();
  const entryOf = (line: FoldingLine) => ALLOWED.find(([file, fragment]) => file === line.rel && line.text.includes(fragment));

  it("every case-folding call in an account file is listed, with why it is not a password account", () => {
    const unlisted = found.filter((line) => !entryOf(line)).map((line) => `${line.rel}:${line.line}: ${line.text}`);
    expect(unlisted).toEqual([]);
  });

  it("each listed line holds exactly the calls it is listed with, and nothing listed is gone", () => {
    const counted = ALLOWED.map(([file, fragment, calls]) => {
      const lines = found.filter((line) => line.rel === file && line.text.includes(fragment));
      return { entry: `${file}: ${fragment}`, listed: calls, found: lines.reduce((sum, line) => sum + line.calls, 0) };
    });
    expect(counted.filter((c) => c.found !== c.listed)).toEqual([]);
  });

  it("no row's address or user is compared directly", () => {
    expect(rowFieldComparisons()).toEqual([]);
  });
});
