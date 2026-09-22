import { useEffect } from "react";
import { dailyDayResolver, setDayBoundary, setPlaceProvider } from "@plainva/ui";
import { dailyNotesFolderKey, dailyNotesFormatKey, dayEndsAtKey, useVault } from "../contexts/VaultContext";
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
  const { vaultPath, queryService } = useVault();

  /**
   * Where this window can find a position (plan Journal-Erweiterungen, X7).
   * WebView2 and WebKitGTK answer `navigator.geolocation` themselves and ask
   * the user; a build without it registers nothing, and the button is absent.
   */
  useEffect(() => {
    const geo = typeof navigator === "undefined" ? undefined : navigator.geolocation;
    if (!geo?.getCurrentPosition) {
      setPlaceProvider(null);
      return;
    }
    setPlaceProvider(() => new Promise((resolve, reject) => {
      geo.getCurrentPosition(
        (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
        reject,
        { timeout: 15_000, maximumAge: 60_000 },
      );
    }));
    return () => setPlaceProvider(null);
  }, []);
  useEffect(() => {
    let alive = true;
    const read = () => {
      if (!vaultPath) {
        setDayBoundary(0);
        queryService?.setDayOfPath(null);
        return;
      }
      void (async () => {
        try {
          const store = await getSettingsStore();
          const minutes = await store.get<number>(dayEndsAtKey(vaultPath));
          if (alive) setDayBoundary(minutes ?? 0);
          // `file.day` (plan Journal-Erweiterungen, X8): the same two settings
          // that name a daily note tell a query which day its name stands for.
          const folder = (await store.get<string>(dailyNotesFolderKey(vaultPath))) ?? "";
          const format = (await store.get<string>(dailyNotesFormatKey(vaultPath))) ?? "YYYY-MM-DD";
          if (alive) queryService?.setDayOfPath(dailyDayResolver({ folder, format }));
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
  }, [vaultPath, queryService]);
}
