import ts from "typescript";
import { describe, expect, it } from "vitest";
import { sourceFile, sourceTexts } from "./test-sourceTree";

/**
 * F57 (maintainer, 2026-11-18): no stored password goes to an address without
 * TLS, or in a private network, that this device never confirmed
 * (`packages/ui/src/lib/endpointConfirmation.ts`). Every place in either shell
 * that opens a password connection — a CalDAV, WebDAV or S3 target, a mail
 * login check — is listed here with how it keeps the rule. A new one fails
 * this test until it is listed, so no send path is added without being asked.
 *
 * Mail sends a stored password only through `mailCredentials`
 * (`packages/ui/src/mail/mailCredentials.ts`), which IMAP, SMTP and Sieve all
 * use; the second test holds that check in place.
 *
 * Asking is half of it; the address asked about must also be this device's own
 * (review of F57, O4). The synced account document names every device's
 * address (`config.url`, the confirmed-access map); a send site that took one
 * from there would ask about an address nobody here typed. So each site also
 * names where its address comes from, and the third test fails a function that
 * sends a password and reads an address out of the document.
 *
 * What this guard does NOT see (review of F57, O4) — the behaviour tests are
 * the net for those, one per way (endpointConfirmation.test.ts,
 * endpointConfirmationSettle.test.ts, cloudAccountsActions.test.ts,
 * AccountPasswordChangePanel.test.tsx, filesRun.test.ts; on the phone
 * accountPassword.test.ts, syncStartOrder.test.ts, fileSyncAccess.test.ts,
 * pimTargetCredentials.test.ts, endpointConfirmationSettle.test.ts):
 * - whether the check stands BEFORE the send: it counts the sends of a file;
 * - a send behind a wrapper outside `SEND` (`connectCalDavAccount`,
 *   `runtime.buildTarget`, `syncTargetFromSlots`, `listProviderFolders`,
 *   `withMailCredentials`);
 * - a document address read through a helper at the top level, a
 *   destructured field, or a mailbox's own `host` (mail rows are documents
 *   too); the exception below holds per file and per what it reads, not per
 *   statement.
 */

