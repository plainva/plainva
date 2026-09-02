import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Capacitor } from "@capacitor/core";
import { ChevronRight } from "lucide-react";
import { SheetGrip } from "../components/SheetGrip";
import { FolderPickerSheet } from "../components/FolderPickerSheet";
import { HailingSheet } from "../components/HailingSheet";
import { Button, createTaskDatabase, formatDiagnosticsExport, GroupCard, ICON, listTemplates, PlainvaLogo, Row, RowList, SectionLabel, SettingField, Switch, TextInput, userGuideUrl } from "@plainva/ui";
import { Browser } from "@capacitor/browser";
import { mPrompt, mSelect } from "../services/mobileDialogs";
import {
  getMobileSettings,
  updateMobileSettings,
  type DefaultView,
} from "../services/mobileSettings";
import type { MobileVault } from "../services/vaultService";
import { AppBar } from "../components/AppBar";
import { TemplateRules } from "../components/TemplateRules";
import { FolderField } from "../components/FolderField";

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

function AreaHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <AppBar onBack={onBack} title={title} />
  );
}

function useSettingsState() {
  const [settings, setSettings] = useState(getMobileSettings());
  const update = (patch: Parameters<typeof updateMobileSettings>[0]) => {
    void updateMobileSettings(patch).then(() => setSettings(getMobileSettings()));
  };
  return { settings, update };
}

/** Editor & notes: the default note view. */
export function EditorAreaScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const { settings, update } = useSettingsState();
  const viewLabel = (view: DefaultView) =>
    t(view === "edit" ? "mobile.defaultViewEdit" : "mobile.defaultViewRead");
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
      <AreaHeader onBack={onBack} title={t("settings.sectionEditor")} />
      <div className="m-settings">
        <GroupCard><RowList><MobileSettingRow
          label={t("mobile.settingDefaultView")}
          onClick={pickDefaultView}
          value={viewLabel(settings.defaultView)}
        /></RowList></GroupCard>

        {/* S39: the desktop has had this since the unresolved-links work; the
            phone created the note without asking because the toggle had no
            mobile control, not because anyone decided it should differ. */}
        <SectionLabel>{t("settings.groupLinks")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row
              end={<Switch
                checked={settings.askBeforeCreateLink}
                label={t("settings.askBeforeCreateLink")}
                onChange={(next) => update({ askBeforeCreateLink: next })}
              />}
              title={t("settings.askBeforeCreateLink")}
            />
          </RowList>
        </GroupCard>
        {/* Describes the whole card, so it keeps the page edge. */}
        <p className="m-hint">{t("settings.askBeforeCreateLinkDesc")}</p>
      </div>
    </div>
  );
}

