import { useCallback, useEffect, useState } from "react";
import { getSettingsStore } from "../services/settingsStore";
import {
  loadCommentNotificationSettings,
  saveCommentNotificationSettings,
  toggleMutedPath,
} from "../services/commentNotificationSettings";

/**
 * Whether this note is silenced, and a way to change it (Stufe F, F2).
 *
 * Its own hook rather than state in the column, because two surfaces ask the
 * same question - the column beside a note and, later, the phone's sheet - and
 * because the answer lives in the settings store rather than in the record.
 *
 * `null` for "notifications are off in this vault entirely": the column then
 * shows no bell at all. Offering to silence something that never speaks would
 * be a control with no effect, and the user would rightly read it as broken.
 */
export function useCommentMute(vaultPath: string | null, path: string | null): {
  muted: boolean | null;
  toggle: (() => void) | undefined;
} {
  const [muted, setMuted] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!path || !vaultPath) {
        if (alive) setMuted(null);
        return;
      }
      const store = await getSettingsStore();
      const settings = await loadCommentNotificationSettings(store, vaultPath);
      if (!alive) return;
      setMuted(settings.enabled ? settings.mutedPaths.includes(path) : null);
    })();
    return () => {
      alive = false;
    };
  }, [vaultPath, path]);

  const toggle = useCallback(() => {
    if (!path || !vaultPath) return;
    void (async () => {
      const store = await getSettingsStore();
      // Re-read rather than closing over the loaded copy: the settings page can
      // have changed the level or another note's mute in the meantime, and
      // writing a stale snapshot back would silently undo that.
      const settings = await loadCommentNotificationSettings(store, vaultPath);
      const next = toggleMutedPath(settings, path);
      await saveCommentNotificationSettings(store, vaultPath, next);
      setMuted(next.mutedPaths.includes(path));
    })();
  }, [vaultPath, path]);

  return { muted, toggle: muted === null ? undefined : toggle };
}
