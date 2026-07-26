import { getSettingsStore } from "./settingsStore";

/**
 * Order of the action rail (plan P3). The rail used to be two fixed arrays;
 * now the user can sort each group by long-pressing a button and dragging.
 *
 * Deliberately ONLY sorting (E3): nothing can be hidden, and the top/bottom
 * split stays. That is what keeps Settings and the command palette reachable —
 * a rail you can empty is a rail you can lock yourself out of.
 *
 * Persistence follows services/density.ts: one global setting in the Tauri
 * store, not per vault.
 */

/** Every action the rail can carry, in its factory order per group. */
export const RIBBON_TOP_IDS = ["new", "open", "daily", "graph", "tasks", "calendar", "mail", "palette"] as const;
export const RIBBON_BOTTOM_IDS = ["help", "settings"] as const;

export type RibbonTopId = (typeof RIBBON_TOP_IDS)[number];
export type RibbonBottomId = (typeof RIBBON_BOTTOM_IDS)[number];
export type RibbonGroup = "top" | "bottom";

export interface RibbonOrder {
  top: string[];
  bottom: string[];
}

export const RIBBON_ORDER_KEY = "ribbonOrder";

export const DEFAULT_RIBBON_ORDER: RibbonOrder = {
  top: [...RIBBON_TOP_IDS],
  bottom: [...RIBBON_BOTTOM_IDS],
};

/**
 * Same contract as the mobile `sanitizeTabSlots`: keep the stored order for the
 * ids we still know, drop unknown ones, and APPEND anything the app has gained
 * since. A user who sorted the rail in an older version therefore keeps their
 * order and simply finds new actions at the end — no reset, no missing button.
 */
function sanitizeGroup(raw: unknown, known: readonly string[]): string[] {
  const out: string[] = [];
  if (Array.isArray(raw)) {
    for (const v of raw) {
      if (typeof v !== "string" || !known.includes(v) || out.includes(v)) continue;
      out.push(v);
    }
  }
  for (const id of known) if (!out.includes(id)) out.push(id);
  return out;
}

export function sanitizeRibbonOrder(raw: unknown): RibbonOrder {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Partial<RibbonOrder>;
  return {
    top: sanitizeGroup(obj.top, RIBBON_TOP_IDS),
    bottom: sanitizeGroup(obj.bottom, RIBBON_BOTTOM_IDS),
  };
}

/**
 * Moves `id` to `toIndex` within its group. Pure; the drag layer only reports
 * "this button now belongs at that slot".
 */
export function moveRibbonAction(order: string[], id: string, toIndex: number): string[] {
  const from = order.indexOf(id);
  if (from === -1) return order;
  const rest = order.filter((x) => x !== id);
  const clamped = Math.max(0, Math.min(toIndex, rest.length));
  return [...rest.slice(0, clamped), id, ...rest.slice(clamped)];
}

/**
 * Sorts the actions the rail currently HAS by the stored order. Gated actions
 * (calendar/mail exist only with a connected service) keep their slot the
 * moment they appear, because the order lists every known id regardless of
 * whether it is currently rendered.
 */
export function applyRibbonOrder<T extends { key: string }>(actions: T[], order: string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...actions].sort((a, b) => (rank.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.key) ?? Number.MAX_SAFE_INTEGER));
}

export async function getStoredRibbonOrder(): Promise<RibbonOrder> {
  try {
    const store = await getSettingsStore();
    return sanitizeRibbonOrder(await store.get<RibbonOrder>(RIBBON_ORDER_KEY));
  } catch {
    return DEFAULT_RIBBON_ORDER;
  }
}

export async function setStoredRibbonOrder(order: RibbonOrder): Promise<void> {
  const store = await getSettingsStore();
  await store.set(RIBBON_ORDER_KEY, order);
  await store.save();
}
