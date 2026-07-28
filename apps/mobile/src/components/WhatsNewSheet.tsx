import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getLatestWhatsNew, WhatsNewIcon } from "@plainva/ui";
import { Browser } from "@capacitor/browser";
import { SheetGrip } from "./SheetGrip";
import { mobileAppVersion } from "../services/mobileWhatsNew";

/**
 * Release highlights on the phone (H5).
 *
 * Same catalog and same words as the desktop, phone shape: a bottom sheet with
 * the lead highlight first and the rest as icon rows.
 *
 * It used to carry a second `firstRun` branch as well — a welcome that could
 * only ever appear directly AFTER the mobile onboarding screen, which is itself
 * a welcome (BS5). Two in a row is one too many; the onboarding is the first
 * start here, and this sheet is only ever what changed.
 */
export function WhatsNewSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const latest = getLatestWhatsNew();

  // Name the version this phone runs, not the catalog's: the shells ship on
  // separate version lines (0.5.13 here while the desktop released 0.5.1), and
  // announcing a number nobody installed reads like a bug. Catalog as fallback.
  const [version, setVersion] = useState(latest.version);
  useEffect(() => {
    void mobileAppVersion().then(setVersion);
  }, []);

  const items = latest.highlights.map((h, i) => ({
    ...h,
    title: t(`whatsNew.highlight${i + 1}Title`, { defaultValue: "" }),
    text: t(`whatsNew.highlight${i + 1}`, { defaultValue: "" }),
  }));

  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="m-sheet" data-testid="whats-new-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("whatsNew.title", { version })}</p>
        <div className="m-wn-list">
          {items.map((h, i) => (
            <div key={i} className={i === 0 ? "m-wn m-wn--lead" : "m-wn"}>
              <span className="m-wn-ic" aria-hidden="true">
                <WhatsNewIcon name={h.icon} size={i === 0 ? 22 : 18} />
              </span>
              <span>
                <span className="m-wn-ttl">
                  {h.title}
                  {h.experimental && <span className="m-wn-exp">{t("whatsNew.experimental")}</span>}
                </span>
                <span className="m-wn-ds">{h.text}</span>
              </span>
            </div>
          ))}
        </div>
        {latest.blogUrl && (
          <button
            className="m-btn m-btn--ghost"
            onClick={() => void Browser.open({ url: latest.blogUrl! }).catch(() => undefined)}
          >
            {t("whatsNew.readBlog")}
          </button>
        )}
        <button className="m-btn m-btn--filled" onClick={onClose}>
          {t("whatsNew.understand")}
        </button>
      </div>
    </div>
  );
}
