import { getActiveVaultEntry } from "../vaultRegistry";
import { getAccountToken } from "../accountBroker";
import { loadCloudAccounts } from "../cloudAccountsStore";
import { pickOAuthClient, type OAuthClient } from "../oauthClientChain";
import { getStoredProvider } from "../syncService";
import { getPimCredentials } from "./pimCredentials";
import { listPimAccounts } from "./pimService";
import type { ServiceConnectionContext } from "@plainva/ui";

/**
 * The OAuth client id this device can sign a NEW calendar account in with
 * (finding 2026-08-21).
 *
 * `pimReauth` has asked the shared four-step chain since 2026-08-19 — own slot
 * → account token → file sync → sibling account — but only for an EXISTING
 * account. The add form never asked, so step 2 of a connect run demanded the
 * client id again although step 1 had just used it: it sits in the file-sync
 * credentials of the very vault the run created. Same chain, one source
 * missing: there is no own slot yet.
 */
export async function lookupOAuthClientForNewAccount(
  provider: "google" | "microsoft",
  context?: ServiceConnectionContext,
): Promise<OAuthClient | null> {
  try {
    const vault = await getActiveVaultEntry();
    if (context && context.vaultId !== vault.id) return null;
    const records = await loadCloudAccounts(vault.id).catch(() => []);
    const family = provider === "google" ? "google" : "microsoft";
    const candidates = records.filter(r => r.family === family && (!context?.cloudAccountId || r.id === context.cloudAccountId));
    if (candidates.length > 1 || (context?.cloudAccountId && candidates.length !== 1)) return null;
    const record = candidates[0];
    const accountToken = record ? await getAccountToken(vault.id, record.id).catch(() => null) : null;
    const syncProvider = !context?.cloudAccountId || record?.services.files ? await getStoredProvider(vault.id).catch(() => null) : null;
    const siblings = (
      await Promise.all(
        (await listPimAccounts().catch(() => []))
          .filter((row) => row.provider === provider && (!context?.cloudAccountId || row.id === record?.services.calendar?.pimAccountId))
          .map((row) => getPimCredentials(vault.id, row.id).catch(() => null)),
      )
    ).filter((creds): creds is NonNullable<typeof creds> => !!creds);
    return pickOAuthClient(provider, { own: null, accountToken, syncProvider, siblings }) ?? (record?.byoClientId ? { clientId: record.byoClientId } : null);
  } catch {
    // A lookup that fails must never block the form — it falls back to asking.
    return null;
  }
}
