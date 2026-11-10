import { contentPathRefusal, isHiddenPath } from "./vault/internalPath.js";

/**
 * The address of a note from outside Plainva: `plainva://open?vault=…&path=…`
 * (ADR 0037). A browser, a calendar, a mail or another app hands it to the
 * operating system, the system hands it to Plainva — so every character of it
 * is untrusted input, and it is read and written HERE and nowhere else.
 *
 * What the address can do is one thing: show a note, optionally at a heading
 * or a block. No parameter runs, creates, writes, switches silently or reaches
 * the system; a parameter this reader does not know is ignored, never obeyed.
 *
 *   vault    the vault's name as the person sees it (not its folder on disk —
 *            an absolute path would tell every reader of the link where the
 *            vault lies, and it differs on every device anyway)
 *   path     the note's path inside the vault, `/` between folders
 *   heading  the text of a heading in it            (optional)
 *   block    the id of a block in it, without `^`  (optional; not with heading)
 */

/** The scheme every copied link carries — the public, stable one. */
export const NOTE_LINK_SCHEME = "plainva";

/**
 * Schemes an incoming address may carry. The installed app registers
 * `plainva`; the isolated development build and the Labs build register their
 * own (`plainva-dev`, `plainva-labs`; the Android TLS-test build
 * `plainva-tlstest`) so they never take the release app's links away from
 * it. A copied link always says `plainva`.
 */
export const NOTE_LINK_SCHEMES: readonly string[] = ["plainva", "plainva-dev", "plainva-labs", "plainva-tlstest"];

/** The one action an address can name. */
const OPEN_ACTION = "open";

/** Longer than this, an address is not read at all. */
export const NOTE_LINK_MAX_LENGTH = 4096;
const MAX_VAULT = 255;
const MAX_PATH = 1024;
const MAX_HEADING = 512;
const BLOCK_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

export interface NoteLinkTarget {
  /** The vault's name; `null` when the address names none (the vault that is open). */
  vault: string | null;
  /** Vault-relative, `/`-separated, NFC. */
  path: string;
  heading?: string;
  /** Without the leading `^`. */
  block?: string;
}

export type NoteLinkRefusal = "scheme" | "action" | "malformed" | "length" | "vault" | "path" | "anchor";

export type NoteLinkParse = { ok: true; target: NoteLinkTarget } | { ok: false; reason: NoteLinkRefusal };

/**
 * Characters no value of an address may hold: C0 and C1 controls, DEL, line
 * and paragraph separators, the byte order mark, the bidirectional controls
 * that make a name read differently from what it is (U+061C, U+200E/F,
 * U+202A-E, U+2066-9), the invisible ones that make two names look alike
 * (U+200B-D, U+2060-4, U+206A-F) and the tag block (U+E0000-E007F). A vault
 * name or a path from an address is shown to the person — in a question, a
 * message, a chip — and must read as what it is.
 */
export function hasForbiddenCharacter(value: string): boolean {
  for (const char of value) {
    const c = char.codePointAt(0)!;
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) return true;
    if (c === 0x061c || c === 0x2028 || c === 0x2029 || c === 0xfeff) return true;
    if ((c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e)) return true;
    if ((c >= 0x2060 && c <= 0x2064) || (c >= 0x2066 && c <= 0x206f)) return true;
    if (c >= 0xe0000 && c <= 0xe007f) return true;
  }
  return false;
}

/** The scheme of an address (lower case, without `:`), or `null`. */
function schemeOf(raw: string): string | null {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(raw);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Whether an address belongs to Plainva at all — one of `NOTE_LINK_SCHEMES`,
 * whatever follows. Such an address is never handed to the system: it is
 * either a note link Plainva opens itself or one it refuses.
 */
export function isNoteLinkAddress(url: unknown): boolean {
  if (typeof url !== "string") return false;
  const scheme = schemeOf(url.trim());
  return scheme !== null && NOTE_LINK_SCHEMES.includes(scheme);
}

/** A strict percent-decoding: `+` is a space (as in a form), a broken escape is no value. */
function decodeValue(value: string): string | null {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return null;
  }
}

