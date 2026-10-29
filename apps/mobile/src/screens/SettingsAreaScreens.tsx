import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Capacitor } from "@capacitor/core";
import { ChevronRight } from "lucide-react";
import { FolderPickerSheet } from "../components/FolderPickerSheet";
import { HailingSheet } from "../components/HailingSheet";
import { DeletedFilesSheet } from "../components/DeletedFilesSheet";
import { ZipBackupGroup } from "../components/ZipBackupGroup";
import { placeStampEnabled, setPlaceStampEnabled, createTaskDatabase, formatBuildLine, formatDiagnosticsExport, GroupCard, ICON, PlainvaLogo, Row, RowList, SectionLabel, SettingField, Switch, CommittedTextInput, travelsWithVault } from "@plainva/ui";
import { mPrompt, mSelect } from "../services/mobileDialogs";
import { type DefaultView, NOTE_HEAD_BUTTONS, type NoteHeadButton } from "../services/mobileSettings";
import { noteTypeOf } from "../services/newNote";
import { getMobileVault, type MobileVault } from "../services/vaultService";
import { AppBar } from "../components/AppBar";
import { TemplateRules } from "../components/TemplateRules";
import { FolderField } from "../components/FolderField";
import { useSettingsState } from "../hooks/useSettingsState";

/**
 * Settings detail screens (redesign 2026-07-18, P4): the master list mirrors
 * the desktop's area catalog; each area pushes ONE of these screens. The
 * rows/pickers moved 1:1 from the old flat SettingsScreen — behavior and
 * persistence are unchanged, only the navigation is master→detail now.
 */

/** Sentinel option of the task-database picker: "create a new one" (S39). */
const CREATE_TASK_DB = "\u0000create";

