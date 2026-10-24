import { accountServices, type CloudAccountRecord, type CloudProviderFamily, type CloudServiceId } from "./cloudAccounts";
import type { OAuthFamily } from "./oauthScopes";
import { tokenCoversService, type StoredAccountToken } from "./tokenBroker";

/**
 * Which cloud account card may answer for ONE subsystem account — a calendar
 * account (pim row) or a mailbox — when it asks the account broker for a token.
 *
 * The rule lives here once, for both shells. It used to be written twice, and
 * both copies took the asking account as an OPTION: without it, "a token for
 * this vault" was answered with the first card that carried the service. The
 * calendar has named its account since 2026-07-30 (a Microsoft calendar was
 * handed the Google account's token). Mail never did — both shells registered
 * its resolver without the mailbox — so a second Microsoft mailbox in a vault
 * read, moved and SENT with the sign-in of the first: Graph answers `/me` for
 * the account of the token, whatever mailbox the app believes it is in
 * (finding 2026-10-12).
 *
 * So the asking account is part of the question, never an option. A question
 * without one gets no card at all, and no match means no broker: the service
 * falls back to its own sign-in, never to a stranger's.
 *
 * Files are not asked here. A vault syncs through one account, which names
 * its provider and client instead (`fileBrokerBinding.ts`).
 */

/** Families whose services can share one refresh token through the broker. */
export function brokerFamily(family: CloudProviderFamily): OAuthFamily | null {
  return family === "microsoft" || family === "google" ? family : null;
}

/** The subsystem account a card points its service at (pim row / mail account). */
export function brokeredSubsystemId(record: CloudAccountRecord, service: CloudServiceId): string | undefined {
  if (service === "calendar") return record.services.calendar?.pimAccountId;
  if (service === "mail") return record.services.mail?.mailAccountId;
  return undefined;
}

/**
 * The cards that may serve `subsystemId` through the broker: a broker family
 * that carries the service and points it at exactly the account that asks.
 *
 * More than one can match — a settings import or an interrupted repair can
 * leave two cards on one mailbox — and the caller tries each of them, because
 * one without a sign-in must not shadow the one that has it (finding
 * 2026-07-30). None of them belongs to another account.
 */
export function brokerCardsFor(
  records: readonly CloudAccountRecord[],
  service: CloudServiceId,
  subsystemId: string,
): CloudAccountRecord[] {
  if (!subsystemId) return [];
  return records.filter(
    (record) =>
      brokerFamily(record.family) !== null &&
      accountServices(record).includes(service) &&
      brokeredSubsystemId(record, service) === subsystemId,
  );
}

/** What the shell knows about its cards and their stored sign-ins. */
export interface BrokerLookupPorts {
  records(): Promise<readonly CloudAccountRecord[]>;
  /** The card's sign-in: any grant when no service is named, otherwise the one that would serve it. */
  token(accountId: string, service?: CloudServiceId, family?: OAuthFamily): Promise<StoredAccountToken | null>;
}

/**
 * Why the broker did not answer for this account, in one sentence, for the
 * error a person reads.
 *
 * The settings show the provider's own words under the advice, and "no stored
 * sign-in" alone did not say which sign-in was missing (finding 2026-07-30) —
 * the fix for "the service has none" is connecting the service, the fix for "the
 * account has none" is one login for all services. It looks at the cards of the
 * account that asked and at no other: a sentence about someone else's card
 * would send the reader to the wrong account. Never throws: it exists to
 * explain a failure, not to add one.
 */
export async function describeBrokerLookup(
  ports: BrokerLookupPorts,
  service: CloudServiceId,
  subsystemId: string,
): Promise<string> {
  try {
    const candidates = brokerCardsFor(await ports.records(), service, subsystemId);
    if (candidates.length === 0) {
      return "this service has no sign-in of its own, and no cloud account carries it — connect it again.";
    }
    let withToken = 0;
    let outOfScope = 0;
    for (const record of candidates) {
      const family = brokerFamily(record.family);
      const anyGrant = await ports.token(record.id);
      if (!anyGrant?.refreshToken) continue;
      const stored = await ports.token(record.id, service, family ?? undefined);
      withToken++;
      if (family && !tokenCoversService(stored, service, family)) outOfScope++;
    }
    if (withToken === 0) {
      return `${candidates.length} cloud account(s) carry this service, but none holds the shared sign-in — reconnect the account with "one login for all services".`;
    }
    // The precise case, and the one nobody could have guessed from a 401: the
    // shared sign-in exists but was granted for other services only.
    if (outOfScope === withToken) {
      return `the shared sign-in of this account was granted for its other services only and cannot cover this one — sign in again, which now asks for the whole account.`;
    }
    return `a shared sign-in is stored (${withToken}/${candidates.length}) but could not be used for this service — reconnect the account with "one login for all services".`;
  } catch (err) {
    return `the cloud account list could not be read (${err instanceof Error ? err.message : String(err)}).`;
  }
}
