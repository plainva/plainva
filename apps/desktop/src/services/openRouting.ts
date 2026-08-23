import { getWindowBus } from "./windowBus";

/**
 * Where content gets drawn, asked from a client window (multi-window C1).
 *
 * A client window may not decide this for itself: content is open once
 * app-wide, and only the owner knows every window and the central window's
 * tabs. So every door into a pane — the file tree, a search hit, a bookmark, a
 * backlink, a graph node, a database row — asks here first and draws only when
 * the answer comes back "you".
 *
 * This lives in one file because the auxiliary shell and the full window would
 * otherwise carry the same twenty lines twice, and the second copy is where the
 * fallback quietly stops matching.
 */
export function routeOpenThroughOwner(
  path: string,
  openHere: () => void,
  opts: { from?: string | null; newWindow?: boolean } = {},
): boolean {
  void (async () => {
    try {
      const bus = await getWindowBus();
      const result = await bus.request("open-content", {
        path,
        from: opts.from ?? undefined,
        newWindow: opts.newWindow,
      });
      if (result.where === "caller") openHere();
    } catch (e) {
      // No bus (browser/test) or the owner did not answer: showing it here is
      // the honest fallback — worse than a duplicate is a dead click.
      console.warn("[openRouting] could not route the open request", e);
      openHere();
    }
  })();
  // Always true: the answer is asynchronous, so the caller must stop now and
  // let `openHere` run when it arrives.
  return true;
}
