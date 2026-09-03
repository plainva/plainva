import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { familyLabel, familyOfSyncProvider, type SyncProviderId } from "@plainva/ui";
import { getSyncStatus, subscribeSyncStatus } from "../services/syncService";
import { getActiveVaultEntry } from "../services/vaultRegistry";

/**
 * "Google Drive · synchron" — the vault's cloud and its state, for the app bar
 * subtitle (mobile rework N5.1).
 *
 * The target picture uses the subtitle on 23 of its 42 bars to answer "where am
 * I, in what state"; the app used it on 1 of 34. The navigator's title is the
 * vault name, which leaves exactly this pair with nowhere else to stand: the
 * cloud has not changed since the vault was connected, and the state is the one
 * thing about it that does.
 *
 * The provider NAME comes from the shared family table — `familyOfSyncProvider`
 * plus `familyLabel` — rather than from a second map. The vault detail carried
 * one of those for itself, which is how the phone ended up with two spellings
 * of "WebDAV / Nextcloud".
 */
export function useSyncSubtitle(): string {
  const { t } = useTranslation();
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
  const [provider, setProvider] = useState<string | null>(null);

  useEffect(() => {
    const read = () => void getActiveVaultEntry().then((e) => setProvider(e.provider ?? null)).catch(() => setProvider(null));
    read();
    window.addEventListener("m-vaults-changed", read);
    return () => window.removeEventListener("m-vaults-changed", read);
  }, []);

  if (!provider) return "";
  const name = familyLabel(familyOfSyncProvider(provider as SyncProviderId));
  return `${name} · ${syncStateLabel(status, t)}`;
}

/**
 * The one wording of the sync state, for every surface that shows it.
 *
 * `retrying` is the state round 3 added: a temporary failure the worker expects
 * to survive. It says WHEN rather than what broke — the raw provider string is
 * useless to a reader mid-commute and stays in the diagnostics — and it is
 * built here rather than in the core, which has no language.
 */
export function syncStateLabel(
  status: { status: string; retryAt?: number },
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (status.status === "syncing") return t("mobile.syncSyncing");
  if (status.status === "retrying") {
    return status.retryAt
      ? t("mobile.syncRetryingAt", {
          time: new Date(status.retryAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
        })
      : t("mobile.syncRetrying");
  }
  if (status.status === "error") return t("mobile.syncError");
  if (status.status === "idle") return t("mobile.syncIdle");
  // `off` is the STATE, not the action (finding 2026-09-03). This fell through
  // to `syncDisconnect` ("Trennen"), so a paused vault announced itself under
  // its name with the verb of the danger row further down. The vault detail
  // had fixed exactly that for its own headline — but not here, in the one
  // wording every surface reads.
  return t("mobile.syncDisconnected");
}
