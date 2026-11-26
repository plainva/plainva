import type { DesktopAiReport } from "./DesktopAiHost";

const nothing = () => undefined;

/**
 * The AI as the shell reads it before its host is loaded (performance plan L5): off, no session, nothing open —
 * exactly what the harness reports while the switch is off, so every surface the shell gates on `enabled` stays
 * away. The doors are empty; none of them is reachable while `enabled` is false.
 */
export const DESKTOP_AI_ABSENT: DesktopAiReport = {
  ai: {
    session: null,
    enabled: false,
    placement: "dock",
    companionOpen: false,
    dockOpen: false,
    openCompanion: nothing,
    closeCompanion: nothing,
    stowDock: nothing,
    openInDock: nothing,
    toggleCompanion: nothing,
    popOut: nothing,
    dock: nothing,
    runSkill: nothing,
    skills: [],
    openAsTab: nothing,
    openNoteTarget: nothing,
    openUrl: nothing,
    activeNote: null,
    commandSourceRef: { current: null },
  },
  embeddings: null,
  gists: null,
  waiting: 0,
  attention: false,
};

/** Whether two reports carry the same values: the host reports after every render, the shell re-renders on a change only. */
export function sameAiReport(a: DesktopAiReport, b: DesktopAiReport): boolean {
  if (a.embeddings !== b.embeddings || a.gists !== b.gists || a.waiting !== b.waiting || a.attention !== b.attention) return false;
  const keys = Object.keys(a.ai) as (keyof DesktopAiReport["ai"])[];
  return keys.length === Object.keys(b.ai).length && keys.every((key) => Object.is(a.ai[key], b.ai[key]));
}
