import { useCallback, useEffect, useState } from "react";
import { getMobileSettings, updateMobileSettings } from "../services/mobileSettings";

/**
 * Whether this note is silenced, and a way to change it (Stufe F, F3).
 *
 * Mirrors the desktop hook of the same name, against the phone's settings
 * object rather than the desktop's store - same answer, same `null` meaning:
 * notifications are off for the vault entirely, so the sheet shows no bell.
 * Offering to silence something that never speaks is a control with no effect.
 */
export function useCommentMute(path: string | null): {
  muted: boolean | null;
  toggle: (() => void) | undefined;
} {
  const [muted, setMuted] = useState<boolean | null>(null);

  useEffect(() => {
    if (!path) {
      setMuted(null);
      return;
    }
    const settings = getMobileSettings();
    setMuted(settings.commentNotifyEnabled ? settings.commentNotifyMuted.includes(path) : null);
  }, [path]);

  const toggle = useCallback(() => {
    if (!path) return;
    void (async () => {
      // Re-read rather than closing over the loaded copy: the settings screen
      // may have changed the level or another note's mute in the meantime, and
      // writing a stale snapshot back would silently undo that.
      const current = getMobileSettings();
      const set = new Set(current.commentNotifyMuted);
      if (set.has(path)) set.delete(path);
      else set.add(path);
      const next = [...set].sort();
      await updateMobileSettings({ commentNotifyMuted: next });
      setMuted(next.includes(path));
    })();
  }, [path]);

  return { muted, toggle: muted === null ? undefined : toggle };
}
