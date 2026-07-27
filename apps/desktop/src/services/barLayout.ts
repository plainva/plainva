import { getSettingsStore } from "./settingsStore";
import {
  resolveAreaOrder,
  sanitizeAreaOrder,
  sameAreaOrder,
  type AreaOrder,
  type AreaOrderSpec,
} from "@plainva/ui";

/**
 * What each bar carries and in which order — the action rail, both sidebars.
 *
 * Storage follows plan § 3: the value lives PER VAULT so it travels through the
 * settings profile, with a global default underneath. A vault without its own
 * value inherits, which means changing the default reaches every vault that was
 * never adapted; only a deliberate change inside a vault writes a vault value.
 * "Reset to default" therefore deletes rather than writes.
 */

export type BarId = "ribbon" | "leftTabs" | "leftSections" | "rightSections";

/** Every action the rail's TOP group can carry. The bottom group (help,
 *  settings) is fixed and deliberately outside this model — that is what makes
 *  E3 structural instead of a runtime check. */
export const RIBBON_AREA_IDS = ["new", "open", "daily", "graph", "tasks", "calendar", "mail", "palette"] as const;
export const LEFT_TAB_IDS = ["files", "tags", "databases"] as const;
export const LEFT_SECTION_IDS = ["recents", "bookmarks"] as const;
export const RIGHT_SECTION_IDS = ["calendar", "outline", "graph", "databases", "backlinks", "properties"] as const;

export interface BarAreaDef {
  id: string;
  /** i18n key of the name shown in settings and in the right-click menu. */
  labelKey: string;
}

export interface BarDef {
  id: BarId;
  titleKey: string;
  descriptionKey: string;
  spec: AreaOrderSpec;
  areas: BarAreaDef[];
}

/** Labels reuse the keys the surfaces already use — no second vocabulary. */
export const BAR_DEFS: BarDef[] = [
  {
    id: "ribbon",
    titleKey: "bars.ribbon",
    descriptionKey: "bars.ribbonDesc",
    spec: { known: RIBBON_AREA_IDS, defaultVisibleCount: RIBBON_AREA_IDS.length },
    areas: [
      { id: "new", labelKey: "common.newNote" },
      { id: "open", labelKey: "editor.openFile" },
      { id: "daily", labelKey: "sidebar.newDaily" },
      { id: "graph", labelKey: "graph.open" },
      { id: "tasks", labelKey: "tasks.openTasks" },
      { id: "calendar", labelKey: "pim.openCalendar" },
      { id: "mail", labelKey: "mail.openMail" },
      { id: "palette", labelKey: "palette.title" },
    ],
  },
  {
    id: "leftTabs",
    titleKey: "bars.leftTabs",
    descriptionKey: "bars.leftTabsDesc",
    spec: { known: LEFT_TAB_IDS, alwaysVisible: ["files"], defaultVisibleCount: LEFT_TAB_IDS.length },
    areas: [
      { id: "files", labelKey: "sidebar.files" },
      { id: "tags", labelKey: "sidebar.tags" },
      { id: "databases", labelKey: "sidebar.databases" },
    ],
  },
  {
    id: "leftSections",
    titleKey: "bars.leftSections",
    descriptionKey: "bars.leftSectionsDesc",
    spec: { known: LEFT_SECTION_IDS, defaultVisibleCount: LEFT_SECTION_IDS.length },
    areas: [
      { id: "recents", labelKey: "sidebar.recent" },
      { id: "bookmarks", labelKey: "sidebar.bookmarks" },
    ],
  },
  {
    id: "rightSections",
    titleKey: "bars.rightSections",
    descriptionKey: "bars.rightSectionsDesc",
    spec: { known: RIGHT_SECTION_IDS, defaultVisibleCount: RIGHT_SECTION_IDS.length },
    areas: [
      { id: "calendar", labelKey: "rightPanel.calendar" },
      { id: "outline", labelKey: "rightPanel.outline" },
      { id: "graph", labelKey: "rightPanel.graph" },
      { id: "databases", labelKey: "rightPanel.databases" },
      { id: "backlinks", labelKey: "rightPanel.backlinks" },
      { id: "properties", labelKey: "rightPanel.properties" },
    ],
  },
];

export function barDef(bar: BarId): BarDef {
  const def = BAR_DEFS.find((b) => b.id === bar);
  if (!def) throw new Error(`unknown bar: ${bar}`);
  return def;
}

// Key shape mirrors settingsProfile.ts. The per-vault key is what the sync
// profile picks up; the default key is global and deliberately NOT synced —
// it is the fallback a fresh vault inherits, not a shared setting.
const b64 = (p: string) => btoa(unescape(encodeURIComponent(p)));
export const barLayoutKey = (bar: BarId, vaultPath: string) => `barLayout_${bar}_${b64(vaultPath)}`;
export const barLayoutDefaultKey = (bar: BarId) => `barLayoutDefault_${bar}`;

/** Fired after any change so open surfaces re-read without a restart. */
export const BAR_LAYOUT_CHANGED_EVENT = "plainva-bar-layout-changed";
/**
 * "Customize bars…" — jumps into the settings area from a bar's context menu.
 * Reuses the established settings deep-link rather than adding a second
 * channel that would have to be wired and kept alive separately.
 */
export function openBarSettings(): void {
  window.dispatchEvent(new CustomEvent("plainva-open-sync-settings", { detail: { area: "bars" } }));
}

/**
 * `source` is the surface that caused the change. A surface ignores its own
 * event: it already holds the new value, and re-reading it would be a needless
 * round-trip through the store on every single move.
 */
