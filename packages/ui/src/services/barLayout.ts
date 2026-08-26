import {
  Bookmark,
  CalendarDays,
  CalendarRange,
  Clock,
  Command,
  Database,
  FilePlus,
  Folder,
  FolderPlus,
  Hash,
  Home,
  Link as LinkIcon,
  List,
  ListChecks,
  Mail,
  MessageSquare,
  Search,
  SlidersHorizontal,
  Sun,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { getPlatformServices } from "../platform/services";
import {
  resolveAreaOrder,
  sanitizeAreaOrder,
  sameAreaOrder,
  type AreaOrder,
  type AreaOrderSpec,
} from "../lib/orderedAreas";

/** The settings store, through the platform registry (ADR 0011) — this module
 *  is shared, so it must not know which shell it runs in. */
const getSettingsStore = () => getPlatformServices().loadSettings();

/**
 * What each bar carries and in which order — the action rail, both sidebars.
 *
 * Storage follows plan § 3: the value lives PER VAULT so it travels through the
 * settings profile, with a global default underneath. A vault without its own
 * value inherits, which means changing the default reaches every vault that was
 * never adapted; only a deliberate change inside a vault writes a vault value.
 * "Reset to default" therefore deletes rather than writes.
 */

export type BarId = "ribbon" | "leftTabs" | "leftSections" | "rightSections" | "mobileBar";

/** Every action the rail's TOP group can carry. The bottom group (help,
 *  settings) is fixed and deliberately outside this model — that is what makes
 *  E3 structural instead of a runtime check. */
export const RIBBON_AREA_IDS = ["new", "newFolder", "newBase", "open", "daily", "graph", "tasks", "calendar", "mail", "comments", "palette"] as const;
export const LEFT_TAB_IDS = ["files", "tags", "databases"] as const;
export const LEFT_SECTION_IDS = ["recents", "bookmarks"] as const;
export const RIGHT_SECTION_IDS = ["calendar", "outline", "graph", "databases", "backlinks", "properties"] as const;
/**
 * The phone's navigation bar (redesign E2). It carries WORK surfaces only —
 * tags, bookmarks and databases moved into the navigator in S9, because they
 * answer "what do I have", which is the left sidebar's question.
 *
 * "Areas" is NOT in this list. It is the bar's fixed last entry, the way to
 * everything outside it, and it sits outside the model for the same reason the
 * rail's Help and Settings do: a way back that a user can hide is not a way
 * back. Material allows 3–5 destinations, so with that fixed entry the
 * configurable part is 2–4 — four by default, which is the picture the mockup
 * shows (Notes · Today · Tasks · Calendar · Areas).
 */
export const MOBILE_BAR_IDS = ["notes", "today", "tasks", "calendar", "mail", "graph", "comments"] as const;

export interface BarAreaDef {
  id: string;
  /** i18n key of the name shown in settings and in the right-click menu. */
  labelKey: string;
  /**
   * The glyph the surface itself shows. It lives HERE and not in each bar, so
   * the settings list can be read against the interface — a row without its
   * icon is a row the eye has to translate back to a button.
   */
  icon: LucideIcon;
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
      { id: "new", labelKey: "common.newNote", icon: FilePlus },
      { id: "newFolder", labelKey: "sidebar.newFolder", icon: FolderPlus },
      { id: "newBase", labelKey: "sidebar.newBase", icon: Database },
      { id: "open", labelKey: "editor.openFile", icon: Search },
      { id: "daily", labelKey: "sidebar.newDaily", icon: Sun },
      { id: "graph", labelKey: "graph.open", icon: Waypoints },
      { id: "tasks", labelKey: "tasks.openTasks", icon: ListChecks },
      { id: "calendar", labelKey: "pim.openCalendar", icon: CalendarRange },
      { id: "mail", labelKey: "mail.openMail", icon: Mail },
      { id: "comments", labelKey: "workspaceSecurity.commentOverview", icon: MessageSquare },
      { id: "palette", labelKey: "palette.title", icon: Command },
    ],
  },
  {
    id: "leftTabs",
    titleKey: "bars.leftTabs",
    descriptionKey: "bars.leftTabsDesc",
    spec: { known: LEFT_TAB_IDS, alwaysVisible: ["files"], defaultVisibleCount: LEFT_TAB_IDS.length },
    areas: [
      { id: "files", labelKey: "sidebar.files", icon: Folder },
      { id: "tags", labelKey: "sidebar.tags", icon: Hash },
      { id: "databases", labelKey: "sidebar.databases", icon: Database },
    ],
  },
  {
    id: "leftSections",
    titleKey: "bars.leftSections",
    descriptionKey: "bars.leftSectionsDesc",
    spec: { known: LEFT_SECTION_IDS, defaultVisibleCount: LEFT_SECTION_IDS.length },
    areas: [
      { id: "recents", labelKey: "sidebar.recent", icon: Clock },
      { id: "bookmarks", labelKey: "sidebar.bookmarks", icon: Bookmark },
    ],
  },
  {
    id: "rightSections",
    titleKey: "bars.rightSections",
    descriptionKey: "bars.rightSectionsDesc",
    spec: { known: RIGHT_SECTION_IDS, defaultVisibleCount: RIGHT_SECTION_IDS.length },
    areas: [
      { id: "calendar", labelKey: "rightPanel.calendar", icon: CalendarDays },
      { id: "outline", labelKey: "rightPanel.outline", icon: List },
      { id: "graph", labelKey: "rightPanel.graph", icon: Waypoints },
      { id: "databases", labelKey: "rightPanel.databases", icon: Database },
      { id: "backlinks", labelKey: "rightPanel.backlinks", icon: LinkIcon },
      { id: "properties", labelKey: "rightPanel.properties", icon: SlidersHorizontal },
    ],
  },
  {
    id: "mobileBar",
    titleKey: "bars.mobileBar",
    descriptionKey: "bars.mobileBarDesc",
    // Notes is pinned: it is the navigator, and hiding it would leave the
    // phone without a way to its own files.
    spec: { known: MOBILE_BAR_IDS, alwaysVisible: ["notes"], minVisible: 2, maxVisible: 4, defaultVisibleCount: 4 },
    areas: [
      { id: "notes", labelKey: "mobile.tabHome", icon: Home },
      { id: "today", labelKey: "mobile.tabToday", icon: Sun },
      { id: "tasks", labelKey: "tasks.title", icon: ListChecks },
      { id: "calendar", labelKey: "mobile.tabCalendar", icon: CalendarDays },
      { id: "mail", labelKey: "mail.title", icon: Mail },
      { id: "graph", labelKey: "rightPanel.graph", icon: Waypoints },
      { id: "comments", labelKey: "workspaceSecurity.commentOverview", icon: MessageSquare },
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

/** Every bar at once — the settings page loads them together. */
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

  // An action added by an APP UPDATE has to arrive where it belongs. Stored
  // arrangements are {order, visibleCount}, and sanitizeAreaOrder appends
  // unknown-to-the-store ids at the END — below the visible run, so a new rail
  // button would exist but be hidden, and the update would look like it did
  // nothing. Insert it after the area it belongs next to and grow the count
  // when that neighbour is itself visible: offered by default, hideable in one
  // click. Runs once per stored value; a user who later hides it keeps it
  // hidden, because from then on the id IS in the stored order.
  touched =
    (await adoptNewAreas(store, vaultPath, "ribbon", { newFolder: "new", newBase: "newFolder", comments: "mail" })) ||
    touched;

  if (touched) {
    await store.save();
    for (const def of BAR_DEFS) announce(def.id);
  }
}

type BarStore = Awaited<ReturnType<typeof getSettingsStore>>;

/**
 * @param after  new area id -> the id it should follow
 */
async function adoptNewAreas(
  store: BarStore,
  vaultPath: string | null,
  bar: BarId,
  after: Record<string, string>,
): Promise<boolean> {
  const def = barDef(bar);
  const keys = [barLayoutDefaultKey(bar), ...(vaultPath ? [barLayoutKey(bar, vaultPath)] : [])];
  let changed = false;

  for (const key of keys) {
    const raw = await store.get<unknown>(key);
    if (raw === undefined) continue; // nothing stored: the spec default already has it
    const stored = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Partial<AreaOrder>) : {};
    const order = Array.isArray(stored.order) ? stored.order.filter((v): v is string => typeof v === "string") : [];
    if (order.length === 0) continue;
    let count = typeof stored.visibleCount === "number" ? stored.visibleCount : order.length;
    let dirty = false;

    for (const [id, predecessor] of Object.entries(after)) {
      if (order.includes(id)) continue;
      const at = order.indexOf(predecessor);
      const index = at >= 0 ? at + 1 : order.length;
      order.splice(index, 0, id);
      if (index < count) count += 1;
      dirty = true;
    }
    if (!dirty) continue;
    await store.set(key, sanitizeAreaOrder({ order, visibleCount: count }, def.spec));
    changed = true;
  }
  return changed;
}
