import { sameStoredValue } from "@plainva/core";
import { parseCustomThemeDesign, type CustomThemeDesign } from "./customThemeDesign";

type ThemeClock = Record<string, number>;
export interface CustomThemeVariant {
  device: string;
  counter: number;
  clock: ThemeClock;
  design: CustomThemeDesign;
}
/** Multi-value register: concurrent designs survive until an explicit edit/choice. */
export interface CustomThemeProfile { version: 1; variants: CustomThemeVariant[] }
const MAX_DEVICES = 64, MAX_VARIANTS = 32, MAX_BYTES = 256 * 1024;
const deviceId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,96}$/.test(value);
const counterValue = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const byId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const variantId = (v: CustomThemeVariant) => `${v.device}:${v.counter}`;
const clockValue = (clock: ThemeClock, id: string): number => Object.prototype.hasOwnProperty.call(clock, id) ? clock[id] : 0;

function parseClock(raw: unknown): ThemeClock | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entries = Object.entries(raw);
  if (!entries.length || entries.length > MAX_DEVICES || entries.some(([id, count]) => !deviceId(id) || !counterValue(count))) return null;
  return Object.fromEntries(entries.sort(([a], [b]) => byId(a, b))) as ThemeClock;
}

function dominates(a: ThemeClock, b: ThemeClock): boolean {
  return Object.entries(b).every(([id, count]) => clockValue(a, id) >= count)
    && Object.entries(a).some(([id, count]) => count > clockValue(b, id));
}

function normalize(variants: CustomThemeVariant[]): CustomThemeProfile {
  const unique = new Map<string, CustomThemeVariant>();
  for (const variant of variants) {
    const id = variantId(variant), previous = unique.get(id);
    if (previous && !sameStoredValue(previous, variant)) throw new Error("custom_theme_revision_collision");
    unique.set(id, variant);
  }
  const all = [...unique.values()];
  // Identical causal clocks with different content are not a valid fork.
  for (let i = 0; i < all.length; i++) for (let j = 0; j < i; j++) {
    if (sameStoredValue(all[i].clock, all[j].clock) && !sameStoredValue(all[i].design, all[j].design)) throw new Error("custom_theme_revision_collision");
  }
  const heads = all.filter(v => !all.some(other => dominates(other.clock, v.clock)));
  if (heads.length > MAX_VARIANTS || new Set(heads.flatMap(v => Object.keys(v.clock))).size > MAX_DEVICES) throw new Error("custom_theme_profile_limit");
  const result: CustomThemeProfile = { version: 1, variants: heads.sort((a, b) => byId(variantId(a), variantId(b))) };
  if (JSON.stringify(result).length > MAX_BYTES) throw new Error("custom_theme_profile_limit");
  return result;
}

export function parseCustomThemeProfile(raw: unknown): CustomThemeProfile | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.version !== 1 || !Array.isArray(value.variants) || !value.variants.length || value.variants.length > MAX_VARIANTS) return null;
  const variants: CustomThemeVariant[] = [];
  for (const entry of value.variants) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const v = entry as Record<string, unknown>, clock = parseClock(v.clock);
    const design = parseCustomThemeDesign(v.design);
    if (!deviceId(v.device) || !counterValue(v.counter) || !clock || clock[v.device] !== v.counter || !design || (v.design as { version?: unknown }).version !== 2) return null;
    variants.push({ device: v.device, counter: v.counter, clock, design });
  }
  try { return normalize(variants); } catch { return null; }
}

export function mergeCustomThemeProfiles(left: CustomThemeProfile | null, right: CustomThemeProfile | null): CustomThemeProfile | null {
  if (!left && !right) return null;
  return normalize([...(left?.variants ?? []), ...(right?.variants ?? [])]);
}

/** Use the editor's observed baseline, then merge with the latest stored value.
 * An unseen remote edit must remain concurrent, not be overwritten by a stale UI. */
export function reviseCustomThemeProfile(baseline: CustomThemeProfile | null, device: string, design: CustomThemeDesign): CustomThemeProfile {
  if (!deviceId(device)) throw new Error("custom_theme_device_invalid");
  const clock: ThemeClock = Object.create(null);
  for (const variant of baseline?.variants ?? []) for (const [id, count] of Object.entries(variant.clock)) clock[id] = Math.max(clock[id] ?? 0, count);
  const counter = (clock[device] ?? 0) + 1;
  if (!counterValue(counter)) throw new Error("custom_theme_profile_limit");
  clock[device] = counter;
  const canonicalClock = parseClock(clock), canonicalDesign = parseCustomThemeDesign(design);
  if (!canonicalClock || !canonicalDesign) throw new Error("custom_theme_profile_invalid");
  return normalize([{ device, counter, clock: canonicalClock, design: canonicalDesign }]);
}

export function customThemeVariantId(variant: CustomThemeVariant): string { return variantId(variant); }
