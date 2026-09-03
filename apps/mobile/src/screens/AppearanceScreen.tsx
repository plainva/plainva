import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import { APP_LANGUAGES, AVAILABLE_THEMES, clampContentFontSize, getWeekStartSetting, GroupCard, ICON, PlainvaLogo, Row, RowList, SectionLabel, Segmented, SettingField, setWeekStartSetting, Switch, TextInput, type ContentFontFamily, type WeekStartSetting, FontCatalogPicker } from "@plainva/ui";
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

      <div className="m-settings">
        <GroupCard>
          <RowList>
            <Row
              end={<><span className="m-prop-val">{languageLabel(settings.language)}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
              onClick={pickLanguage}
              title={t("mobile.settingLanguage")}
            />
          </RowList>
        </GroupCard>

        <SectionLabel>{t("settings.theme")}</SectionLabel>
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
            <SectionLabel>{t("hailing.collection", {
                count: settings.unlockedThemeVariants.length,
                total: LCARS_VARIANTS.length,
              })}
            </SectionLabel>
            <div className="m-freqrow">
              <FrequencyChips onChanged={() => setSettings(getMobileSettings())} />
            </div>
          </>
        )}

        <SectionLabel>{t("mobile.settingTheme")}</SectionLabel>
        <Segmented
          ariaLabel={t("mobile.settingTheme")}
          options={MODES.map(([id, label]) => ({ value: id, label }))}
          value={settings.themeMode}
          onChange={(v) => update({ themeMode: v as (typeof MODES)[number][0] })}
        />

        {/* The heading carries the current value; a row underneath repeating the
            heading's own words was the second of the two slider rows this screen
            used as headings (feedback 2026-08-15, point 7). */}
        <SectionLabel end={`${settings.contentFontSize} px`}>{t("settings.contentFontSize")}</SectionLabel>
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
        <SectionLabel>{t("settings.contentFontFamily")}</SectionLabel>
        <Segmented
          ariaLabel={t("settings.contentFontFamily")}
          options={FONT_FAMILIES.map(([id, key]) => ({ value: id, label: t(key) }))}
          value={settings.contentFontFamily}
          onChange={(v) => update({ contentFontFamily: v as ContentFontFamily })}
        />
        {settings.contentFontFamily === "custom" && (
          /* The curated list first (T7): preview per row, "not installed"
             where the phone lacks the font. The name field stays below. */
          <FontCatalogPicker
            value={settings.contentFontCustom}
            onPick={(font) => update({ contentFontFamily: "custom", contentFontCustom: font.css })}
          />
        )}
        {settings.contentFontFamily === "custom" && (
          <GroupCard>
            <RowList>
              <SettingField label={t("settings.fontCustomPlaceholder")}>
                <TextInput
                  onChange={(e) => update({ contentFontCustom: e.target.value })}
                  value={settings.contentFontCustom}
                />
              </SettingField>
            </RowList>
          </GroupCard>
        )}
        <p className="m-hint">{t("settings.contentFontFamilyDesc")}</p>

        {/* A slider row is a label WITH a value; it was standing in for a heading
            here, which is why this one had no value to show. */}
        <SectionLabel>{t("mobile.settingMotion")}</SectionLabel>
        <Segmented
          ariaLabel={t("mobile.settingMotion")}
          options={MOTIONS.map(([id, label]) => ({ value: id, label }))}
          value={settings.motion}
          onChange={(v) => update({ motion: v as (typeof MOTIONS)[number][0] })}
        />

        {/* The third column (finding 2026-08-21). It only APPLIES from 1024 px,
            and the row says so rather than hiding on a phone: a setting that
            appears and disappears with the window is one nobody finds twice. */}
        <SectionLabel>{t("settings.layout")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row
              end={<Switch
                checked={settings.contextPanelDocked}
                label={t("settings.contextPanelDocked")}
                onChange={(next) => update({ contextPanelDocked: next })}
              />}
              title={t("settings.contextPanelDocked")}
            />
          </RowList>
        </GroupCard>
        <p className="m-hint">{t("settings.contextPanelDockedDesc")}</p>

        {/* First day of the week (S26): the same app-wide setting the desktop
            has, read from the same key — a vault whose week starts on Sunday
            must start on Sunday on both devices. */}
        <SectionLabel>{t("settings.weekStart")}</SectionLabel>
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
        <p className="m-hint">{t("settings.weekStartDesc")}</p>

        {/* About (D5): the logo keeps the desktop's 5-tap gesture. */}
        <SectionLabel>{t("settings.about")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row
              end={version ? <span className="m-prop-val">v{version}</span> : undefined}
              icon={<PlainvaLogo size={ICON.touch} />}
              onClick={logoTap}
              title="Plainva"
            />
          </RowList>
        </GroupCard>
        <p className="m-hint">{t("mobile.aboutTip")}</p>

      </div>

      {hailing && <HailingSheet onChanged={() => setSettings(getMobileSettings())} onClose={() => setHailing(false)} />}
    </div>
  );
}
