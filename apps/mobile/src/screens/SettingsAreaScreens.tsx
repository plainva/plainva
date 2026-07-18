import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Capacitor } from "@capacitor/core";
import { ChevronLeft, ChevronRight, FolderSearch } from "lucide-react";
import { SheetGrip } from "../components/SheetGrip";
import { FolderPickerSheet } from "../components/FolderPickerSheet";
import { HailingSheet } from "../components/HailingSheet";
import { listTemplates, formatDiagnosticsExport, PlainvaLogo, TextInput } from "@plainva/ui";
import { mSelect } from "../services/mobileDialogs";
import {
  getMobileSettings,
  updateMobileSettings,
  type DefaultView,
} from "../services/mobileSettings";
import type { MobileVault } from "../services/vaultService";

/**
 * Settings detail screens (redesign 2026-07-18, P4): the master list mirrors
 * the desktop's area catalog; each area pushes ONE of these screens. The
 * rows/pickers moved 1:1 from the old flat SettingsScreen — behavior and
 * persistence are unchanged, only the navigation is master→detail now.
 */

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
    <button className="m-row" onClick={onClick}>
      <span>{label}</span>
      <span className="m-prop-val">{value}</span>
      <ChevronRight className="m-chevron" size={18} />
    </button>
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
        <button aria-label={label} className="m-iconbtn" onClick={(e) => { e.preventDefault(); onPick(); }} type="button">
          <FolderSearch size={20} />
        </button>
      </span>
    </label>
  );
}

function AreaHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="m-header">
      <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
        <ChevronLeft size={20} />
      </button>
      <h1>{title}</h1>
    </header>
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
      <MobileSettingRow
        label={t("mobile.settingDefaultView")}
        onClick={pickDefaultView}
        value={viewLabel(settings.defaultView)}
      />
    </div>
  );
}

/** Content & structure: capture/daily/template folders + the daily template. */
export function ContentAreaScreen({ vault, onBack }: { vault: MobileVault; onBack: () => void }) {
  const { t } = useTranslation();
  const { settings, update } = useSettingsState();
  const [pickFor, setPickFor] = useState<"dailyFolder" | "inboxFolder" | "templateFolder" | null>(null);

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

  return (
    <div className="m-page">
      <AreaHeader onBack={onBack} title={t("settings.sectionContent")} />
      <p className="m-sectionlabel">{t("mobile.settingFolders")}</p>
      <div className="m-sync">
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
          label={t("mobile.settingTemplateFolder")}
          onChange={(v) => update({ templateFolder: v || "Templates" })}
          onPick={() => setPickFor("templateFolder")}
          value={settings.templateFolder}
        />
      </div>
      <MobileSettingRow
        label={t("settings.dailyNotesTemplate")}
        onClick={pickDailyTemplate}
        value={settings.dailyTemplate || "—"}
      />

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
      <p className="m-sectionlabel">{t("versions.title")}</p>
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
      <button className="m-row m-row--static" onClick={logoTap}>
        <PlainvaLogo size={22} />
        <span>Plainva</span>
      </button>
      <button className="m-row" onClick={exportDiagnostics}>
        <span>{t("settings.exportDiagnostics")}</span>
        <ChevronRight className="m-chevron" size={18} />
      </button>
      <button className="m-row" onClick={() => setOkfInfo(true)}>
        <span>{t("okfInfo.settingsButton")}</span>
        <ChevronRight className="m-chevron" size={18} />
      </button>

      {hailing && <HailingSheet onChanged={() => setTick((n) => n + 1)} onClose={() => setHailing(false)} />}

      {okfInfo && (
        <div className="m-sheet-backdrop" onClick={() => setOkfInfo(false)}>
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <SheetGrip onClose={() => setOkfInfo(false)} />
            <p className="m-sheet-title">{t("okfInfo.title")}</p>
            <p className="m-hint m-hint--inset">{t("okfInfo.intro")}</p>
            <p className="m-sectionlabel m-sectionlabel--inset">{t("okfInfo.whatTitle")}</p>
            <p className="m-hint m-hint--inset">{t("okfInfo.whatBody")}</p>
            <p className="m-sectionlabel m-sectionlabel--inset">{t("okfInfo.whyTitle")}</p>
            <p className="m-hint m-hint--inset">{t("okfInfo.whyBody")}</p>
            <p className="m-sectionlabel m-sectionlabel--inset">{t("okfInfo.obsidianTitle")}</p>
            <p className="m-hint m-hint--inset">{t("okfInfo.obsidianBody")}</p>
          </div>
        </div>
      )}
    </div>
  );
}