/** M3 one-line setting: label left, current value right, opens a sheet. */
export function MobileSettingRow({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <Row
      end={<><span className="m-prop-val">{value}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
      onClick={onClick}
      title={label}
    />
  );
}

function AreaHeader({ id, title, onBack }: { id: string; title: string; onBack: () => void }) {
  return (
    <AppBar onBack={onBack} title={title} testId={`appbar-area-${id}`} />
  );
}

/** Editor & notes: the view, writing, and the journal's device settings. */
export function EditorAreaScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const { settings, update } = useSettingsState();
  // Device-local, off by default (plan Journal-Erweiterungen, E6).
  const [placeStamp, setPlaceStamp] = useState(placeStampEnabled);
  const viewLabel = (view: DefaultView) =>
    t(view === "edit" ? "mobile.defaultViewEdit" : "mobile.defaultViewRead");
  // The first button of a note's app bar (F9): the same names the note uses.
  const headLabel = (button: NoteHeadButton) =>
    t(button === "outline" ? "rightPanel.outline" : button === "backlinks" ? "rightPanel.backlinks" : "mobile.toggleBookmark");
  const pickHeadButton = () => {
    void mSelect({
      title: t("mobile.noteHeadButton"),
      options: NOTE_HEAD_BUTTONS.map((b) => ({ value: b, label: headLabel(b) })),
      value: settings.noteHeadButton,
    }).then((v) => {
      if (v !== null) update({ noteHeadButton: v as NoteHeadButton });
    });
  };
  const pickDefaultView = () => {
    void mSelect({
      title: t("mobile.settingDefaultView"),
      options: (["read", "edit"] as DefaultView[]).map((m) => ({ value: m, label: viewLabel(m) })),
      value: settings.defaultView,
    }).then((v) => {
      if (v !== null) update({ defaultView: v as DefaultView });
    });
  };
  return (
    <div className="m-page">
      <AreaHeader id="editor" onBack={onBack} title={t("settings.sectionEditor")} />
      <div className="m-settings">
        {/* The explanations sit behind each row's ⓘ (settings plan 2026-10-29,
            appendix 2.3): a note just created opens to be written in either way
            (wish 2026-10-19), and what the head button leaves out stays within
            reach. */}
        <SectionLabel>{t("settings.groupView")}</SectionLabel>
        <GroupCard><RowList>
          <Row
            end={<><span className="m-prop-val">{viewLabel(settings.defaultView)}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
            info={t("mobile.defaultViewNewNotes")}
            onClick={pickDefaultView}
            title={t("mobile.settingDefaultView")}
          />
          <Row title={t("mobile.readerAutoHide")} end={<Switch checked={settings.readerAutoHide} label={t("mobile.readerAutoHide")} onChange={(readerAutoHide) => update({ readerAutoHide })} />} />
          <Row
            end={<><span className="m-prop-val">{headLabel(settings.noteHeadButton)}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
            info={t("mobile.noteHeadButtonHint")}
            onClick={pickHeadButton}
            title={t("mobile.noteHeadButton")}
          />
        </RowList></GroupCard>

        {/* Spell checking (plan Befunde 2026-10-06, E3) and asking before an
            empty link becomes a note (S39) — one group, as on the desktop
            (appendix 2.3 B1). What checks is the keyboard and the system. */}
        <SectionLabel>{t("settings.groupWriting")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row
              end={<Switch
                checked={settings.spellcheck === true}
                label={t("settings.spellcheck")}
                onChange={(next) => update({ spellcheck: next })}
              />}
              info={t("settings.spellcheckDesc")}
              title={t("settings.spellcheck")}
            />
            <Row
              end={<Switch
                checked={settings.askBeforeCreateLink}
                label={t("settings.askBeforeCreateLink")}
                onChange={(next) => update({ askBeforeCreateLink: next })}
              />}
              info={t("settings.askBeforeCreateLinkDesc")}
              title={t("settings.askBeforeCreateLink")}
            />
          </RowList>
        </GroupCard>

        {/* The journal's device settings (appendix 2.3 B2): the place stamp
            came from Appearance. Device-local and OFF by default: one's phone
            and one's desk are different places to be asked about one's
            position; the permission is asked on the first press, never here
            (plan Journal-Erweiterungen, E6). */}
        <SectionLabel>{t("settings.editorGroupJournal")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row
              end={<Switch
                checked={placeStamp}
                testId="place-stamp-switch"
                label={t("settings.placeStamp")}
                onChange={(next) => { setPlaceStamp(next); setPlaceStampEnabled(next); }}
              />}
              info={t("settings.placeStampDesc")}
              title={t("settings.placeStamp")}
              wrap
            />
          </RowList>
        </GroupCard>
      </div>
    </div>
  );
}

/**
 * Notes & filing (settings plan 2026-10-29, E9): the half of the former
 * "Content & structure" about where notes go and what they start as. The daily
 * note and journal fields are their own screen (`JournalAreaScreen`), as on
 * the desktop.
 */
export function ContentAreaScreen({ vault, onBack }: { vault: MobileVault; onBack: () => void }) {
  const { t } = useTranslation();
  const { settings, update } = useSettingsState();
  // Stufe F: the same three levels the desktop offers, through the phone's own
  // picker rather than a select - one product, two idioms.
  const levelSuffix = (level: string) =>
    level === "mentions" ? "Mentions" : level === "all" ? "All" : "Relevant";
  const pickNotifyLevel = () => {
    void mSelect({
      title: t("commentNotify.level"),
      options: ["mentions", "relevant", "all"].map((value) => ({
        value,
        label: t(`commentNotify.level${levelSuffix(value)}`),
      })),
      value: settings.commentNotifyLevel,
    }).then((v) => {
      if (v !== null) void update({ commentNotifyLevel: v });
    });
  };
  const [pickFor, setPickFor] = useState<"inboxFolder" | "attachmentFolder" | "templateFolder" | null>(null);
  // The reviewer name and the remark notifications travel with nothing: the
  // profile catalog has no field for them (E14), so they wear the badge.
  const deviceOnly = (field?: string) => !travelsWithVault(field, "mobile");

  /** The `.base` this vault treats as its task database — the same setting the
   *  desktop has, so the tasks area shows entries and can promote into it. */
  const pickTaskDatabase = () => {
    void (async () => {
      const bases = await vault.queryService?.listBases().catch(() => []);
      const picked = await mSelect({
        title: t("settings.taskDatabase"),
        options: [
          { value: "", label: "—" },
          ...(bases ?? []).map((b) => ({ value: b.path, label: b.title })),
          // S39: a vault with no task database yet had a picker with nothing to
          // pick — the desktop could create one, the phone could only wait for it.
          { value: CREATE_TASK_DB, label: t("settings.taskDatabaseCreate") },
        ],
        value: settings.taskDatabase,
      });
      if (picked === null) return;
      if (picked !== CREATE_TASK_DB) {
        update({ taskDatabase: picked });
        return;
      }
      const name = await mPrompt({
        title: t("settings.taskDatabaseCreate"),
        message: t("settings.taskDatabaseCreateName"),
        initial: t("settings.taskDatabaseDefaultName"),
      });
      if (name.cancelled || !name.value.trim()) return;
      // The scaffold is the shared one, so a database created here is the same
      // file the desktop would have written — same views, same status options.
      const path = await createTaskDatabase(vault.files, name.value, {
        viewTable: t("database.viewTable"),
        viewBoard: t("database.viewBoard"),
        viewTimeline: t("database.viewTimeline"),
        doneKey: t("tasks.dbDoneKey", { defaultValue: "done" }),
        dueKey: t("tasks.dbDueKey"),
        statusOptions: [t("tasks.dbStatusOpen"), t("tasks.dbStatusInProgress"), t("tasks.dbStatusDone")],
        priorityKey: t("tasks.dbPriorityKey"),
        priorityOptions: [t("tasks.priorityHigh"), t("tasks.priorityMedium"), t("tasks.priorityLow")],
      }).catch(() => null);
      if (!path) return;
      update({ taskDatabase: path });
      // The phone has no watcher to find the new file: the index is told
      // here, so the tasks area sees it now and the sync takes it along.
      void vault.reindexPaths([path]);
    })();
  };

  return (
    <div className="m-page">
      <AreaHeader id="content" onBack={onBack} title={t("settings.sectionContent")} />
      <div className="m-settings">
        <SectionLabel>{t("settings.groupFolders")}</SectionLabel>
        <GroupCard>
          <RowList>
            <FolderField
              info={t("settings.templateFolderDesc")}
              label={t("mobile.settingTemplateFolder")}
              normalize={(v) => v.trim() || "Templates"}
              onSave={(v) => update({ templateFolder: v })}
              onPick={() => setPickFor("templateFolder")}
              value={settings.templateFolder}
            />
            {/* Normalized when saved, not per keystroke (E23): `|| "Inbox"`
                refilled a cleared field while one was still typing. */}
            <FolderField
              info={t("settings.inboxFolderDesc")}
              label={t("mobile.settingInboxFolder")}
              normalize={(v) => v.trim() || "Inbox"}
              onSave={(v) => update({ inboxFolder: v })}
              onPick={() => setPickFor("inboxFolder")}
              value={settings.inboxFolder}
            />
            <FolderField
              hint={t("settings.attachmentFolderHint")}
              info={t("settings.attachmentFolderDesc")}
              label={t("settings.attachmentFolder")}
              normalize={(v) => v.trim()}
              onSave={(v) => update({ attachmentFolder: v })}
              onPick={() => setPickFor("attachmentFolder")}
              value={settings.attachmentFolder}
            />
          </RowList>
        </GroupCard>

        <TemplateRules onChange={update} settings={settings} vault={vault} />

        {/* The type field saves what the creation paths read
            (`services/newNote.ts`): the name without blanks around it, and the
            default for a field left empty — which the placeholder names while
            it is empty. */}
        <SectionLabel>{t("settings.groupNewNotes")}</SectionLabel>
        <GroupCard>
          <RowList>
            <SettingField info={t("settings.defaultNoteTypeDesc")} label={t("settings.defaultNoteType")}>
              <CommittedTextInput
                normalize={noteTypeOf}
                onSave={(v) => update({ defaultNoteType: v })}
                placeholder={noteTypeOf("")}
                value={settings.defaultNoteType}
              />
            </SettingField>
          </RowList>
        </GroupCard>

        <SectionLabel>{t("settings.groupDatabases")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row
              end={<><span className="m-prop-val">{settings.taskDatabase || "—"}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
              info={t("settings.taskDatabaseDesc")}
              onClick={pickTaskDatabase}
              title={t("settings.taskDatabase")}
            />
          </RowList>
        </GroupCard>

        {/* Stufe F, F3: the reviewer name and the same three questions the
            desktop asks about remarks, in the same order - whether at all,
            about what, and how much the message may say. The privacy switch
            sits here because it is needed in the moment notifications are
            switched on (§5, FB2). */}
        <SectionLabel>{t("settings.groupAnnotations")}</SectionLabel>
        <GroupCard>
          <RowList>
            <SettingField deviceOnly={deviceOnly(undefined)} info={t("settings.verifierNameDesc")} label={t("settings.verifierName")}>
              <CommittedTextInput
                onSave={(v) => update({ verifierName: v })}
                placeholder={t("trust.verifierPlaceholder")}
                value={settings.verifierName}
              />
            </SettingField>
            <Row
              deviceOnly={deviceOnly(undefined)}
              end={<Switch
                checked={settings.commentNotifyEnabled}
                label={t("commentNotify.enable")}
                onChange={(next) => {
                  // The baseline is drawn BEFORE the flag is stored, so no cycle
                  // can slip between the two and release the backlog (FB3).
                  void (async () => {
                    if (next) {
                      const m = await import("../services/commentNotifier");
                      await m.drawMobileCommentBaseline();
                    }
                    await update({ commentNotifyEnabled: next });
                  })();
                }}
              />}
              info={t("commentNotify.enableHint")}
              title={t("commentNotify.enable")}
            />
            {settings.commentNotifyEnabled && (
              <>
                <Row
                  deviceOnly={deviceOnly(undefined)}
                  end={<><span className="m-prop-val">{t(`commentNotify.level${levelSuffix(settings.commentNotifyLevel)}`)}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
                  onClick={pickNotifyLevel}
                  subtitle={t(`commentNotify.level${levelSuffix(settings.commentNotifyLevel)}Hint`)}
                  title={t("commentNotify.level")}
                />
                <Row
                  deviceOnly={deviceOnly(undefined)}
                  end={<Switch
                    checked={settings.commentNotifyPreview}
                    label={t("commentNotify.preview")}
                    onChange={(next) => void update({ commentNotifyPreview: next })}
                  />}
                  info={t("commentNotify.previewHint")}
                  title={t("commentNotify.preview")}
                />
              </>
            )}
          </RowList>
        </GroupCard>
      </div>

      {pickFor && (
        <FolderPickerSheet
          onClose={() => setPickFor(null)}
          onPick={(path) => {
            if (path) update({ [pickFor]: path });
          }}
          title={t("settings.browseFolders")}
          vault={vault}
        />
      )}
    </div>
  );
}

/**
 * Backup & version history: the snapshot-retention pickers (package G), and
 * since the settings plan of 2026-10-29 the restore of deleted files beside
 * them (move 53) — the same safety net as the versions. Each retention row
 * says what it deletes, as on the desktop: that is a consequence, not an
 * explanation.
 */
export function BackupAreaScreen({ vault, onBack }: { vault: MobileVault; onBack: () => void }) {
  const { t } = useTranslation();
  const { settings, update } = useSettingsState();
  const [deleted, setDeleted] = useState(false);
  const pickBackupInterval = () => {
    void mSelect({
      title: t("settings.versionInterval"),
      message: t("settings.versionIntervalDesc"),
      options: [0, 60, 120, 300, 600].map((sec) => ({
        value: String(sec),
        label: sec === 0 ? t("settings.versionIntervalEvery") : `${sec / 60} min`,
      })),
      value: String(settings.backupIntervalSeconds),
    }).then((v) => {
      if (v !== null) update({ backupIntervalSeconds: Number(v) });
    });
  };
  const pickBackupCount = () => {
    void mSelect({
      title: t("settings.versionMaxCount"),
      message: t("settings.versionMaxCountDesc"),
      options: [20, 50, 100, 200].map((n) => ({ value: String(n), label: String(n) })),
      value: String(settings.backupMaxPerFile),
    }).then((v) => {
      if (v !== null) update({ backupMaxPerFile: Number(v) });
    });
  };
  const pickBackupAge = () => {
    void mSelect({
      title: t("settings.versionMaxAge"),
      message: t("settings.versionMaxAgeDesc"),
      options: [0, 30, 90, 365].map((d) => ({
        value: String(d),
        label: d === 0 ? t("settings.versionAgeUnlimited") : t("settings.versionAgeDays", { days: d }),
      })),
      value: String(settings.backupMaxAgeDays),
    }).then((v) => {
      if (v !== null) update({ backupMaxAgeDays: Number(v) });
    });
  };
  return (
    <div className="m-page">
      <AreaHeader id="backup" onBack={onBack} title={t("settings.backupSection")} />
      <div className="m-settings">
        {/* The scheduled ZIP archive came here from the sync screen (move 21). */}
        <ZipBackupGroup vault={vault} />
        <SectionLabel>{t("versions.title")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row
              end={<><span className="m-prop-val">{settings.backupIntervalSeconds === 0 ? t("settings.versionIntervalEvery") : `${settings.backupIntervalSeconds / 60} min`}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
              info={t("settings.versionIntervalDesc")}
              onClick={pickBackupInterval}
              title={t("settings.versionInterval")}
            />
            <Row
              end={<><span className="m-prop-val">{String(settings.backupMaxPerFile)}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
              onClick={pickBackupCount}
              subtitle={t("settings.versionMaxCountDesc")}
              title={t("settings.versionMaxCount")}
            />
            <Row
              end={<><span className="m-prop-val">{settings.backupMaxAgeDays === 0 ? t("settings.versionAgeUnlimited") : t("settings.versionAgeDays", { days: settings.backupMaxAgeDays })}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
              onClick={pickBackupAge}
              subtitle={t("settings.versionMaxAgeDesc")}
              title={t("settings.versionMaxAge")}
            />
            <Row
              data-testid="backup-deleted-files"
              end={<ChevronRight className="m-chevron" size={ICON.ui} />}
              info={t("settings.deletedFilesDesc")}
              onClick={() => setDeleted(true)}
              title={t("versions.deletedTitle")}
            />
          </RowList>
        </GroupCard>
      </div>
      {deleted && <DeletedFilesSheet onClose={() => setDeleted(false)} vault={vault} />}
    </div>
  );
}

/** About & diagnostics: the 5-tap logo, diagnostics export. "What is OKF?" is the info of Maintenance › OKF format since 2026-10-29 (move 17). */
export function AboutAreaScreen({ onBack }: { onBack: () => void }) {
  const { t, i18n: i18nInstance } = useTranslation();
  const [, setTick] = useState(0);
  const [hailing, setHailing] = useState(false);
  // Version and build under the logo (Labs channel, harness plan §21a.4): the
  // release, the dev build and a Labs build can sit on one phone.
  const [appVersion, setAppVersion] = useState("");
  useEffect(() => {
    void import("@capacitor/app")
      .then(({ App }) => App.getInfo())
      .then((info) => setAppVersion(info.version))
      .catch(() => {});
  }, []);
  const taps = useRef<{ n: number; t: number }>({ n: 0, t: 0 });
  const logoTap = () => {
    const now = Date.now();
    taps.current = now - taps.current.t > 3000 ? { n: 1, t: now } : { n: taps.current.n + 1, t: taps.current.t };
    if (taps.current.n >= 5) {
      taps.current = { n: 0, t: 0 };
      setHailing(true);
    }
  };

  // Diagnostics export (package I, desktop P4 parity): the shared no-content
  // event log plus app facts, through the share sheet (web: a download).
  const exportDiagnostics = () => {
    void (async () => {
      let appVersion = "dev";
      try {
        const { App } = await import("@capacitor/app");
        appVersion = (await App.getInfo()).version;
      } catch {
        /* web dev server has no native info */
      }
      const text = formatDiagnosticsExport({
        appVersion,
        tauriVersion: "-",
        webView: navigator.userAgent.match(/(Chrome|AppleWebKit)\/[\d.]+/)?.[0],
        os: Capacitor.getPlatform(),
        language: i18nInstance.language,
        conflicts: await (await getMobileVault()).files.listConflictDiagnostics?.(),
      });
      const name = `plainva-diagnostics-${new Date().toISOString().slice(0, 10)}.md`;
      if (Capacitor.getPlatform() === "web") {
        const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        return;
      }
      const { Share } = await import("@capacitor/share");
      await Share.share({ title: name, text });
    })();
  };

  return (
    <div className="m-page">
      <AreaHeader id="about" onBack={onBack} title={t("settings.about")} />
      <div className="m-settings">
        {/* The logo with its five-tap gesture and the hint (D5); both used to
            stand on Appearance as well (settings plan 2026-10-29, appendix 2.1 B5). */}
        <GroupCard>
          <RowList>
            <Row icon={<PlainvaLogo size={ICON.touch} />} onClick={logoTap} subtitle={[appVersion, formatBuildLine()].filter(Boolean).join(" · ")} title="Plainva" />
          </RowList>
        </GroupCard>
        <p className="m-hint">{t("mobile.aboutTip")}</p>
        <GroupCard>
          <RowList>
            <Row
              end={<ChevronRight className="m-chevron" size={ICON.ui} />}
              onClick={exportDiagnostics}
              title={t("settings.exportDiagnostics")}
            />
          </RowList>
        </GroupCard>
      </div>

      {hailing && <HailingSheet onChanged={() => setTick((n) => n + 1)} onClose={() => setHailing(false)} />}

    </div>
  );
}
