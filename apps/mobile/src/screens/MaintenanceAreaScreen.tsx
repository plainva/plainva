import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Download, FileCog, FileUp, ListTree, RefreshCw } from "lucide-react";
import { GroupCard, ICON, Row, RowList, SectionLabel, okfBundleStatusLines } from "@plainva/ui";
import { AppBar } from "../components/AppBar";
import { rebuildVaultIndex } from "../services/indexMaintenance";
import { scanVaultOkfVersion } from "../services/okfMigration";
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
  onConvertOkf,
  onMigrateOkf,
  onImport,
  onOverviews,
}: {
  vault: MobileVault;
  onBack: () => void;
  /** Opens the import wizard (S41) — the phone's first door to the importers. */
  onConvertOkf: () => void;
  /** Opens the OKF bundle migration (OKF v0.2 plan, P2). */
  onMigrateOkf: () => void;
  onImport: () => void;
  /** Opens the OKF overviews list (P6). */
  onOverviews: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<{ notes: number; attachments: number } | null>(null);
  /** One line on what the root index.md declares — the row's subtitle. */
  const [bundleLine, setBundleLine] = useState("");

  useEffect(() => {
    let stale = false;
    if (!vault.queryService) {
      setBundleLine("");
      return;
    }
    scanVaultOkfVersion(vault)
      .then((state) => {
        if (!stale) setBundleLine(okfBundleStatusLines(state).map((l) => t(l.key, l.params)).join(" "));
      })
      .catch(() => {
        if (!stale) setBundleLine("");
      });
    return () => {
      stale = true;
    };
  }, [vault, t]);

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
    // The run and its two outcome messages live in services/indexMaintenance,
    // shared with the palette's command; the screen adds what only it shows.
    void rebuildVaultIndex(vault)
      .then(async (done) => {
        if (done) setStats(await loadStats());
      })
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

        {/* The order of the desktop (settings plan 2026-10-29, § 3.9): the
            state, then the index, then the OKF format — "What is OKF?" is the
            info of its group (move 17), it was a row in About before — and the
            import, which is the vault's contents too. Restoring deleted files
            moved to Backup & versioning, beside the version history (move 53). */}
        <SectionLabel info={{ text: t("settings.searchIndexInfo"), guide: "Search.md" }}>{t("settings.rebuildIndex")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row
              disabled={busy || !vault.indexer}
              icon={<RefreshCw size={ICON.ui} />}
              info={t("settings.rebuildIndexDesc")}
              onClick={rebuildIndex}
              subtitle={busy ? t("settings.rebuildIndexRunning") : t("settings.rebuildIndexHint")}
              title={t("settings.rebuildIndexAction")}
            />
          </RowList>
        </GroupCard>

        <SectionLabel
          info={{ text: [t("okfInfo.short1"), t("okfInfo.short2"), t("okfInfo.short3")].join("\n\n"), guide: "OKF.md" }}
        >
          {t("settings.groupOkfFormat")}
        </SectionLabel>
        <GroupCard>
          <RowList>
            <Row
              data-testid="open-okf"
              disabled={busy || !vault.queryService}
              end={<ChevronRight className="m-chevron" size={ICON.ui} />}
              icon={<FileCog size={ICON.ui} />}
              onClick={onConvertOkf}
              title={t("okf.wizardTitle")}
            />
            <Row
              data-testid="open-okf-migration"
              disabled={busy || !vault.queryService}
              end={<ChevronRight className="m-chevron" size={ICON.ui} />}
              icon={<FileUp size={ICON.ui} />}
              onClick={onMigrateOkf}
              subtitle={bundleLine}
              title={t("settings.okfBundleLabel")}
            />
            <Row
              data-testid="open-overviews"
              disabled={busy || !vault.queryService}
              end={<ChevronRight className="m-chevron" size={ICON.ui} />}
              icon={<ListTree size={ICON.ui} />}
              onClick={onOverviews}
              title={t("indexMd.overviewsTitle")}
            />
          </RowList>
        </GroupCard>

        <SectionLabel>{t("import.title")}</SectionLabel>
        <GroupCard>
          <RowList>
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
    </div>
  );
}
