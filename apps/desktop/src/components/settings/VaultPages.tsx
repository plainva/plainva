import React from "react";
import { useTranslation } from "react-i18next";
import { Folder } from "lucide-react";
import { Button, IconButton, SettingCard, SettingCardNote, SettingRow } from "@plainva/ui";
import { Select } from "../Select";
import { AreaHead } from "./AppPages";
import { PimAccountsSection } from "../pim/PimAccountsSection";
import { MailAccountsSection } from "../mail/MailAccountsSection";
import { DEFAULT_NOTE_TYPE, DEFAULT_DAILY_NOTE_TYPE } from "../../contexts/VaultContext";
import { DEFAULT_BACKUP_RETENTION } from "@plainva/core";
import { DEFAULT_ZIP_KEEP } from "../../services/backupPolicy";

/**
 * The remaining VAULT-world settings pages (redesign 2026-07-18, P2):
 * calendar & accounts (PIM), content & structure, backup & versioning,
 * maintenance. Layout only — state, persistence and the active-vault gating
 * semantics stay in SettingsModal and arrive as props.
 */

export const PimPage: React.FC<{ isActiveVault: boolean }> = ({ isActiveVault }) => {
  const { t } = useTranslation();
  return (
    <div>
      <AreaHead areaId="pim" />
      {isActiveVault ? (
        <>
          <SettingCard label={t("settings.groupCalendars", { defaultValue: "Kalender" })}>
            <SettingCardNote>
              <PimAccountsSection />
            </SettingCardNote>
          </SettingCard>
          <SettingCard label={t("mail.sectionTitle", { defaultValue: "E-Mail (IMAP, nur Lesen)" })}>
            <SettingCardNote>
              <MailAccountsSection />
            </SettingCardNote>
          </SettingCard>
        </>
      ) : (
        <SettingCard>
          <SettingCardNote>{t("pim.openVaultFirst", { defaultValue: "Nur für den geöffneten Vault verfügbar." })}</SettingCardNote>
        </SettingCard>
      )}
    </div>
  );
};

export interface ContentPageProps {
  isActiveVault: boolean;
  dailyNotesFolder: string;
  onDailyNotesFolder: (v: string) => void;
  onBrowseDailyFolder: () => void;
  dailyNotesFormat: string;
  onDailyNotesFormat: (v: string) => void;
  templateFolder: string;
  onTemplateFolder: (v: string) => void;
  onBrowseTemplateFolder: () => void;
  dailyNoteTemplate: string;
  onDailyNoteTemplate: (v: string) => void;
  templateFiles: string[];
  taskDatabase: string;
  onTaskDatabase: (v: string) => void;
  baseFiles: { path: string; title: string }[];
  onCreateTaskDb: () => void;
  canCreateTaskDb: boolean;
  defaultNoteType: string;
  onDefaultNoteType: (v: string) => void;
  dailyNoteType: string;
  onDailyNoteType: (v: string) => void;
  okfViolations: number | null;
  onShowOkfWizard: () => void;
  onShowOkfInfo: () => void;
  onShowIndexManager: () => void;
  onUpdateAllIndexes: () => void;
  extendedDatabases: boolean;
  onExtendedDatabases: (v: boolean) => void;
}

