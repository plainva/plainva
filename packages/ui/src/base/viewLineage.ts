/**
 * Which view of a database the screen holds now is which view it showed (B20).
 *
 * A database change is set on the file as it lies there, and for that the
 * change has to tell which of the views it hands over are views the screen
 * showed, and which it made. Names do not tell it: a view deleted here and a
 * new one added in its place get the same name (the desktop names a new view
 * by its type, "Table"), and taken by its name the new view would be handed
 * what the other side set on the old one. The screen knows what it did — it
 * added, removed or moved a view — and says so; the lineage is what follows
 * from it, gathered over every change that waits for a moved file.
 */

/** What one change did to the list of views: one added at a place, one removed from a place, or one moved. */
export type ViewsChange = { add: number } | { remove: number } | { move: [from: number, to: number] };

/**
 * For each view of the config now, the place among the views shown of the
 * view it is — `null` for a view made here. A view shown that no entry names
 * was removed here.
 */
export type ViewLineage = ReadonlyArray<number | null>;

/**
 * The lineage of one change from a config of `shownCount` views to one of
 * `nextCount`. A change that says nothing about the views kept them where
 * they were. Unknown (`undefined`) where what it says does not add up to
 * `nextCount` views — then which view is which is judged from the views.
 */
export function lineageOfChange(shownCount: number, nextCount: number, change?: ViewsChange): ViewLineage | undefined {
  const out: Array<number | null> = Array.from({ length: shownCount }, (_, i) => i);
  if (change) {
    if ("add" in change) {
      if (change.add < 0 || change.add > out.length) return undefined;
      out.splice(change.add, 0, null);
    } else if ("remove" in change) {
      if (change.remove < 0 || change.remove >= out.length) return undefined;
      out.splice(change.remove, 1);
    } else {
      const [from, to] = change.move;
      if (from < 0 || from >= out.length || to < 0 || to >= out.length) return undefined;
      const [moved] = out.splice(from, 1);
      out.splice(to, 0, moved);
    }
  }
  return out.length === nextCount ? out : undefined;
}

/** The lineage of one change from the config `shown` to `next` (`lineageOfChange`, counted on their views). */
export function lineageBetween(shown: unknown, next: unknown, change?: ViewsChange): ViewLineage | undefined {
  const count = (cfg: unknown) => {
    const views = cfg !== null && typeof cfg === "object" ? (cfg as { views?: unknown }).views : undefined;
    return Array.isArray(views) ? views.length : 0;
  };
  return lineageOfChange(count(shown), count(next), change);
}

/**
 * The lineage of two changes, one after the other: `earlier` from the config
 * shown to the one between, `later` from that one to the config now. Unknown
 * where either is.
 */
export function composeLineage(earlier: ViewLineage | undefined, later: ViewLineage | undefined): ViewLineage | undefined {
  if (earlier === undefined || later === undefined) return undefined;
  const out: Array<number | null> = [];
  for (const between of later) {
    if (between === null) out.push(null);
    else if (between < 0 || between >= earlier.length) return undefined;
    else out.push(earlier[between]);
  }
  return out;
}

/** The lineage, where it fits a change from `shownCount` views to `nextCount`: each place shown named at most once. */
export function fittingLineage(lineage: ViewLineage | undefined, shownCount: number, nextCount: number): number[] | undefined {
  if (lineage === undefined || lineage.length !== nextCount) return undefined;
  const seen = new Set<number>();
  for (const i of lineage) {
    if (i === null) continue;
    if (!Number.isInteger(i) || i < 0 || i >= shownCount || seen.has(i)) return undefined;
    seen.add(i);
  }
  return lineage.map((i) => (i === null ? -1 : i));
}
