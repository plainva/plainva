import i18n from "@plainva/ui/i18n";
import type { AccessFamily } from "@plainva/ui";
import { getActiveVaultEntry } from "../vaultRegistry";
import { loadCloudAccounts } from "../cloudAccountsStore";
import { AccessUnavailableError, beginMobileSignIn } from "../accountSignIn";

/**
 * Renewing an expired calendar sign-in - ONE chain, for both places that offer
 * it (N9.3): the calendar's own banner and the accounts screen.
 *
 * A Google or Microsoft calendar has no sign-in of its own; it uses its card's
 * (account sign-in plan E1). Renewing it is therefore the card's "Sign in
 * again": one consent for everything the card carries, bound to the same card
 * and the same calendar row, so the row keeps its calendars and every mirrored
 * task its anchor. Until K4b this module ran a consent for the calendar alone,
 * with a client id looked up along a chain of its own - the second way to sign
 * in that the plan set out to remove.
 *
 * CalDAV is deliberately NOT handled here: renewing it is a form, not a
 * consent. Callers ask `needsForm` first and send the user to the form.
 */
export type ReauthOutcome =
  /** A browser consent was opened; the redirect completes it. */
  | { kind: "started" }
  /** CalDAV: the form must ask. */
  | { kind: "needsForm"; provider: string; reason: "caldav" }
  /** This device has no usable access for the provider: the access sheet asks. */
  | { kind: "needsAccess"; family: AccessFamily }
  | { kind: "failed"; error: string };

export function reauthNeedsForm(provider: string): boolean {
  return provider === "caldav";
}

export async function reauthorizeCalendarAccount(account: { id: string; label: string; provider: string }): Promise<ReauthOutcome> {
  if (reauthNeedsForm(account.provider)) {
    return { kind: "needsForm", provider: account.provider, reason: "caldav" };
  }
  try {
    const vault = await getActiveVaultEntry();
    const record = (await loadCloudAccounts(vault.id)).find((entry) => entry.services.calendar?.pimAccountId === account.id);
    if (!record || (record.family !== "google" && record.family !== "microsoft")) {
      return { kind: "failed", error: i18n.t("cloudAccounts.loginBindingChanged") };
    }
    await beginMobileSignIn(vault.id, { family: record.family, cardId: record.id, add: [] });
    return { kind: "started" };
  } catch (e) {
    if (e instanceof AccessUnavailableError) return { kind: "needsAccess", family: e.family };
    return { kind: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}
