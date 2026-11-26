import { useLayoutEffect } from "react";
import { useAiAttention, useAiWaitingCount, type AiSession } from "@plainva/ui/ai";
import { setAiBadge } from "../services/ai/mobileAiPorts";

/**
 * Counts what waits for a decision in the AI (plan KI-Oberflächen K11) and leaves it where the bar's and the areas'
 * AI entry read it (`useAiBadge`). Part of the AI's host, which loads with the harness (performance plan L5): while
 * the harness is not loaded nothing waits, and the entries show nothing — as while the AI is off.
 */
export function AiBadgeCount({ session }: { session: AiSession | null }) {
  const waiting = useAiWaitingCount(session);
  const attention = useAiAttention(session);
  useLayoutEffect(() => {
    setAiBadge({ waiting, attention });
  }, [waiting, attention]);
  useLayoutEffect(() => () => setAiBadge({ waiting: 0, attention: false }), []);
  return null;
}
