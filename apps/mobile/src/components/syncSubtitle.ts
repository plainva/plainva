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
  const state =
    status.status === "syncing"
      ? t("mobile.syncSyncing")
      : status.status === "error"
        ? t("mobile.syncError")
        : status.status === "idle"
          ? t("mobile.syncIdle")
          : t("mobile.syncDisconnect");
  return `${name} · ${state}`;
}