function announce(bar: BarId, source?: string) {
  window.dispatchEvent(new CustomEvent(BAR_LAYOUT_CHANGED_EVENT, { detail: { bar, source } }));
}

export async function loadBarLayout(bar: BarId, vaultPath: string | null): Promise<AreaOrder> {
  const def = barDef(bar);
  try {
    const store = await getSettingsStore();
    const globalDefault = await store.get<unknown>(barLayoutDefaultKey(bar));
    const own = vaultPath ? await store.get<unknown>(barLayoutKey(bar, vaultPath)) : undefined;
    return resolveAreaOrder(own, globalDefault, def.spec);
  } catch {
    return sanitizeAreaOrder(undefined, def.spec);
  }
}

/** True while the vault follows the global default (nothing of its own stored). */
export async function barLayoutIsInherited(bar: BarId, vaultPath: string | null): Promise<boolean> {
  if (!vaultPath) return true;
  try {
    const store = await getSettingsStore();
    return (await store.get<unknown>(barLayoutKey(bar, vaultPath))) === undefined;
  } catch {
    return true;
  }
}

/** A deliberate change in this vault — from here on the vault value wins. */
export async function saveBarLayout(bar: BarId, vaultPath: string | null, value: AreaOrder, source?: string): Promise<void> {
  if (!vaultPath) return;
  const def = barDef(bar);
  const store = await getSettingsStore();
  const next = sanitizeAreaOrder(value, def.spec);
  const current = await store.get<unknown>(barLayoutKey(bar, vaultPath));
  if (current !== undefined && sameAreaOrder(sanitizeAreaOrder(current, def.spec), next)) return;
  await store.set(barLayoutKey(bar, vaultPath), next);
  await store.save();
  announce(bar, source);
}

/** Drops the vault value so the vault inherits the global default again. */
export async function resetBarLayout(bar: BarId, vaultPath: string | null): Promise<void> {
  if (!vaultPath) return;
  const store = await getSettingsStore();
  await store.delete(barLayoutKey(bar, vaultPath));
  await store.save();
  announce(bar);
}

/** Lifts the current arrangement into the global default for new vaults. */
export async function saveBarLayoutAsDefault(bar: BarId, value: AreaOrder): Promise<void> {
  const def = barDef(bar);
  const store = await getSettingsStore();
  await store.set(barLayoutDefaultKey(bar), sanitizeAreaOrder(value, def.spec));
  await store.save();
  announce(bar);
}

/** All four bars at once — the settings page loads them together. */
export async function loadAllBarLayouts(vaultPath: string | null): Promise<Record<BarId, AreaOrder>> {
  const entries = await Promise.all(BAR_DEFS.map(async (d) => [d.id, await loadBarLayout(d.id, vaultPath)] as const));
  return Object.fromEntries(entries) as Record<BarId, AreaOrder>;
}

// --- Migration of the three places that carried an arrangement before ---------
//
// The rail's order lived in the settings store under "ribbonOrder" (global),
// the right sidebar's in localStorage under one app-wide key, and the left
// sections' in localStorage PER VAULT. All three become bar layouts here.
//
// Global values become the global DEFAULT, not a vault value: the user arranged
// them before per-vault existed, so the arrangement they know should follow them
// into every vault — and stay adaptable per vault afterwards. The per-vault one
// becomes a vault value, because that is what it already was.
//
// Migration writes only where nothing is stored yet, so it can run on every
// start without ever overwriting a deliberate choice.

const LEGACY_RIBBON_KEY = "ribbonOrder";
const LEGACY_RIGHT_KEY = "plainva-right-panels-order";
const legacyLeftKey = (vaultPath: string) => `plainva-left-sections-${vaultPath}-order`;

function readLegacyArray(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : undefined;
  } catch {
    return undefined;
  }
}

export async function migrateLegacyBarLayouts(vaultPath: string | null): Promise<void> {
  let store;
  try {
    store = await getSettingsStore();
  } catch {
    return;
  }
  let touched = false;

  const seedDefault = async (bar: BarId, order: string[] | undefined) => {
    if (!order || order.length === 0) return;
    if ((await store.get<unknown>(barLayoutDefaultKey(bar))) !== undefined) return;
    const def = barDef(bar);
    await store.set(barLayoutDefaultKey(bar), sanitizeAreaOrder({ order, visibleCount: def.spec.known.length }, def.spec));
    touched = true;
  };

  // The rail: only the top group ever moved; the bottom one was never sortable.
  const legacyRibbon = await store.get<{ top?: unknown }>(LEGACY_RIBBON_KEY);
  const top = Array.isArray(legacyRibbon?.top)
    ? (legacyRibbon.top as unknown[]).filter((v): v is string => typeof v === "string")
    : undefined;
  await seedDefault("ribbon", top);

  try {
    await seedDefault("rightSections", readLegacyArray(localStorage.getItem(LEGACY_RIGHT_KEY)));

    if (vaultPath) {
      const legacyLeft = readLegacyArray(localStorage.getItem(legacyLeftKey(vaultPath)));
      if (legacyLeft && legacyLeft.length > 0 && (await store.get<unknown>(barLayoutKey("leftSections", vaultPath))) === undefined) {
        const def = barDef("leftSections");
        await store.set(
          barLayoutKey("leftSections", vaultPath),
          sanitizeAreaOrder({ order: legacyLeft, visibleCount: def.spec.known.length }, def.spec),
        );
        touched = true;
      }
    }
  } catch {
    // localStorage unavailable (never in the app, but keep the store part working)
  }

  if (touched) {
    await store.save();
    for (const def of BAR_DEFS) announce(def.id);
  }
}
