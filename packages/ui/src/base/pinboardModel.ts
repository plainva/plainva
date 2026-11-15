import { trimEndChars } from "@plainva/core";
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
 * - A drag splices into the stored list (D3): the first drag materializes
 *   the unarranged cards it shows; cards the board does not show keep their
 *   places.
 * - Self-heal: entries whose file no longer exists / left the source set are
 *   dropped whenever a mutator writes — measured against every card of the
 *   VIEW before the search in its head or a chip narrows it, never against
 *   the cards on screen (since 0.8.4 one pin while searching took every other
 *   card's place out of the .base, and the sync carried it on).
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

/** `list` with each entry once, at its first place. */
function once(list: readonly string[] | undefined): string[] {
  return [...new Set(list ?? [])];
}

/**
 * A drag (D3): the stored list of the section with `moved` taken out and put
 * before the slot's card — or after the last card shown, the end of what the
 * person saw. `shown` is the section as drawn: its cards that the list does
 * not hold yet (unarranged, drawn on top) are written in front, in the order
 * drawn, so the first drag materializes what the person saw. The list heals
 * against `present` — every card of the VIEW, before the search in its head
 * or a chip narrows it —, never against the cards on screen: one drag while
 * searching took every other card's place out of the .base (since 0.8.4). A
 * card dropped onto itself stays.
 */
export function spliceIntoSequence(
  stored: string[] | undefined,
  shown: string[],
  moved: string[],
  slot: PinboardDropSlot,
  present?: ReadonlySet<string>,
): string[] {
  // A list that holds a card twice draws it twice; the card stands at its first place.
  shown = once(shown);
  const kept = once(stored).filter((p) => !present || present.has(p));
  const listed = new Set(kept);
  const movedSet = new Set(moved);
  const all = once([...shown.filter((p) => !listed.has(p)), ...kept]);
  if (slot.kind === "before" && movedSet.has(slot.path)) return all;
  const rest = all.filter((p) => !movedSet.has(p));
  const insertAt = (at: number) => [...rest.slice(0, at), ...moved, ...rest.slice(at)];
  if (slot.kind === "before") {
    const at = rest.indexOf(slot.path);
    if (at >= 0) return insertAt(at);
  }
  // The end of the section as shown: after its last card that does not move.
  const lastShown = [...shown].reverse().find((p) => !movedSet.has(p));
  const after = lastShown === undefined ? -1 : rest.indexOf(lastShown);
  return after < 0 ? [...rest, ...moved] : insertAt(after + 1);
}

/**
 * Pin a card: it enters the pinned section on top (Keep) and leaves the order
 * list. Both lists heal against `presentPaths` — every card of the view
 * before its search narrows it, never the cards on screen.
 */
export function applyPin(
  order: string[] | undefined,
  pinned: string[] | undefined,
  path: string,
  presentPaths: ReadonlySet<string>,
): { order: string[]; pinned: string[] } {
  const heal = (list: string[] | undefined) => once(list).filter((p) => presentPaths.has(p) && p !== path);
  return { order: heal(order), pinned: [path, ...heal(pinned)] };
}

/** Unpin a card: it returns to the TOP of the unpinned section (visible, predictable); healed as `applyPin`. */
export function applyUnpin(
  order: string[] | undefined,
  pinned: string[] | undefined,
  path: string,
  presentPaths: ReadonlySet<string>,
): { order: string[]; pinned: string[] } {
  const heal = (list: string[] | undefined) => once(list).filter((p) => presentPaths.has(p) && p !== path);
  return { order: [path, ...heal(order)], pinned: heal(pinned) };
}

/**
 * A new order of the shown keys (a board's columns) written into the stored
 * order: the shown keys take the places shown keys held, in their new order;
 * every key not shown — a group whose cards the search has not let through —
 * keeps its place. A key the stored order does not hold yet (a value that
 * turned up after the board was first arranged) goes where it was dropped:
 * before the shown key that follows it, or after the one before it.
 */
export function reorderShown(stored: readonly string[], shownInNewOrder: readonly string[]): string[] {
  const kept = once(stored);
  const keptSet = new Set(kept);
  const order = once(shownInNewOrder);
  const shown = new Set(order);
  const next = order.filter((k) => keptSet.has(k));
  let i = 0;
  const placed = kept.map((k) => (shown.has(k) ? next[i++]! : k));
  // One pass (a board can carry thousands of groups): every run of new keys
  // goes right before the stored key that follows it in the new order; a run
  // at the end right after the last stored one; with no stored key shown,
  // the new keys go to the end.
  const before = new Map<string, string[]>();
  let run: string[] = [];
  let lastKept: string | undefined;
  for (const k of order) {
    if (!keptSet.has(k)) run.push(k);
    else {
      if (run.length > 0) before.set(k, run);
      run = [];
      lastKept = k;
    }
  }
  const out: string[] = [];
  for (const k of placed) {
    const ahead = before.get(k);
    if (ahead) out.push(...ahead);
    out.push(k);
    if (k === lastKept) out.push(...run);
  }
  if (lastKept === undefined) out.push(...run);
  return out;
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
 * Timestamp file name for a capture WITHOUT a title (maintainer decision
 * 2026-07-17): "2026-07-17 14.32.05" — sortable, readable, and free of
 * characters Windows forbids (dots instead of colons). The caller's collision
 * loop appends " 2", " 3", … when two captures land in the same second.
 */
export function captureTimestampName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}

/**
 * File name for quick capture (P4): the first words of the given text (since
 * the title popup of 2026-07-17: the TITLE the user typed), cleaned of
 * markdown markers and characters that are invalid in file names, capped at a
 * word boundary. Null when nothing usable remains (caller falls back to a
 * timestamp name).
 */
export function captureFileName(text: string, maxLen = 48): string | null {
  const firstLine = (text ?? "").split("\n").find((l) => l.trim() !== "");
  if (!firstLine) return null;
  let s = firstLine
    .replace(/^\s*(?:#{1,6}\s+|>\s*|(?:[-*+]|\d+[.)])\s+(?:\[[ xX/-]\]\s*)?)/, "") // block markers
    .replace(/[*_~`=[\]#|]/g, "") // inline markers / wiki brackets
    .replace(/[<>:"/\\?]/g, " ") // characters invalid in Windows file names
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > maxLen) {
    const cut = s.slice(0, maxLen + 1);
    const space = cut.lastIndexOf(" ");
    s = (space > maxLen / 2 ? cut.slice(0, space) : cut.slice(0, maxLen)).trim();
  }
  s = trimEndChars(s, ". "); // Windows: no trailing dots/spaces
  return s || null;
}

/** Third stage after source/view filters and selected label chips. */
export function filterCardPathsByText(sequence: string[], matches: ReadonlySet<string> | null): string[] {
  return matches === null ? sequence : sequence.filter(path => matches.has(path));
}
export function pinboardTextMatches(values: readonly string[], query: string): boolean {
  const needle = query.trim().normalize("NFC").toLocaleLowerCase();
  return !needle || values.some(value => value.normalize("NFC").toLocaleLowerCase().includes(needle));
}