/** Content & structure: capture/daily/template folders + the daily template. */
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
  const [pickFor, setPickFor] = useState<
    "dailyFolder" | "inboxFolder" | "attachmentFolder" | "templateFolder" | null
  >(null);

  // Daily template (package I, desktop dailyNotesTemplate parity): fresh
  // dailies seed from a template file in the template folder; "—" = none.
  const pickDailyTemplate = () => {
    void (async () => {
      const items = await listTemplates(vault.adapter, settings.templateFolder).catch(() => []);
      const picked = await mSelect({
        title: t("settings.dailyNotesTemplate"),
        options: [
          { value: "", label: "—" },
          ...items.map((it) => {
            const file = it.path.split("/").pop() ?? it.path;
            return { value: file, label: it.title };
          }),
        ],
        value: settings.dailyTemplate,
      });
      if (picked !== null) update({ dailyTemplate: picked });
    })();
  };

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
      const path = await createTaskDatabase(vault.adapter, name.value, {
        viewTable: t("database.viewTable"),
        viewBoard: t("database.viewBoard"),
        doneKey: t("tasks.dbDoneKey", { defaultValue: "done" }),
        dueKey: t("tasks.dbDueKey"),
        statusOptions: [t("tasks.dbStatusOpen"), t("tasks.dbStatusInProgress"), t("tasks.dbStatusDone")],
      }).catch(() => null);
      if (!path) return;
      update({ taskDatabase: path });
      // The watcher indexes the new file; the tasks area should see it now.
      void vault.indexer?.indexPath(path).catch(() => {});
    })();
  };

  return (
    <div className="m-page">
      <AreaHeader onBack={onBack} title={t("settings.sectionContent")} />
      <div className="m-settings">
        <SectionLabel>{t("mobile.settingFolders")}</SectionLabel>
        <GroupCard>
          <RowList>
            <FolderField
              label={t("mobile.settingDailyFolder")}
              onChange={(v) => update({ dailyFolder: v.trim() || "Daily" })}
              onPick={() => setPickFor("dailyFolder")}
              value={settings.dailyFolder}
            />
            <FolderField
              label={t("mobile.settingInboxFolder")}
              onChange={(v) => update({ inboxFolder: v.trim() || "Inbox" })}
              onPick={() => setPickFor("inboxFolder")}
              value={settings.inboxFolder}
            />
            <FolderField
              label={t("settings.attachmentFolder")}
              onChange={(v) => update({ attachmentFolder: v.trim() })}
              onPick={() => setPickFor("attachmentFolder")}
              value={settings.attachmentFolder}
            />
            <FolderField
              label={t("mobile.settingTemplateFolder")}
              onChange={(v) => update({ templateFolder: v.trim() || "Templates" })}
              onPick={() => setPickFor("templateFolder")}
              value={settings.templateFolder}
            />
          </RowList>
        </GroupCard>

        <GroupCard>
          <RowList>
            <MobileSettingRow
              label={t("settings.dailyNotesTemplate")}
              onClick={pickDailyTemplate}
              value={settings.dailyTemplate || "—"}
            />
            <MobileSettingRow
              label={t("settings.taskDatabase")}
              onClick={pickTaskDatabase}
              value={settings.taskDatabase || "—"}
            />
          </RowList>
        </GroupCard>

        {/* S39: the note-shape fields. They already travelled here through the
            settings profile — a value set on the desktop applied on the phone,
            but nothing here could read or change it. Each carries its own
            explanation now, so the sentence sits with the field it belongs to
            instead of below whatever happened to come next. */}
        <SectionLabel>{t("settings.dailyNotes")}</SectionLabel>
        <GroupCard>
          <RowList>
            <SettingField hint={t("settings.dailyNotesFormatDesc")} label={t("settings.dailyNotesFormat")}>
              <TextInput
                onChange={(e) => update({ dailyFormat: e.target.value })}
                value={settings.dailyFormat}
              />
            </SettingField>
            <SettingField label={t("settings.dailyNoteType")}>
              <TextInput
                onChange={(e) => update({ dailyNoteType: e.target.value })}
                value={settings.dailyNoteType}
              />
            </SettingField>
            <SettingField hint={t("settings.defaultNoteTypeDesc")} label={t("settings.defaultNoteType")}>
              <TextInput
                onChange={(e) => update({ defaultNoteType: e.target.value })}
                value={settings.defaultNoteType}
              />
            </SettingField>
            <SettingField hint={t("settings.verifierNameDesc")} label={t("settings.verifierName")}>
              <TextInput
                onChange={(e) => update({ verifierName: e.target.value })}
                placeholder={t("trust.verifierPlaceholder")}
                value={settings.verifierName}
              />
            </SettingField>
          </RowList>
        </GroupCard>

        <TemplateRules onChange={update} settings={settings} vault={vault} />

        {/* Stufe F, F3: the same three questions the desktop asks, in the same
            order - whether at all, about what, and how much the message may
            say. The privacy switch sits here rather than in a privacy area,
            because it is needed in the moment notifications are switched on
            (§5, FB2). The sentence under the first row states the phone's limit
            plainly: no timer runs in the background, so it notices on opening
            rather than at once. */}
        <SectionLabel>{t("commentNotify.section")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row
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
              title={t("commentNotify.enable")}
            />
            {settings.commentNotifyEnabled && (
              <>
                <MobileSettingRow
                  label={t("commentNotify.level")}
                  onClick={pickNotifyLevel}
                  value={t(`commentNotify.level${levelSuffix(settings.commentNotifyLevel)}`)}
                />
                <Row
                  end={<Switch
                    checked={settings.commentNotifyPreview}
                    label={t("commentNotify.preview")}
                    onChange={(next) => void update({ commentNotifyPreview: next })}
                  />}
                  title={t("commentNotify.preview")}
                />
              </>
            )}
          </RowList>
        </GroupCard>
        <p className="m-hint">
          {settings.commentNotifyEnabled ? t("commentNotify.previewHint") : t("commentNotify.enableHint")}
        </p>
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

/** Backup & version history: the snapshot-retention pickers (package G). */
export function BackupAreaScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const { settings, update } = useSettingsState();
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
      <AreaHeader onBack={onBack} title={t("settings.backupSection")} />
      <div className="m-settings">
        <SectionLabel>{t("versions.title")}</SectionLabel>
        <GroupCard>
          <RowList>
            <MobileSettingRow
              label={t("settings.versionInterval")}
              onClick={pickBackupInterval}
              value={
                settings.backupIntervalSeconds === 0
                  ? t("settings.versionIntervalEvery")
                  : `${settings.backupIntervalSeconds / 60} min`
              }
            />
            <MobileSettingRow
              label={t("settings.versionMaxCount")}
              onClick={pickBackupCount}
              value={String(settings.backupMaxPerFile)}
            />
            <MobileSettingRow
              label={t("settings.versionMaxAge")}
              onClick={pickBackupAge}
              value={
                settings.backupMaxAgeDays === 0
                  ? t("settings.versionAgeUnlimited")
                  : t("settings.versionAgeDays", { days: settings.backupMaxAgeDays })
              }
            />
          </RowList>
        </GroupCard>
      </div>
    </div>
  );
}

