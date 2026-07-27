/**
 * One model for every configurable bar: the action rail, both desktop sidebars
 * and the mobile navigation bar.
 *
 * The shape is the one the mobile bar already proved (navigation.ts): a single
 * ordered list of ALL known ids plus a count of how many of them are visible.
 * Membership therefore follows from POSITION — dragging above the line shows an
 * entry, dragging below hides it. There is no second "hidden" list that could
 * drift out of sync with the order.
 *
 * `alwaysVisible` ids are pinned into the visible part (plan E3): the rail must
 * keep Help and Settings, the left sidebar must keep the Files tab. Without
 * that a user can hide their own way back.
 */

export interface AreaOrder {
  /** Every known id, in the user's order. */
  order: string[];
  /** How many leading entries are visible. */
  visibleCount: number;
}

export interface AreaOrderSpec {
  /** All ids the app knows, in factory order. */
  known: readonly string[];
  /** Ids that can never be hidden — they are sorted to the front on load. */
  alwaysVisible?: readonly string[];
  /** Lower bound for `visibleCount` (mobile bar: 3). Defaults to the pinned count. */
  minVisible?: number;
  /** Upper bound for `visibleCount` (mobile bar: 5). Defaults to "all". */
  maxVisible?: number;
  /** Visible count for a fresh install. Defaults to "all visible". */
  defaultVisibleCount?: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function bounds(spec: AreaOrderSpec): { min: number; max: number } {
  const pinned = spec.alwaysVisible?.length ?? 0;
  const max = clamp(spec.maxVisible ?? spec.known.length, 0, spec.known.length);
  const min = clamp(Math.max(spec.minVisible ?? 0, pinned), 0, max);
  return { min, max };
}

/**
 * Normalizes a persisted value: unknown ids and duplicates drop, missing known
 * ids are appended in factory order. Same self-healing contract as the two
 * implementations this replaces (`sanitizeRibbonOrder`, `sanitizeTabSlots`) —
 * a user who sorted an older version keeps their order and finds new entries at
 * the end. No reset, no missing button.
 */
export function sanitizeAreaOrder(raw: unknown, spec: AreaOrderSpec): AreaOrder {
  const knownSet = new Set(spec.known);
  const pinned = spec.alwaysVisible ?? [];
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Partial<AreaOrder>) : {};
  const rawOrder = Array.isArray(raw) ? raw : source.order;

  const order: string[] = [];
  if (Array.isArray(rawOrder)) {
    for (const v of rawOrder) {
      if (typeof v !== "string" || !knownSet.has(v) || order.includes(v)) continue;
      order.push(v);
    }
  }
  for (const id of spec.known) if (!order.includes(id)) order.push(id);

  // Pinned entries lead, in their configured order — they must never sit in the
  // hidden part, and a stored order from before they were pinned might do that.
  for (let i = pinned.length - 1; i >= 0; i--) {
    const id = pinned[i];
    const at = order.indexOf(id);
    if (at > 0) {
      order.splice(at, 1);
      order.unshift(id);
    }
  }

  const { min, max } = bounds(spec);
  const fallback = spec.defaultVisibleCount ?? spec.known.length;
  const rawCount = Array.isArray(raw) ? fallback : source.visibleCount;
  const count = typeof rawCount === "number" && Number.isFinite(rawCount) ? Math.round(rawCount) : fallback;
  return { order, visibleCount: clamp(count, min, max) };
}

/** The visible slice — the first `visibleCount` entries. */
export function visibleAreas(value: AreaOrder): string[] {
  return value.order.slice(0, value.visibleCount);
}

/** Everything below the line. */
export function hiddenAreas(value: AreaOrder): string[] {
  return value.order.slice(value.visibleCount);
}

export function isAreaVisible(value: AreaOrder, id: string): boolean {
  const at = value.order.indexOf(id);
  return at >= 0 && at < value.visibleCount;
}

