import { useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { proposeCustomThemeMood, withCustomThemeMood, type CustomThemeDesign } from "../lib/customThemeDesign";
import type { CustomThemeMode, CustomThemeSpec } from "../lib/customTheme";
import { appliedTheme, onThemeApplied, setCustomThemePreview, type CustomThemePreview } from "../lib/themeRegistry";

export interface CustomThemePairOptions {
  /** Is the page on screen? Default true. The desktop keeps every settings
   * page mounted, so it passes whether "My theme" is the page being shown. */
  active?: boolean;
  /** Where the live preview goes — null when the page leaves. Default: the
   * theme registry, which repaints the whole app. */
  preview?: (preview: CustomThemePreview | null) => void;
}

/**
 * Shared draft boundary: an unadopted mood never reaches persisted appearance.
 *
 * And the live preview (plan Befunde 2026-09-24, E22): while the page is on
 * screen, the whole app shows the mood being edited — every switch of the
 * mood and every colour change repaints it, a proposal included — without
 * storing the "Mode" setting. When the page leaves (unmount, or `active`
 * turning false), the stored look returns. The editor starts on the mood the
 * app shows and follows it, until somebody switches.
 */
export function useCustomThemePair(design: CustomThemeDesign, onChange: (design: CustomThemeDesign) => void | Promise<void>, options: CustomThemePairOptions = {}) {
  const { active = true, preview = setCustomThemePreview } = options;
  const stored = useSyncExternalStore(onThemeApplied, appliedTheme, appliedTheme);
  const [mode, setModeState] = useState<CustomThemeMode>(stored.mode);
  const [picked, setPicked] = useState(false);
  // Start mood, derived during render so the first preview already paints the
  // right mood: coming on screen resets it to the mood the app shows; until
  // somebody switches, it follows that mood (a stored theme that arrives
  // late, System turning dark).
  const [anchor, setAnchor] = useState({ active, shown: stored.mode });
  if (anchor.active !== active || anchor.shown !== stored.mode) {
    const entering = active && !anchor.active;
    setAnchor({ active, shown: stored.mode });
    if (entering) setPicked(false);
    if ((entering || !picked) && mode !== stored.mode) setModeState(stored.mode);
  }
  const [drafts, setDrafts] = useState<Partial<Record<CustomThemeMode, CustomThemeSpec>>>({});
  const [saveFailed, setSaveFailed] = useState(false);
  const pending = design[mode] === null;
  const proposal = useMemo(() => proposeCustomThemeMood(design, mode), [design, mode]);
  const spec = design[mode] ?? drafts[mode] ?? proposal;
  // Before paint, so a switch never flashes the previous mood.
  useLayoutEffect(() => {
    if (active) preview({ mode, spec });
  }, [active, mode, spec, preview]);
  useLayoutEffect(() => {
    if (!active) return undefined;
    return () => preview(null);
  }, [active, preview]);
  const commit = async (next: CustomThemeSpec) => {
    setSaveFailed(false);
    try { await onChange(withCustomThemeMood(design, next)); }
    catch { setSaveFailed(true); }
  };
  const update = (next: CustomThemeSpec) => {
    if (design[next.mode]) void commit(next);
    else setDrafts(current => ({ ...current, [next.mode]: next }));
  };
  const setMode = (next: CustomThemeMode) => { setPicked(true); setModeState(next); };
  return {
    mode, setMode, spec, pending, saveFailed, update, adopt: () => { void commit(spec); },
    /** The look the app returns to when the page leaves — for the preview banner. */
    stored,
  };
}
