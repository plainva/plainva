import React from "react";
import { useTranslation } from "react-i18next";
import { Folder, X } from "lucide-react";
import { Button, CommittedTextInput, DAY_END_CHOICES, ICON, IconButton, SettingCard, SettingCardNote, SettingRow, boundaryLabel, clampBoundary, okfBundleStatusLines, sanitizeDailyNoteFormat, travelsWithVault, type CloudServiceId } from "@plainva/ui";
import { Select } from "../Select";
import { AreaHead } from "./AppPages";
import { ReminderSettings } from "../pim/ReminderSettings";
import { CommentNotificationRows } from "../comments/CommentNotificationSettings";
import { PimAccountsSection } from "../pim/PimAccountsSection";
import { MailAccountsSection } from "../mail/MailAccountsSection";
import { DEFAULT_NOTE_TYPE, DEFAULT_DAILY_NOTE_TYPE } from "../../contexts/VaultContext";
import { DEFAULT_BACKUP_RETENTION, DEFAULT_JOURNAL_HEADING, type OkfVersionState } from "@plainva/core";
import type { FolderTemplateRule, TypeTemplateRule } from "@plainva/ui";
import { DEFAULT_ZIP_KEEP } from "../../services/backupPolicy";

/**
 * The remaining VAULT-world settings pages (redesign 2026-07-18, P2):
 * calendar & accounts (PIM), content & structure, backup & versioning,
 * maintenance. Layout only — state, persistence and the active-vault gating
 * semantics stay in SettingsModal and arrive as props.
 */