export const ContentPage: React.FC<ContentPageProps> = (p) => {
  const { t } = useTranslation();
  return (
    <div>
      <AreaHead areaId="content" />

      <SettingCard label={t("settings.groupDailyNotes", { defaultValue: "Tagesnotizen" })}>
        <SettingRow label={t("settings.dailyNotesFolder")}>
          <div style={{ display: "flex", gap: "0.4rem", width: "100%", alignItems: "center" }}>
            <input autoComplete="off" value={p.dailyNotesFolder} onChange={(e) => p.onDailyNotesFolder(e.target.value)} placeholder="Tagebuch/" className="pv-field" style={{ flex: 1, minWidth: 0 }} />
            <IconButton
              label={t("settings.browseFolders")}
              data-testid="browse-daily-folder"
              disabled={!p.isActiveVault}
              onClick={p.onBrowseDailyFolder}
            >
              <Folder size={14} />
            </IconButton>
          </div>
        </SettingRow>
        <SettingRow label={t("settings.dailyNotesFormat")} desc={t("settings.dailyNotesFormatDesc")}>
          <input autoComplete="off" value={p.dailyNotesFormat} onChange={(e) => p.onDailyNotesFormat(e.target.value.replace(/[./\\]/g, "-"))} placeholder="YYYY-MM-DD" className="pv-field" style={{ width: "100%" }} />
        </SettingRow>
        <SettingRow label={t("settings.dailyNotesTemplate")}>
          {p.templateFiles.length > 0 ? (
            <Select
              ariaLabel={t("settings.dailyNotesTemplate")}
              value={p.templateFiles.includes(p.dailyNoteTemplate) ? p.dailyNoteTemplate : ""}
              onChange={p.onDailyNoteTemplate}
              options={[{ value: "", label: "—" }, ...p.templateFiles.map((f) => ({ value: f, label: f }))]}
            />
          ) : (
            <input autoComplete="off" value={p.dailyNoteTemplate} onChange={(e) => p.onDailyNoteTemplate(e.target.value)} placeholder="DailyTemplate.md" className="pv-field" style={{ width: "100%" }} />
          )}
        </SettingRow>
      </SettingCard>

      <SettingCard label={t("settings.groupTemplatesTasks", { defaultValue: "Vorlagen & Aufgaben" })}>
        <SettingRow label={t("settings.templateFolder")}>
          <div style={{ display: "flex", gap: "0.4rem", width: "100%", alignItems: "center" }}>
            <input autoComplete="off" value={p.templateFolder} onChange={(e) => p.onTemplateFolder(e.target.value)} placeholder="Templates/" className="pv-field" style={{ flex: 1, minWidth: 0 }} />
            <IconButton
              label={t("settings.browseFolders")}
              data-testid="browse-template-folder"
              disabled={!p.isActiveVault}
              onClick={p.onBrowseTemplateFolder}
            >
              <Folder size={14} />
            </IconButton>
          </div>
        </SettingRow>
        <SettingRow label={t("settings.taskDatabase")} desc={t("settings.taskDatabaseDesc")} wide>
          <div style={{ display: "flex", gap: "0.4rem", width: "100%", alignItems: "center" }}>
            {p.baseFiles.length > 0 ? (
              <div style={{ flex: 1, minWidth: 0 }}>
                <Select
                  ariaLabel={t("settings.taskDatabase")}
                  value={p.baseFiles.some((b) => b.path === p.taskDatabase) ? p.taskDatabase : ""}
                  onChange={p.onTaskDatabase}
                  options={[{ value: "", label: "—" }, ...p.baseFiles.map((b) => ({ value: b.path, label: b.title }))]}
                />
              </div>
            ) : (
              <input autoComplete="off" value={p.taskDatabase} onChange={(e) => p.onTaskDatabase(e.target.value)} placeholder="Tasks.base" className="pv-field" style={{ flex: 1, minWidth: 0 }} />
            )}
            <button
              onClick={p.onCreateTaskDb}
              disabled={!p.canCreateTaskDb}
              data-testid="create-task-db"
              className="pv-btn pv-btn--secondary"
              style={{ whiteSpace: "nowrap" }}
            >
              {t("settings.taskDatabaseCreate")}
            </button>
          </div>
        </SettingRow>
      </SettingCard>

      <SettingCard label={t("settings.groupOkfStructure", { defaultValue: "OKF & Struktur" })}>
        <SettingRow label={t("settings.defaultNoteType")} desc={t("settings.defaultNoteTypeDesc")}>
          <input autoComplete="off" value={p.defaultNoteType} onChange={(e) => p.onDefaultNoteType(e.target.value)} placeholder={DEFAULT_NOTE_TYPE} className="pv-field" style={{ width: "100%" }} />
        </SettingRow>
        <SettingRow label={t("settings.dailyNoteType")} desc={t("settings.dailyNoteTypeDesc")}>
          <input autoComplete="off" value={p.dailyNoteType} onChange={(e) => p.onDailyNoteType(e.target.value)} placeholder={DEFAULT_DAILY_NOTE_TYPE} className="pv-field" style={{ width: "100%" }} />
        </SettingRow>
        {p.isActiveVault && (
          <>
            {p.okfViolations !== null && p.okfViolations > 0 && (
              <SettingRow
                label={t("settings.okfConversionLabel")}
                desc={t("settings.okfConversionDesc", { count: p.okfViolations })}
              >
                <button onClick={p.onShowOkfWizard} className="pv-btn pv-btn--primary">
                  {t("settings.okfConversionButton")}
                </button>
              </SettingRow>
            )}
            <SettingRow label={t("okfInfo.settingsButton")} desc={t("okfInfo.settingsDesc")}>
              <button onClick={p.onShowOkfInfo} className="pv-btn pv-btn--secondary">
                {t("okfInfo.settingsButton")}
              </button>
            </SettingRow>
            <SettingRow label={t("settings.okfIndexLabel")} desc={t("settings.okfIndexDesc")}>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button onClick={p.onShowIndexManager} className="pv-btn pv-btn--secondary">
                  {t("settings.okfIndexButton")}
                </button>
                <button onClick={p.onUpdateAllIndexes} className="pv-btn pv-btn--secondary">
                  {t("indexMd.updateAllAction")}
                </button>
              </div>
            </SettingRow>
          </>
        )}
        <SettingRow label={t("settings.allowExtendedDb")} desc={t("settings.allowExtendedDbDesc")}>
          <input type="checkbox" id="extDb" checked={p.extendedDatabases} onChange={(e) => p.onExtendedDatabases(e.target.checked)} />
        </SettingRow>
      </SettingCard>
    </div>
  );
};

