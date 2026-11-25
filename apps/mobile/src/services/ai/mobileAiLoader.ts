import { AI_SETTINGS_KEY, aiSwitchOf, createAiSessionLoader, type AiSessionLoader, ensureAiIfOn, getPlatformServices, useAiRequested, useLoadedAiSession } from "@plainva/ui";
import type { AiSession } from "@plainva/ui/ai";

/**
 * The phone's AI session, made on demand (performance plan L5): `mobileAi.ts` and the harness behind it are a chunk
 * of their own, loaded when the AI is on on this device or a surface of the AI opens. Until then every reader sees
 * `null` and draws nothing of the AI — what it drew while the switch was off.
 */
// Made when it is first asked, not while this module loads (moduleInitBoundary.test.ts); every caller asks the same one.
let made: AiSessionLoader | null = null;
const loader = (): AiSessionLoader => (made ??= createAiSessionLoader(async () => (await import("./mobileAi")).getMobileAiSession()));
export const mobileAiLoader: AiSessionLoader = {
  ensure: () => loader().ensure(),
  session: () => loader().session(),
  requested: () => loader().requested(),
  adopt: (session) => loader().adopt(session),
  subscribe: (listener) => loader().subscribe(listener),
};

/** The session for a component of the start bundle: `null` until it is made. */
export function useMobileAiSession(): AiSession | null {
  return useLoadedAiSession(mobileAiLoader);
}

/** Whether the AI was asked for: the shell mounts the AI's host from then on. */
export function useMobileAiRequested(): boolean {
  return useAiRequested(mobileAiLoader);
}

/** The switch as the AI's settings store it, read without the harness. */
export async function mobileAiSwitch(): Promise<boolean> {
  const store = await getPlatformServices().loadSettings();
  return aiSwitchOf(await store.get(AI_SETTINGS_KEY));
}

/** At the start: the AI loads only when its switch is on. */
export function startMobileAiIfOn(): Promise<AiSession | null> {
  return ensureAiIfOn(mobileAiLoader, mobileAiSwitch);
}
