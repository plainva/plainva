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
 */

/** The constructors and calls that send a password to a server. */
const SEND = /new (?:CalDavPimTarget|WebDavSyncTarget|S3SyncTarget)\(|\b(?:buildWebDavTarget|buildS3Target|checkMailLogin|checkCalDavLogin|probeCalDav)\(/g;

const STORED_GATED = "a stored password: asks `isEndpointConfirmedIn` / `assertEndpointConfirmedIn` first";
const TYPED_CONFIRMS = "a password or address typed here: confirms the address with `confirmEndpointsIn` first";
const PROBE_ONLY = "a probe of what was typed in the form, before anything is stored";
const DEFINITION = "the definition the listed callers use";

const ALLOWED: ReadonlyArray<readonly [file: string, calls: number, reason: string]> = [
  ["apps/desktop/src/components/OnlineVaultSetup.tsx", 6, `${PROBE_ONLY}; the save confirms the address for the new vault`],
  ["apps/desktop/src/components/mail/MailAccountsSection.tsx", 1, TYPED_CONFIRMS],
  ["apps/desktop/src/contexts/VaultContext.tsx", 2, `${STORED_GATED} (\`unconfirmedSyncSlots\` into \`resolveFileSyncAccess\`)`],
  ["apps/desktop/src/services/accountPassword.ts", 4, TYPED_CONFIRMS],
  ["apps/desktop/src/services/accountSignIn.ts", 1, "Gmail app password: imap.gmail.com, a public name over TLS, needs no confirmation"],
  ["apps/desktop/src/services/cloudAccountsActions.ts", 5, `\`runConnectSequence\` confirms a typed password's addresses or refuses a reused one's; \`syncTargetFromSlots\`: ${STORED_GATED}`],
  ["apps/desktop/src/services/pim/pimAccounts.ts", 3, "reached only through `runConnectSequence` and the password change, which confirm first"],
  ["apps/desktop/src/services/pim/pimRuntime.ts", 1, STORED_GATED],
  ["apps/desktop/src/services/syncTargets.ts", 4, DEFINITION],
  ["apps/mobile/src/screens/MailAccountsScreen.tsx", 1, TYPED_CONFIRMS],
  ["apps/mobile/src/services/accountPassword.ts", 4, TYPED_CONFIRMS],
  ["apps/mobile/src/services/connectProbe.ts", 2, PROBE_ONLY],
  ["apps/mobile/src/services/pim/pimService.ts", 5, `\`buildTargetFor\`: ${STORED_GATED}; add and repair: ${TYPED_CONFIRMS}; \`probeCalDav\`: ${PROBE_ONLY}`],
  ["apps/mobile/src/services/syncService.ts", 2, `\`buildTarget\`: ${STORED_GATED} for a stored slot; \`decideStart\` reads unconfirmed as signed out`],
  ["packages/ui/src/mail/mailClient.ts", 1, DEFINITION],
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
});
