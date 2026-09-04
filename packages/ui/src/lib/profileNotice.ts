/**
 * When the "settings adopted from another device" notice is worth showing.
 *
 * The notice used to appear on nearly every cycle — every ~30 seconds, on a
 * device where nothing had changed (report 2026-07-29). The cause was an export
 * that did not round-trip (see `accountProfile`: device-dependent order and
 * parked device state), and that is fixed at the root. This is the second half:
 * even with a genuine change, an announcement is worth exactly one interruption.
 * Afterwards the diagnostics record carries it, naming the fields.
 *
 * The memory is per vault and PERSISTENT (feedback round 2026-09-01, M5): it
 * used to live in a module-level set, which a phone — restarting the app all
 * day — emptied every time, so "once" meant "once per start". What is
 * remembered is the change itself, the sorted field names: the same change
 * arriving again is not news, a different one is. Without storage (tests,
 * headless) the session set stands in.
 */
import { stableStringify } from "@plainva/core";
import { PROFILE_FIELDS } from "./profileFields";

/** Where the notice memory lives: localStorage on the desktop, the settings
 * store on the phone (a WebView's localStorage is not the store the rest of
 * the app trusts with anything durable - finding 2026-09-04). */
export interface ProfileNoticeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
type StorageLike = ProfileNoticeStorage;

const defaultStorage = (): StorageLike | null => (typeof localStorage === "undefined" ? null : localStorage);
const storageKey = (vaultKey: string) => `plainva-profile-announced-${vaultKey}`;
const announced = new Map<string, string>();

/**
 * What was announced: the sorted field names AND, when the caller has them,
 * the adopted values. Names alone let the same state count as news whenever
 * the cycle cut the change differently - the values say whether anything the
 * user would recognise actually moved (finding 2026-09-04).
 */
function signature(changedNames: readonly string[], changedValues?: Readonly<Record<string, unknown>>): string {
  const names = [...changedNames].sort();
  if (!changedValues) return JSON.stringify(names);
  return JSON.stringify(names.map((name) => [name, stableStringify(changedValues[name])]));
}

/**
 * True for a real change that has not been announced before, on this device,
 * for this vault — across restarts.
 *
 * @param changedNames the fields that actually differed; an empty list means the
 *        cycle only re-stamped values, which is not something to interrupt over.
 */
export function shouldAnnounceProfileImport(
  vaultKey: string,
  changedNames: readonly string[],
  storage: StorageLike | null = defaultStorage(),
  changedValues?: Readonly<Record<string, unknown>>,
): boolean {
  if (changedNames.length === 0) return false;
  const sig = signature(changedNames, changedValues);
  let last: string | null = announced.get(vaultKey) ?? null;
  try {
    last = storage?.getItem(storageKey(vaultKey)) ?? last;
  } catch {
    /* fall back to the session memory */
  }
  if (last === sig) return false;
  announced.set(vaultKey, sig);
  try {
    storage?.setItem(storageKey(vaultKey), sig);
  } catch {
    /* not persisted: the session memory still holds it */
  }
  return true;
}

/** Forgets the notice state — the vault was closed, or the device signed out. */
export function clearProfileAnnouncement(vaultKey: string, storage: StorageLike | null = defaultStorage()): void {
  announced.delete(vaultKey);
  try {
    storage?.removeItem(storageKey(vaultKey));
  } catch {
    /* nothing to forget */
  }
}

/**
 * Which areas of the settings a change touched — the i18n keys of their
 * labels, in catalog order and without repeats — so the notice can say WHAT
 * changed instead of only that something did (M5). Names the catalog does not
 * know are skipped; an empty result means "say it the generic way".
 */
export function profileChangeAreaKeys(changedNames: readonly string[]): string[] {
  const names = new Set(changedNames);
  const areas: string[] = [];
  for (const field of PROFILE_FIELDS) {
    if (!names.has(field.logical)) continue;
    const key = `settingsSync.area_${field.area}`;
    if (!areas.includes(key)) areas.push(key);
  }
  return areas;
}
