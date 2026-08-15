import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Capacitor } from "@capacitor/core";
import { ChevronRight, FolderSearch } from "lucide-react";
import { SheetGrip } from "../components/SheetGrip";
import { FolderPickerSheet } from "../components/FolderPickerSheet";
import { HailingSheet } from "../components/HailingSheet";
import { Button, createTaskDatabase, formatDiagnosticsExport, GroupCard, ICON, IconButton, listTemplates, PlainvaLogo, Row, RowList, SectionLabel, Switch, TextInput, userGuideUrl } from "@plainva/ui";
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

/** Path setting: free-text field plus the vault-internal folder picker. */
function FolderField({
  label,
  value,
  onChange,
  onPick,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onPick: () => void;
}) {
  return (
    <label className="m-field">
      <span>{label}</span>
      <span className="m-field-row">
        <TextInput onChange={(e) => onChange(e.target.value.trim())} value={value} />
        <IconButton label={label} onClick={(e) => { e.preventDefault(); onPick(); }}>
          <FolderSearch size={ICON.head} />
        </IconButton>
      </span>
    </label>
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
      <p className="m-hint">{t("settings.askBeforeCreateLinkDesc")}</p>
    </div>
  );
}

/** Content & structure: capture/daily/template folders + the daily template. */
export function ContentAreaScreen({ vault, onBack }: { vault: MobileVault; onBack: () => void }) {
  const { t } = useTranslation();
  const { settings, update } = useSettingsState();
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
      <SectionLabel>{t("mobile.settingFolders")}</SectionLabel>
      <div className="m-settings">
        <FolderField
          label={t("mobile.settingDailyFolder")}
          onChange={(v) => update({ dailyFolder: v || "Daily" })}
          onPick={() => setPickFor("dailyFolder")}
          value={settings.dailyFolder}
        />
        <FolderField
          label={t("mobile.settingInboxFolder")}
          onChange={(v) => update({ inboxFolder: v || "Inbox" })}
          onPick={() => setPickFor("inboxFolder")}
          value={settings.inboxFolder}
        />
        <FolderField
          label={t("settings.attachmentFolder")}
          onChange={(v) => update({ attachmentFolder: v })}
          onPick={() => setPickFor("attachmentFolder")}
          value={settings.attachmentFolder}
        />
        <FolderField
          label={t("mobile.settingTemplateFolder")}
          onChange={(v) => update({ templateFolder: v || "Templates" })}
          onPick={() => setPickFor("templateFolder")}
          value={settings.templateFolder}
        />
      </div>
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
          but nothing here could read or change it. */}
      <SectionLabel>{t("settings.dailyNotes")}</SectionLabel>
      <label className="m-field">
        <span>{t("settings.dailyNotesFormat")}</span>
        <TextInput
          onChange={(e) => update({ dailyFormat: e.target.value })}
          value={settings.dailyFormat}
        />
      </label>
      <p className="m-hint">{t("settings.dailyNotesFormatDesc")}</p>
      <label className="m-field">
        <span>{t("settings.dailyNoteType")}</span>
        <TextInput
          onChange={(e) => update({ dailyNoteType: e.target.value })}
          value={settings.dailyNoteType}
        />
      </label>
      <label className="m-field">
        <span>{t("settings.defaultNoteType")}</span>
        <TextInput
          onChange={(e) => update({ defaultNoteType: e.target.value })}
          value={settings.defaultNoteType}
        />
      </label>
      <p className="m-hint">{t("settings.defaultNoteTypeDesc")}</p>

      <TemplateRules onChange={update} settings={settings} vault={vault} />

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