/**
 * A vault-relative path as an address may name it — or `null`. It is
 * normalised to NFC (a Mac writes names decomposed), never absolute (`/x`,
 * `C:/x`, `\server`), never leaves the vault (`..`), has no empty or `.`
 * segment and no backslash.
 *
 * A note link opens notes and the files Plainva shows in its tree — nothing
 * else (F2 review, 2026-11-10). So no segment may start with a dot: that
 * refuses the app's own folders in every spelling (`.plainva`, `.Plainva`,
 * `.plainva.`), the assistant's policy and skills (`.agent`), the encrypted
 * workspace's records (`.pvws`) and every hidden file, which no surface lists
 * (decision E8). Also refused: a Windows device name (`NUL`, `com1.md`), a
 * colon (an alternate data stream, `a.md:x`) and, through
 * `contentPathRefusal`, an internal folder in any spelling.
 */
export function noteLinkPath(value: string): string | null {
  const path = value.normalize("NFC");
  if (path === "" || path.length > MAX_PATH || hasForbiddenCharacter(path)) return null;
  if (path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) return null;
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".." || segment.trim() === "")) return null;
  if (isHiddenPath(path) || segments.some((segment) => segment.startsWith("."))) return null;
  const refused = contentPathRefusal(path);
  if (refused === "internal" || refused === "device" || refused === "stream") return null;
  return path;
}

function readVault(value: string): string | null {
  const vault = value.normalize("NFC").trim();
  if (vault === "" || vault.length > MAX_VAULT || hasForbiddenCharacter(vault)) return null;
  return vault;
}

