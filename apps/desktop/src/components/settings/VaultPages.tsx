import React from "react";
import { useTranslation } from "react-i18next";
import { Folder, X } from "lucide-react";
import { Button, ICON, IconButton, SettingCard, SettingCardNote, SettingRow, okfBundleStatusLines } from "@plainva/ui";
import { Select } from "../Select";
import { AreaHead } from "./AppPages";
import { ReminderSettings } from "../pim/ReminderSettings";
import { PimAccountsSection } from "../pim/PimAccountsSection";
import { MailAccountsSection } from "../mail/MailAccountsSection";
import { DEFAULT_NOTE_TYPE, DEFAULT_DAILY_NOTE_TYPE } from "../../contexts/VaultContext";
import { DEFAULT_BACKUP_RETENTION, type OkfVersionState } from "@plainva/core";
import type { FolderTemplateRule, TypeTemplateRule } from "@plainva/ui";
import { DEFAULT_ZIP_KEEP } from "../../services/backupPolicy";

/**
 * The remaining VAULT-world settings pages (redesign 2026-07-18, P2):
 * calendar & accounts (PIM), content & structure, backup & versioning,
 * maintenance. Layout only — state, persistence and the active-vault gating
 * semantics stay in SettingsModal and arrive as props.
 */

export const PimPage: React.FC<{ isActiveVault: boolean; onOpenCloudAccounts: () => void }> = ({ isActiveVault, onOpenCloudAccounts }) => {
  const { t } = useTranslation();
  return (
    <div>
      <AreaHead areaId="pim" />
      {isActiveVault ? (
        <>
          <SettingCard label={t("settings.groupCalendars", { defaultValue: "Kalender" })}>
            <SettingCardNote>
              <PimAccountsSection onOpenCloudAccounts={onOpenCloudAccounts} />
            </SettingCardNote>
          </SettingCard>
          <ReminderSettings />
        </>
      ) : (
        <SettingCard>
          <SettingCardNote>{t("pim.openVaultFirst", { defaultValue: "Nur für den geöffneten Vault verfügbar." })}</SettingCardNote>
        </SettingCard>
      )}
    </div>
  );
};

/** Email service page (cloud-accounts split): mailbox references + capture
 * behavior; connecting/removing mailboxes lives in the Cloud-Konten area. */
