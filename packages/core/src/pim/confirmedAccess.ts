/**
 * How each device reaches a password calendar account (CalDAV, Nextcloud), as
 * that device itself confirmed it: the address and user it signs in with, and
 * the principal the server named for them (GitHub issue 174, Fehlerliste C13).
 *
 * One Nextcloud can be reached through more than one address — the public name
 * on the laptop, the LAN address on the phone — and the server resolves its
 * principal against the address it was asked through. A single "the address"
 * and "the principal" in the shared row therefore had two true values, and the
 * two devices wrote theirs over the other's on every import and every fetch:
 * two writes per cycle and device, forever, and in the window between them a
 * connect did not find its own row and added a second one.
 *
 * So every device keeps ITS entry, under its own device id, and only ever
 * writes that one. The import takes every other device's entry as that device
 * published it and never touches this device's own (`mergeConfirmedAccess`):
 * each entry has one writer, so the set settles after one exchange. Nothing is
 * removed by absence — a document from a device that does not know the key yet
 * leaves the set as it is.
 *
 * Bounded: at most `MAX_CONFIRMED_ACCESS` entries, the smallest device ids. The
 * bound is applied the same way on every write and every merge, so a device
 * whose id falls outside it does not keep adding itself back.
 */

/** The account config key that holds the map device id → `ConfirmedAccess`. It travels with the settings. */
export const CONFIRMED_ACCESS_KEY = "confirmedAccess";

/** The most devices one account row remembers an access for. */
export const MAX_CONFIRMED_ACCESS = 8;

export interface ConfirmedAccess {
  /** The address this device signs in with, as it typed it. */
  url: string;
  /** The user this device signs in with, as it typed it. */
  user: string;
  /** The `current-user-principal` the server named, resolved against `url`; absent when it named none. */
  principal?: string;
}

export type ConfirmedAccessMap = Record<string, ConfirmedAccess>;

function validAccess(value: unknown): ConfirmedAccess | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.url !== "string" || !v.url.trim() || typeof v.user !== "string" || !v.user.trim()) return null;
  return {
    url: v.url,
    user: v.user,
    ...(typeof v.principal === "string" && v.principal.trim() ? { principal: v.principal } : {}),
  };
}

function bounded(entries: Iterable<[string, ConfirmedAccess]>): ConfirmedAccessMap {
  const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).slice(0, MAX_CONFIRMED_ACCESS);
  return Object.fromEntries(sorted);
}

/** The valid entries of a config's map, bounded; `{}` when there is none. */
export function confirmedAccessOf(config: Record<string, unknown> | undefined | null): ConfirmedAccessMap {
  const raw = config?.[CONFIRMED_ACCESS_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const entries: [string, ConfirmedAccess][] = [];
  for (const [device, value] of Object.entries(raw as Record<string, unknown>)) {
    const access = validAccess(value);
    if (device && access) entries.push([device, access]);
  }
  return bounded(entries);
}

/** The map with THIS device's entry set to `access`. */
export function withOwnConfirmedAccess(map: ConfirmedAccessMap, deviceId: string, access: ConfirmedAccess): ConfirmedAccessMap {
  const own = validAccess(access);
  if (!deviceId || !own) return bounded(Object.entries(map));
  return bounded([...Object.entries(map).filter(([device]) => device !== deviceId), [deviceId, own]]);
}

/**
 * The map after an import: every device's entry as the document carries it,
 * except this device's own, which only this device writes; entries the document
 * does not carry stay. Without a device id every local entry wins over the
 * document's (nothing of the own entry can be lost that way).
 */
export function mergeConfirmedAccess(local: ConfirmedAccessMap, imported: ConfirmedAccessMap, deviceId?: string): ConfirmedAccessMap {
  const out = new Map<string, ConfirmedAccess>(Object.entries(local));
  for (const [device, access] of Object.entries(imported)) {
    if (!deviceId && out.has(device)) continue;
    if (device === deviceId && out.has(device)) continue;
    out.set(device, access);
  }
  return bounded(out);
}

/** `base` with every entry of `over` laid on top (an adopted row: the fresh connect's own entry wins). */
export function overlayConfirmedAccess(base: ConfirmedAccessMap, over: ConfirmedAccessMap): ConfirmedAccessMap {
  return bounded(Object.entries({ ...base, ...over }));
}

/** Whether two maps hold the same entries (key order aside). */
export function sameConfirmedAccess(a: ConfirmedAccessMap, b: ConfirmedAccessMap): boolean {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key, i) => {
    if (key !== keysB[i]) return false;
    const x = a[key];
    const y = b[key];
    return x.url === y.url && x.user === y.user && (x.principal ?? "") === (y.principal ?? "");
  });
}
