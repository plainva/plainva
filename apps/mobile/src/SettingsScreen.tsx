import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Capacitor } from "@capacitor/core";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, FolderSearch } from "lucide-react";
import { listTemplates, formatDiagnosticsExport, APP_LANGUAGES, PlainvaLogo, TextInput } from "@plainva/ui";
import { FolderPickerSheet } from "./components/FolderPickerSheet";
import { HailingSheet } from "./components/HailingSheet";
import { mSelect } from "./services/mobileDialogs";
import {
  getMobileSettings,
  updateMobileSettings,
  type DefaultView,
} from "./services/mobileSettings";
import type { MobileVault } from "./services/vaultService";
import { MAX_TAB_SLOTS, sanitizeTabSlots, TAB_POOL, type TabScreenId } from "./navigation";

/**
 * Mobile settings (P1): language, theme mode, default note view and the
 * daily-notes folder. Values persist through the platform settings store
 * and apply immediately (desktop hybrid-save model: no save button).
 * R2.2 adds the tab-bar layout: up to four pool screens, ▲▼ reorder.
 * R3.3: choices open M3 selection sheets instead of native <select>s.
 */
export function SettingsScreen({
  vault,
  onBack,
  onOpenAppearance,
}: {
  vault: MobileVault;
  onBack: () => void;
  onOpenAppearance: () => void;
}) {
  const { t, i18n: i18nInstance } = useTranslation();
  const [settings, setSettings] = useState(getMobileSettings());
  // Folder picker target (R3.6): which path setting is being browsed.
  const [pickFor, setPickFor] = useState<"dailyFolder" | "inboxFolder" | "templateFolder" | null>(null);
  // Easter egg (D5): five taps on the About logo within 3 s open the
  // hailing-frequencies sheet — the desktop title-bar gesture, mobile-sized.
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

  const update = (patch: Parameters<typeof updateMobileSettings>[0]) => {
    void updateMobileSettings(patch).then(() => setSettings(getMobileSettings()));
  };

  const viewLabel = (view: DefaultView) =>
    t(view === "edit" ? "mobile.defaultViewEdit" : "mobile.defaultViewRead");
  const languageLabel = (code: string) =>
    code
      ? (APP_LANGUAGES.find((l) => l.code === code)?.nativeName ?? code)
      : t("mobile.settingLanguageSystem");

  const pickLanguage = () => {
    void mSelect({
      title: t("mobile.settingLanguage"),
      options: [
        { value: "", label: t("mobile.settingLanguageSystem") },
        ...APP_LANGUAGES.map((l) => ({ value: l.code, label: l.nativeName })),
      ],
      value: settings.language,
    }).then((v) => {
      if (v !== null) update({ language: v });
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

  // Snapshot retention (package G): three coarse pickers over the shared
  // BackupRetentionPolicy; the boot + the live listener apply them.
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

  const slots = sanitizeTabSlots(settings.tabSlots);
  const setSlots = (next: TabScreenId[]) => update({ tabSlots: next });
  const toggleSlot = (id: TabScreenId) => {
    if (slots.includes(id)) {
      if (slots.length > 1) setSlots(slots.filter((s) => s !== id));
    } else if (slots.length < MAX_TAB_SLOTS) {
      setSlots([...slots, id]);
    }
  };
  const moveSlot = (id: TabScreenId, delta: -1 | 1) => {
    const idx = slots.indexOf(id);
    const to = idx + delta;
    if (idx < 0 || to < 0 || to >= slots.length) return;
    const next = [...slots];
    next.splice(idx, 1);
    next.splice(to, 0, id);
    setSlots(next);
  };

  return (
    <div className="m-page">
      <header className="m-header">
        <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
          <ChevronLeft size={20} />
        </button>
        <h1>{t("mobile.sectionSettings")}</h1>
      </header>

      <SettingRow label={t("mobile.settingLanguage")} onClick={pickLanguage} value={languageLabel(settings.language)} />
      {/* Appearance moved to its own screen (M3E mockup 9). */}
      <button className="m-row" onClick={onOpenAppearance}>
        <span>{t("mobile.settingTheme")}</span>
        <ChevronRight className="m-chevron" size={18} />
      </button>
      <SettingRow
        label={t("mobile.settingDefaultView")}
        onClick={pickDefaultView}
        value={viewLabel(settings.defaultView)}
      />

      {/* Snapshot retention (package G) */}
      <p className="m-sectionlabel">{t("versions.title")}</p>
      <SettingRow
        label={t("settings.versionInterval")}
        onClick={pickBackupInterval}
        value={
          settings.backupIntervalSeconds === 0
            ? t("settings.versionIntervalEvery")
            : `${settings.backupIntervalSeconds / 60} min`
        }
      />
      <SettingRow
        label={t("settings.versionMaxCount")}
        onClick={pickBackupCount}
        value={String(settings.backupMaxPerFile)}
      />
      <SettingRow
        label={t("settings.versionMaxAge")}
        onClick={pickBackupAge}
        value={
          settings.backupMaxAgeDays === 0
            ? t("settings.versionAgeUnlimited")
            : t("settings.versionAgeDays", { days: settings.backupMaxAgeDays })
        }
      />

      {/* Configurable capture/daily/template folders (R3.6): free text plus
          a vault-internal folder picker on every field. */}
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
      <SettingRow
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

      <p className="m-sectionlabel">{t("mobile.settingTabs")}</p>
      <p className="m-hint">{t("mobile.settingTabsHint", { max: MAX_TAB_SLOTS })}</p>
      {/* Selected screens first (in bar order, with reorder arrows), then the rest. */}
      {[...slots.map((id) => TAB_POOL.find((p) => p.id === id)!), ...TAB_POOL.filter((p) => !slots.includes(p.id))].map(
        (def) => {
          const selected = slots.includes(def.id);
          const idx = slots.indexOf(def.id);
          const Icon = def.icon;
          return (
            <div className="m-row m-row--split" key={def.id}>
              <button
                aria-pressed={selected}
                className="m-row-main"
                onClick={() => toggleSlot(def.id)}
              >
                <Icon className={selected ? "m-accent" : "m-chevron"} size={18} />
                <span>{t(def.labelKey)}</span>
                <span className={`m-slotmark${selected ? " is-on" : ""}`} />
              </button>
              {selected && (
                <>
                  <button
                    aria-label={t("block.moveUp")}
                    className="m-iconbtn"
                    disabled={idx === 0}
                    onClick={() => moveSlot(def.id, -1)}
                  >
                    <ArrowUp size={18} />
                  </button>
                  <button
                    aria-label={t("block.moveDown")}
                    className="m-iconbtn"
                    disabled={idx === slots.length - 1}
                    onClick={() => moveSlot(def.id, 1)}
                  >
                    <ArrowDown size={18} />
                  </button>
                </>
              )}
            </div>
          );
        },
      )}

      {/* About (D5): the logo listens for the desktop's 5-tap gesture. */}
      <p className="m-sectionlabel">{t("settings.about")}</p>
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

      {hailing && <HailingSheet onChanged={() => setSettings(getMobileSettings())} onClose={() => setHailing(false)} />}

      {okfInfo && (
        <div className="m-sheet-backdrop" onClick={() => setOkfInfo(false)}>
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="m-sheet-grip" />
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

/** M3 one-line setting: label left, current value right, opens a sheet. */
function SettingRow({
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
