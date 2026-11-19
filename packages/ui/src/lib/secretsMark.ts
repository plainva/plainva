import type { SecretsPortMeta } from "./secretsPort";
import type { ISettingsStore } from "../platform/settings";

/**
 * The marks the secrets sync keeps about a password (review 2026-11-18, round
 * eight, F67).
 *
 * To tell "unchanged" from "changed", the port remembers each password it
 * published or took as a mark of its binding and secret. Up to now that mark
 * was the text itself — `stableStringify({ binding, secret })` — kept in the
 * ordinary settings store (`plainva-settings.json` on the desktop, the
 * settings of the phone), so every password stood there in plain text.
 *
 * A mark is now an HMAC-SHA-256 of that same text under a random key of this
 * device. The key lives where the passwords live, in the credentials store
 * (`SECRETS_MARK_KEY_SLOT`): the keychain, or where a desktop has none, the
 * credentials file that holds the passwords themselves — never the settings
 * store. Without the key a mark names nothing and cannot be checked against a
 * guess. Because the input is exactly the old text, an old mark turns into
 * the new mark of the same pair (`sealSecretsMeta`): no revision moves, no
 * time, no upload.
 *
 * An empty mark ("") means "not known here": a device whose credentials store
 * could not give a key drops its old plain marks rather than keep them, and
 * the port then takes the slot as unchanged (`secretsPort.ts`).
 */
export const SECRETS_MARK_KEY_SLOT = "settingsSyncSecretsMarkKey";

const PREFIX = "m1:";

export type SecretsMarker = (text: string) => Promise<string>;

/** Where the key is kept: the same credentials store the passwords use. */
export interface SecretsMarkSlots {
  readSlot(slot: string): Promise<unknown>;
  writeSlot(slot: string, value: unknown): Promise<void>;
}

/** A mark as this file writes it; anything else that is not "" is an old plain mark. */
export const isSecretsMark = (value: string): boolean => value.startsWith(PREFIX);

const HEX_KEY = /^[0-9a-f]{64}$/;

// The first two callers on a fresh device must not each make a key: the
// second would overwrite the first, and every mark made with it would be
// wrong. Key reads and the one creation run one after the other.
let keyQueue: Promise<unknown> = Promise.resolve();

async function deviceKey(slots: SecretsMarkSlots): Promise<string> {
  const run = async (): Promise<string> => {
    const stored = await slots.readSlot(SECRETS_MARK_KEY_SLOT);
    if (typeof stored === "string" && HEX_KEY.test(stored)) return stored;
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const fresh = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    await slots.writeSlot(SECRETS_MARK_KEY_SLOT, fresh);
    // Read back: a store that took the write but returns something else
    // (or nothing) gives no key to mark with.
    const back = await slots.readSlot(SECRETS_MARK_KEY_SLOT);
    if (back !== fresh) throw new Error("secrets mark key could not be stored");
    return fresh;
  };
  const next = keyQueue.then(run, run);
  keyQueue = next.catch(() => undefined);
  return next;
}

/** The marker of this device; throws when the credentials store gives no key. */
export async function secretsMarker(slots: SecretsMarkSlots): Promise<SecretsMarker> {
  const hex = await deviceKey(slots);
  const raw = new Uint8Array(hex.match(/../g)!.map((pair) => parseInt(pair, 16)));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const encoder = new TextEncoder();
  return async (text) => {
    const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(text)));
    let binary = "";
    for (const byte of signature) binary += String.fromCharCode(byte);
    return PREFIX + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=$/, "");
  };
}

/**
 * Turns every old plain mark of one vault's metadata into the mark of the same
 * pair; with no marker, drops it to "" (never kept). True when anything changed.
 */
export async function sealSecretsMeta(meta: SecretsPortMeta, mark: SecretsMarker | null): Promise<boolean> {
  let changed = false;
  for (const entry of Object.values(meta.entries)) {
    if (!entry.hash || isSecretsMark(entry.hash)) continue;
    entry.hash = mark ? await mark(entry.hash) : "";
    changed = true;
  }
  if (meta.settled !== undefined && !isSecretsMark(meta.settled)) {
    delete meta.settled;
    changed = true;
  }
  return changed;
}

/**
 * At start, before any vault opens: every secrets metadata record of this
 * device — every vault, open or not — loses its plain marks, and the store is
 * written once. Returns how many records it rewrote.
 */
export async function sealSecretsMetaInStore(
  store: ISettingsStore,
  isMetaKey: (key: string) => boolean,
  slots: SecretsMarkSlots,
): Promise<number> {
  const keys = (await store.keys()).filter(isMetaKey);
  const records: Array<[string, SecretsPortMeta]> = [];
  for (const key of keys) {
    const meta = await store.get<SecretsPortMeta>(key);
    if (meta && typeof meta === "object" && meta.entries && typeof meta.entries === "object") records.push([key, meta]);
  }
  const plain = records.filter(([, meta]) =>
    Object.values(meta.entries).some((entry) => typeof entry?.hash === "string" && entry.hash !== "" && !isSecretsMark(entry.hash)),
  );
  if (plain.length === 0) return 0;
  let mark: SecretsMarker | null;
  try {
    mark = await secretsMarker(slots);
  } catch {
    mark = null;
  }
  for (const [key, meta] of plain) {
    await sealSecretsMeta(meta, mark);
    await store.set(key, meta);
  }
  await store.save();
  return plain.length;
}
