import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft } from "lucide-react";
import { AVAILABLE_THEMES, clampContentFontSize, PlainvaLogo } from "@plainva/ui";
import { HailingSheet } from "../components/HailingSheet";
import {
  getMobileSettings,
  updateMobileSettings,
  type MotionPref,
  type ThemeMode,
} from "../services/mobileSettings";

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
  const MOTIONS: Array<[MotionPref, string]> = [
    ["system", t("mobile.motionSystem")],
    ["on", t("mobile.motionOn")],
    ["off", t("mobile.motionOff")],
  ];

  return (
    <div className="m-page">
      <header className="m-header">
        <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
          <ChevronLeft size={20} />
        </button>
        <h1>{t("mobile.settingTheme")}</h1>
      </header>

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
              className={active ? "m-themecard is-on" : "m-themecard"}
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

      <p className="m-sectionlabel">{t("mobile.settingTheme")}</p>
      <div className="m-seg m-seg--inset">
        {MODES.map(([id, label]) => (
          <button
            className={settings.themeMode === id ? "m-seg-item is-on" : "m-seg-item"}
            key={id}
            onClick={() => update({ themeMode: id })}
          >
            {label}
          </button>
        ))}
      </div>

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
      <div className="m-sliderrow">
        <span>{t("mobile.settingMotion")}</span>
      </div>
      <div className="m-seg m-seg--inset">
        {MOTIONS.map(([id, label]) => (
          <button
            className={settings.motion === id ? "m-seg-item is-on" : "m-seg-item"}
            key={id}
            onClick={() => update({ motion: id })}
          >
            {label}
          </button>
        ))}
      </div>

      {/* About (D5): the logo keeps the desktop's 5-tap gesture. */}
      <p className="m-sectionlabel">{t("settings.about")}</p>
      <button className="m-row m-row--static" onClick={logoTap}>
        <PlainvaLogo size={22} />
        <span>Plainva</span>
        {version && <span className="m-prop-val">v{version}</span>}
      </button>
      <p className="m-hint m-hint--inset">{t("mobile.aboutTip")}</p>

      {hailing && <HailingSheet onChanged={() => setSettings(getMobileSettings())} onClose={() => setHailing(false)} />}
    </div>
  );
}
