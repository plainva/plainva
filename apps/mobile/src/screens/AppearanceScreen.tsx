import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Pencil } from "lucide-react";
import { LinkStylePreview, NOTE_LINK_STYLES, WEB_LINK_STYLES, readNoteLinkStyle, readWebLinkStyle } from "@plainva/ui";
import { APP_LANGUAGES, AVAILABLE_THEMES, clampContentFontSize, getWeekStartSetting, GroupCard, ICON, Row, RowList, SectionLabel, Segmented, SettingField, setWeekStartSetting, Switch, type FontChoice, type FontSlot, type WeekStartSetting, CUSTOM_THEME_ID, themesWithCustom, IconButton } from "@plainva/ui";
import { FontSlotSheet } from "../components/FontSlotSheet";
import { FrequencyChips } from "../components/FrequencyChips";
import { LCARS_VARIANTS } from "@plainva/ui";
import { getThemeDef, pinnedModeHintKey } from "@plainva/ui";
import { mSelect } from "../services/mobileDialogs";
import {
  type MotionPref,
  type ThemeMode,
} from "../services/mobileSettings";
import { AppBar } from "../components/AppBar";
import { useSettingsState } from "../hooks/useSettingsState";

/**
 * Appearance screen (M3E mockup 9): theme cards with three-stripe previews
 * (easter-egg themes gated + marked ✦) and the mode, the fonts, language and
 * region, display, links and tags — the desktop page's five groups (settings
 * plan 2026-10-29, appendix 2.1). The logo with its 5-tap hailing gesture
 * lives on About & diagnostics.
 */
