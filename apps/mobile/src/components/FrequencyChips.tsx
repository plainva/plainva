import { useTranslation } from "react-i18next";
import { LCARS_VARIANTS } from "@plainva/ui";
import { getMobileSettings, updateMobileSettings } from "../services/mobileSettings";

/**
 * Collected LCARS frequency chips (D5): tap activates the variant (and the
 * LCARS theme). Shared between the hailing sheet and the appearance screen —
 * the appearance placement answers "how do I switch?" without spoiling the
 * easter egg (chips only exist once frequencies were collected).
 */
export function FrequencyChips({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation();
  const s = getMobileSettings();
  const collected = LCARS_VARIANTS.filter((v) => s.unlockedThemeVariants.includes(v.id));
  if (collected.length === 0) return null;
  return (
    <div className="m-hail-chips">
      {collected.map((v) => {
        const active = s.themeName === "lcars" && (s.themeVariants.lcars ?? "make-it-so") === v.id;
        return (
          <button
            className={active ? "m-chip is-on" : "m-chip"}
            key={v.id}
            onClick={() => {
              const cur = getMobileSettings();
              const themeBefore =
                cur.themeName === "lcars" || cur.themeName === "win95" ? cur.themeBefore : cur.themeName;
              void updateMobileSettings({
                themeBefore,
                themeName: "lcars",
                themeVariants: { ...cur.themeVariants, lcars: v.id },
              }).then(onChanged);
            }}
            style={{ borderColor: v.accent }}
          >
            <span className="m-hail-dot" style={{ background: v.accent }} />
            {t(`themes.variants.${v.id}`, { defaultValue: v.label })}
          </button>
        );
      })}
    </div>
  );
}
