import { createElement, useLayoutEffect } from "react";
import { useMobileAi } from "../services/ai/mobileAi";
import type { MobileVault } from "../services/vaultService";
import { AiBadgeCount } from "./AiBadgeCount";

/** What the shell reads of the AI: the harness's hook. */
export interface MobileAiReport {
  ai: ReturnType<typeof useMobileAi>;
}

/**
 * The phone's AI as a part of its own (performance plan L5): the shell mounts it once the AI was asked for — at the
 * start when the switch is on, or when a surface of the AI opened — and until then reads a report of an AI that is
 * off. It runs the hook the shell ran itself before and hands its result up, and counts what waits for a decision
 * for the bar (`AiBadgeCount`); it draws nothing.
 */
export function MobileAiHost({ vault, paletteNote, onReport }: { vault: MobileVault | null; paletteNote: () => string | null; onReport: (report: MobileAiReport) => void }) {
  const ai = useMobileAi(vault, paletteNote);
  // Before the paint, so the shell never draws a frame with the AI half there.
  useLayoutEffect(() => {
    onReport({ ai });
  });
  return createElement(AiBadgeCount, { session: ai.session });
}
