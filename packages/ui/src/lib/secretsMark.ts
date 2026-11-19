import type { SecretsPortMeta } from "./secretsPort";
import type { ISettingsStore } from "../platform/settings";

/**
 * The marks the secrets sync keeps about a password (review 2026-11-18,
 * rounds eight and nine, F67).
 *
 * To tell "unchanged" from "changed", the port remembers each password it
 * published or took as a mark of its binding and secret. Up to now that mark
 * was the text itself — `stableStringify({ binding, secret })` — kept in the
 * ordinary settings store (`plainva-settings.json` on the desktop, the app's
 * settings on the phone, which the system backup copies), so every password
 * stood there in plain text, since 0.5.0.
 *
 * A mark is now `m1:<key id>.<HMAC-SHA-256>` of that same text under a random
 * key of this device. The key lives where the passwords live, in the
 * credentials store (`SECRETS_MARK_KEY_SLOT`), never in the settings store.
 * Because the input is exactly the old text, an old mark turns into the new
 * mark of the same pair (`sealSecretsMeta`): no revision moves, no time, no
 * upload.
 *
 * Knowledge is never thrown away and never guessed:
 *  - A credentials store that does not answer is an error, not "no key": the
 *    port does not run and nothing is sealed; the next start tries again, and
 *    the old marks stay as they are until then.
 *  - Only a key that is missing on a device without any mark is made fresh.
 *    A key missing while marks of it exist (the store lost that one item) is
 *    made anew too — the port needs one — but every mark of the lost key is
 *    known by its key id as knowledge this device lost (`ownsMark`), and the
 *    port restores it from the shared document instead of taking anything as
 *    a change (`secretsPort.ts`).
 *  - An empty slot has its own mark, the mark of no secret: a password typed
 *    later is a change made here.
 *
 * The records also move to a new name in the settings store
 * (`secretsMetaStorageKey`): a device that goes back to 0.8.7 finds no record
 * under the name that version reads and starts like a new device — revision 1
 * from its own slots, which beats nothing newer. Coming back to this version,
 * what 0.8.7 knew in between is taken in (`mergeLegacySecretsMeta`).
 */
export const SECRETS_MARK_KEY_SLOT = "settingsSyncSecretsMarkKey";

const PREFIX = "m1:";

export interface SecretsMarker {
  (text: string): Promise<string>;
  /** Whether a mark was made with this device's current key. */
  owns(mark: string): boolean;
}

/** Where the key is kept: the same credentials store the passwords use. */
export interface SecretsMarkSlots {
  readSlot(slot: string): Promise<unknown>;
  writeSlot(slot: string, value: unknown): Promise<void>;
  /**
   * Reads the key, telling "not there" (null) from "the store does not
   * answer" (throws). A host without it reads through `readSlot`.
   */
  readMarkKey?(): Promise<unknown>;
}

/** A mark as this file writes it, with any key; anything else that is not "" is an old plain mark. */
export const isSecretsMark = (value: string): boolean => value.startsWith(PREFIX);

const HEX_KEY = /^[0-9a-f]{64}$/;

/**
 * Whether a record holds marks made with a key — knowledge a new key would
 * lose. An old plain mark is none (round eleven): it is sealed with whatever
 * key there is, nothing of it is lost.
 */
export const holdsSecretsMarks = (meta: SecretsPortMeta | null | undefined): boolean =>
  !!meta &&
  (Object.values(meta.entries ?? {}).some((entry) => typeof entry?.hash === "string" && isSecretsMark(entry.hash)) ||
    (typeof meta.settled === "string" && isSecretsMark(meta.settled)));

// The first two callers on a fresh device must not each make a key: the
// second would overwrite the first, and every mark made with it would be
// wrong. Key reads and the one creation run one after the other.
let keyQueue: Promise<unknown> = Promise.resolve();

async function deviceKey(slots: SecretsMarkSlots, marksExist: boolean): Promise<string> {
  const run = async (): Promise<string> => {
    let stored: unknown;
    try {
      stored = slots.readMarkKey ? await slots.readMarkKey() : await slots.readSlot(SECRETS_MARK_KEY_SLOT);
    } catch (error) {
      // Not answering is not "no key". Only where there is no mark to lose —
      // a first run on a device whose keychain is not reachable at all, where
      // the passwords live in the credentials file — is a key made anyway.
      if (marksExist) throw error;
      stored = null;
    }
    if (typeof stored === "string" && HEX_KEY.test(stored)) return stored;
    if (stored !== null && stored !== undefined) throw new Error("secrets mark key is unreadable");
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const fresh = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    await slots.writeSlot(SECRETS_MARK_KEY_SLOT, fresh);
    // Read back: a store that took the write but returns something else
    // (or nothing) gives no key to mark with.
    const back = slots.readMarkKey ? await slots.readMarkKey() : await slots.readSlot(SECRETS_MARK_KEY_SLOT);
    if (back !== fresh) throw new Error("secrets mark key could not be stored");
    return fresh;
  };
  const next = keyQueue.then(run, run);
  keyQueue = next.catch(() => undefined);
  return next;
}