/** The constructors and calls that send a password to a server. */
const SEND = /new (?:CalDavPimTarget|WebDavSyncTarget|S3SyncTarget)\(|\b(?:buildWebDavTarget|buildS3Target|checkMailLogin|checkCalDavLogin|probeCalDav)\(/g;

/**
 * How the synced account document names an address: a row's `config.url`,
 * `host`, `port` or `endpoint`, and the confirmed-access map of every device.
 */
const DOCUMENT_ADDRESS = /\bconfig\??\.(?:url|host|port|endpoint)\b|\bconfirmedAccessOf\(|\blatestConfirmedAccess\(|\bCONFIRMED_ACCESS_KEY\b/g;

const STORED_GATED = "a stored password: asks `isEndpointConfirmedIn` / `assertEndpointConfirmedIn` first";
const TYPED_CONFIRMS = "a password or address typed here: confirms the address with `confirmEndpointsIn` first";
const NEW_PASSWORD_GATED = "a new password for addresses that came with the account: asks `assertEndpointConfirmedIn` first, confirms none (review of F57, O3)";
const TYPED_ENDPOINTS = "confirms only an endpoint typed in the form (`confirmTypedEndpointsIn`); one it came with must be confirmed first (review of F57, O3)";
const PROBE_ONLY = "a probe of what was typed in the form, before anything is stored";
const DEFINITION = "the definition the listed callers use";

/**
 * Statements that send a password and also name the document's addresses,
 * without sending to them (O4): what each reads, and why that is no send.
 */
const DOCUMENT_READS_NOT_SENT: ReadonlyArray<readonly [file: string, reads: string, reason: string]> = [
  ["apps/mobile/src/services/pim/pimService.ts", "CONFIRMED_ACCESS_KEY, confirmedAccessOf(", "the repair form sends to the address typed in it and reads the confirmed-access map only to replace this device's own entry in it"],
];

/** Where the address a site sends to comes from (O4). */
const FROM_SLOT = "this device's own slot in the credential store";
const FROM_FORM = "the form on this device, as typed";
const FROM_CODE = "a fixed public address in the code";
const FROM_CALLER = "its caller, one of the sites listed here";

const ALLOWED: ReadonlyArray<readonly [file: string, calls: number, reason: string, address: string]> = [
  ["apps/desktop/src/components/OnlineVaultSetup.tsx", 6, `${PROBE_ONLY}; the save confirms the address for the new vault`, FROM_FORM],
  ["apps/desktop/src/contexts/VaultContext.tsx", 2, `${STORED_GATED} (\`unconfirmedSyncSlots\` into \`resolveFileSyncAccess\`)`, FROM_SLOT],
  ["apps/desktop/src/services/accountPassword.ts", 4, NEW_PASSWORD_GATED, `${FROM_SLOT}, for mail the mailbox row on this device; only the password is typed here`],
  ["apps/desktop/src/services/accountSignIn.ts", 1, "Gmail app password: imap.gmail.com, a public name over TLS, needs no confirmation", FROM_CODE],
  ["apps/desktop/src/services/cloudAccountsActions.ts", 5, `\`runConnectSequence\` confirms a typed password's addresses or refuses a reused one's; \`syncTargetFromSlots\`: ${STORED_GATED}`, `\`runConnectSequence\`: ${FROM_FORM}; \`syncTargetFromSlots\`: ${FROM_SLOT}`],
  ["apps/desktop/src/services/pim/pimAccounts.ts", 3, "reached only through `runConnectSequence` and the password change, which confirm first", FROM_CALLER],
  ["apps/desktop/src/services/pim/pimRuntime.ts", 1, STORED_GATED, FROM_SLOT],
  ["apps/desktop/src/services/syncTargets.ts", 4, DEFINITION, FROM_CALLER],
  ["apps/mobile/src/screens/MailAccountsScreen.tsx", 1, TYPED_ENDPOINTS, FROM_FORM],
  ["apps/mobile/src/services/accountPassword.ts", 4, NEW_PASSWORD_GATED, `${FROM_SLOT}, for mail the mailbox row on this device; only the password is typed here`],
  ["apps/mobile/src/services/connectProbe.ts", 2, PROBE_ONLY, FROM_FORM],
  ["apps/mobile/src/services/pim/pimService.ts", 5, `\`buildTargetFor\`: ${STORED_GATED} (through \`pimTargetCredentials\`); add and repair (forms that start empty): ${TYPED_CONFIRMS}; \`probeCalDav\`: ${PROBE_ONLY}`, `\`buildTargetFor\`: ${FROM_SLOT}; add, repair and \`probeCalDav\`: ${FROM_FORM}`],
  ["apps/mobile/src/services/syncService.ts", 2, `\`buildTarget\`: ${STORED_GATED} for a stored slot; \`decideStart\` reads unconfirmed as signed out`, `\`buildTarget\`: ${FROM_SLOT}, or the form for a new vault`],
  ["packages/ui/src/mail/mailClient.ts", 1, DEFINITION, FROM_CALLER],
  ["packages/ui/src/mail/mailboxSignIn.ts", 1, `a password typed for a mailbox whose servers came with it: ${STORED_GATED} (review of F57, O3)`, FROM_CALLER],
];

describe("every password connection asks whether this device confirmed the address (F57)", () => {
  it("is listed, with how it keeps the rule", () => {
    const found = new Map<string, number>();
    for (const { rel, text } of sourceTexts(["packages/ui/src", "apps/desktop/src", "apps/mobile/src"], "shipped")) {
      const calls = text.match(SEND)?.length ?? 0;
      if (calls) found.set(rel, calls);
    }
    const listed = new Map(ALLOWED.map(([file, calls]) => [file, calls]));
    const unlisted = [...found].filter(([file, calls]) => listed.get(file) !== calls).map(([file, calls]) => `${file}: ${calls} (listed ${listed.get(file) ?? 0})`);
    const stale = [...listed].filter(([file]) => !found.has(file)).map(([file]) => file);
    expect(unlisted).toEqual([]);
    expect(stale).toEqual([]);
  });

  it("mail takes a stored password only through mailCredentials, which asks first", () => {
    expect(sourceFile("packages/ui/src/mail/mailCredentials.ts")).toMatch(/isEndpointConfirmedIn\(vaultPath, endpoint\)/);
    for (const { rel, text } of sourceTexts(["packages/ui/src/mail"], "shipped")) {
      if (rel.endsWith("mailCredentials.ts") || rel.endsWith("mailAccounts.ts")) continue;
      expect(`${rel}: ${/\bgetMailPassword\(/.test(text)}`).toBe(`${rel}: false`);
    }
  });

  it("no function that sends a password reads an address out of the account document (O4)", () => {
    const fromDocument: string[] = [];
    for (const { rel, text } of sourceTexts(["packages/ui/src", "apps/desktop/src", "apps/mobile/src"], "shipped")) {
      if (!new RegExp(SEND.source).test(text)) continue;
      const file = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      // The whole top-level statement around a send: a component, a function, a
      // service object — so a read one closure further out still counts.
      for (const statement of file.statements) {
        const body = statement.getText(file);
        if (!new RegExp(SEND.source).test(body)) continue;
        const reads = body.match(DOCUMENT_ADDRESS) ?? [];
        const named = reads.join(", ");
        if (reads.length && !DOCUMENT_READS_NOT_SENT.some(([file, listed]) => file === rel && listed === named)) fromDocument.push(`${rel}:${file.getLineAndCharacterOfPosition(statement.getStart(file)).line + 1}: ${named}`);
      }
    }
    expect(fromDocument).toEqual([]);
  });

  it("the address check knows the ways the document names an address", () => {
    for (const read of ["row.config.url", "account.config?.host", "existing.config.port", "confirmedAccessOf(row.config)", "latestConfirmedAccess(map)", "row.config[CONFIRMED_ACCESS_KEY]"]) {
      expect(`${read}: ${(read.match(DOCUMENT_ADDRESS) ?? []).length > 0}`).toBe(`${read}: true`);
    }
  });
});