/** About & diagnostics: the 5-tap logo, diagnostics export, OKF explainer. */
export function AboutAreaScreen({ onBack }: { onBack: () => void }) {
  const { t, i18n: i18nInstance } = useTranslation();
  const [, setTick] = useState(0);
  const [hailing, setHailing] = useState(false);
  const [okfInfo, setOkfInfo] = useState(false);
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
      <AreaHeader onBack={onBack} title={t("settings.about")} />
      <div className="m-settings">
        <GroupCard>
          <RowList>
            <Row icon={<PlainvaLogo size={ICON.touch} />} onClick={logoTap} title="Plainva" />
            <Row
              end={<ChevronRight className="m-chevron" size={ICON.ui} />}
              onClick={exportDiagnostics}
              title={t("settings.exportDiagnostics")}
            />
            <Row
              end={<ChevronRight className="m-chevron" size={ICON.ui} />}
              onClick={() => setOkfInfo(true)}
              title={t("okfInfo.settingsButton")}
            />
          </RowList>
        </GroupCard>
      </div>

      {hailing && <HailingSheet onChanged={() => setTick((n) => n + 1)} onClose={() => setHailing(false)} />}

      {okfInfo && (
        <div className="m-sheet-backdrop" onClick={() => setOkfInfo(false)}>
          <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
            <SheetGrip onClose={() => setOkfInfo(false)} />
            <p className="m-sheet-title">{t("okfInfo.title")}</p>
            {/* Short here as well (E2): three sentences, then the handbook.
                The long version used to be four sections in a bottom sheet. */}
            <p className="m-hint">{t("okfInfo.short1")}</p>
            <p className="m-hint">{t("okfInfo.short2")}</p>
            <p className="m-hint">{t("okfInfo.short3")}</p>
            <Button
              variant="ghost"
              onClick={() => void Browser.open({ url: userGuideUrl("OKF.md") }).catch(() => undefined)}
            >
              {t("okfInfo.readMore")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
