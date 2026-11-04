import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingRow, Switch } from "@plainva/ui";
import { getRestoreWindowsSetting, setRestoreWindowsSetting } from "../../services/windowManager";

/**
 * Restore the window layout — a row of Settings → Startup & behavior → Startup
 * (multi-window P4/E5; the card "Windows" held this one row and joined
 * "Startup", settings plan 2026-10-29, appendix 2.4 B1).
 *
 * One switch, on by default: a window arrangement is something the user built,
 * and dropping it on every start would make the whole feature feel accidental.
 * Off is the escape hatch for a clean single window every morning.
 *
 * Compose windows are never restored, whatever this says: what they hold is
 * unsaved text that lives in memory, and reopening one would produce an empty
 * composer that claims to have kept something. That consequence stays visible
 * under the switch; what the switch does is behind its ⓘ.
 */
export function WindowRestoreRow() {
  const { t } = useTranslation();
  const [restore, setRestore] = useState(true);

  useEffect(() => {
    let alive = true;
    void getRestoreWindowsSetting().then((v) => {
      if (alive) setRestore(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  const toggle = useCallback((on: boolean) => {
    setRestore(on);
    void setRestoreWindowsSetting(on).catch((e) => {
      console.warn("[WindowSettings] could not persist the window restore setting", e);
    });
  }, []);

  return (
    <SettingRow label={t("window.restoreWindows")} desc={t("window.restoreWindowsDrafts")} info={t("window.restoreWindowsDesc")}>
      <Switch checked={restore} onChange={toggle} label={t("window.restoreWindows")} />
    </SettingRow>
  );
}
