import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, ChevronRight, Layers, Play } from "lucide-react";
import { Banner, Button, GroupCard, ICON, InfoTip, Row, RowList, SectionLabel, Switch } from "@plainva/ui";
import { mSelect } from "../services/mobileDialogs";
import { applyVaultSettings } from "../services/mobileSettings";
import { backupFolderFor, backupState, backupVaultNow, dismissUnreadableBackups, listBackups } from "../services/vaultBackup";
import type { BackupListing } from "../services/backupListing";
import { getVaultEntry } from "../services/vaultRegistry";
import type { MobileVault } from "../services/vaultService";

/**
 * The scheduled ZIP archive (S36), in Backup & versioning since the settings
 * plan of 2026-10-29 (move 21) — where the desktop keeps it. It stood in the
 * sync screen's "Contents" before, beside the vault's name and its deletion.
 *
 * The desktop has had a daily ZIP with retention since its backup package; the
 * phone had only the on-demand export — so a vault nobody thought to export by
 * hand had no archive at all. The destination is fixed on the phone.
 */
export function ZipBackupGroup({ vault }: { vault: MobileVault }) {
  const { t } = useTranslation();
  const vaultId = vault.vaultId;
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [archives, setArchives] = useState<BackupListing | null>(null);
  const [zipOn, setZipOn] = useState(() => backupState(vaultId).enabled);
  const [zipKeep, setZipKeep] = useState(() => backupState(vaultId).keep);
  const [zipLast, setZipLast] = useState(() => backupState(vaultId).lastRun);

  useEffect(() => {
    void getVaultEntry(vaultId).then((entry) => setName(entry?.name ?? ""));
  }, [vaultId]);

  useEffect(() => {
    let alive = true;
    void listBackups(name, zipLast).then((list) => {
      if (alive) setArchives(list);
    });
    return () => {
      alive = false;
    };
  }, [name, busy, zipLast]);

  return (
    <>
      <SectionLabel>{t("settings.groupZipBackups")}</SectionLabel>
      <GroupCard>
        <RowList>
          <Row
            /* The title breaks rather than clips: the value beside it is a
               switch, which carries no meaning, and what got cut was "(ZIP)" —
               the part that says what kind of backup this is. */
            wrap
            end={
              <Switch
                label={t("settings.backupZipEnabled")}
                checked={zipOn}
                onChange={(on) => {
                  setZipOn(on);
                  void applyVaultSettings(vaultId, { backupZipEnabled: on });
                }}
              />
            }
            icon={<Archive size={ICON.ui} />}
            info={t("settings.backupZipEnabledDesc")}
            /* Whether the schedule has ever run — the only way an archive that
               silently never happens becomes visible. */
            subtitle={
              !zipOn
                ? t("mobile.backupZipOff")
                : zipLast
                  ? t("mobile.backupZipOn", {
                      count: archives?.archives.length ?? 0,
                      when: new Date(zipLast).toLocaleDateString(),
                    })
                  : t("mobile.backupZipNever")
            }
            title={t("settings.backupZipEnabled")}
          />
          {/* Both rows exist ONLY while the switch is on (E2) — that is what
              carries their dependency, not an indent. */}
          {zipOn && (
            <Row
              end={<><span className="m-prop-val">{String(zipKeep)}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
              icon={<Layers size={ICON.ui} />}
              onClick={() => {
                void mSelect({
                  title: t("settings.backupZipKeep"),
                  options: [3, 7, 14, 30].map((n) => ({ value: String(n), label: String(n) })),
                  value: String(zipKeep),
                }).then(async (picked) => {
                  if (picked === null) return;
                  const keep = Math.max(1, Number(picked));
                  setZipKeep(keep);
                  await applyVaultSettings(vaultId, { backupZipKeep: keep });
                });
              }}
              subtitle={t("settings.backupZipKeepDesc")}
              title={t("settings.backupZipKeep")}
            />
          )}
          {zipOn && (
            <Row
              disabled={busy}
              icon={<Play size={ICON.ui} />}
              onClick={() => {
                setBusy(true);
                // The run and its answer are shared with the palette's
                // command (services/vaultBackup).
                void backupVaultNow(vault, name)
                  // The sub-line reports the last run; leaving it stale right
                  // after a manual one would be the one moment it is wrong.
                  .then(() => setZipLast(backupState(vaultId).lastRun))
                  .finally(() => setBusy(false));
              }}
              title={t("settings.backupNowButton")}
            />
          )}
        </RowList>
        {/* C25: after a reinstall on Android the folder still holds the old
            archives, but this installation cannot see them — the count above
            would read "0" and the pruning would never touch them. */}
        {archives?.unreadable && (
          <Banner
            kind="warning"
            rounded
            actions={
              <Button
                variant="ghost"
                data-testid="vault-backups-unreadable-dismiss"
                onClick={() => {
                  dismissUnreadableBackups(name);
                  setArchives((current) => (current ? { ...current, unreadable: false } : current));
                }}
              >
                {t("common.dismiss")}
              </Button>
            }
          >
            <strong>{t("mobile.backupUnreadableTitle")}</strong>
            <InfoTip label={t("mobile.backupUnreadableTitle")} info={t("mobile.backupUnreadableBody")} />
            <p className="m-hint" data-testid="vault-backups-unreadable">
              {t("mobile.backupUnreadableShort", { folder: backupFolderFor(name) })}
            </p>
          </Banner>
        )}
      </GroupCard>
    </>
  );
}