export interface BackupPageProps {
  isActiveVault: boolean;
  zipEnabled: boolean;
  onZipEnabled: (v: boolean) => void;
  zipDest: string;
  zipDefaultDest: string;
  onChooseZipDest: () => void;
  onResetZipDest: () => void;
  onOpenZipDest: () => void;
  zipKeep: string;
  onZipKeep: (raw: string) => void;
  zipStatusDesc: string;
  zipRunning: boolean;
  onBackupNow: () => void;
  snapshotIntervalSec: string;
  onSnapshotInterval: (v: string) => void;
  versionMaxCount: string;
  onVersionMaxCount: (raw: string) => void;
  versionMaxAgeDays: string;
  onVersionMaxAge: (v: string) => void;
}

export const BackupPage: React.FC<BackupPageProps> = (p) => {
  const { t } = useTranslation();
  return (
    <div>
      <AreaHead areaId="backup" />

      <SettingCard label={t("settings.groupZipBackups", { defaultValue: "ZIP-Backups" })}>
        <SettingRow label={t("settings.backupZipEnabled")} desc={t("settings.backupZipEnabledDesc")}>
          <input
            type="checkbox"
            data-testid="backup-zip-enabled"
            checked={p.zipEnabled}
            onChange={(e) => p.onZipEnabled(e.target.checked)}
          />
        </SettingRow>
        <SettingRow label={t("settings.backupZipDest")} desc={p.zipDest || p.zipDefaultDest || undefined}>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button onClick={p.onChooseZipDest} className="pv-btn pv-btn--secondary">
              {t("settings.backupZipChoose")}
            </button>
            {p.zipDest && (
              <button onClick={p.onResetZipDest} className="pv-btn pv-btn--secondary">
                {t("settings.backupZipDefault")}
              </button>
            )}
            <button onClick={p.onOpenZipDest} className="pv-btn pv-btn--secondary">
              {t("settings.backupZipOpen")}
            </button>
          </div>
        </SettingRow>
        <SettingRow label={t("settings.backupZipKeep")} desc={t("settings.backupZipKeepDesc")}>
          <input
            type="number"
            min={1}
            max={50}
            value={p.zipKeep}
            onChange={(e) => p.onZipKeep(e.target.value)}
            className="pv-field" style={{ width: "90px" }}
          />
        </SettingRow>
        {p.isActiveVault && (
          <SettingRow label={t("settings.backupNow")} desc={p.zipStatusDesc}>
            <button
              data-testid="backup-now"
              disabled={p.zipRunning}
              onClick={p.onBackupNow}
              className="pv-btn pv-btn--primary" style={{ opacity: p.zipRunning ? 0.6 : 1 }}
            >
              {t("settings.backupNowButton")}
            </button>
          </SettingRow>
        )}
      </SettingCard>

      <SettingCard label={t("versions.title")}>
        <SettingRow label={t("settings.versionInterval")} desc={t("settings.versionIntervalDesc")}>
          <Select
            ariaLabel={t("settings.versionInterval")}
            value={p.snapshotIntervalSec}
            minWidth={180}
            align="right"
            options={[
              { value: "0", label: t("settings.versionIntervalEvery") },
              { value: "30", label: "30 s" },
              { value: "120", label: "2 min" },
              { value: "300", label: "5 min" },
              { value: "600", label: "10 min" },
            ]}
            onChange={p.onSnapshotInterval}
          />
        </SettingRow>
        <SettingRow label={t("settings.versionMaxCount")} desc={t("settings.versionMaxCountDesc")}>
          <input
            type="number"
            min={5}
            max={1000}
            value={p.versionMaxCount}
            onChange={(e) => p.onVersionMaxCount(e.target.value)}
            className="pv-field" style={{ width: "90px" }}
          />
        </SettingRow>
        <SettingRow label={t("settings.versionMaxAge")} desc={t("settings.versionMaxAgeDesc")}>
          <Select
            ariaLabel={t("settings.versionMaxAge")}
            value={p.versionMaxAgeDays}
            minWidth={180}
            align="right"
            options={[
              { value: "30", label: t("settings.versionAgeDays", { days: 30 }) },
              { value: "90", label: t("settings.versionAgeDays", { days: 90 }) },
              { value: "180", label: t("settings.versionAgeDays", { days: 180 }) },
              { value: "365", label: t("settings.versionAgeDays", { days: 365 }) },
              { value: "0", label: t("settings.versionAgeUnlimited") },
            ]}
            onChange={p.onVersionMaxAge}
          />
        </SettingRow>
      </SettingCard>
    </div>
  );
};

