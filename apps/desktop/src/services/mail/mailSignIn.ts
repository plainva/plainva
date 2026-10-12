import { setMailLookupNote, setMailTokenResolver } from "@plainva/ui/mail";
import { brokerTokenProvider, describeBrokerLookup } from "../accountBroker";

/**
 * Where an OAuth mailbox gets its sign-in from, in the main window.
 *
 * A Microsoft or Gmail mailbox draws its access token from the shared account
 * broker when a cloud account card carries it (cloud accounts stage B);
 * otherwise the resolver returns undefined and the mailbox keeps its own
 * refresh path.
 *
 * The MAILBOX is part of the question. This registration used to stand in
 * `main.tsx` and asked for "the mail token of this vault": the broker then
 * answered with the first card that carried mail, for every mailbox. With two
 * Microsoft mailboxes the second one read, moved and SENT with the sign-in of
 * the first — Graph answers `/me` for the account of the token — and a Gmail
 * mailbox beside a Microsoft one was handed a token its server refuses
 * (finding 2026-10-12). It is a function of its own so a test can ask the
 * resolver that is actually registered, with two mailboxes
 * (`mailSignIn.test.ts`); the broker's own tests had the case all along.
 *
 * Owner window only: an auxiliary window asks the owner over the bus
 * (`registerClientMailPlatform`), which ends up here with the mailbox it named.
 */
export function registerMailSignIn(): void {
  setMailTokenResolver((vaultPath, accountId) => brokerTokenProvider(vaultPath, "mail", accountId));
  // And why it came back empty, when it does (finding 2026-07-30) — for the
  // mailbox that asked.
  setMailLookupNote((vaultPath, accountId) => describeBrokerLookup(vaultPath, "mail", accountId));
}
