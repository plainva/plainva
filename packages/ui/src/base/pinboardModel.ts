/**
 * Pure pinboard view-model helpers (plan Pinboard P3/P5), shared by both
 * shells.
 *
 * Contract (format §3, decisions E1/E3/E5/D3):
 * - `pinboardPinned` is the pinned section — its list order IS the section
 *   order. Pinned paths are NOT repeated in `pinboardOrder`.
 * - `pinboardOrder` is the arranged order of the UNPINNED section. Cards not
 *   listed there ("unarranged": freshly captured, externally created) render
 *   ON TOP, newest first by ctime (E5 — ctime, not mtime, so checking a box
 *   or editing a label never reorders the board under the user's finger),
 *   followed by the listed cards.
 * - A drag SPLICES into the full unfiltered sequence (D3): the first drag
 *   materializes the whole current unpinned order once; chip-filtered views
 *   never lose the positions of filtered-out cards because the splice operates
 *   on the full sequence, not the visible subset.
 * - Self-heal: entries whose file no longer exists / left the source set are
 *   dropped whenever a mutator writes.
 */

export interface PinboardRowLike {
  path: string;
  /** files.ctime (index v3) — null for legacy rows, fall back to mtime. */
  ctime: number | null;
  mtime: number;
}

export interface PinboardSections {
  /** Pinned section, in pinboardPinned order (missing files dropped). */
  pinned: string[];
  /** Unpinned section: unarranged (ctime desc) first, then the listed order. */
  unpinned: string[];
}

/** Assemble both sections from the query rows and the view's order/pinned lists. */
export function orderCards(
  rows: PinboardRowLike[],
  order: string[] | undefined,
  pinned: string[] | undefined,
): PinboardSections {
  const present = new Map(rows.map((r) => [r.path, r]));
  const pinnedClean = (pinned ?? []).filter((p) => present.has(p));
  const pinnedSet = new Set(pinnedClean);
  const listed = (order ?? []).filter((p) => present.has(p) && !pinnedSet.has(p));
  const listedSet = new Set(order ?? []);
  const unarranged = rows
    .filter((r) => !listedSet.has(r.path) && !pinnedSet.has(r.path))
    .sort((a, b) => {
      const ta = a.ctime ?? a.mtime;
      const tb = b.ctime ?? b.mtime;
      if (tb !== ta) return tb - ta;
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; // deterministic tie
    })
    .map((r) => r.path);
  return { pinned: pinnedClean, unpinned: [...unarranged, ...listed] };
}

/** Drop slot of a card drag: before a specific card, or at the section end. */
export type PinboardDropSlot = { kind: "before"; path: string } | { kind: "end" };

/**
 * Splice `moved` into the FULL section sequence (D3). `sequence` is the
 * complete unfiltered section order as currently rendered (orderCards output);
 * the return value is the new persisted list for that section. Also the
 * first-drag materialization: the result always lists every card of the
 * sequence explicitly.
 */
export function spliceIntoSequence(sequence: string[], moved: string[], slot: PinboardDropSlot): string[] {
  const movedSet = new Set(moved);
  const rest = sequence.filter((p) => !movedSet.has(p));
  if (slot.kind === "end") return [...rest, ...moved];
  const at = rest.indexOf(slot.path);
  if (at < 0) return [...rest, ...moved];
  return [...rest.slice(0, at), ...moved, ...rest.slice(at)];
}

/** Pin a card: it enters the pinned section on top (Keep) and leaves the order list. */
export function applyPin(
  order: string[] | undefined,
  pinned: string[] | undefined,
  path: string,
  presentPaths: ReadonlySet<string>,
): { order: string[]; pinned: string[] } {
  const heal = (list: string[] | undefined) => (list ?? []).filter((p) => presentPaths.has(p) && p !== path);
  return { order: heal(order), pinned: [path, ...heal(pinned)] };
}

/** Unpin a card: it returns to the TOP of the unpinned section (visible, predictable). */
export function applyUnpin(
  order: string[] | undefined,
  pinned: string[] | undefined,
  path: string,
  presentPaths: ReadonlySet<string>,
): { order: string[]; pinned: string[] } {
  const heal = (list: string[] | undefined) => (list ?? []).filter((p) => presentPaths.has(p) && p !== path);
  return { order: [path, ...heal(order)], pinned: heal(pinned) };
}

