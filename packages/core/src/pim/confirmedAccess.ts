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
 * each entry has one writer, so the set settles after one exchange.
 *
 * Which access the shared document names, and which entries it keeps, goes by
 * WHEN each was confirmed (review 2026-11-18): `since` is the moment a device
 * first confirmed that access — it stays while the address, user and principal
 * stay, so re-confirming on every fetch never moves it, and it moves when any
 * of them changes. The document names the latest one (`latestConfirmedAccess`;
 * a tie goes to the smaller device id), so a server move repaired on one
 * device reaches a new device even while an older device still names the old
 * address. The bound keeps the `MAX_CONFIRMED_ACCESS` latest entries, so a
 * retired device falls out and an active one never does; a device's own entry
 * goes with "Remove account" and "Sign out on this device"
 * (`withoutOwnConfirmedAccess`).
 *
 * An import takes the other devices' entries as the document carries them —
 * a document that carries the key at all is complete, so an entry it lacks was
 * taken out by its owner — and never this device's own, which only this
 * device writes or removes. A document without the key (a device up to 0.8.7)
 * changes nothing.
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
  /** When this device first confirmed exactly this access (ISO time); absent on an entry written before it was recorded. */
  since?: string;
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
    ...(typeof v.since === "string" && v.since.trim() ? { since: v.since } : {}),
  };
}

/** Whether two entries name the same access — address, user and principal; `since` aside. */
export function sameAccessValue(a: ConfirmedAccess, b: ConfirmedAccess): boolean {
  return a.url === b.url && a.user === b.user && (a.principal ?? "") === (b.principal ?? "");
}

/** Later first: the latest `since`, a tie to the smaller device id. */
function byRecency([deviceA, a]: [string, ConfirmedAccess], [deviceB, b]: [string, ConfirmedAccess]): number {
  const sinceA = a.since ?? "";
  const sinceB = b.since ?? "";
  if (sinceA !== sinceB) return sinceA > sinceB ? -1 : 1;
  return deviceA < deviceB ? -1 : deviceA > deviceB ? 1 : 0;
}

function bounded(entries: Iterable<[string, ConfirmedAccess]>): ConfirmedAccessMap {
  const kept = [...entries].sort(byRecency).slice(0, MAX_CONFIRMED_ACCESS);
  // Stored in device-id order, so the same set always serializes the same way.
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(kept);
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

/** Whether a config carries the key at all — a document from a device that knows it, complete. */
export function carriesConfirmedAccess(config: Record<string, unknown> | undefined | null): boolean {
  const raw = config?.[CONFIRMED_ACCESS_KEY];
  return !!raw && typeof raw === "object" && !Array.isArray(raw);
}

/** The entry the shared document names: the latest confirmed, a tie to the smaller device id. */
export function latestConfirmedAccess(map: ConfirmedAccessMap): [string, ConfirmedAccess] | null {
  const sorted = Object.entries(map).sort(byRecency);
  return sorted[0] ?? null;
}

/** The time now, strictly after the last one handed out here: two entries confirmed in one millisecond keep their order. */
let lastStamp = 0;
function stampNow(): string {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp).toISOString();
}

/**
 * The map with THIS device's entry set to `access`. Its `since` stays when the
 * access is the one already recorded, and is `now` when it is new or changed.
 */
export function withOwnConfirmedAccess(map: ConfirmedAccessMap, deviceId: string, access: ConfirmedAccess, now: string = stampNow()): ConfirmedAccessMap {
  const fresh = validAccess(access);
  if (!deviceId || !fresh) return bounded(Object.entries(map));
  const previous = map[deviceId];
  const since = previous && sameAccessValue(previous, fresh) && previous.since ? previous.since : now;
  const own: ConfirmedAccess = { url: fresh.url, user: fresh.user, ...(fresh.principal ? { principal: fresh.principal } : {}), since };
  return bounded([...Object.entries(map).filter(([device]) => device !== deviceId), [deviceId, own]]);
}

/** The map without THIS device's entry ("Remove account", "Sign out on this device"). */
export function withoutOwnConfirmedAccess(map: ConfirmedAccessMap, deviceId: string): ConfirmedAccessMap {
  return bounded(Object.entries(map).filter(([device]) => device !== deviceId));
}

/**
 * The map after an import. This device's own entry is the local one, or none:
 * only this device writes or removes it. Every other device's entry is the
 * document's when the document carries the key (`importedCarriesKey`), so an
 * entry its owner took out goes here too; a document without the key leaves
 * the local entries as they are. Without a device id every local entry wins
 * and the document only adds (nothing of the own entry can be lost that way).
 */
export function mergeConfirmedAccess(local: ConfirmedAccessMap, imported: ConfirmedAccessMap, deviceId?: string, importedCarriesKey = true): ConfirmedAccessMap {
  if (!deviceId) return bounded(Object.entries({ ...imported, ...local }));
  const out = new Map<string, ConfirmedAccess>();
  const own = local[deviceId];
  if (own) out.set(deviceId, own);
  const others = importedCarriesKey ? imported : local;
  for (const [device, access] of Object.entries(others)) {
    if (device !== deviceId) out.set(device, access);
  }
  return bounded(out);
}

/**
 * `base` with every entry of `over` laid on top (an adopted row: the fresh
 * connect's own entry wins). An entry that names the access `base` already
 * had keeps base's `since`.
 */
export function overlayConfirmedAccess(base: ConfirmedAccessMap, over: ConfirmedAccessMap): ConfirmedAccessMap {
  const out: ConfirmedAccessMap = { ...base };
  for (const [device, access] of Object.entries(over)) {
    const previous = base[device];
    out[device] = previous && sameAccessValue(previous, access) && previous.since ? { ...access, since: previous.since } : access;
  }
  return bounded(Object.entries(out));
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
    return sameAccessValue(x, y) && (x.since ?? "") === (y.since ?? "");
  });
}
