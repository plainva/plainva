import { ICON_CR, SYSTEM_JUNK_NAMES } from "./systemJunk.js";
import { trimEndChars } from "../textScan.js";

/**
 * Which path SEGMENTS are internal: tooling, version control, operating-system
 * bookkeeping and the app's own temporary files. A path with one such segment
 * is never indexed, never listed in the tree and never synced.
 *
 * The rules are DATA, not code, for one reason: the native vault walk
 * (`vault_walk.rs` on the desktop) must skip exactly the folders the JS walker
 * skips, without descending into a `node_modules` first. It receives this very
 * object with every call and applies four generic matchers; a second copy of
 * the list in Rust would drift, and a folder skipped natively but not here
 * would read as "its files were deleted" to the index and the sync layer.
 * `internalPathRules.fixture.json` pins the rules and a list of verdicts; the
 * same file is read by the unit test here and by the Rust test.
 *
 * Matched on whole segments (not substrings), so legitimate user files like
 * `notes.plainva.png` or `node_modules_archive/x.png` are not excluded.
 * `.CONFLICT` copies are deliberately NOT excluded: they are indexed so they
 * stay visible and resolvable in the tree; the sync targets already keep
 * `.CONFLICT` local-only on push.
 */
export interface InternalPathRules {
  /** Segment equals one of these. Compared folded (`foldSegment`): letter case, trailing dots and spaces do not count. */
  exact: string[];
  /** Segment, lower-cased, equals one of these (already lower-case). */
  exactIgnoreCase: string[];
  /** Segment starts with one of these. */
  prefix: string[];
  /** Segment starts with a dot, is longer than one character and ends with one of these. */
  dotSuffix: string[];
}

export const INTERNAL_PATH_RULES: InternalPathRules = {
  exact: [
    // Plainva / vault tooling
    ".plainva", ".obsidian", ".trash", ".smart-env",
    // version control and package managers
    ".git", "node_modules",
    // language and build tooling that lives next to notes in a developer's vault
    ".venv", "__pycache__", ".tox", ".turbo", ".cache",
    // editor metadata
    ".idea", ".vscode",
    // The custom-folder-icon file of macOS (systemJunk.ts).
    ICON_CR,
  ],
  // Operating-system bookkeeping (`.DS_Store`, `Thumbs.db`, `.Trashes`, …;
  // issue #110, E10). AppleDouble `._*` is deliberately NOT decided here:
  // this is a path-only rule, and a note may legitimately be called
  // `._notes.md` — the indexer reads the header instead (systemJunk.ts).
  exactIgnoreCase: [...SYSTEM_JUNK_NAMES],
  prefix: [
    ".stfolder",
    // The app's own atomic-write temp file (issue #122): the desktop writes
    // `.plainva-tmp-<pid>-<n>-<name>`, Android `.plainva-tmp-<random>.tmp`,
    // iOS `.plainva-tmp-<uuid>`, each beside the note and renamed over it.
    // It exists for milliseconds; a leftover after a hard kill is not a note.
    // The watcher reports it on every save, and before this rule each report
    // cost a disk probe and an SQL query. A user's own dot-file
    // (`.env-notes.md`) does not start with this prefix and stays a note.
    ".plainva-tmp-",
  ],
  // Tool caches name themselves: .mypy_cache, .pytest_cache, .ruff_cache,
  // .rumdl_cache (issue #70) — and the next linter will follow the same shape.
  // Deliberately anchored on a LEADING DOT: a user's own "read_cache" folder of
  // notes is not tooling, and neither is "Build" or "Target". Only names that
  // already declare themselves hidden are excluded by pattern.
  dotSuffix: ["_cache"],
};

/**
 * A segment as the file systems Plainva runs on compare it (finding
 * 2026-11-10, F2 review): NTFS and a default APFS volume ignore letter case,
 * Windows drops trailing dots and spaces from a name, and a Mac may hand a
 * name over decomposed. `.Plainva`, `.plainva.` and `.plainva ` are the app's
 * own folder there — a note link, a Markdown link or an embed that spelled it
 * so reached the sync key file. Every rule compares this form, so no caller
 * can bring a spelling the rules do not know; the native walk folds the same
 * way (`vault_walk.rs`, `WalkRules::is_internal`).
 */
export function foldSegment(segment: string): string {
  return trimEndChars(segment.normalize("NFC"), ". ").toLowerCase();
}

const EXACT = new Set(INTERNAL_PATH_RULES.exact.map(foldSegment));
const EXACT_IGNORE_CASE = new Set(INTERNAL_PATH_RULES.exactIgnoreCase.map(foldSegment));
const PREFIX = INTERNAL_PATH_RULES.prefix.map((p) => p.toLowerCase());
const DOT_SUFFIX = INTERNAL_PATH_RULES.dotSuffix.map((p) => p.toLowerCase());

/** True for one path segment the rules name, in any spelling the file system reads as it. */
export function isInternalSegment(s: string): boolean {
  const folded = foldSegment(s);
  if (EXACT.has(folded) || EXACT_IGNORE_CASE.has(folded)) return true;
  for (const p of PREFIX) if (folded.startsWith(p)) return true;
  if (folded.length > 1 && folded.startsWith(".")) {
    for (const suffix of DOT_SUFFIX) if (folded.endsWith(suffix)) return true;
  }
  return false;
}

/** True when any segment of a vault-relative path is internal. */
export function isInternalPath(path: string): boolean {
  return path.replace(/\\/g, "/").split("/").some(isInternalSegment);
}

