import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { AreaBoundary } from "@plainva/ui";
import type { AiSession } from "@plainva/ui/ai";
import { startMobileAiIfOn, useMobileAiRequested } from "../services/ai/mobileAiLoader";
import type { MobileVault } from "../services/vaultService";
import type { MobileAiReport } from "./MobileAiHost";
import { deferredPart } from "../lib/deferredParts";

const MobileAiHost = deferredPart(() => import("./MobileAiHost").then((m) => m.MobileAiHost));

/** The AI as the shell reads it; `session` is null until the AI is loaded. */
export type ShellAi = Omit<MobileAiReport["ai"], "session"> & { session: AiSession | null };

const nothing = () => undefined;

/**
 * The AI before its host is loaded (performance plan L5): off, no session, nothing open — what the harness reports
 * while the switch is off, so every entry the shell gates on `enabled` stays away.
 */
export const MOBILE_AI_ABSENT: ShellAi = {
  session: null,
  enabled: false,
  sheet: null,
  closeSheet: nothing,
  notePick: null,
  closePick: nothing,
  policy: null,
  navRef: { current: { openNote: nothing, commands: [] } },
  embeddings: null,
  gists: null,
  skills: [],
  palette: {},
};

function sameAi(a: ShellAi, b: ShellAi): boolean {
  const keys = Object.keys(a) as (keyof ShellAi)[];
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
}

/**
 * The shell's AI and the element that hosts it: the switch is read at the start, and the host mounts once the AI
 * was asked for. Rendered where the shell renders its sheets; the host itself draws nothing.
 */
export function useMobileAiHosted(vault: MobileVault | null, paletteNote: () => string | null): [ShellAi, ReactNode] {
  const requested = useMobileAiRequested();
  useEffect(() => {
    void startMobileAiIfOn().catch(() => undefined);
  }, []);
  const [ai, setAi] = useState<ShellAi>(MOBILE_AI_ABSENT);
  const take = useCallback((report: MobileAiReport) => {
    const next: ShellAi = report.ai;
    setAi((current) => (sameAi(current, next) ? current : next));
  }, []);
  const host = requested ? (
    <AreaBoundary area="host:ai" size="quiet">
      <Suspense fallback={null}>
        <MobileAiHost vault={vault} paletteNote={paletteNote} onReport={take} />
      </Suspense>
    </AreaBoundary>
  ) : null;
  return [ai, host];
}
