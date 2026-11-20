import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The phone's mail form and rows (review of F57, O3): a server the form came
 * with is never confirmed by a password typed in it, and its rows and edit
 * sheet ask **Confirm address** first. The rule itself is
 * `confirmTypedEndpointsIn` (endpointConfirmation.test.ts); this pins that the
 * screen sends through it, with the mailbox it edits as what it came with.
 */
describe("the phone's mail form", () => {
  const screen = readFileSync(join(__dirname, "MailAccountsScreen.tsx"), "utf8");

  it("confirms only a server whose endpoint was typed in it", () => {
    expect(screen).toMatch(/await confirmTypedEndpointsIn\(vault, mailboxEndpoints\(account\), \[\.\.\.\(editing \? mailboxEndpoints\(editing\) : \[\]\), \.\.\.mailboxEndpointsNotInForm\(account\)\]\);\s*await checkMailLogin/);
    expect(screen).not.toMatch(/confirmEndpointsIn\(/);
  });

  it("asks for each unconfirmed server under its row and above the edit form", () => {
    expect(screen).toMatch(/\{imap && <MailboxConfirm account=\{a\} \/>\}/);
    expect(screen).toMatch(/\{kind === "imap" && editing && <MailboxConfirm account=\{editing\} \/>\}\s*\{kind === "imap" \? \(\s*<MailImapForm/);
  });
});