/**
 * Whether a vault file is HIDDEN from the user's surfaces: a path with a
 * segment that starts with a dot — a dot file (`.notizen.md`) or anything in a
 * dot folder (`.attachments/`). Decision E8 (Sammelplan § 3.121), as Obsidian
 * does it.
 *
 * Hidden is not internal. Such a file is part of the vault: the index holds
 * it, because the sync learns local changes from the index and content
 * encryption re-encrypts from the same table — left out of the index, it
 * would stop syncing and leave a plaintext copy on the remote. It is only not
 * SHOWN: search, the graph, link and embed suggestions, the quick switcher,
 * the file tree and file lists, backlink lists, database rows, tags and task
 * lists leave it out, in both shells and for every place a vault lies. A link
 * that names it still leads to it — a hidden file is not a missing file.
 * Internal paths (`.plainva`, `.obsidian`, `.git`, …) keep their own, stricter
 * rule above; every one of them is hidden by this rule as well.
 */
export function isHiddenPath(path: string): boolean {
  return path.replace(/\\/g, "/").split("/").some((segment) => segment.length > 1 && segment.startsWith("."));
}

/**
 * `isHiddenPath` as an SQL condition that is TRUE for a path the user may see,
 * for a query that cannot filter afterwards (a page, a LIMIT). `column` is a
 * literal of the caller's statement, never user input. The index stores paths
 * with forward slashes.
 */
export function visiblePathSql(column: string): string {
  return `(${column} NOT LIKE '.%' AND ${column} NOT LIKE '%/.%')`;
}

/**
 * A Windows device name — `CON`, `PRN`, `AUX`, `NUL`, `COM0`–`COM9`,
 * `LPT0`–`LPT9` (and the superscript digits Windows also reserves),
 * `CONIN$`, `CONOUT$` — with or without an extension, in any case. Opening
 * such a path on Windows reaches the device, not a file, and a read can hang.
 * Refused on every platform: a path is written on one system and opened on
 * another (F2 review, 2026-11-10).
 */
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3]|conin\$|conout\$)$/i;
export function isWindowsDeviceSegment(segment: string): boolean {
  const base = trimEndChars(segment.split(".")[0], " ");
  return DEVICE_NAME.test(base);
}

/**
 * The 8.3 short form Windows can keep beside a long name (`PLAINV~1` for
 * `.plainva`): a second spelling of a folder that no rule above sees. A path
 * from content that has this shape is not followed to the disk.
 */
export function isShortNameAlias(segment: string): boolean {
  return /^[^.~]{1,6}~[1-9][0-9]{0,5}(?:\.[^.]{0,3})?$/.test(segment);
}

/**
 * Why a path that CONTENT names — a link, an embed, an archive entry, a
 * template setting — needs a second look before it is followed to the disk,
 * or `null`. `internal` is final: the app's own folders in any spelling are
 * never a link target. The other three are SHAPES — a device name, an
 * alternate data stream (`note.md:hidden`), an 8.3 alias — that are real,
 * ordinary names on macOS, Linux, Android and iOS (`Meeting 10:30.png`,
 * `aux.png`, `IMG~1.JPG`), and on Windows reach a device, a hidden stream
 * or another folder. Such a path is followed only when the vault itself holds
 * that exact spelling: the index, or the listing of its folder
 * (`contentPathIsReal`). F2 review, 2026-11-10.
 */
export function contentPathRefusal(path: string): "internal" | "device" | "stream" | "alias" | null {
  const segments = path.replace(/\\/g, "/").split("/");
  if (segments.some(isInternalSegment)) return "internal";
  if (segments.some(isWindowsDeviceSegment)) return "device";
  if (segments.some((segment) => segment.includes(":"))) return "stream";
  if (segments.some(isShortNameAlias)) return "alias";
  return null;
}

/** Whether one segment has one of the three shapes `contentPathRefusal` asks about. */
function hasSuspiciousShape(segment: string): boolean {
  return isWindowsDeviceSegment(segment) || segment.includes(":") || isShortNameAlias(segment);
}

/**
 * Whether a path content names may be followed to the disk: never into an
 * internal folder; a segment with a suspicious shape only where the listing
 * of its folder holds exactly that name — a real file, not another spelling
 * the file system resolves (a device, a stream, an 8.3 alias are never
 * listed). Every other path: yes, as before. `list` is the vault's own
 * listing of one folder (`""` is the vault's root).
 */
export async function contentPathIsReal(
  path: string,
  list: (folder: string) => Promise<readonly { name: string }[]>,
): Promise<boolean> {
  const segments = path.replace(/\\/g, "/").split("/");
  if (segments.some(isInternalSegment)) return false;
  for (let i = 0; i < segments.length; i += 1) {
    if (!hasSuspiciousShape(segments[i])) continue;
    const wanted = segments[i].normalize("NFC");
    let names: readonly { name: string }[];
    try {
      names = await list(segments.slice(0, i).join("/"));
    } catch {
      return false;
    }
    if (!names.some((entry) => entry.name.normalize("NFC") === wanted)) return false;
  }
  return true;
}

/**
 * `contentPathIsReal` as a gate in front of a read: the path, or an error.
 * A `.base` file is synced content — its `template:` must not paste the sync
 * key file into a new note — and a template named `Meeting: weekly.md` on a
 * Mac is a real template.
 */
export async function checkedContentPath(
  path: string,
  list: ((folder: string) => Promise<readonly { name: string }[]>) | null | undefined,
): Promise<string> {
  if (contentPathRefusal(path) === "internal") throw new Error("refused path (internal)");
  if (contentPathRefusal(path) === null) return path;
  if (!list || !(await contentPathIsReal(path, list))) throw new Error("refused path (not a file of this vault)");
  return path;
}
