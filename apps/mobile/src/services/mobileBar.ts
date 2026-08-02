import {
  barLayoutKey,
  barDef,
  loadBarLayout,
  saveBarLayout,
  sanitizeAreaOrder,
  visibleAreas,
  type AreaOrder,
} from "@plainva/ui";
import { getPlatformServices } from "@plainva/ui";
import { getMobileSettings, updateMobileSettings } from "./mobileSettings";
import type { TabScreenId } from "../navigation";

/**
 * The phone's navigation bar, read from the SHARED bar model (redesign E2 / S10).
 *
 * Until now the phone kept its own two settings — a list of areas (`tabSlots`)
 * and how many of them the bar showed (`barTabCount`) — while the desktop had
 * four bars in one model with visibility, order, a per-vault value and a global
 * default. Two models for the same idea is how the two shells drift: the phone
 * could not be arranged from the desktop, and its arrangement did not travel.
 *
 * The bar is now `barLayout`'s fifth bar. Everything that follows from that
 * comes for free: the desktop settings page lists it because it iterates the bar
 * definitions, and the arrangement travels in the settings profile.
 */

const BAR = "mobileBar" as const;

/** The bar's areas, in order, as the shell knows them. */
export function mobileBarTabs(value: AreaOrder): TabScreenId[] {
  return visibleAreas(value) as TabScreenId[];
}

export function loadMobileBar(vaultId: string | null): Promise<AreaOrder> {
  return loadBarLayout(BAR, vaultId);
}

export function saveMobileBar(vaultId: string | null, value: AreaOrder, source?: string): Promise<void> {
  return saveBarLayout(BAR, vaultId, value, source);
}

/**
 * The one-time move of the old two settings into the bar layout.
 *
 * Runs only where the vault has nothing stored yet, so it can run on every
 * start without ever overwriting a deliberate choice — the same rule the
 * desktop's own legacy migration follows.
 *
 * Three of the old areas are gone: tags, bookmarks and databases became
 * navigator sections in S9, and search was never a place, it is an action. They
 * are dropped here rather than mapped onto something else — a bar entry that
 * silently turns into a different screen would be worse than an entry that is
 * simply no longer offered. What survives keeps its relative order — with the
 * one exception the model insists on: Notes leads, because it is pinned.
 */
export async function migrateMobileBarLayout(vaultId: string | null): Promise<void> {
  if (!vaultId) return;
  const def = barDef(BAR);
  const known = new Set<string>(def.spec.known);
  let store;
  try {
    store = await getPlatformServices().loadSettings();
  } catch {
    return;
  }
  if ((await store.get<unknown>(barLayoutKey(BAR, vaultId))) !== undefined) return;

  const s = getMobileSettings();
  const legacy = Array.isArray(s.tabSlots) ? s.tabSlots.filter((id): id is string => typeof id === "string") : [];
  const survivors = legacy.filter((id) => known.has(id));
  if (survivors.length === 0) return;

  // The old count was "how many of the slots the bar shows". Areas that no
  // longer exist were in that run too, so counting them would leave the bar
  // shorter than the user set it — count what survived within the old run.
  const rawCount = typeof s.barTabCount === "number" ? s.barTabCount : survivors.length;
  const withinRun = legacy.slice(0, Math.max(0, rawCount)).filter((id) => known.has(id)).length;

  await store.set(
    barLayoutKey(BAR, vaultId),
    sanitizeAreaOrder({ order: survivors, visibleCount: withinRun }, def.spec),
  );
  await store.save();
}

/**
 * Keeps the legacy fields in step with the bar, so a phone that is downgraded —
 * or a copy of Plainva that has not been updated yet — still finds a bar it
 * understands. Cheap, and the alternative is a device that loses its bar.
 */
export function mirrorLegacyBarFields(value: AreaOrder): void {
  void updateMobileSettings({
    tabSlots: value.order as TabScreenId[],
    barTabCount: value.visibleCount,
  });
}
