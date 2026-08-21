import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Download, FileClock, ListTree, RefreshCw } from "lucide-react";
import { GroupCard, ICON, Row, RowList, SectionLabel, toast } from "@plainva/ui";
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
export function MaintenanceAreaScreen({
  vault,
  onBack,
  onImport,
  onOverviews,
}: {
  vault: MobileVault;
  onBack: () => void;
  /** Opens the import wizard (S41) — the phone's first door to the importers. */
  onImport: () => void;
  /** Opens the OKF overviews list (P6). */
  onOverviews: () => void;
}) {
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
        toast.success(t("settings.rebuildIndexDone"));
        window.dispatchEvent(new CustomEvent("m-index-changed"));
      })
      // Both branches used to emit the SECTION HEADING — the same outcome-free
      // word whether the rebuild finished or was swallowed, which is exactly
      // what the comment above says must not happen (S45).
      .catch(() => toast.warning(t("settings.rebuildIndexFailed")))
      .finally(() => setBusy(false));
  };

  return (
    <div className="m-page">
      <AppBar onBack={onBack} title={t("settings.sectionMaintenance")} />

      <div className="m-settings">
        <SectionLabel>{t("settings.vaultStats")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row title={stats ? t("settings.vaultStatsValue", { notes: stats.notes, attachments: stats.attachments }) : "—"} />
          </RowList>
        </GroupCard>

        {/* Three cards, each a bold line, a paragraph and a full-width tonal
            button, are three rows: the description is what a row's second line is
            for. Import stands with them because it is the vault's contents, like
            the two above — and because the desktop keeps it a vault action too. */}
        <SectionLabel>{t("mobile.vaultGroupContents")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row
              disabled={busy || !vault.indexer}
              icon={<RefreshCw size={ICON.ui} />}
              onClick={rebuildIndex}
              subtitle={busy ? t("settings.rebuildIndexRunning") : ""}
              title={t("settings.rebuildIndexAction")}
            />
            <Row
              disabled={busy}
              end={<ChevronRight className="m-chevron" size={ICON.ui} />}
              icon={<FileClock size={ICON.ui} />}
              onClick={() => setDeleted(true)}
              title={t("versions.deletedTitle")}
            />
            <Row
              data-testid="open-overviews"
              disabled={busy || !vault.queryService}
              end={<ChevronRight className="m-chevron" size={ICON.ui} />}
              icon={<ListTree size={ICON.ui} />}
              onClick={onOverviews}
              title={t("indexMd.overviewsTitle")}
            />
            <Row
              data-testid="open-import"
              disabled={busy}
              end={<ChevronRight className="m-chevron" size={ICON.ui} />}
              icon={<Download size={ICON.ui} />}
              onClick={onImport}
              title={t("import.title")}
            />
          </RowList>
        </GroupCard>
      </div>

      {deleted && <DeletedFilesSheet onClose={() => setDeleted(false)} vault={vault} />}
    </div>
  );
}
