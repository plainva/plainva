/**
 * What the system's assistant gets to know of a vault, and what it may ask of
 * the app (AI harness P4.7).
 *
 * Siri, Shortcuts and Apple Intelligence reach an app through App Intents. An
 * intent runs natively, and no JavaScript runs while Plainva is closed — the
 * fact the home-screen widgets are built on. So an intent works nothing out
 * and writes nothing into the vault. Two files in the App Group carry
 * everything:
 *
 * - the DIRECTORY, written by the app while it runs: the titles the system may
 *   know, so that it can find a note somebody names;
 * - the ORDERS, written by an intent: what was asked for. The app redeems
 *   them when it next comes to the front, through its own write paths — a
 *   journal entry through the journal, a task through the task database.
 *
 * Four rules follow, and they are the whole design:
 *
 * 1. **Titles pass the privacy gate.** The system's assistant is a recipient
 *    like a cloud provider that may use the internet: what it does with a
 *    title — on the device, in the maker's cloud, in an assistant it hands
 *    over to, in a search — is not Plainva's to know. A note kept from the
 *    cloud or from web access is not in the directory.
 * 2. **No path, and no text.** An entry is a title, the name of its folder
 *    and a key. The key is a fingerprint of the path under a secret of this
 *    device; which note it means is resolved by the app, against a table it
 *    keeps in its own storage. It stays the same for as long as the note
 *    stays where it is, so a shortcut somebody saved keeps meaning its note.
 * 3. **Off means empty.** Until the device's switch is on, and always inside
 *    an encrypted workspace, the directory has no rows: a file that never
 *    held the titles cannot leak them.
 * 4. **An order is words, not a write.** What somebody said to the system
 *    waits as text with the moment it was said; nothing of the vault changes
 *    until the app itself writes it.
 */

/** Bumped when the shape changes; a native reader that sees a higher one finds nothing. */
export const INTENT_DIRECTORY_VERSION = 1;

/** The ceiling on rows: the notes changed last. A file two processes read is no index of a vault. */
export const INTENT_DIRECTORY_MAX_NOTES = 2000;

/** …and on its size: the native reader takes no file beyond a megabyte, and a file it refuses would leave an older one standing. */
export const INTENT_DIRECTORY_MAX_BYTES = 900 * 1024;

export const INTENT_TITLE_LIMIT = 120;
export const INTENT_FOLDER_LIMIT = 60;

/** What an order may carry: a sentence somebody spoke, not a document. */
export const INTENT_ORDER_TEXT_LIMIT = 2000;

/** How many orders are read at once; the native queue holds no more. */
export const INTENT_ORDER_MAX = 100;

/** "Open this note" is about now: later, it would move a screen nobody is looking at for that reason. */
export const INTENT_NAVIGATION_TTL_MS = 2 * 60 * 1000;

/** What a key looks like: sixteen hex digits. Anything else is no key, wherever it comes from. */
export const INTENT_KEY_PATTERN = /^[0-9a-f]{16}$/;

export interface IntentDirectoryNote {
  /** The note's key: what an order names, and what a saved shortcut remembers. */
  k: string;
  /** The note's title. */
  t: string;
  /** The name of the folder it lies in, where it lies in one: what tells two notes of one title apart. */
  f?: string;
}

export interface IntentDirectory {
  version: number;
  /** When the app wrote this, as an epoch in ms. */
  writtenAt: number;
  /** The vault the titles belong to. */
  vault: string;
  notes: IntentDirectoryNote[];
}

/** Which note each key of the directory means — kept in the app's own storage, never beside the directory. */
export interface IntentRefTable {
  writtenAt: number;
  refs: Record<string, string>;
}

export interface IntentDirectoryInput {
  vaultName: string;
  /** False where nothing may be named at all: the switch is off, or the vault is an encrypted workspace. */
  enabled: boolean;
  /** The vault's notes, the ones changed last first. */
  notes: readonly { path: string; title: string }[];
  /** The privacy gate for one note, with the system's assistant as the recipient. */
  allowed(path: string): boolean;
  /** The key of a path: `intentNoteKey` under this device's secret. */
  key(path: string): string;
  now: Date;
}

/** What a secret for the keys looks like: sixteen random bytes, as hex. */
export const INTENT_SECRET_PATTERN = /^[0-9a-f]{32}$/;