export interface MaintenancePageProps {
  isActiveVault: boolean;
  reindexRunning: boolean;
  onReindex: () => void;
  onShowDeletedFiles: () => void;
  vaultStats: { notes: number; attachments: number } | null;
}

export const MaintenancePage: React.FC<MaintenancePageProps> = (p) => {
  const { t } = useTranslation();
  return (
    <div>
      <AreaHead areaId="maintenance" />
      {p.isActiveVault ? (
        <>
          <SettingCard label={t("settings.rebuildIndex", { defaultValue: "Suchindex" })}>
            <SettingRow
              label={t("settings.rebuildIndex", { defaultValue: "Suchindex" })}
              desc={t("settings.rebuildIndexDesc", { defaultValue: "Baut den Suchindex dieses Vaults komplett neu auf — hilft, wenn Suche, Backlinks oder Datenbanken veraltet wirken." })}
            >
              <Button variant="secondary" size="sm" disabled={p.reindexRunning} onClick={p.onReindex}>
                {p.reindexRunning ? t("settings.rebuildIndexRunning", { defaultValue: "Läuft…" }) : t("settings.rebuildIndexAction", { defaultValue: "Index neu aufbauen" })}
              </Button>
            </SettingRow>
          </SettingCard>
          <SettingCard label={t("settings.sectionVault", { defaultValue: "Vault" })}>
            <SettingRow label={t("versions.deletedTitle")} desc={t("settings.deletedFilesDesc")}>
              <button
                data-testid="settings-deleted-files"
                onClick={p.onShowDeletedFiles}
                className="pv-btn pv-btn--secondary"
              >
                {t("settings.deletedFilesButton")}
              </button>
            </SettingRow>
            {p.vaultStats && (
              <SettingRow
                label={t("settings.vaultStats", { defaultValue: "Vault-Statistik" })}
                desc={t("settings.vaultStatsValue", { defaultValue: "Notizen: {{notes}} · Anhänge: {{attachments}}", notes: p.vaultStats.notes, attachments: p.vaultStats.attachments })}
              />
            )}
          </SettingCard>
        </>
      ) : (
        <SettingCard>
          <SettingCardNote>{t("settings.vaultNotOpenHint")}</SettingCardNote>
        </SettingCard>
      )}
    </div>
  );
};

/** Keeps the number/keep parsing identical to the previous inline handlers. */
export const clampZipKeep = (raw: string) => Math.min(50, Math.max(1, parseInt(raw, 10) || DEFAULT_ZIP_KEEP));
export const clampVersionMaxCount = (raw: string) => Math.min(1000, Math.max(5, parseInt(raw, 10) || DEFAULT_BACKUP_RETENTION.maxBackupsPerFile));
