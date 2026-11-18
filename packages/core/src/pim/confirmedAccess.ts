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
 * the ORDER in which they were confirmed (reviews 2026-11-18): `seq` is set to
 * the row's highest number plus one when a device confirms a CHANGED access,
 * and stays while address, user and principal stay. No clock is involved, so a
 * device whose clock is wrong gains nothing. The document names the entry with
 * the highest number (`latestConfirmedAccess`; a tie goes to the smaller
 * device id) — what a NEW device signs in with; a device that has its own row
 * keeps its own address and never sends its password anywhere else. The bound
 * keeps the `MAX_CONFIRMED_ACCESS` highest numbers, so a retired device falls
 * out and an active one never does; a device's own entry goes with "Sign out
 * on this device" (`withoutOwnConfirmedAccess`).
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

/**
 * The highest number a confirmation can carry (review 2026-11-18, O2). A row
 * gains one per changed access — no honest row comes near it. A `seq` outside
 * 1…MAX_CONFIRMED_SEQ, or no whole number, counts as none: a document that
 * carries 2^53 − 1 would otherwise win for ever and leave the next number
 * unsafe for every honest entry.
 */
export const MAX_CONFIRMED_SEQ = 1_000_000_000;

export interface ConfirmedAccess {
  /** The address this device signs in with, as it typed it. */
  url: string;
  /** The user this device signs in with, as it typed it. */
  user: string;
  /** The `current-user-principal` the server named, resolved against `url`; absent when it named none. */
  principal?: string;
  /** Its place in the order of confirmations of this row: the row's highest number plus one when a device confirmed a changed access; absent (0) on an entry written before it was recorded. */
  seq?: number;
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
    ...(typeof v.seq === "number" && Number.isInteger(v.seq) && v.seq > 0 && v.seq <= MAX_CONFIRMED_SEQ ? { seq: v.seq } : {}),
  };
}

/** Whether two entries name the same access — address, user and principal; `seq` aside. */
export function sameAccessValue(a: ConfirmedAccess, b: ConfirmedAccess): boolean {
  return a.url === b.url && a.user === b.user && (a.principal ?? "") === (b.principal ?? "");
}

/** Later first: the highest `seq`, a tie to the smaller device id. */
function byRecency([deviceA, a]: [string, ConfirmedAccess], [deviceB, b]: [string, ConfirmedAccess]): number {
  const seqA = a.seq ?? 0;
  const seqB = b.seq ?? 0;
  if (seqA !== seqB) return seqB - seqA;
  return deviceA < deviceB ? -1 : deviceA > deviceB ? 1 : 0;
}

/** The next number of this row: its highest plus one. */
function nextSeq(map: ConfirmedAccessMap): number {
  return Math.max(0, ...Object.values(map).map((access) => access.seq ?? 0)) + 1;
}

/**
 * The map with `device` confirmed as the LATEST access: the next number, and
 * at the top of the range the top itself, every other entry one below at most
 * (review 2026-11-18, O2) — a repair on this device wins against every entry
 * of the document, also one that sits at the upper edge.
 */
function asLatest(map: ConfirmedAccessMap, device: string, access: ConfirmedAccess): ConfirmedAccessMap {
  const others = Object.entries(map).filter(([id]) => id !== device);
  const next = nextSeq(Object.fromEntries(others));
  if (next <= MAX_CONFIRMED_SEQ) return { ...Object.fromEntries(others), [device]: { ...access, seq: next } };
  return {
    ...Object.fromEntries(others.map(([id, other]) => [id, { ...other, seq: Math.min(other.seq ?? 0, MAX_CONFIRMED_SEQ - 1) || undefined }])),
    [device]: { ...access, seq: MAX_CONFIRMED_SEQ },
  };
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

/** The entry the shared document names — what a new device signs in with: the highest number, a tie to the smaller device id. */
export function latestConfirmedAccess(map: ConfirmedAccessMap): [string, ConfirmedAccess] | null {
  const sorted = Object.entries(map).sort(byRecency);
  return sorted[0] ?? null;
}

/**
 * The map with THIS device's entry set to `access`. Its number stays when the
 * access is the one already recorded, and is the row's next one when it is
 * new or changed.
 */
export function withOwnConfirmedAccess(map: ConfirmedAccessMap, deviceId: string, access: ConfirmedAccess): ConfirmedAccessMap {
  const fresh = validAccess(access);
  if (!deviceId || !fresh) return bounded(Object.entries(map));
  const previous = map[deviceId];
  const own: ConfirmedAccess = { url: fresh.url, user: fresh.user, ...(fresh.principal ? { principal: fresh.principal } : {}) };
  if (previous && sameAccessValue(previous, fresh) && previous.seq) {
    return bounded([...Object.entries(map).filter(([device]) => device !== deviceId), [deviceId, { ...own, seq: previous.seq }]]);
  }
  return bounded(Object.entries(asLatest(map, deviceId, own)));
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
 * had keeps base's number; any other gets base's next one.
 */
export function overlayConfirmedAccess(base: ConfirmedAccessMap, over: ConfirmedAccessMap): ConfirmedAccessMap {
  let out: ConfirmedAccessMap = { ...base };
  for (const [device, access] of Object.entries(over)) {
    const previous = base[device];
    out = previous && sameAccessValue(previous, access) && previous.seq
      ? { ...out, [device]: { ...access, seq: previous.seq } }
      : asLatest(out, device, access);
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
    return sameAccessValue(x, y) && (x.seq ?? 0) === (y.seq ?? 0);
  });
}
