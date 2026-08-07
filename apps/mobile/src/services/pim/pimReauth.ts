import { getActiveVaultEntry } from "../vaultRegistry";
import { getPimCredentials } from "./pimCredentials";
import { beginPimOAuth } from "./pimOAuth";

/**
 * Renewing an expired calendar sign-in — ONE chain, for both places that offer
 * it (N9.3).
 *
 * It lived inside the accounts screen, so the calendar's own banner could only
 * navigate there: its prominent, filled button called `onOpenSettings()` and
 * changed the screen instead of signing anything in. Two implementations would
 * be worse than one indirection — a renewal that binds the WRONG account id
 * loses every calendar and every mirrored task's anchor, which is exactly what
 * "delete it and add it again" used to cost.
 *
 * The consent runs against the same account id, so the row keeps its calendars.
 * For an expired grant the credential slot is still there, so the client id it
 * was created with is reused and the user does not have to dig it out again.
 *
 * CalDAV is deliberately NOT handled here: renewing it is a form, not a
 * consent. Callers ask `needsForm` first and send the user to the form.
 */
export type ReauthOutcome =
  /** A browser consent was opened; the redirect completes it. */
  | { kind: "started" }
  /** CalDAV, or an OAuth account whose client id is gone: the form must ask. */
  | { kind: "needsForm"; provider: string; reason: "caldav" | "missingClientId" }
  | { kind: "failed"; error: string };

export function reauthNeedsForm(provider: string): boolean {
  return provider === "caldav";
}

export async function reauthorizeCalendarAccount(
  account: { id: string; label: string; provider: string },
  /** Fallbacks from the add-account form, used only when no slot survives. */
  fallback?: { googleClientId?: string; googleClientSecret?: string; microsoftClientId?: string },
): Promise<ReauthOutcome> {
  if (reauthNeedsForm(account.provider)) {
    return { kind: "needsForm", provider: account.provider, reason: "caldav" };
  }
  try {
    const vault = await getActiveVaultEntry();
    const stored = await getPimCredentials(vault.id, account.id).catch(() => null);
    const storedId = stored && stored.kind !== "caldav" ? stored.clientId : "";
    const storedSecret = stored && stored.kind === "google" ? stored.clientSecret : "";
    if (account.provider === "google") {
      const clientId = storedId || (fallback?.googleClientId ?? "").trim();
      if (!clientId) {
        // Nothing to sign in WITH — the form asks, rather than opening a
        // consent page Google would reject.
        return { kind: "needsForm", provider: account.provider, reason: "missingClientId" };
      }
      await beginPimOAuth("google", {
        clientId,
        clientSecret: storedSecret || fallback?.googleClientSecret || "",
        label: account.label,
        accountId: account.id,
      });
      return { kind: "started" };
    }
    // Microsoft falls back to the shipped central client id when no slot is left.
    await beginPimOAuth("microsoft", {
      clientId: storedId || fallback?.microsoftClientId || "",
      label: account.label,
      accountId: account.id,
    });
    return { kind: "started" };
  } catch (e) {
    return { kind: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}