export const MailPage: React.FC<{ isActiveVault: boolean; onOpenCloudAccounts: () => void }> = ({ isActiveVault, onOpenCloudAccounts }) => {
  const { t } = useTranslation();
  return (
    <div>
      <AreaHead areaId="mail" />
      {isActiveVault ? (
        <MailAccountsSection onOpenCloudAccounts={onOpenCloudAccounts} />
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
  /** Folder → template rules (plan Vorlagen-Engine P4). */
  folderTemplates: FolderTemplateRule[];
  onFolderTemplates: (rules: FolderTemplateRule[]) => void;
  /** Template file names offered in the rule rows. */
  templateChoices: string[];
  onBrowseRuleFolder: (index: number) => void;
  /** OKF type → template rules (plan Vorlagen-Engine P4b). */
  typeTemplates: TypeTemplateRule[];
  onTypeTemplates: (rules: TypeTemplateRule[]) => void;
  onTemplateFolder: (v: string) => void;
  onBrowseTemplateFolder: () => void;
  inboxFolder: string;
  onInboxFolder: (v: string) => void;
  onBrowseInboxFolder: () => void;
  attachmentFolder: string;
  onAttachmentFolder: (v: string) => void;
  onBrowseAttachmentFolder: () => void;
  textFileExtensions: string;
  onTextFileExtensions: (v: string) => void;
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
  /** Bundle version (OKF v0.2 plan, P2): null until the scan ran. */
  okfVersionState: OkfVersionState | null;
  onShowOkfMigration: () => void;
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

      {/* Order (maintainer, 2026-07-27): the template folder comes first — it is
          the precondition for the template picker further down, not an appendix
          to the tasks. Then everything about daily notes, including their
          template. The task database gets its own card: "templates & tasks" was
          one heading over two unrelated things. */}
      <SettingCard label={t("settings.groupTemplates", { defaultValue: "Vorlagen" })}>
        <SettingRow label={t("settings.templateFolder")} desc={t("settings.templateFolderDesc")}>
          <div style={{ display: "flex", gap: "0.4rem", width: "100%", alignItems: "center" }}>
            <input autoComplete="off" value={p.templateFolder} onChange={(e) => p.onTemplateFolder(e.target.value)} placeholder="Templates/" className="pv-field" style={{ flex: 1, minWidth: 0 }} />
            <IconButton
              label={t("settings.browseFolders")}
              data-testid="browse-template-folder"
              disabled={!p.isActiveVault}
              onClick={p.onBrowseTemplateFolder}
            >
              <Folder size={ICON.ui} />
            </IconButton>
          </div>
        </SettingRow>

        {/* Folder rules (plan Vorlagen-Engine P4). A rule row is stored as soon
            as it is added, even half-filled — that way a mapping can be clicked
            together in peace instead of having to be right in one go; an
            unfinished rule simply never matches. */}
        <SettingRow
          label={t("settings.folderTemplates", { defaultValue: "Vorlagen je Ordner" })}
          desc={t("settings.folderTemplatesDesc", { defaultValue: "Neue Notizen in diesem Ordner starten aus der zugeordneten Vorlage." })}
          wide
        >
          <div className="pv-rulelist" data-testid="folder-template-rules">
            {p.folderTemplates.map((rule, index) => (
              <div className="pv-rule" key={index}>
                <input
                  autoComplete="off"
                  className="pv-field pv-rule-from"
                  value={rule.folder}
                  placeholder={t("settings.ruleFolderPlaceholder", { defaultValue: "Ordner …" })}
                  aria-label={t("settings.folderTemplates", { defaultValue: "Vorlagen je Ordner" })}
                  onChange={(e) =>
                    p.onFolderTemplates(p.folderTemplates.map((r, i) => (i === index ? { ...r, folder: e.target.value } : r)))
                  }
                />
                <IconButton
                  label={t("settings.browseFolders")}
                  disabled={!p.isActiveVault}
                  onClick={() => p.onBrowseRuleFolder(index)}
                >
                  <Folder size={ICON.ui} />
                </IconButton>
                <span className="pv-rule-arrow" aria-hidden>→</span>
                <div className="pv-rule-to">
                  <Select
                    ariaLabel={t("settings.ruleTemplate", { defaultValue: "Vorlage" })}
                    value={rule.template}
                    options={[
                      { value: "", label: t("settings.ruleTemplatePlaceholder", { defaultValue: "Vorlage wählen …" }) },
                      // A template that has since been renamed stays listed, so
                      // opening the settings never silently drops a rule.
                      ...(rule.template && !p.templateChoices.includes(rule.template) ? [{ value: rule.template, label: rule.template }] : []),
                      ...p.templateChoices.map((name) => ({ value: name, label: name })),
                    ]}
                    onChange={(next) =>
                      p.onFolderTemplates(p.folderTemplates.map((r, i) => (i === index ? { ...r, template: next } : r)))
                    }
                  />
                </div>
                <IconButton
                  label={t("settings.ruleRemove", { defaultValue: "Zuordnung entfernen" })}
                  onClick={() => p.onFolderTemplates(p.folderTemplates.filter((_, i) => i !== index))}
                >
                  <X size={ICON.ui} />
                </IconButton>
              </div>
            ))}
            <Button
              variant="ghost"
              data-testid="add-folder-template"
              onClick={() => p.onFolderTemplates([...p.folderTemplates, { folder: "", template: "" }])}
            >
              {t("settings.addFolderTemplate", { defaultValue: "＋ Ordner-Vorlage" })}
            </Button>
          </div>
        </SettingRow>

        {/* Type rules (P4b). Same card, second list — folder and type are the
            same question from two directions ("where does the note live" /
            "what is it"), and two cards would suggest two features with no
            natural place for the precedence rule. */}
        <SettingRow
          label={t("settings.typeTemplates", { defaultValue: "Vorlagen je Notiztyp" })}
          desc={t("settings.typeTemplatesDesc", { defaultValue: "Greift, wenn für den Ordner nichts hinterlegt ist." })}
          wide
        >
          <div className="pv-rulelist" data-testid="type-template-rules">
            {p.typeTemplates.map((rule, index) => (
              <div className="pv-rule" key={index}>
                <input
                  autoComplete="off"
                  className="pv-field pv-rule-from"
                  value={rule.type}
                  placeholder={DEFAULT_NOTE_TYPE}
                  aria-label={t("settings.typeTemplates", { defaultValue: "Vorlagen je Notiztyp" })}
                  onChange={(e) =>
                    p.onTypeTemplates(p.typeTemplates.map((r, i) => (i === index ? { ...r, type: e.target.value } : r)))
                  }
                />
                <span className="pv-rule-arrow" aria-hidden>→</span>
                <div className="pv-rule-to">
                  <Select
                    ariaLabel={t("settings.ruleTemplate", { defaultValue: "Vorlage" })}
                    value={rule.template}
                    options={[
                      { value: "", label: t("settings.ruleTemplatePlaceholder", { defaultValue: "Vorlage wählen …" }) },
                      ...(rule.template && !p.templateChoices.includes(rule.template) ? [{ value: rule.template, label: rule.template }] : []),
                      ...p.templateChoices.map((name) => ({ value: name, label: name })),
                    ]}
                    onChange={(next) =>
                      p.onTypeTemplates(p.typeTemplates.map((r, i) => (i === index ? { ...r, template: next } : r)))
                    }
                  />
                </div>
                <IconButton
                  label={t("settings.ruleRemove", { defaultValue: "Zuordnung entfernen" })}
                  onClick={() => p.onTypeTemplates(p.typeTemplates.filter((_, i) => i !== index))}
                >
                  <X size={ICON.ui} />
                </IconButton>
              </div>
            ))}
            <Button
              variant="ghost"
              data-testid="add-type-template"
              onClick={() => p.onTypeTemplates([...p.typeTemplates, { type: "", template: "" }])}
            >
              {t("settings.addTypeTemplate", { defaultValue: "＋ Typ-Vorlage" })}
            </Button>
          </div>
        </SettingRow>

        <SettingCardNote>
          {t("settings.templateRuleHint", {
            defaultValue:
              "Ordner-Vorlagen gelten auch für Unterordner; bei mehreren Treffern gewinnt der längste passende Pfad. Ordner schlägt Typ. Eine ausdrücklich gewählte Vorlage schlägt beide.",
          })}
        </SettingCardNote>

        {/* Target of the phone's ＋ quick capture and of text shared from
            another app. The desktop has no such single capture button — every
            note it creates goes where the user pointed — so this setting is
            written here and READ on the phone. It lives here because it is a
            property of the VAULT, and a vault is usually set up on the
            desktop; hiding it would mean the folder can only ever be chosen on
            the device that has the smaller screen. */}
        <SettingRow label={t("settings.inboxFolder")} desc={t("settings.inboxFolderDesc")}>
          <div style={{ display: "flex", gap: "0.4rem", width: "100%", alignItems: "center" }}>
            <input autoComplete="off" value={p.inboxFolder} onChange={(e) => p.onInboxFolder(e.target.value)} placeholder="Inbox/" className="pv-field" style={{ flex: 1, minWidth: 0 }} data-testid="inbox-folder" />
            <IconButton
              label={t("settings.browseFolders")}
              data-testid="browse-inbox-folder"
              disabled={!p.isActiveVault}
              onClick={p.onBrowseInboxFolder}
            >
              <Folder size={ICON.ui} />
            </IconButton>
          </div>
        </SettingRow>
        {/* Where a dropped, pasted or photographed file lands (S17). Empty
            keeps the old behaviour — beside the note — which is why it is a
            placeholder rather than a forced value. */}
        <SettingRow label={t("settings.attachmentFolder")} desc={t("settings.attachmentFolderDesc")}>
          <div style={{ display: "flex", gap: "0.4rem", width: "100%", alignItems: "center" }}>
            <input autoComplete="off" value={p.attachmentFolder} onChange={(e) => p.onAttachmentFolder(e.target.value)} placeholder="Attachments/" className="pv-field" style={{ flex: 1, minWidth: 0 }} data-testid="attachment-folder" />
            <IconButton
              label={t("settings.browseFolders")}
              data-testid="browse-attachment-folder"
              disabled={!p.isActiveVault}
              onClick={p.onBrowseAttachmentFolder}
            >
              <Folder size={ICON.ui} />
            </IconButton>
          </div>
        </SettingRow>
        {/* C15: which extra file types open in Plainva rather than going to the
            system. It can only ADD — the built-in list stays whatever this
            says, so a typo here can never turn a note into an OS handoff. */}
        <SettingRow label={t("settings.textFileExtensions")} desc={t("settings.textFileExtensionsDesc")}>
          <input
            autoComplete="off"
            value={p.textFileExtensions}
            onChange={(e) => p.onTextFileExtensions(e.target.value)}
            placeholder="fountain, adoc"
            className="pv-field"
            style={{ width: "100%" }}
            data-testid="text-file-extensions"
          />
        </SettingRow>
      </SettingCard>

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
              <Folder size={ICON.ui} />
            </IconButton>
          </div>
        </SettingRow>
        <SettingRow label={t("settings.dailyNotesFormat")} desc={t("settings.dailyNotesFormatDesc")}>
          <input autoComplete="off" value={p.dailyNotesFormat} onChange={(e) => p.onDailyNotesFormat(e.target.value.replace(/[./\\]/g, "-"))} placeholder="YYYY-MM-DD" className="pv-field" style={{ width: "100%" }} />
        </SettingRow>
        <SettingRow label={t("settings.dailyNotesTemplate")} desc={t("settings.dailyNotesTemplateDesc")}>
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

      <SettingCard label={t("settings.groupTasks", { defaultValue: "Aufgaben" })}>
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
            {/* What the root index.md declares, and whether notes still carry
                the legacy per-note key. The button names the next step: lift
                the root while it is behind, otherwise only clean up. */}
            {p.okfVersionState && (
              <SettingRow
                label={t("settings.okfBundleLabel")}
                desc={okfBundleStatusLines(p.okfVersionState).map((l) => t(l.key, l.params)).join(" ")}
              >
                {p.okfVersionState.rootIndex.exists &&
                p.okfVersionState.rootIndex.declared !== null &&
                !p.okfVersionState.rootIndex.current ? (
                  <button onClick={p.onShowOkfMigration} className="pv-btn pv-btn--primary" data-testid="okf-bundle-upgrade">
                    {t("settings.okfBundleButton")}
                  </button>
                ) : p.okfVersionState.notesWithVersion.length > 0 ? (
                  <button onClick={p.onShowOkfMigration} className="pv-btn pv-btn--secondary" data-testid="okf-bundle-clean">
                    {t("settings.okfBundleCleanButton")}
                  </button>
                ) : null}
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
  /** Fast reconcile against the disk (and the cloud on a synced vault) — P1. */
  onRefresh: () => void;
  /** Throw the index away and parse every file again — the slow one. */
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
          {/* Two actions where there used to be one mislabelled button: the
              old "Index neu aufbauen" ran the cheap reconcile, so the expensive
              rebuild had no entry point at all (plan P1b). */}
          <SettingCard label={t("settings.rebuildIndex", { defaultValue: "Suchindex" })}>
            <SettingRow
              label={t("refresh.action", { defaultValue: "Vault neu einlesen" })}
              desc={t("refresh.actionDesc", { defaultValue: "Gleicht den Index mit dem Ordner ab und holt bei Online-Vaults die Cloud-Dateien. Schnell und verlustfrei — dasselbe wie F5." })}
            >
              <Button variant="secondary" size="sm" disabled={p.reindexRunning} onClick={p.onRefresh}>
                {t("refresh.action", { defaultValue: "Vault neu einlesen" })}
              </Button>
            </SettingRow>
            <SettingRow
              label={t("refresh.rebuildAction", { defaultValue: "Index vollständig neu aufbauen" })}
              desc={t("settings.rebuildIndexDesc", { defaultValue: "Baut den Suchindex dieses Vaults komplett neu auf — hilft, wenn Suche, Backlinks oder Datenbanken veraltet wirken." })}
            >
              <Button variant="secondary" size="sm" disabled={p.reindexRunning} onClick={p.onReindex}>
                {p.reindexRunning ? t("settings.rebuildIndexRunning", { defaultValue: "Läuft…" }) : t("refresh.rebuildAction", { defaultValue: "Index vollständig neu aufbauen" })}
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