const base64url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=$/, "").replace(/=$/, "");
};

/**
 * The marker of this device. `marksExist`: whether the records it will read
 * hold marks — then a store that does not answer is an error.
 */
export async function secretsMarker(slots: SecretsMarkSlots, marksExist = true): Promise<SecretsMarker> {
  const hex = await deviceKey(slots, marksExist);
  const raw = new Uint8Array(hex.match(/../g)!.map((pair) => parseInt(pair, 16)));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const encoder = new TextEncoder();
  const sign = async (text: string) => new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(text)));
  const id = base64url(await sign("plainva secrets mark key id")).slice(0, 8);
  const own = `${PREFIX}${id}.`;
  const mark = async (text: string) => own + base64url(await sign(text));
  return Object.assign(mark, { owns: (value: string) => value.startsWith(own) });
}

/**
 * Turns every old plain mark of one vault's record into the mark of the same
 * pair. True when anything changed. A mark of another key is left as it is:
 * it is knowledge this device lost, which the port restores (`ownsMark`).
 */
export async function sealSecretsMeta(meta: SecretsPortMeta, mark: SecretsMarker): Promise<boolean> {
  let changed = false;
  for (const entry of Object.values(meta.entries)) {
    if (!entry.hash || isSecretsMark(entry.hash)) continue;
    entry.hash = await mark(entry.hash);
    changed = true;
  }
  return changed;
}

/**
 * What 0.8.7 knew, under its own name for the record, taken into this
 * version's record when both are there (a device that went back to 0.8.7 and
 * came forward again): the entries of the old types and their marks of having
 * been received are the newer word, since only 0.8.7 wrote them meanwhile;
 * everything of the current types stays. Either alone is returned as it is.
 */
export function mergeLegacySecretsMeta(current: SecretsPortMeta | null, legacy: SecretsPortMeta | null): SecretsPortMeta | null {
  if (!legacy) return current;
  if (!current) return legacy;
  const out: SecretsPortMeta = { ...current, entries: { ...current.entries }, imported: { ...current.imported }, quarantine: { ...current.quarantine, ...legacy.quarantine } };
  const legacyTypes = new Set(["caldav-password", "imap-password"]);
  for (const [id, entry] of Object.entries(current.entries)) {
    if (legacyTypes.has(entry.binding.secretType)) {
      delete out.entries[id];
      delete out.imported[id];
    }
  }
  for (const [id, entry] of Object.entries(legacy.entries ?? {})) {
    if (!legacyTypes.has(entry.binding.secretType)) continue;
    out.entries[id] = entry;
    if (legacy.imported?.[id]) out.imported[id] = true;
  }
  return out;
}

export interface SecretsMetaStorage {
  /** The name this version keeps a vault's record under. */
  current(legacyKey: string): string;
  /** Whether a store key is a record under the name 0.8.7 reads. */
  isLegacy(key: string): boolean;
}

/**
 * At start, before any secrets round: every record of this device — every
 * vault, open or not — under the name 0.8.7 reads is sealed, taken into the
 * record under this version's name and removed, and the store is written
 * once. Without a key nothing is touched; the caller reports it and the next
 * start tries again. Returns how many records it moved.
 */
export async function sealSecretsMetaInStore(store: ISettingsStore, storage: SecretsMetaStorage, slots: SecretsMarkSlots): Promise<number> {
  const keys = (await store.keys()).filter(storage.isLegacy);
  if (keys.length === 0) return 0;
  const legacy: Array<[string, SecretsPortMeta]> = [];
  for (const key of keys) {
    const meta = await store.get<SecretsPortMeta>(key);
    if (meta && typeof meta === "object" && meta.entries && typeof meta.entries === "object") legacy.push([key, meta]);
  }
  const currents = new Map<string, SecretsPortMeta | null>();
  for (const [key] of legacy) currents.set(key, (await store.get<SecretsPortMeta>(storage.current(key))) ?? null);
  const marksExist = [...currents.values()].some(holdsSecretsMarks) || legacy.some(([, meta]) => holdsSecretsMarks(meta));
  const mark = await secretsMarker(slots, marksExist);
  for (const [key, meta] of legacy) {
    await sealSecretsMeta(meta, mark);
    const merged = mergeLegacySecretsMeta(currents.get(key) ?? null, meta)!;
    await sealSecretsMeta(merged, mark);
    await store.set(storage.current(key), merged);
    await store.delete(key);
  }
  await store.save();
  return legacy.length;
}