/** Reads an incoming address. Never throws. */
export function parseNoteLinkUrl(url: unknown): NoteLinkParse {
  if (typeof url !== "string") return { ok: false, reason: "malformed" };
  const raw = url.trim();
  if (raw.length > NOTE_LINK_MAX_LENGTH) return { ok: false, reason: "length" };
  const scheme = schemeOf(raw);
  if (scheme === null || !NOTE_LINK_SCHEMES.includes(scheme)) return { ok: false, reason: "scheme" };
  // `scheme://open`, `scheme://open/`, then the query; a fragment is ignored.
  const rest = raw.slice(scheme.length + 1);
  const match = /^\/\/([^/?#]*)\/?(?:\?([^#]*))?(?:#.*)?$/.exec(rest);
  if (!match) return { ok: false, reason: "malformed" };
  if (match[1].toLowerCase() !== OPEN_ACTION) return { ok: false, reason: "action" };
  const values = new Map<string, string>();
  for (const pair of (match[2] ?? "").split("&")) {
    if (pair === "") continue;
    const eq = pair.indexOf("=");
    const key = decodeValue(eq < 0 ? pair : pair.slice(0, eq));
    const value = decodeValue(eq < 0 ? "" : pair.slice(eq + 1));
    if (key === null || value === null) return { ok: false, reason: "malformed" };
    if (key !== "vault" && key !== "path" && key !== "heading" && key !== "block") continue;
    // A parameter given twice is a question which one counts — not answered by guessing.
    if (values.has(key)) return { ok: false, reason: "malformed" };
    values.set(key, value);
  }
  let vault: string | null = null;
  if (values.has("vault")) {
    vault = readVault(values.get("vault")!);
    if (vault === null) return { ok: false, reason: "vault" };
  }
  const path = values.has("path") ? noteLinkPath(values.get("path")!) : null;
  if (path === null) return { ok: false, reason: "path" };
  const target: NoteLinkTarget = { vault, path };
  const heading = values.get("heading");
  const block = values.get("block");
  if (heading !== undefined && block !== undefined) return { ok: false, reason: "anchor" };
  if (heading !== undefined) {
    const text = heading.normalize("NFC").trim();
    if (text === "" || text.length > MAX_HEADING || hasForbiddenCharacter(text)) return { ok: false, reason: "anchor" };
    target.heading = text;
  }
  if (block !== undefined) {
    const id = block.trim().replace(/^\^/, "");
    if (!BLOCK_ID.test(id)) return { ok: false, reason: "anchor" };
    target.block = id;
  }
  return { ok: true, target };
}

/** `encodeURIComponent`, which leaves `/` encoded too — a path reads the same either way. */
const encode = (value: string) => encodeURIComponent(value);

/**
 * The address of a note. Throws on a target `parseNoteLinkUrl` would refuse,
 * so Plainva never copies a link it would not open itself.
 */
export function buildNoteLinkUrl(target: NoteLinkTarget): string {
  const parts: string[] = [];
  if (target.vault !== null) parts.push(`vault=${encode(target.vault.normalize("NFC").trim())}`);
  parts.push(`path=${encode(target.path.normalize("NFC"))}`);
  if (target.heading !== undefined) parts.push(`heading=${encode(target.heading.normalize("NFC").trim())}`);
  if (target.block !== undefined) parts.push(`block=${encode(target.block.replace(/^\^/, ""))}`);
  const url = `${NOTE_LINK_SCHEME}://${OPEN_ACTION}?${parts.join("&")}`;
  const check = parseNoteLinkUrl(url);
  if (!check.ok) throw new Error(`not a note link Plainva can open (${check.reason})`);
  return url;
}

/** The anchor of a target as a wiki link and the anchor jump write it: `Heading`, `^id`, or nothing. */
export function noteLinkAnchor(target: Pick<NoteLinkTarget, "heading" | "block">): string | null {
  if (target.block) return `^${target.block}`;
  if (target.heading) return target.heading;
  return null;
}

/**
 * What a link to a note with a place in it looks like inside the vault:
 * `[[Name]]`, `[[Name#Heading]]`, `[[Name#^id]]`. `name` is what the link
 * rule leads to that note by (`wikiTargetForPath`).
 */
export function wikiLinkText(name: string, target: Pick<NoteLinkTarget, "heading" | "block">): string {
  const anchor = noteLinkAnchor(target);
  return anchor ? `[[${name}#${anchor}]]` : `[[${name}]]`;
}

/**
 * The names the link rule (ADR 0027) is asked for when the path of an address
 * no longer exists: the path without `.md` — the note moved within a folder
 * tree the rule still finds by its end —, then the file name alone — the note
 * moved to another folder. A name the rule would cut (`#`, `^`, `|`, `[`, `]`)
 * is not asked about: it would lead somewhere the address did not mean.
 */
export function noteLinkNameCandidates(path: string): string[] {
  const stem = path.replace(/\.md$/i, "");
  const name = stem.split("/").pop() ?? stem;
  return [...new Set([stem, name])].filter((candidate) => candidate !== "" && !/[#^|[\]]/.test(candidate));
}

/** A vault as one shell knows it: a key of its own (a folder, an id) and the name the person sees. */
export interface LinkVault<K> {
  key: K;
  name: string;
}

export type LinkVaultChoice<K> =
  | { kind: "here" }
  | { kind: "switch"; vault: LinkVault<K> }
  | { kind: "unknown" }
  | { kind: "ambiguous" };

const vaultKeyName = (name: string) => name.normalize("NFC").trim().toLowerCase();

/**
 * Which vault an address means, on this device. The one that is shown when
 * its name matches — or when the address names none; another known vault by
 * that name only to ASK about (the caller asks before it switches, never
 * silently); several by that name, or none, is said as such.
 */
export function chooseLinkVault<K>(
  wanted: string | null,
  shown: LinkVault<K> | null,
  known: readonly LinkVault<K>[],
): LinkVaultChoice<K> {
  if (wanted === null) return shown ? { kind: "here" } : { kind: "unknown" };
  const name = vaultKeyName(wanted);
  if (shown && vaultKeyName(shown.name) === name) return { kind: "here" };
  const matches = known.filter((vault) => vaultKeyName(vault.name) === name && (!shown || vault.key !== shown.key));
  if (matches.length === 1) return { kind: "switch", vault: matches[0] };
  return { kind: matches.length > 1 ? "ambiguous" : "unknown" };
}
