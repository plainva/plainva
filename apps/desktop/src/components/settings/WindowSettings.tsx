import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingCard, SettingRow, Switch } from "@plainva/ui";
import { getRestoreWindowsSetting, setRestoreWindowsSetting } from "../../services/windowManager";

/**
 * Windows — Settings → Startup & behavior (multi-window P4/E5).
 *
 * One switch, on by default: a window arrangement is something the user built,
 * and dropping it on every start would make the whole feature feel accidental.
 * Off is the escape hatch for a clean single window every morning.
 *
 * Compose windows are never restored, whatever this says: what they hold is
 * unsaved text that lives in memory, and reopening one would produce an empty
 * composer that claims to have kept something.
 */
export function WindowSettings() {
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
    <SettingCard label={t("window.settingsGroup")}>
      <SettingRow label={t("window.restoreWindows")} desc={t("window.restoreWindowsDesc")}>
        <Switch checked={restore} onChange={toggle} label={t("window.restoreWindows")} />
      </SettingRow>
    </SettingCard>
  );
}