export function AppearanceScreen({ onBack, onEditCustomTheme }: { onBack: () => void; onEditCustomTheme: () => void }) {
  const { t } = useTranslation();
  // The one optimistic settings hook (E23): the size slider snapped back while
  // its save was in flight.
  const { settings, update, refresh } = useSettingsState();
  const [fontSheet, setFontSheet] = useState<FontSlot | null>(null);
  /** What the row says: the custom name, or the words for a preset/theme. */
  const fontChoiceLabel = (c: FontChoice): string =>
    c.family === "custom" ? c.customName || t("settings.fontFieldEmpty") : t(`settings.font${c.family.charAt(0).toUpperCase()}${c.family.slice(1)}`);
  const [weekStart, setWeekStart] = useState<WeekStartSetting>("monday");
  useEffect(() => {
    void getWeekStartSetting().then(setWeekStart);
  }, []);
  const pinnedHint = pinnedModeHintKey(settings.themeName);
  const MODES: Array<[ThemeMode, string]> = [
    ["system", t("mobile.themeSystem")],
    ["light", t("mobile.themeLight")],
    ["dark", t("mobile.themeDark")],
  ];
  /** The shared family choices; "custom" reveals a free-text name below. */
/** One row per font slot: label key, and the two settings keys it reads. */
const FONT_SLOT_ROWS = [
  ["ui", "settings.fontUi", "uiFontFamily", "uiFontCustom"],
  ["content", "settings.fontContent", "contentFontFamily", "contentFontCustom"],
  ["code", "settings.fontCode", "codeFontFamily", "codeFontCustom"],
] as const;

const LINK_STYLE_LABEL: Record<string, string> = {
  underline: "settings.linkStyleUnderline",
  tint: "settings.linkStyleTint",
  color: "settings.linkStyleColor",
  subtle: "settings.linkStyleSubtle",
};

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
        {/* The same five groups as the desktop page (settings plan 2026-10-29,
            appendix 2.1 B3/B4): Design, Fonts, Language & region, Display,
            Links & tags. Eleven headings used to stand here, most over a single
            row. The place stamp went to Editor & notes › Journal, the logo with
            its hint to About & diagnostics (B5). */}
        <SectionLabel>{t("settings.groupDesign")}</SectionLabel>
        <div className="m-themegrid">
          {themesWithCustom(AVAILABLE_THEMES.filter((th) => !th.unlock || settings.unlockedThemes.includes(th.id)), settings.customTheme).map((th) => {
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
              <div className="m-themecard-wrap" key={th.id}>
              <button
                className={active ? "pv-card pv-card--flush m-themecard is-on" : "pv-card pv-card--flush m-themecard"}
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
              {/* The pencil (A2): a sibling of the card, opens "Mein Design";
                  selects the theme first when another one is active. */}
              {th.id === CUSTOM_THEME_ID && (
                <IconButton
                  size="sm"
                  className="m-themecard-edit"
                  label={t("settings.customThemeEdit")}
                  data-testid="theme-card-custom-edit"
                  onClick={() => { if (!active) update({ themeName: CUSTOM_THEME_ID }); onEditCustomTheme(); }}
                >
                  <Pencil size={ICON.meta} aria-hidden="true" />
                </IconButton>
              )}
              </div>
            );
          })}
        </div>
        {/* The mode is a row of the Design group, as on the desktop ("Mode"). A
            one-mode theme pins it: the choice shows the pinned mode and says
            why, like the desktop's locked select — a tap on the other mode used
            to do nothing without a word (plan Befunde 2026-09-24, E22). */}
        <GroupCard>
          <RowList>
            <SettingField
              isStatic
              label={t("settings.themeMode")}
              hint={pinnedHint ? <span data-testid="theme-mode-pinned">{t(pinnedHint)}</span> : undefined}
            >
              <Segmented
                ariaLabel={t("settings.themeMode")}
                options={MODES.map(([id, label]) => ({ value: id, label }))}
                value={pinnedHint ? (getThemeDef(settings.themeName)?.modes[0] ?? settings.themeMode) : settings.themeMode}
                onChange={(v) => update({ themeMode: v as (typeof MODES)[number][0] })}
                disabled={!!pinnedHint}
              />
            </SettingField>
          </RowList>
        </GroupCard>

        {settings.unlockedThemeVariants.length > 0 && (
          <>
            <SectionLabel>{t("hailing.collection", {
                count: settings.unlockedThemeVariants.length,
                total: LCARS_VARIANTS.length,
              })}
            </SectionLabel>
            <div className="m-freqrow">
              <FrequencyChips onChanged={refresh} />
            </div>
          </>
        )}

        {/* The three font slots (issue #82, plan 2026-09-06 P2): interface,
            content, code — each a row that opens its sheet with the theme's
            font, the generic presets, the catalogue and a free name — and the
            content size, the same four values the desktop's card has. Why
            fonts belong to the device is behind the group's ⓘ. */}
        <SectionLabel info={t("settings.fontsDeviceHint")}>{t("settings.groupFonts")}</SectionLabel>
        <GroupCard>
          <RowList>
            {FONT_SLOT_ROWS.map(([slot, labelKey, familyKey, customKey]) => (
              <Row
                key={slot}
                title={t(labelKey)}
                end={<><span className="m-prop-val">{fontChoiceLabel({ family: settings[familyKey], customName: settings[customKey] })}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
                onClick={() => setFontSheet(slot)}
                data-testid={`font-slot-${slot}`}
              />
            ))}
            <SettingField
              label={t("settings.contentFontSize")}
              info={t("settings.contentFontSizeDesc")}
              action={<span className="m-prop-val">{settings.contentFontSize} px</span>}
            >
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
            </SettingField>
          </RowList>
        </GroupCard>

        {/* Language sits in the appearance area (desktop parity, redesign P4);
            the first day of the week (S26) beside it — the same app-wide
            setting the desktop has, read from the same key. */}
        <SectionLabel>{t("settings.groupLanguageRegion")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row
              end={<><span className="m-prop-val">{languageLabel(settings.language)}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
              onClick={pickLanguage}
              title={t("mobile.settingLanguage")}
            />
            <SettingField isStatic label={t("settings.weekStart")} info={t("settings.weekStartDesc")}>
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
            </SettingField>
          </RowList>
        </GroupCard>

        {/* Display: motion, and the third column (finding 2026-08-21). The
            column only APPLIES from 1024 px, and the row says so rather than
            hiding on a phone: a setting that appears and disappears with the
            window is one nobody finds twice. Density and interface zoom are
            desktop-only by decision (parity catalog density-mode, ui-zoom). */}
        <SectionLabel>{t("settings.groupDisplay")}</SectionLabel>
        <GroupCard>
          <RowList>
            <SettingField isStatic label={t("mobile.settingMotion")}>
              <Segmented
                ariaLabel={t("mobile.settingMotion")}
                options={MOTIONS.map(([id, label]) => ({ value: id, label }))}
                value={settings.motion}
                onChange={(v) => update({ motion: v as (typeof MOTIONS)[number][0] })}
              />
            </SettingField>
            <Row
              end={<Switch
                checked={settings.contextPanelDocked}
                label={t("settings.contextPanelDocked")}
                onChange={(next) => update({ contextPanelDocked: next })}
              />}
              title={t("settings.contextPanelDocked")}
              subtitle={t("settings.contextPanelDockedWidth")}
              info={t("settings.contextPanelDockedDesc")}
              wrap
            />
          </RowList>
        </GroupCard>

        {/* Links & tags (maintainer, 2026-10-23; finding 2026-09-19): the same
            choices as on the desktop, with the sentence that shows them as
            notes draw them. Rows with a choice sheet, like the font slots: four
            words do not fit a segmented bar at phone width. */}
        <SectionLabel>{t("settings.groupLinksTags")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row
              title={t("settings.noteLinkStyle")}
              info={t("settings.noteLinkStyleDesc")}
              end={<><span className="m-prop-val">{t(LINK_STYLE_LABEL[readNoteLinkStyle(settings.noteLinkStyle)])}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
              onClick={() => {
                void mSelect({
                  title: t("settings.noteLinkStyle"),
                  message: t("settings.noteLinkStyleDesc"),
                  options: NOTE_LINK_STYLES.map((style) => ({ value: style, label: t(LINK_STYLE_LABEL[style]) })),
                  value: readNoteLinkStyle(settings.noteLinkStyle),
                }).then((v) => { if (v !== null) update({ noteLinkStyle: readNoteLinkStyle(v) }); });
              }}
              data-testid="note-link-style"
            />
            <Row
              title={t("settings.webLinkStyle")}
              end={<><span className="m-prop-val">{t(LINK_STYLE_LABEL[readWebLinkStyle(settings.webLinkStyle)])}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
              onClick={() => {
                void mSelect({
                  title: t("settings.webLinkStyle"),
                  options: WEB_LINK_STYLES.map((style) => ({ value: style, label: t(LINK_STYLE_LABEL[style]) })),
                  value: readWebLinkStyle(settings.webLinkStyle),
                }).then((v) => { if (v !== null) update({ webLinkStyle: readWebLinkStyle(v) }); });
              }}
              data-testid="web-link-style"
            />
          </RowList>
          <LinkStylePreview className="m-link-preview" />
          <RowList>
            {/* The pill is always there; this only decides about colour. */}
            <Row
              end={<Switch
                checked={settings.tagColors === true}
                label={t("settings.tagColors")}
                onChange={(next) => update({ tagColors: next })}
              />}
              title={t("settings.tagColors")}
              info={t("settings.tagColorsDesc")}
            />
          </RowList>
        </GroupCard>
      </div>

      {fontSheet && (
        <FontSlotSheet
          slot={fontSheet}
          title={t(FONT_SLOT_ROWS.find((r) => r[0] === fontSheet)![1])}
          value={{ family: settings[FONT_SLOT_ROWS.find((r) => r[0] === fontSheet)![2]], customName: settings[FONT_SLOT_ROWS.find((r) => r[0] === fontSheet)![3]] }}
          onPick={(choice) => {
            const row = FONT_SLOT_ROWS.find((r) => r[0] === fontSheet)!;
            update({ [row[2]]: choice.family, [row[3]]: choice.customName });
            setFontSheet(null);
          }}
          onClose={() => setFontSheet(null)}
        />
      )}
    </div>
  );
}
