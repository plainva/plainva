import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { getMobileSettings, updateMobileSettings, type MobileSettings } from "../services/mobileSettings";

type SettingsPatch = Parameters<typeof updateMobileSettings>[0];

/**
 * The settings a screen shows and changes — ONE hook, optimistic (TestFlight
 * finding 2026-09-22, E23).
 *
 * Three screens kept their own copy of `useState(getMobileSettings())` plus an
 * `update` that set the state only AFTER the asynchronous save. Until then the
 * screen rendered the old value: a slider snapped back under the thumb and a
 * text field lost its caret. Since `881fdceb` the cache itself only changes
 * after the store acknowledged the write, so the lag became visible.
 *
 * Here a change shows at once. Patches still in flight lie ON TOP of what is
 * stored, so a slider dragged across five values does not flicker back through
 * the acknowledgements of the first four; a patch that fails drops out — the
 * screen falls back to the stored value — and says so. Changes from elsewhere
 * (settings sync, another screen) arrive through `m-settings-changed`.
 */
export function useSettingsState(): {
  settings: MobileSettings;
  update: (patch: SettingsPatch) => Promise<void>;
  /** Re-reads the store — for a child that saved on its own. */
  refresh: () => void;
} {
  const pending = useRef<Array<{ id: number; patch: Partial<MobileSettings> }>>([]);
  const seq = useRef(0);
  const view = useCallback(
    (): MobileSettings => pending.current.reduce<MobileSettings>((shown, p) => ({ ...shown, ...p.patch }), getMobileSettings()),
    [],
  );
  const [settings, setSettings] = useState(() => getMobileSettings());

  useEffect(() => {
    const changed = () => setSettings(view());
    window.addEventListener("m-settings-changed", changed);
    return () => window.removeEventListener("m-settings-changed", changed);
  }, [view]);

  const update = useCallback((patch: SettingsPatch): Promise<void> => {
    const id = ++seq.current;
    // A custom theme is validated and parsed by the store; it is shown once it
    // is stored, never as the raw spec a caller handed in.
    const { customTheme: _theme, ...shown } = patch;
    pending.current = [...pending.current, { id, patch: shown }];
    setSettings(view());
    return updateMobileSettings(patch)
      .catch((error: unknown) => {
        console.error("settings save failed", error);
        toast.error(i18n.t("mobile.settingSaveFailed"));
      })
      .finally(() => {
        pending.current = pending.current.filter((p) => p.id !== id);
        setSettings(view());
      });
  }, [view]);

  const refresh = useCallback(() => setSettings(view()), [view]);
  return { settings, update, refresh };
}
