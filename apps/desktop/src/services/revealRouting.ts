import { getWindowBus } from "./windowBus";

/**
 * "Reveal in file tree" across windows (finding 2026-09-07).
 *
 * An auxiliary window shows content and has no tree; the entry in its ⋮ menu
 * (and the folder links in the reader and the database) used to fire an event
 * nobody there listened to. The request now goes to the owner, which routes
 * it to the window that shows this vault WITH a tree and brings that window
 * forward — see the `reveal-in-tree` contract in windowBus.ts.
 *
 * The full second window is the other half: when the owner picks it, it gets
 * a `reveal-path` broadcast addressed by label and does locally what the
 * central window's ⋮ entry does.
 */

export type RevealOutcome = "owner" | "window" | "none" | "unreachable";

/** Asks the owner to show this path in a tree somewhere. Never throws. */
export async function requestRevealInTree(path: string): Promise<RevealOutcome> {
  try {
    const bus = await getWindowBus();
    const result = await bus.request("reveal-in-tree", { path });
    return result.where;
  } catch (e) {
    console.warn("[revealRouting] the central window did not answer", e);
    return "unreachable";
  }
}

/**
 * Full-window side: react to the owner's pick. `onReveal` gets the path and
 * does what the shell's own entry does — park it for the tree, raise the
 * local event. Resolves to the unsubscribe; a window without a bus gets a
 * no-op rather than an exception.
 */
export async function installRevealPathListener(label: string, onReveal: (path: string) => void): Promise<() => void> {
  try {
    const bus = await getWindowBus();
    return await bus.onBroadcast("reveal-path", (payload) => {
      if (payload.label === label && payload.path) onReveal(payload.path);
    });
  } catch {
    return () => {};
  }
}
