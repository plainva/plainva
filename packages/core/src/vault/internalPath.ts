import { ICON_CR, SYSTEM_JUNK_NAMES } from "./systemJunk.js";

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
  /** Segment equals one of these, case-sensitively. */
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

const EXACT = new Set(INTERNAL_PATH_RULES.exact);
const EXACT_IGNORE_CASE = new Set(INTERNAL_PATH_RULES.exactIgnoreCase);

/** True for one path segment the rules name. */
export function isInternalSegment(s: string): boolean {
  if (EXACT.has(s)) return true;
  if (EXACT_IGNORE_CASE.has(s.toLowerCase())) return true;
  for (const p of INTERNAL_PATH_RULES.prefix) if (s.startsWith(p)) return true;
  if (s.length > 1 && s.startsWith(".")) {
    for (const suffix of INTERNAL_PATH_RULES.dotSuffix) if (s.endsWith(suffix)) return true;
  }
  return false;
}

/** True when any segment of a vault-relative path is internal. */
export function isInternalPath(path: string): boolean {
  return path.replace(/\\/g, "/").split("/").some(isInternalSegment);
}