/** Rewrite vault paths in order/pinned after a rename/move (P5 sweep helper). */
export function retargetPinboardPaths(
  list: string[] | undefined,
  moves: ReadonlyMap<string, string>,
): { list: string[]; changed: boolean } {
  let changed = false;
  const out = (list ?? []).map((p) => {
    const to = moves.get(p);
    if (to !== undefined && to !== p) {
      changed = true;
      return to;
    }
    return p;
  });
  return { list: out, changed };
}

/**
 * Deterministic masonry: cards go, in sequence order, into the currently
 * shortest column (Keep's flow). Heights come from the view's ResizeObserver
 * measurements; unmeasured cards use the estimate so the first paint already
 * distributes reasonably.
 */
export function distributeCards(
  sequence: string[],
  heights: ReadonlyMap<string, number>,
  columnCount: number,
  estimate = 180,
): string[][] {
  const cols = Math.max(1, Math.floor(columnCount));
  const columns: string[][] = Array.from({ length: cols }, () => []);
  const tally = new Array(cols).fill(0);
  for (const path of sequence) {
    let target = 0;
    for (let i = 1; i < cols; i++) if (tally[i] < tally[target]) target = i;
    columns[target].push(path);
    tally[target] += (heights.get(path) ?? estimate) + 12; // + grid gap
  }
  return columns;
}

/** Column count from the container width (fixed card width, Keep-style). */
export function pinboardColumnCount(containerWidth: number, cardWidth = 256, gap = 12): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return 1;
  return Math.max(1, Math.floor((containerWidth + gap) / (cardWidth + gap)));
}

/**
 * Pointer drop slot over the rendered cards: before the hovered card when the
 * pointer is in its upper half, after it (= before its successor) otherwise;
 * "end" when the pointer misses every card. `rects` are viewport rects in
 * SECTION sequence order.
 */
export function dropSlotAt(
  rects: { path: string; top: number; bottom: number; left: number; right: number }[],
  sequence: string[],
  x: number,
  y: number,
): PinboardDropSlot {
  for (const r of rects) {
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      const before = y <= (r.top + r.bottom) / 2;
      if (before) return { kind: "before", path: r.path };
      const idx = sequence.indexOf(r.path);
      const next = idx >= 0 ? sequence[idx + 1] : undefined;
      return next ? { kind: "before", path: next } : { kind: "end" };
    }
  }
  return { kind: "end" };
}

/**
 * Chip filter (P4): AND semantics — a card stays visible when it carries EVERY
 * selected label. Tag labels match hierarchically ("privat" also matches
 * "privat/haus"), mirroring the app's tag semantics. The selection is
 * session-local and never persisted (§3); ordering/drag always operate on the
 * UNFILTERED sequence (D3).
 */
export function filterCardPaths(
  sequence: string[],
  labelsByPath: ReadonlyMap<string, readonly string[]>,
  selected: readonly string[],
): string[] {
  if (selected.length === 0) return sequence;
  return sequence.filter((p) => {
    const labels = labelsByPath.get(p) ?? [];
    return selected.every((s) => labels.some((l) => l === s || l.startsWith(s + "/")));
  });
}

/**
 * File name for quick capture (P4): the first words of the content, cleaned of
 * markdown markers and characters that are invalid in file names, capped at a
 * word boundary. Null when nothing usable remains (caller falls back to a
 * timestamp name).
 */
export function captureFileName(text: string, maxLen = 48): string | null {
  const firstLine = (text ?? "").split("\n").find((l) => l.trim() !== "");
  if (!firstLine) return null;
  let s = firstLine
    .replace(/^\s*(?:#{1,6}\s+|>\s*|(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?)/, "") // block markers
    .replace(/[*_~`=[\]#|]/g, "") // inline markers / wiki brackets
    .replace(/[<>:"/\\?]/g, " ") // characters invalid in Windows file names
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > maxLen) {
    const cut = s.slice(0, maxLen + 1);
    const space = cut.lastIndexOf(" ");
    s = (space > maxLen / 2 ? cut.slice(0, space) : cut.slice(0, maxLen)).trim();
  }
  s = s.replace(/[. ]+$/, ""); // Windows: no trailing dots/spaces
  return s || null;
}
