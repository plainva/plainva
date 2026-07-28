import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getLatestWhatsNew } from "@plainva/ui";
import { Browser } from "@capacitor/browser";
import { SheetGrip } from "./SheetGrip";
import { mobileAppVersion } from "../services/mobileWhatsNew";

/**
 * Release highlights and the first-start welcome (H5).
 *
 * The desktop has shown both since 0.5.0 and put ~100 translated keys per
 * language into the SHARED bundle — the mobile app carried them as dead weight
 * and told its users nothing. Same texts, phone shape: a bottom sheet.
 *
 * Two states, one component, because they differ only in their words: someone
 * opening Plainva for the first time gets the welcome, someone whose app just
 * updated gets what changed.
 */
export function WhatsNewSheet({ firstRun, onClose }: { firstRun: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const latest = getLatestWhatsNew();

  // Name the version this phone runs, not the catalog's: the shells ship on
  // separate version lines (0.5.13 here while the desktop released 0.5.1), and
  // announcing a number nobody installed reads like a bug. Catalog as fallback.
  const [version, setVersion] = useState(latest.version);
  useEffect(() => {
    let cancelled = false;
    void mobileAppVersion().then((v) => {
      if (!cancelled) setVersion(v);
    });
    return () => { cancelled = true; };
  }, []);

  const points = firstRun
    ? [t("firstRun.point1"), t("firstRun.point2"), t("firstRun.point3")]
    : Array.from({ length: latest.highlightCount }, (_, i) => t(`whatsNew.highlight${i + 1}`, { defaultValue: "" })).filter(Boolean);

  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="m-sheet" data-testid="whats-new-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{firstRun ? t("firstRun.title") : t("whatsNew.title", { version })}</p>
        <p className="m-hint">{firstRun ? t("firstRun.intro") : t("whatsNew.subtitle")}</p>
        <ul className="m-bullets">
          {points.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
        {!firstRun && latest.blogUrl && (
          <button
            className="m-btn m-btn--ghost"
            onClick={() => void Browser.open({ url: latest.blogUrl! }).catch(() => undefined)}
          >
            {t("whatsNew.readBlog")}
          </button>
        )}
        <button className="m-btn m-btn--filled" onClick={onClose}>
          {firstRun ? t("firstRun.start") : t("whatsNew.understand")}
        </button>
      </div>
    </div>
  );
}