export const PimPage: React.FC<{ isActiveVault: boolean; onOpenCloudAccounts: (accountRef?: string, service?: CloudServiceId) => void }> = ({ isActiveVault, onOpenCloudAccounts }) => {
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
export const MailPage: React.FC<{ isActiveVault: boolean; onOpenCloudAccounts: (accountRef?: string, service?: CloudServiceId) => void }> = ({ isActiveVault, onOpenCloudAccounts }) => {
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

/** A vault setting that the settings profile does not carry stays on this device (E14). */
const deviceOnly = (field?: string) => !travelsWithVault(field, "desktop");

/** A vault-path field with the folder browser beside it. */
const FolderInput: React.FC<{
  value: string;
  onSave: (v: string) => void;
  placeholder: string;
  disabled: boolean;
  onBrowse: () => void;
  inputTestId?: string;
  browseTestId?: string;
}> = ({ value, onSave, placeholder, disabled, onBrowse, inputTestId, browseTestId }) => {
  const { t } = useTranslation();
  return (
    <div style={{ display: "flex", gap: "0.4rem", width: "100%", alignItems: "center" }}>
      <CommittedTextInput autoComplete="off" value={value} onSave={onSave} placeholder={placeholder} style={{ flex: 1, minWidth: 0 }} data-testid={inputTestId} />
      <IconButton label={t("settings.browseFolders")} data-testid={browseTestId} disabled={disabled} onClick={onBrowse}>
        <Folder size={ICON.ui} />
      </IconButton>
    </div>
  );
};

/**
 * "Notes & filing" (settings plan 2026-10-29, E9): the half of the former
 * "Content & structure" page about where notes go and what they start as —
 * folders, templates, new notes, databases, annotations. The daily-note and
 * journal fields are their own page (`JournalPage`); the OKF actions are
 * commands and moved to Maintenance, where the phone already had them.
 */
export interface ContentPageProps {
  isActiveVault: boolean;
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
  taskDatabase: string;
  onTaskDatabase: (v: string) => void;
  baseFiles: { path: string; title: string }[];
  onCreateTaskDb: () => void;
  canCreateTaskDb: boolean;
  defaultNoteType: string;
  onDefaultNoteType: (v: string) => void;
  /** Reviewer name for "Mark as reviewed" (OKF 0.2 plan P3b) — device-local. */
  verifierName: string;
  onVerifierName: (v: string) => void;
  extendedDatabases: boolean;
  commentAnchors: boolean;
  onCommentAnchors: (v: boolean) => void;
  onExtendedDatabases: (v: boolean) => void;
}

export const ContentPage: React.FC<ContentPageProps> = (p) => {
  const { t } = useTranslation();
  return (
    <div>
      <AreaHead areaId="content" />

      {/* Folders first: the template folder is the precondition for the
          template rules below (maintainer, 2026-07-27), and the three folders
          shared one card with the rules before — three topics under
          "Templates" (plan 2026-10-29, move 38). */}
      <SettingCard label={t("settings.groupFolders")}>
        <SettingRow label={t("settings.templateFolder")} info={t("settings.templateFolderDesc")}>
          <FolderInput value={p.templateFolder} onSave={p.onTemplateFolder} placeholder="Templates/" disabled={!p.isActiveVault} onBrowse={p.onBrowseTemplateFolder} browseTestId="browse-template-folder" />
        </SettingRow>
        {/* Target of the phone's ＋ quick capture and of text shared from
            another app. Written here and READ on the phone: a vault is usually
            set up on the desktop, and hiding it would mean the folder can only
            be chosen on the smaller screen. */}
        <SettingRow label={t("settings.inboxFolder")} info={t("settings.inboxFolderDesc")}>
          <FolderInput value={p.inboxFolder} onSave={p.onInboxFolder} placeholder="Inbox/" disabled={!p.isActiveVault} onBrowse={p.onBrowseInboxFolder} inputTestId="inbox-folder" browseTestId="browse-inbox-folder" />
        </SettingRow>
        {/* Where a dropped, pasted or photographed file lands (S17). Empty
            keeps the old behaviour — beside the note — which is what the
            visible line says. */}
        <SettingRow label={t("settings.attachmentFolder")} desc={t("settings.attachmentFolderHint")} info={t("settings.attachmentFolderDesc")}>
          <FolderInput value={p.attachmentFolder} onSave={p.onAttachmentFolder} placeholder="Attachments/" disabled={!p.isActiveVault} onBrowse={p.onBrowseAttachmentFolder} inputTestId="attachment-folder" browseTestId="browse-attachment-folder" />
        </SettingRow>
      </SettingCard>

      {/* Folder and type rules: the same question from two directions ("where
          does the note live" / "what is it"), so one card — and ONE info
          button for the precedence rule that ties them together (Q8). A rule
          row is stored as soon as it is added, even half-filled; an unfinished
          rule simply never matches. */}
      <SettingCard
        label={t("settings.groupTemplates", { defaultValue: "Vorlagen" })}
        info={[t("settings.folderTemplatesDesc"), t("settings.typeTemplatesDesc"), t("settings.templateRuleHint")].join("\n\n")}
      >
        <SettingRow label={t("settings.folderTemplates", { defaultValue: "Vorlagen je Ordner" })} wide>
          <div className="pv-rulelist" data-testid="folder-template-rules">
            {p.folderTemplates.map((rule, index) => (
              <div className="pv-rule" key={index}>
                <CommittedTextInput
                  autoComplete="off"
                  className="pv-rule-from"
                  value={rule.folder}
                  placeholder={t("settings.ruleFolderPlaceholder", { defaultValue: "Ordner …" })}
                  aria-label={t("settings.folderTemplates", { defaultValue: "Vorlagen je Ordner" })}
                  onSave={(folder) =>
                    p.onFolderTemplates(p.folderTemplates.map((r, i) => (i === index ? { ...r, folder } : r)))
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
        <SettingRow label={t("settings.typeTemplates", { defaultValue: "Vorlagen je Notiztyp" })} wide>
          <div className="pv-rulelist" data-testid="type-template-rules">
            {p.typeTemplates.map((rule, index) => (
              <div className="pv-rule" key={index}>
                <CommittedTextInput
                  autoComplete="off"
                  className="pv-rule-from"
                  value={rule.type}
                  placeholder={DEFAULT_NOTE_TYPE}
                  aria-label={t("settings.typeTemplates", { defaultValue: "Vorlagen je Notiztyp" })}
                  onSave={(type) =>
                    p.onTypeTemplates(p.typeTemplates.map((r, i) => (i === index ? { ...r, type } : r)))
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
      </SettingCard>

      <SettingCard label={t("settings.groupNewNotes")}>
        <SettingRow label={t("settings.defaultNoteType")} info={t("settings.defaultNoteTypeDesc")}>
          <CommittedTextInput autoComplete="off" value={p.defaultNoteType} onSave={p.onDefaultNoteType} placeholder={DEFAULT_NOTE_TYPE} style={{ width: "100%" }} />
        </SettingRow>
        {/* C15: which extra file types open in Plainva rather than going to the
            system. It can only ADD — the built-in list stays whatever this
            says, so a typo here can never turn a note into an OS handoff. */}
        <SettingRow label={t("settings.textFileExtensions")} desc={t("settings.textFileExtensionsHint")} info={t("settings.textFileExtensionsDesc")}>
          <CommittedTextInput
            autoComplete="off"
            value={p.textFileExtensions}
            onSave={p.onTextFileExtensions}
            placeholder="fountain, adoc"
            style={{ width: "100%" }}
            data-testid="text-file-extensions"
          />
        </SettingRow>
      </SettingCard>

      <SettingCard label={t("settings.groupDatabases")}>
        <SettingRow label={t("settings.taskDatabase")} info={t("settings.taskDatabaseDesc")} wide>
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
              <CommittedTextInput autoComplete="off" value={p.taskDatabase} onSave={p.onTaskDatabase} placeholder="Tasks.base" style={{ flex: 1, minWidth: 0 }} />
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
        <SettingRow label={t("settings.allowExtendedDb")} desc={t("settings.allowExtendedDbDesc")} info={t("settings.allowExtendedDbInfo")}>
          <input type="checkbox" id="extDb" checked={p.extendedDatabases} onChange={(e) => p.onExtendedDatabases(e.target.checked)} />
        </SettingRow>
      </SettingCard>

      {/* Stufe F: the reviewer name, the anchors and the notifications answer
          "what happens around a remark" — one card, and the privacy switch is
          reachable in the same moment notifications are switched on. */}
      <SettingCard label={t("settings.groupAnnotations")} testId="settings-annotations">
        <SettingRow label={t("settings.verifierName")} info={t("settings.verifierNameDesc")} deviceOnly={deviceOnly(undefined)}>
          <CommittedTextInput autoComplete="off" value={p.verifierName} onSave={p.onVerifierName} placeholder={t("trust.verifierPlaceholder")} style={{ width: "100%" }} data-testid="verifier-name" />
        </SettingRow>
        <SettingRow label={t("settings.commentAnchors")} desc={t("settings.commentAnchorsHint")} info={t("settings.commentAnchorsDesc")} deviceOnly={deviceOnly("commentAnchors")}>
          <input type="checkbox" id="commentAnchors" checked={p.commentAnchors} onChange={(e) => p.onCommentAnchors(e.target.checked)} />
        </SettingRow>
        {p.isActiveVault && <CommentNotificationRows deviceOnly={deviceOnly(undefined)} />}
      </SettingCard>
    </div>
  );
};

/**
 * "Daily notes & journal" (settings plan 2026-10-29, E9): every vault field
 * the daily note and the journal read, from one page — they used to lie over
 * three cards of "Content & structure". The device's own journal settings
 * (place stamp, quick capture) stay on the app pages; the journal card's info
 * says where.
 */
export interface JournalPageProps {
  isActiveVault: boolean;
  dailyNotesFolder: string;
  onDailyNotesFolder: (v: string) => void;
  onBrowseDailyFolder: () => void;
  dailyNotesFormat: string;
  onDailyNotesFormat: (v: string) => void;
  dailyNoteTemplate: string;
  onDailyNoteTemplate: (v: string) => void;
  templateFiles: string[];
  dailyNoteType: string;
  onDailyNoteType: (v: string) => void;
  /** Heading the journal entries of a daily note stand under (plan Journal, E3). */
  journalHeading: string;
  onJournalHeading: (v: string) => void;
  /** When this vault's day ends, minutes after midnight (plan Journal-Erweiterungen, E1). */
  dayEndsAt: number;
  onDayEndsAt: (v: number) => void;
  /** Frontmatter property a day is rated in (plan Journal-Erweiterungen, E5). */
  journalMoodProperty: string;
  onJournalMoodProperty: (v: string) => void;
}

export const JournalPage: React.FC<JournalPageProps> = (p) => {
  const { t } = useTranslation();
  return (
    <div>
      <AreaHead areaId="journal" />

      <SettingCard label={t("settings.groupDailyNotes", { defaultValue: "Tagesnotizen" })}>
        <SettingRow label={t("settings.dailyNotesFolder")}>
          <FolderInput value={p.dailyNotesFolder} onSave={p.onDailyNotesFolder} placeholder="Tagebuch/" disabled={!p.isActiveVault} onBrowse={p.onBrowseDailyFolder} browseTestId="browse-daily-folder" />
        </SettingRow>
        <SettingRow label={t("settings.dailyNotesFormat")} desc={t("settings.dailyNotesFormatDesc")}>
          {/* Sanitized when saved, never under the caret (E23): a rewrite per
              keystroke moved the caret whenever the sanitizer changed a letter. */}
          <CommittedTextInput autoComplete="off" value={p.dailyNotesFormat} normalize={sanitizeDailyNoteFormat} onSave={p.onDailyNotesFormat} placeholder="YYYY-MM-DD" style={{ width: "100%" }} />
        </SettingRow>
        <SettingRow label={t("settings.dailyNotesTemplate")} info={t("settings.dailyNotesTemplateDesc")}>
          {p.templateFiles.length > 0 ? (
            <Select
              ariaLabel={t("settings.dailyNotesTemplate")}
              value={p.templateFiles.includes(p.dailyNoteTemplate) ? p.dailyNoteTemplate : ""}
              onChange={p.onDailyNoteTemplate}
              options={[{ value: "", label: "—" }, ...p.templateFiles.map((f) => ({ value: f, label: f }))]}
            />
          ) : (
            <CommittedTextInput autoComplete="off" value={p.dailyNoteTemplate} onSave={p.onDailyNoteTemplate} placeholder="DailyTemplate.md" style={{ width: "100%" }} />
          )}
        </SettingRow>
        <SettingRow label={t("settings.dailyNoteType")} info={t("settings.dailyNoteTypeDesc")}>
          <CommittedTextInput autoComplete="off" value={p.dailyNoteType} onSave={p.onDailyNoteType} placeholder={DEFAULT_DAILY_NOTE_TYPE} style={{ width: "100%" }} />
        </SettingRow>
      </SettingCard>

      <SettingCard label={t("settings.groupJournal")} info={{ text: t("settings.groupJournalInfo"), guide: "Journal.md" }} testId="settings-journal">
        <SettingRow label={t("settings.journalHeading")} desc={t("settings.journalHeadingHint")} info={t("settings.journalHeadingDesc")}>
          <CommittedTextInput autoComplete="off" value={p.journalHeading} onSave={p.onJournalHeading} placeholder={DEFAULT_JOURNAL_HEADING} data-testid="journal-heading" />
        </SettingRow>
        <SettingRow label={t("settings.journalMood")} desc={t("settings.journalMoodHint")} info={t("settings.journalMoodDesc")}>
          <CommittedTextInput autoComplete="off" value={p.journalMoodProperty} onSave={p.onJournalMoodProperty} placeholder="stimmung" data-testid="journal-mood-property" />
        </SettingRow>
        <SettingRow label={t("settings.dayEndsAt")} info={t("settings.dayEndsAtDesc")}>
          <Select
            ariaLabel={t("settings.dayEndsAt")}
            value={String(clampBoundary(p.dayEndsAt))}
            options={DAY_END_CHOICES.map((minutes) => ({
              value: String(minutes),
              label: minutes === 0 ? t("settings.dayEndsAtMidnight") : boundaryLabel(minutes),
            }))}
            onChange={(next) => p.onDayEndsAt(clampBoundary(Number(next)))}
            data-testid="day-ends-at"
          />
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
  /** Restore deleted files — beside the version history since 2026-10-29 (move 53). */
  onShowDeletedFiles: () => void;
}

export const BackupPage: React.FC<BackupPageProps> = (p) => {
  const { t } = useTranslation();
  return (
    <div>
      <AreaHead areaId="backup" />

      <SettingCard label={t("settings.groupZipBackups", { defaultValue: "ZIP-Backups" })}>
        <SettingRow label={t("settings.backupZipEnabled")} info={t("settings.backupZipEnabledDesc")}>
          <input
            type="checkbox"
            data-testid="backup-zip-enabled"
            checked={p.zipEnabled}
            onChange={(e) => p.onZipEnabled(e.target.checked)}
          />
        </SettingRow>
        <SettingRow label={t("settings.backupZipDest")} desc={p.zipDest || p.zipDefaultDest || undefined} deviceOnly={deviceOnly(undefined)}>
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
        <SettingRow label={t("settings.versionInterval")} info={t("settings.versionIntervalDesc")}>
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
        {p.isActiveVault && (
          <SettingRow label={t("versions.deletedTitle")} info={t("settings.deletedFilesDesc")}>
            <button
              data-testid="settings-deleted-files"
              onClick={p.onShowDeletedFiles}
              className="pv-btn pv-btn--secondary"
            >
              {t("settings.deletedFilesButton")}
            </button>
          </SettingRow>
        )}
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
  vaultStats: { notes: number; attachments: number } | null;
  okfViolations: number | null;
  /** Bundle version (OKF v0.2 plan, P2): null until the scan ran. */
  okfVersionState: OkfVersionState | null;
  onShowOkfMigration: () => void;
  onShowOkfWizard: () => void;
  onShowIndexManager: () => void;
  onUpdateAllIndexes: () => void;
}

/**
 * Maintenance (settings plan 2026-10-29, § 3.9): the state first, then the
 * commands by how often they are reached for — the index, then the OKF format.
 * The OKF actions came from "Content & structure" (move 50): they are commands,
 * not settings, and the phone already kept them here. "What is OKF?" is the
 * info of their card (move 51). Restoring deleted files moved to Backup &
 * versioning (move 53), beside the version history it belongs to.
 */
export const MaintenancePage: React.FC<MaintenancePageProps> = (p) => {
  const { t } = useTranslation();
  return (
    <div>
      <AreaHead areaId="maintenance" />
      {p.isActiveVault ? (
        <>
          {p.vaultStats && (
            <SettingCard label={t("settings.vaultStats", { defaultValue: "Vault-Statistik" })} testId="settings-vault-stats">
              <SettingRow
                label={t("settings.vaultStatsValue", { defaultValue: "Notizen: {{notes}} · Anhänge: {{attachments}}", notes: p.vaultStats.notes, attachments: p.vaultStats.attachments })}
              />
            </SettingCard>
          )}
          {/* Two actions where there used to be one mislabelled button: the
              old "Index neu aufbauen" ran the cheap reconcile, so the expensive
              rebuild had no entry point at all (plan P1b). The visible line of
              each says when to take it; what it does is behind the info. */}
          <SettingCard label={t("settings.rebuildIndex", { defaultValue: "Suchindex" })} info={{ text: t("settings.searchIndexInfo"), guide: "Search.md" }}>
            <SettingRow
              label={t("refresh.action", { defaultValue: "Vault neu einlesen" })}
              desc={t("refresh.actionHint")}
              info={t("refresh.actionDesc")}
            >
              <Button variant="secondary" size="sm" disabled={p.reindexRunning} onClick={p.onRefresh}>
                {t("refresh.action", { defaultValue: "Vault neu einlesen" })}
              </Button>
            </SettingRow>
            <SettingRow
              label={t("refresh.rebuildAction", { defaultValue: "Index vollständig neu aufbauen" })}
              desc={t("settings.rebuildIndexHint")}
              info={t("settings.rebuildIndexDesc")}
            >
              <Button variant="secondary" size="sm" disabled={p.reindexRunning} onClick={p.onReindex}>
                {p.reindexRunning ? t("settings.rebuildIndexRunning", { defaultValue: "Läuft…" }) : t("refresh.rebuildAction", { defaultValue: "Index vollständig neu aufbauen" })}
              </Button>
            </SettingRow>
          </SettingCard>
          <SettingCard
            label={t("settings.groupOkfFormat")}
            info={{ text: [t("okfInfo.short1"), t("okfInfo.short2"), t("okfInfo.short3")].join("\n\n"), guide: "OKF.md" }}
            testId="settings-okf"
          >
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
            <SettingRow label={t("settings.okfIndexLabel")} info={t("settings.okfIndexDesc")}>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button onClick={p.onShowIndexManager} className="pv-btn pv-btn--secondary">
                  {t("settings.okfIndexButton")}
                </button>
                <button onClick={p.onUpdateAllIndexes} className="pv-btn pv-btn--secondary">
                  {t("indexMd.updateAllAction")}
                </button>
              </div>
            </SettingRow>
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
