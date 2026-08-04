import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import { APP_LANGUAGES, AVAILABLE_THEMES, clampContentFontSize, type ContentFontFamily, getWeekStartSetting, ICON, PlainvaLogo, Segmented, setWeekStartSetting, TextInput, type WeekStartSetting } from "@plainva/ui";
import { HailingSheet } from "../components/HailingSheet";
import { FrequencyChips } from "../components/FrequencyChips";
import { LCARS_VARIANTS } from "@plainva/ui";
import { mSelect } from "../services/mobileDialogs";
import {
  getMobileSettings,
  updateMobileSettings,
  type MotionPref,
  type ThemeMode,
} from "../services/mobileSettings";
import { AppBar } from "../components/AppBar";

/**
 * Appearance screen (M3E mockup 9): theme cards with three-stripe previews
 * (easter-egg themes gated + marked ✦), an inline mode segmented control,
 * the content font-size slider, the motion switch and the About row — whose
 * logo keeps the desktop's 5-tap hailing gesture, followed by the mockup's
 * deliberately cryptic hint.
 */
export function AppearanceScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(getMobileSettings());
  const [hailing, setHailing] = useState(false);
  const [weekStart, setWeekStart] = useState<WeekStartSetting>("monday");
  useEffect(() => {
    void getWeekStartSetting().then(setWeekStart);
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

  const [version, setVersion] = useState("");
  useEffect(() => {
    void import("@capacitor/app")
      .then(({ App }) => App.getInfo())
      .then((info) => setVersion(info.version))
      .catch(() => {});
  }, []);

  const update = (patch: Parameters<typeof updateMobileSettings>[0]) => {
    void updateMobileSettings(patch).then(() => setSettings(getMobileSettings()));
  };

  const MODES: Array<[ThemeMode, string]> = [
    ["system", t("mobile.themeSystem")],
    ["light", t("mobile.themeLight")],
    ["dark", t("mobile.themeDark")],
  ];
  /** The shared family choices; "custom" reveals a free-text name below. */
const FONT_FAMILIES = [
  ["theme", "settings.fontTheme"],
  ["serif", "settings.fontSerif"],
  ["sans", "settings.fontSans"],
  ["mono", "settings.fontMono"],
  ["custom", "settings.fontCustom"],
] as const;

const MOTIONS: Array<[MotionPref, string]> = [
    ["system", t("mobile.motionSystem")],
    ["on", t("mobile.motionOn")],
    ["off", t("mobile.motionOff")],
  ];

  // Language sits in the appearance area (desktop parity, redesign P4).
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

  return (
    <div className="m-page">
      <AppBar onBack={onBack} title={t("settings.sectionAppearance")} />

      <button className="m-row" onClick={pickLanguage}>
        <span>{t("mobile.settingLanguage")}</span>
        <span className="m-prop-val">{languageLabel(settings.language)}</span>
        <ChevronRight className="m-chevron" size={ICON.head} />
      </button>

      <p className="m-sectionlabel">{t("settings.theme")}</p>
      <div className="m-themegrid">
        {AVAILABLE_THEMES.filter((th) => !th.unlock || settings.unlockedThemes.includes(th.id)).map((th) => {
          const mode = th.modes.includes(
            document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light",
          )
            ? document.documentElement.getAttribute("data-theme") === "dark"
              ? ("dark" as const)
              : ("light" as const)
            : th.modes[0];
          const sw = th.swatch[mode]!;
          const active = (settings.themeName || "petrol") === th.id;
          return (
            <button
              className={active ? "pv-card pv-card--flush m-themecard is-on" : "pv-card pv-card--flush m-themecard"}
              key={th.id}
              onClick={() => update({ themeName: th.id })}
            >
              <span aria-hidden className="m-themeprev">
                <i style={{ background: sw.bg }} />
                <i style={{ background: sw.surface }} />
                <i style={{ background: sw.accent }} />
              </span>
              <span className="m-themename">
                {t(`themes.names.${th.id}`, { defaultValue: th.label })}
                {th.unlock ? " ✦" : ""}
              </span>
            </button>
          );
        })}
      </div>

      {settings.unlockedThemeVariants.length > 0 && (
        <>
          <p className="m-sectionlabel">
            {t("hailing.collection", {
              count: settings.unlockedThemeVariants.length,
              total: LCARS_VARIANTS.length,
            })}
          </p>
          <div className="m-freqrow">
            <FrequencyChips onChanged={() => setSettings(getMobileSettings())} />
          </div>
        </>
      )}

      <p className="m-sectionlabel">{t("mobile.settingTheme")}</p>
      <Segmented
        ariaLabel={t("mobile.settingTheme")}
        options={MODES.map(([id, label]) => ({ value: id, label }))}
        value={settings.themeMode}
        onChange={(v) => update({ themeMode: v as (typeof MODES)[number][0] })}
      />

      <p className="m-sectionlabel">{t("settings.contentFontSize")}</p>
      <div className="m-sliderrow">
        <span>{t("settings.contentFontSize")}</span>
        <span className="m-prop-val">{settings.contentFontSize} px</span>
      </div>
      <input
        aria-label={t("settings.contentFontSize")}
        className="m-slider"
        max={24}
        min={12}
        onChange={(e) => update({ contentFontSize: clampContentFontSize(Number(e.target.value)) })}
        step={1}
        type="range"
        value={settings.contentFontSize}
      />
      {/* Content font family (S39): the same choice the desktop has, resolved
          by the same shared stacks — "theme" leaves --font-content to the theme.
          The custom name is sanitized before it reaches CSS. */}
      <p className="m-sectionlabel">{t("settings.contentFontFamily")}</p>
      <Segmented
        ariaLabel={t("settings.contentFontFamily")}
        options={FONT_FAMILIES.map(([id, key]) => ({ value: id, label: t(key) }))}
        value={settings.contentFontFamily}
        onChange={(v) => update({ contentFontFamily: v as ContentFontFamily })}
      />
      {settings.contentFontFamily === "custom" && (
        <label className="m-field">
          <span>{t("settings.fontCustomPlaceholder")}</span>
          <TextInput
            onChange={(e) => update({ contentFontCustom: e.target.value })}
            value={settings.contentFontCustom}
          />
        </label>
      )}
      <p className="m-hint m-hint--inset">{t("settings.contentFontFamilyDesc")}</p>

      <div className="m-sliderrow">
        <span>{t("mobile.settingMotion")}</span>
      </div>
      <Segmented
        ariaLabel={t("mobile.settingMotion")}
        options={MOTIONS.map(([id, label]) => ({ value: id, label }))}
        value={settings.motion}
        onChange={(v) => update({ motion: v as (typeof MOTIONS)[number][0] })}
      />

      {/* First day of the week (S26): the same app-wide setting the desktop
          has, read from the same key — a vault whose week starts on Sunday
          must start on Sunday on both devices. */}
      <p className="m-sectionlabel">{t("settings.weekStart")}</p>
      <Segmented
        ariaLabel={t("settings.weekStart")}
        options={[
          { value: "monday", label: t("settings.weekStartMonday") },
          { value: "saturday", label: t("settings.weekStartSaturday") },
          { value: "sunday", label: t("settings.weekStartSunday") },
        ]}
        value={weekStart}
        onChange={(v) => {
          setWeekStart(v as WeekStartSetting);
          void setWeekStartSetting(v as WeekStartSetting);
        }}
      />
      <p className="m-hint m-hint--inset">{t("settings.weekStartDesc")}</p>

      {/* About (D5): the logo keeps the desktop's 5-tap gesture. */}
      <p className="m-sectionlabel">{t("settings.about")}</p>
      <button className="m-row m-row--static" onClick={logoTap}>
        <PlainvaLogo size={ICON.touch} />
        <span>Plainva</span>
        {version && <span className="m-prop-val">v{version}</span>}
      </button>
      <p className="m-hint m-hint--inset">{t("mobile.aboutTip")}</p>

      {hailing && <HailingSheet onChanged={() => setSettings(getMobileSettings())} onClose={() => setHailing(false)} />}
    </div>
  );
}
