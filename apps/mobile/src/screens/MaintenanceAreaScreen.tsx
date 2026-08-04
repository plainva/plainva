import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileClock, RefreshCw } from "lucide-react";
import { Button, ICON, toast } from "@plainva/ui";
import { AppBar } from "../components/AppBar";
import { DeletedFilesSheet } from "../components/DeletedFilesSheet";
import type { MobileVault } from "../services/vaultService";

/**
 * Maintenance (S39, P10) — the vault's housekeeping, which the phone reached
 * through no door at all: the settings catalog listed the area and the mobile
 * shell filtered it away.
 *
 * It holds what concerns the vault's CONTENTS and its index. The vault screen
 * keeps what concerns its cloud connection and identity, so each action has
 * exactly one way in — the two index actions moved here rather than being
 * offered in both places.
 */
export function MaintenanceAreaScreen({ vault, onBack }: { vault: MobileVault; onBack: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [stats, setStats] = useState<{ notes: number; attachments: number } | null>(null);

  const loadStats = () =>
    vault.queryService
      ?.getVaultStats()
      .then((s) => s)
      .catch(() => null) ?? Promise.resolve(null);

  useEffect(() => {
    let stale = false;
    void loadStats().then((s) => {
      if (!stale) setStats(s);
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadStats is derived from vault
  }, [vault]);

  const rebuildIndex = () => {
    setBusy(true);
    void vault.indexer
      ?.indexVaultFull()
      .then(async () => {
        setStats(await loadStats());
        // The index is invisible; without a word the button just goes quiet and
        // the user cannot tell a finished rebuild from a swallowed one.
        toast.success(t("settings.rebuildIndex"));
        window.dispatchEvent(new CustomEvent("m-index-changed"));
      })
      .catch(() => toast.warning(t("settings.rebuildIndex")))
      .finally(() => setBusy(false));
  };

  return (
    <div className="m-page">
      <AppBar onBack={onBack} title={t("settings.sectionMaintenance")} />

      <p className="m-sectionlabel">{t("settings.vaultStats")}</p>
      <div className="m-card">
        <p>
          {stats
            ? t("settings.vaultStatsValue", { notes: stats.notes, attachments: stats.attachments })
            : "—"}
        </p>
      </div>

      <p className="m-sectionlabel">{t("mobile.vaultGroupContents")}</p>
      <div className="m-card">
        <p>
          <b>{t("settings.rebuildIndex")}</b>
        </p>
        <p>{t("settings.rebuildIndexDesc")}</p>
        <Button disabled={busy || !vault.indexer} onClick={rebuildIndex} variant="tonal">
          <RefreshCw size={ICON.ui} />
          {busy ? t("settings.rebuildIndexRunning") : t("settings.rebuildIndexAction")}
        </Button>
      </div>
      <div className="m-card">
        <p>
          <b>{t("versions.deletedTitle")}</b>
        </p>
        <p>{t("settings.deletedFilesDesc")}</p>
        <Button disabled={busy} onClick={() => setDeleted(true)} variant="tonal">
          <FileClock size={ICON.ui} />
          {t("settings.deletedFilesButton")}
        </Button>
      </div>

      {deleted && <DeletedFilesSheet onClose={() => setDeleted(false)} vault={vault} />}
    </div>
  );
}
