import { useEffect } from "react";
import { setDayBoundary } from "@plainva/ui";
import { dayEndsAtKey, useVault } from "../contexts/VaultContext";
import { getSettingsStore } from "../services/settingsStore";

/**
 * Publishes this vault's day boundary to the one place that answers "which day
 * is it" (plan Journal-Erweiterungen, X2).
 *
 * Every way into the journal would otherwise have to carry the setting down to
 * the call — a shortcut, the tray, the palette, the sidebar's pen. There is one
 * vault per window, so one value per window is the whole truth; this reads it
 * when the vault opens and again when settings are saved, and `journalToday()`
 * is right everywhere from then on.
 *
 * A vault without the setting, or a read that fails, means midnight — which is
 * what the app did before the boundary existed.
 */
export function useDayBoundary(): void {
  const { vaultPath } = useVault();
  useEffect(() => {
    let alive = true;
    const read = () => {
      if (!vaultPath) {
        setDayBoundary(0);
        return;
      }
      void (async () => {
        try {
          const store = await getSettingsStore();
          const minutes = await store.get<number>(dayEndsAtKey(vaultPath));
          if (alive) setDayBoundary(minutes ?? 0);
        } catch {
          if (alive) setDayBoundary(0);
        }
      })();
    };
    read();
    window.addEventListener("plainva-features-saved", read);
    return () => {
      alive = false;
      window.removeEventListener("plainva-features-saved", read);
    };
  }, [vaultPath]);
}