/*
 * SipHash-2-4 (Aumasson and Bernstein): a keyed fingerprint of 64 bits, made
 * for exactly this — short inputs under a secret key. A plain hash would not
 * do: a key leaves the device (the system keeps it as the note's identity, a
 * saved shortcut carries it), and from a hash without a secret anybody could
 * check a guessed path against it. Written over 32-bit halves, so that it is
 * integers only and the same on every engine; pinned to the reference vectors
 * in `systemIntents.test.ts`.
 *
 * `v` holds v0..v3 as [low, high] pairs.
 */
function sipAdd(v: Uint32Array, a: number, b: number): void {
  const low = v[a]! + v[b]!;
  v[a + 1] = v[a + 1]! + v[b + 1]! + (low > 0xffffffff ? 1 : 0);
  v[a] = low;
}

function sipRotl(v: Uint32Array, a: number, bits: number): void {
  const low = v[a]!;
  const high = v[a + 1]!;
  v[a] = (low << bits) | (high >>> (32 - bits));
  v[a + 1] = (high << bits) | (low >>> (32 - bits));
}

function sipXor(v: Uint32Array, a: number, b: number): void {
  v[a] = v[a]! ^ v[b]!;
  v[a + 1] = v[a + 1]! ^ v[b + 1]!;
}

/** A rotation by 32 bits is the two halves changing places. */
function sipSwap(v: Uint32Array, a: number): void {
  const low = v[a]!;
  v[a] = v[a + 1]!;
  v[a + 1] = low;
}

function sipRound(v: Uint32Array): void {
  sipAdd(v, 0, 2);
  sipRotl(v, 2, 13);
  sipXor(v, 2, 0);
  sipSwap(v, 0);
  sipAdd(v, 4, 6);
  sipRotl(v, 6, 16);
  sipXor(v, 6, 4);
  sipAdd(v, 0, 6);
  sipRotl(v, 6, 21);
  sipXor(v, 6, 0);
  sipAdd(v, 4, 2);
  sipRotl(v, 2, 17);
  sipXor(v, 2, 4);
  sipSwap(v, 4);
}

const le32 = (bytes: Uint8Array, at: number): number => (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0;

function sipHash24(key: Uint8Array, data: Uint8Array): string {
  const k0l = le32(key, 0);
  const k0h = le32(key, 4);
  const k1l = le32(key, 8);
  const k1h = le32(key, 12);
  const v = new Uint32Array([k0l ^ 0x70736575, k0h ^ 0x736f6d65, k1l ^ 0x6e646f6d, k1h ^ 0x646f7261, k0l ^ 0x6e657261, k0h ^ 0x6c796765, k1l ^ 0x79746573, k1h ^ 0x74656462]);
  const block = (bytes: Uint8Array, at: number) => {
    const low = le32(bytes, at);
    const high = le32(bytes, at + 4);
    v[6] = v[6]! ^ low;
    v[7] = v[7]! ^ high;
    sipRound(v);
    sipRound(v);
    v[0] = v[0]! ^ low;
    v[1] = v[1]! ^ high;
  };
  const whole = data.length - (data.length % 8);
  for (let at = 0; at < whole; at += 8) block(data, at);
  // The last block: what is left of the input, and the input's length in its top byte.
  const tail = new Uint8Array(8);
  tail.set(data.subarray(whole));
  tail[7] = data.length & 0xff;
  block(tail, 0);
  v[4] = v[4]! ^ 0xff;
  for (let round = 0; round < 4; round++) sipRound(v);
  const hex = (value: number) => (value >>> 0).toString(16).padStart(8, "0");
  return hex(v[1]! ^ v[3]! ^ v[5]! ^ v[7]!) + hex(v[0]! ^ v[2]! ^ v[4]! ^ v[6]!);
}

/**
 * A fingerprint of a path under this device's secret: 64 bits, as sixteen hex
 * digits. Not a lock — whoever reads the directory already reads the title —
 * but a name for a note that says nothing about where it lies, and that only
 * this device can turn back into one. Empty where the secret is no secret:
 * a key anybody could work out from a path would be the path.
 */
export function intentNoteKey(secret: string, path: string): string {
  if (!INTENT_SECRET_PATTERN.test(secret)) return "";
  const key = new Uint8Array(16);
  for (let index = 0; index < 16; index++) key[index] = parseInt(secret.slice(index * 2, index * 2 + 2), 16);
  return sipHash24(key, new TextEncoder().encode(path));
}

/** Text as another process may show or speak it: nothing invisible, one line, a bounded length. */
function clean(text: string, limit: number): string {
  const line = text
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [...line].slice(0, limit).join("").trim();
}

const hidden = (path: string): boolean => path.split("/").some((part) => part.startsWith("."));

/** How many bytes a text takes as UTF-8 in JSON, generously: every unit beyond ASCII counts as three, and a quote or backslash as two. */
function weight(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    bytes += unit > 0x7f ? 3 : unit === 0x22 || unit === 0x5c ? 2 : 1;
  }
  return bytes;
}