/**
 * Moves `id` to `toIndex` in the full list. The line stays where it is, so a
 * move across it changes visibility — that IS the gesture. Pinned ids cannot be
 * pushed below the line: the target index is clamped to the visible part.
 */
export function moveArea(value: AreaOrder, id: string, toIndex: number, spec: AreaOrderSpec): AreaOrder {
  const from = value.order.indexOf(id);
  if (from < 0) return value;
  const pinned = new Set(spec.alwaysVisible ?? []);
  const rest = value.order.filter((v) => v !== id);
  let target = clamp(toIndex, 0, rest.length);

  // A pinned entry stays visible; nothing may be dragged in front of one either.
  if (pinned.has(id)) target = clamp(target, 0, Math.max(0, value.visibleCount - 1));
  else target = Math.max(target, pinned.size);

  const order = [...rest.slice(0, target), id, ...rest.slice(target)];
  return { order, visibleCount: value.visibleCount };
}

/**
 * Show or hide a single entry — the shortcut behind the right-click menu.
 * Showing appends at the end of the visible part, hiding moves to the top of
 * the hidden part, so the neighbours keep their relative order.
 */
export function setAreaVisible(value: AreaOrder, id: string, visible: boolean, spec: AreaOrderSpec): AreaOrder {
  const at = value.order.indexOf(id);
  if (at < 0) return value;
  if (isAreaVisible(value, id) === visible) return value;
  const { min, max } = bounds(spec);
  if (visible) {
    const moved = moveArea(value, id, value.visibleCount, spec);
    return { order: moved.order, visibleCount: clamp(value.visibleCount + 1, min, max) };
  }
  if ((spec.alwaysVisible ?? []).includes(id)) return value;
  const moved = moveArea(value, id, Math.max(0, value.visibleCount - 1), spec);
  return { order: moved.order, visibleCount: clamp(value.visibleCount - 1, min, max) };
}

/** Step the line itself (mobile stepper: "areas in the bar −/+"). */
export function setVisibleCount(value: AreaOrder, count: number, spec: AreaOrderSpec): AreaOrder {
  const { min, max } = bounds(spec);
  return { order: value.order, visibleCount: clamp(Math.round(count), min, max) };
}

/**
 * Sorts the entries the surface CURRENTLY has by the stored order and drops the
 * hidden ones. Gated entries (calendar/mail exist only with a connected
 * service) keep their slot the moment they appear, because the order lists
 * every known id regardless of whether it is rendered right now.
 */
export function applyAreaOrder<T>(items: readonly T[], value: AreaOrder, idOf: (item: T) => string): T[] {
  const rank = new Map(value.order.map((id, i) => [id, i]));
  const shown = new Set(visibleAreas(value));
  return items
    .filter((item) => shown.has(idOf(item)))
    .sort((a, b) => (rank.get(idOf(a)) ?? Number.MAX_SAFE_INTEGER) - (rank.get(idOf(b)) ?? Number.MAX_SAFE_INTEGER));
}

export function sameAreaOrder(a: AreaOrder, b: AreaOrder): boolean {
  return a.visibleCount === b.visibleCount && a.order.length === b.order.length && a.order.every((v, i) => v === b.order[i]);
}

/**
 * Inheritance (plan § 3): a vault without its own value follows the global
 * default, so changing the default reaches every vault that was never adapted.
 * Only a deliberate change inside a vault writes a vault value — and from then
 * on that one wins and travels with the settings profile.
 */
export function resolveAreaOrder(vaultValue: unknown, globalDefault: unknown, spec: AreaOrderSpec): AreaOrder {
  const hasOwn =
    Array.isArray(vaultValue) ||
    (!!vaultValue && typeof vaultValue === "object" && Array.isArray((vaultValue as Partial<AreaOrder>).order));
  return sanitizeAreaOrder(hasOwn ? vaultValue : globalDefault, spec);
}
