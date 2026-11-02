import { useEffect } from "react";
import { setVaultWeekStartScope, type WeekStartSetting } from "@plainva/ui";
import { getSettingsStore } from "./settingsStore";

/**
 * The week start of the vault a window shows (decision E4 of the bug-clearing
 * plan): kept beside the vault's other settings, under the key the settings
 * profile carries to the other devices (`weekStart` in `profileFields.ts`).
 * A vault without one follows the device's choice (`weekStart.ts` in the ui
 * package).
 */
export const weekStartKey = (vaultPath: string) => `calendarWeekStart_${btoa(unescape(encodeURIComponent(vaultPath)))}`;

/** Names the window's vault to the shared week start; every window root calls it with the vault it shows. */
export function useVaultWeekStart(vaultPath: string | null | undefined): void {
  useEffect(() => {
    if (!vaultPath) {
      setVaultWeekStartScope(null);
      return;
    }
    setVaultWeekStartScope({
      read: async () => (await getSettingsStore()).get<string>(weekStartKey(vaultPath)),
      write: async (value: WeekStartSetting) => {
        const store = await getSettingsStore();
        await store.set(weekStartKey(vaultPath), value);
        await store.save();
      },
    });
    return () => setVaultWeekStartScope(null);
  }, [vaultPath]);
}