/** What a row costs beyond its texts: the key, the names of its fields and the punctuation. */
const ROW_OVERHEAD = 48;

/** The directory and, beside it, which note each of its keys means. Only the first leaves the app's own storage. */
export function buildIntentDirectory(input: IntentDirectoryInput): { directory: IntentDirectory; table: IntentRefTable } {
  const notes: IntentDirectoryNote[] = [];
  const refs: Record<string, string> = {};
  const writtenAt = input.now.getTime();
  if (input.enabled) {
    const seen = new Set<string>();
    let bytes = 256;
    for (const note of input.notes) {
      if (notes.length >= INTENT_DIRECTORY_MAX_NOTES || bytes >= INTENT_DIRECTORY_MAX_BYTES) break;
      const path = note.path;
      if (!path || seen.has(path) || !/\.md$/i.test(path) || hidden(path)) continue;
      seen.add(path);
      if (!input.allowed(path)) continue;
      const key = input.key(path);
      // Two paths with one key cannot both be meant by it: the first keeps it.
      if (!INTENT_KEY_PATTERN.test(key) || key in refs) continue;
      const parts = path.split("/");
      const name = parts[parts.length - 1]!.replace(/\.md$/i, "");
      const title = clean(note.title && note.title !== path ? note.title : name, INTENT_TITLE_LIMIT) || clean(name, INTENT_TITLE_LIMIT);
      if (!title) continue;
      const folder = parts.length > 1 ? clean(parts[parts.length - 2]!, INTENT_FOLDER_LIMIT) : "";
      bytes += ROW_OVERHEAD + weight(title) + weight(folder);
      notes.push(folder ? { k: key, t: title, f: folder } : { k: key, t: title });
      refs[key] = path;
    }
  }
  return { directory: { version: INTENT_DIRECTORY_VERSION, writtenAt, vault: clean(input.vaultName, INTENT_TITLE_LIMIT), notes }, table: { writtenAt, refs } };
}

export function serializeIntentDirectory(directory: IntentDirectory): string {
  return JSON.stringify(directory);
}

/** Reads a directory back; null for anything that is not one. */
export function parseIntentDirectory(raw: string): IntentDirectory | null {
  try {
    const value = JSON.parse(raw) as Partial<IntentDirectory> | null;
    if (!value || typeof value !== "object" || value.version !== INTENT_DIRECTORY_VERSION) return null;
    if (typeof value.writtenAt !== "number" || !Number.isSafeInteger(value.writtenAt) || typeof value.vault !== "string" || !Array.isArray(value.notes)) return null;
    const notes: IntentDirectoryNote[] = [];
    for (const entry of value.notes) {
      if (!entry || typeof entry !== "object") return null;
      const { k, t, f } = entry as Partial<IntentDirectoryNote>;
      if (typeof k !== "string" || !INTENT_KEY_PATTERN.test(k) || typeof t !== "string" || (f !== undefined && typeof f !== "string")) return null;
      notes.push(f ? { k, t, f } : { k, t });
    }
    return { version: value.version, writtenAt: value.writtenAt, vault: value.vault, notes };
  } catch {
    return null;
  }
}

/** Reads the table back from the app's storage; null for anything that is not one. */
export function readIntentRefTable(raw: unknown): IntentRefTable | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<IntentRefTable>;
  if (typeof value.writtenAt !== "number" || !value.refs || typeof value.refs !== "object" || Array.isArray(value.refs)) return null;
  const refs: Record<string, string> = {};
  for (const [key, path] of Object.entries(value.refs)) {
    if (INTENT_KEY_PATTERN.test(key) && typeof path === "string" && path) refs[key] = path;
  }
  return { writtenAt: value.writtenAt, refs };
}

export type IntentOrderKind = "open" | "search" | "journal" | "task";
export const INTENT_ORDER_KINDS: readonly IntentOrderKind[] = ["open", "search", "journal", "task"];

