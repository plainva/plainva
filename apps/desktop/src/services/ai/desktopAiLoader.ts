import { AI_SETTINGS_KEY, aiSwitchOf, createAiSessionLoader, type AiSessionLoader, ensureAiIfOn, getPlatformServices, useAiRequested, useLoadedAiSession } from "@plainva/ui";
import type { AiSession } from "@plainva/ui/ai";
import { isOwnerWindow } from "../windowContext";

/**
 * The desktop's AI session, made on demand (performance plan L5): `desktopAi.ts` and the harness behind it are a
 * chunk of their own, loaded when the AI is on on this device or a surface of the AI opens. Only the central window
 * has a session; every other window answers `null` without loading anything.
 */
// Made when it is first asked, not while this module loads (moduleInitBoundary.test.ts); every caller asks the same one.
let made: AiSessionLoader | null = null;
const loader = (): AiSessionLoader => (made ??= createAiSessionLoader(async () => (isOwnerWindow() ? (await import("./desktopAi")).getDesktopAiSession() : null)));
export const desktopAiLoader: AiSessionLoader = {
  ensure: () => loader().ensure(),
  session: () => loader().session(),
  requested: () => loader().requested(),
  adopt: (session) => loader().adopt(session),
  subscribe: (listener) => loader().subscribe(listener),
};

/** The session for a component of the start bundle: `null` until it is made — what a window without the AI sees. */
export function useDesktopAiSession(): AiSession | null {
  return useLoadedAiSession(desktopAiLoader);
}

/** Whether the AI was asked for in this window: the shell mounts the AI's host from then on. */
export function useDesktopAiRequested(): boolean {
  return useAiRequested(desktopAiLoader);
}

/** The switch as the AI's settings store it, read without the harness. */
export async function desktopAiSwitch(): Promise<boolean> {
  const store = await getPlatformServices().loadSettings();
  return aiSwitchOf(await store.get(AI_SETTINGS_KEY));
}

/** At the start of the central window: the AI loads only when its switch is on. */
export function startDesktopAiIfOn(): Promise<AiSession | null> {
  if (!isOwnerWindow()) return Promise.resolve(null);
  return ensureAiIfOn(desktopAiLoader, desktopAiSwitch);
}