/** What an intent left for the app. */
export interface IntentOrder {
  /** Assigned by the native queue; what clearing names. */
  id: number;
  kind: IntentOrderKind;
  /** When it was asked, ms since the epoch. A journal entry carries this time, and "tomorrow" in a task means the day after this one. */
  at: number;
  /** open: the key of the note that was chosen. */
  key?: string;
  /** open: the title that was chosen; search: the words; journal and task: what to write. */
  text: string;
}

/** Text of an order: what was said, with its line breaks, without anything invisible, bounded. */
function orderText(value: unknown): string {
  if (typeof value !== "string") return "";
  // Line by line: a line break is the one control character that means something here.
  const lines = value.split(/\r\n?|\n/).map((line) => clean(line, INTENT_ORDER_TEXT_LIMIT));
  const kept = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return [...kept].slice(0, INTENT_ORDER_TEXT_LIMIT).join("").trim();
}

const wholeNumber = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/**
 * Reads what the native queue hands over. Total: an entry that is not an
 * order is dropped, and a queue longer than the native side ever keeps is cut.
 */
export function readIntentOrders(raw: unknown): IntentOrder[] {
  if (!Array.isArray(raw)) return [];
  const orders: IntentOrder[] = [];
  const ids = new Set<number>();
  for (const entry of raw.slice(0, INTENT_ORDER_MAX)) {
    if (!entry || typeof entry !== "object") continue;
    const value = entry as Record<string, unknown>;
    if (!wholeNumber(value.id) || value.id === 0 || ids.has(value.id) || !wholeNumber(value.at)) continue;
    if (typeof value.kind !== "string" || !(INTENT_ORDER_KINDS as readonly string[]).includes(value.kind)) continue;
    const kind = value.kind as IntentOrderKind;
    const text = kind === "journal" || kind === "task" ? orderText(value.text) : orderText(value.text).replace(/\n+/g, " ");
    ids.add(value.id);
    if (kind === "open" && typeof value.key === "string" && INTENT_KEY_PATTERN.test(value.key)) orders.push({ id: value.id, kind, at: value.at, key: value.key, text });
    else orders.push({ id: value.id, kind, at: value.at, text });
  }
  return orders;
}

export interface IntentOrderPlan {
  /** What to write, in the order it was asked. */
  captures: IntentOrder[];
  /** Where to go: the last place that was asked for, while that is still about now. */
  navigation: IntentOrder | null;
  /** Orders that will never be acted on — too old, empty, or a place somebody asked for before the last one. */
  moot: number[];
}

/** A clock that is a day ahead is a wrong clock, not a message from the future. */
const CLOCK_SLACK_MS = 24 * 60 * 60 * 1000;

/**
 * What to do with the orders that wait. Captures are all written, oldest
 * first — however long ago they were said: words somebody asked to have
 * written down are never dropped for their age, they land in the day they
 * were said on. Of the places somebody asked to be taken to, only the last
 * one counts, and only while it is fresh.
 */
export function planIntentOrders(orders: readonly IntentOrder[], now: number): IntentOrderPlan {
  const captures: IntentOrder[] = [];
  const moot: number[] = [];
  let navigation: IntentOrder | null = null;
  for (const order of [...orders].sort((a, b) => a.at - b.at || a.id - b.id)) {
    const age = now - order.at;
    if (order.kind === "journal" || order.kind === "task") {
      if (!order.text) moot.push(order.id);
      // Said more than a day "from now": the clock was wrong then, and now is the best moment that is known.
      else captures.push(age < -CLOCK_SLACK_MS ? { ...order, at: now } : order);
      continue;
    }
    if (age > INTENT_NAVIGATION_TTL_MS || age < -CLOCK_SLACK_MS) {
      moot.push(order.id);
      continue;
    }
    if (navigation) moot.push(navigation.id);
    navigation = order;
  }
  return { captures, navigation, moot };
}

export type IntentNavigation = { kind: "open"; path: string } | { kind: "search"; query: string };

/**
 * Where an order to go somewhere leads. A key opens the note the app's own
 * table names for it; where the table does not know it any more — the note
 * moved, or may no longer be named — the title that was chosen is searched
 * for. Never a note opened by guess.
 */
export function resolveIntentNavigation(order: IntentOrder, table: IntentRefTable | null): IntentNavigation | null {
  if (order.kind === "search") return { kind: "search", query: order.text };
  if (order.kind !== "open") return null;
  const path = order.key && table ? table.refs[order.key] : undefined;
  if (path) return { kind: "open", path };
  return order.text ? { kind: "search", query: order.text } : null;
}
