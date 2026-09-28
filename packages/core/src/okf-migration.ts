import { OKF_VERSION } from "./metadata.js";
import { deleteFrontmatterPath, readFrontmatterPath } from "./frontmatter-surgical.js";
import { isExcludedFromOkfScan, isReservedOkfName } from "./okf-conversion.js";

/**
 * OKF bundle migration (plan OKF v0.2, P2): lift the bundle declaration in the
 * root `index.md` to the version Plainva writes, and — opt-in — remove the
 * legacy per-note `okf_version` key that earlier Plainva versions stamped into
 * every note (the spec only ever placed it on the bundle root; E1 2026-08-20).
 *
 * Everything here is pure and idempotent: a second run over a migrated vault
 * is a no-op, a half-finished run can simply be run again. Files are edited
 * surgically — the root line is rewritten in place, the note key goes through
 * the surgical frontmatter path — so the rest of each file stays byte-stable.
 *
 * Deliberately NOT here: no other key is touched, no provenance is invented
 * for existing notes (§ 6 rule 4), and the run itself (backups, reporting,
 * cancellation) lives with the conversion run in `@plainva/ui`.
 */

export const OKF_ROOT_INDEX_PATH = "index.md";

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

const WHITESPACE = /\s/;
const isWhitespace = (ch: string | undefined): boolean => ch !== undefined && WHITESPACE.test(ch);
const isSpaceOrTab = (ch: string | undefined): boolean => ch === " " || ch === "\t";
/** Where `^` and `$` stand under the `m` flag. */
const isLineTerminator = (ch: string | undefined): boolean => ch === "\n" || ch === "\r" || ch === "\u2028" || ch === "\u2029";
const DECL_KEY = "okf_version";

/**
 * The declaration line inside the root frontmatter. Accepts the quoted form
 * Plainva writes, an unquoted scalar (YAML would read `0.1` as a number) and a
 * trailing `# comment`, which survives the rewrite.
 */
interface DeclarationLine {
  /** The span the rewrite replaces: from the line start to the end of the value or comment. */
  index: number;
  end: number;
  /** Indentation, key and colon. */
  key: string;
  /** The value — exactly one of the three is set, by how it was written. */
  doubleQuoted?: string;
  singleQuoted?: string;
  plain?: string;
  comment?: string;
}

/** End of a `[^\r\n]*` run: the other line terminators belong to it. */
function crlfEnd(text: string, from: number): number {
  while (from < text.length && text[from] !== "\r" && text[from] !== "\n") from++;
  return from;
}

/** `[ \t]*(#[^\r\n]*)?$` from `from`: where it ends and the comment, or null. */
function declarationTail(block: string, from: number): { end: number; comment?: string } | null {
  let at = from;
  while (isSpaceOrTab(block[at])) at++;
  if (block[at] === "#") {
    const end = crlfEnd(block, at);
    return { end, comment: block.slice(at, end) };
  }
  return at === block.length || isLineTerminator(block[at]) ? { end: at } : null;
}

/**
 * The first declaration line of a frontmatter block, read by hand (plan
 * Befunde 24.09., E6). The pattern it replaces —
 * `^([ \t]*okf_version[ \t]*:)[ \t]*(?:"…"|'…'|([^#\r\n]*?))[ \t]*(#[^\r\n]*)?$`
 * under the `m` flag — let a plain value and the blanks after it share a run
 * of blanks, so a long run inside the value made the engine retry from every
 * blank: quadratic on text from a synced file.
 *
 * The reading is the old one: a quoted value counts only when the rest of the
 * line is blanks and an optional comment; otherwise the value is plain — it
 * starts after the blanks behind the colon and runs to the first `#` or line
 * terminator, without its trailing blanks. The comment runs to the next `\r`
 * or `\n`.
 */
function findDeclarationLine(block: string): DeclarationLine | null {
  const n = block.length;
  for (let lineStart = 0; lineStart <= n;) {
    let at = lineStart;
    while (isSpaceOrTab(block[at])) at++;
    if (block.startsWith(DECL_KEY, at)) {
      let colon = at + DECL_KEY.length;
      while (isSpaceOrTab(block[colon])) colon++;
      if (block[colon] === ":") {
        const key = block.slice(lineStart, colon + 1);
        let value = colon + 1;
        while (isSpaceOrTab(block[value])) value++;
        const quote = block[value];
        if (quote === "\"" || quote === "'") {
          let close = value + 1;
          while (close < n && block[close] !== quote && block[close] !== "\r" && block[close] !== "\n") close++;
          const tail = block[close] === quote ? declarationTail(block, close + 1) : null;
          if (tail) {
            const quoted = block.slice(value + 1, close);
            return { index: lineStart, end: tail.end, key, ...(quote === "\"" ? { doubleQuoted: quoted } : { singleQuoted: quoted }), comment: tail.comment };
          }
        }
        let stop = value;
        while (stop < n && block[stop] !== "#" && !isLineTerminator(block[stop])) stop++;
        let valueEnd = stop;
        while (valueEnd > value && isSpaceOrTab(block[valueEnd - 1])) valueEnd--;
        const tail = declarationTail(block, stop)!;
        return { index: lineStart, end: tail.end, key, plain: block.slice(value, valueEnd), comment: tail.comment };
      }
    }
    while (at < n && !isLineTerminator(block[at])) at++;
    lineStart = at + 1;
  }
  return null;
}

/**
 * Whether a frontmatter block carries an `okf_version` key at the start of a
 * line — blank lines and any whitespace before it allowed, like
 * `/(^|\r?\n)\s*okf_version\s*:/` — in one pass (plan Befunde 24.09., E6).
 * The pattern retried its whitespace from every newline of a blank run.
 * Looser than `readRootOkfDeclaration`: an empty value counts, too.
 */
export function hasOkfVersionKey(frontmatter: string): boolean {
  // Whether the text since the start, or since the last `\n`, is whitespace.
  let lineStart = true;
  for (let i = 0; i < frontmatter.length; i++) {
    if (lineStart && frontmatter.startsWith(DECL_KEY, i)) {
      let colon = i + DECL_KEY.length;
      while (isWhitespace(frontmatter[colon])) colon++;
      if (frontmatter[colon] === ":") return true;
    }
    const ch = frontmatter[i];
    if (ch === "\n") lineStart = true;
    else if (!isWhitespace(ch)) lineStart = false;
  }
  return false;
}

/**
 * The bundle version a root `index.md` declares, or null when it declares
 * none (no frontmatter, or frontmatter without the key). Tolerant on purpose:
 * whatever is written there is reported as the trimmed string.
 */
export function readRootOkfDeclaration(content: string): string | null {
  const fm = content.match(FM_RE);
  if (!fm) return null;
  const m = findDeclarationLine(fm[1]);
  if (!m) return null;
  const value = (m.doubleQuoted ?? m.singleQuoted ?? m.plain ?? "").trim();
  return value === "" ? null : value;
}

export interface OkfRootBumpResult {
  content: string;
  changed: boolean;
  /** What the root declared before (null = no declaration, nothing to bump). */
  from: string | null;
}

/**
 * Rewrites the root declaration to `version` in place (default: the version
 * Plainva writes). Only the value changes; indentation, key spelling, a
 * trailing comment, the managed-listing marker and the whole body stay as
 * they are. A root without a declaration is left alone — per spec there is
 * nothing to declare then, and inventing a declaration would silently switch
 * on the index.md automation for a hand-written root file.
 */
export function bumpRootOkfDeclaration(content: string, version: string = OKF_VERSION): OkfRootBumpResult {
  const from = readRootOkfDeclaration(content);
  if (from === null || from === version) return { content, changed: false, from };
  const fm = content.match(FM_RE)!;
  const block = fm[1];
  const decl = findDeclarationLine(block);
  const newBlock = decl
    ? block.slice(0, decl.index) + `${decl.key} "${version}"${decl.comment ? ` ${decl.comment}` : ""}` + block.slice(decl.end)
    : block;
  const start = fm.index! + fm[0].indexOf(block);
  const next = content.slice(0, start) + newBlock + content.slice(start + block.length);
  return { content: next, changed: next !== content, from };
}

export interface OkfNoteStripResult {
  content: string;
  changed: boolean;
  /** The value the note carried (as written, stringified), null when it carried none. */
  value: string | null;
}

/**
 * Removes the legacy per-note `okf_version` key. Throws FrontmatterSurgicalError
 * for frontmatter that cannot be edited safely — the run skips and reports
 * such a file instead of guessing.
 */
export function stripNoteOkfVersion(content: string): OkfNoteStripResult {
  const raw = readFrontmatterPath(content, ["okf_version"]);
  if (raw === undefined || raw === null) return { content, changed: false, value: null };
  const next = deleteFrontmatterPath(content, ["okf_version"]);
  return { content: next, changed: next !== content, value: String(raw) };
}

export interface OkfMigrateFileOptions {
  /** Vault-relative path of the bundle root index (default `index.md`). */
  rootIndexPath?: string;
  /** Remove the per-note key (D2, default on in the dialogs). */
  stripNoteVersion: boolean;
  /** Version the root should declare afterwards (default: what Plainva writes). */
  targetVersion?: string;
}

export interface OkfMigrateFileResult {
  content: string;
  changed: boolean;
  kind: "root" | "note" | "none";
}

/**
 * One file of the migration: the root index gets its declaration bumped, a
 * note loses the legacy key (when asked), everything else — other reserved
 * `index.md`/`log.md` files included — is left untouched.
 */
export function migrateOkfFile(path: string, content: string, options: OkfMigrateFileOptions): OkfMigrateFileResult {
  const rootIndexPath = options.rootIndexPath ?? OKF_ROOT_INDEX_PATH;
  if (path === rootIndexPath) {
    const r = bumpRootOkfDeclaration(content, options.targetVersion ?? OKF_VERSION);
    return { content: r.content, changed: r.changed, kind: "root" };
  }
  if (isReservedOkfName(path) || !options.stripNoteVersion) return { content, changed: false, kind: "none" };
  const r = stripNoteOkfVersion(content);
  return { content: r.content, changed: r.changed, kind: "note" };
}

export interface OkfVersionScanInput {
  /**
   * Note paths to inspect (forward slashes). Callers with an index pass the
   * notes the index says carry `okf_version`; a caller without one may pass
   * every markdown path — the result is the same, only slower.
   */
  paths: string[];
  readTextFile(path: string): Promise<string>;
  rootIndexPath?: string;
  /** Folders skipped entirely (mirrors the conformance scan's exclusions). */
  excludeFolders?: string[];
}

export interface OkfVersionState {
  /** The version Plainva writes (what "current" means). */
  targetVersion: string;
  rootIndex: {
    exists: boolean;
    /** Declared bundle version, null when the root declares none. */
    declared: string | null;
    /** declared === targetVersion */
    current: boolean;
  };
  /** Notes still carrying the legacy per-note key, with the value as written. */
  notesWithVersion: { path: string; value: string }[];
  /** Count per value ("0.1": 34, "1.0": 3) — the first time the mixed state is visible. */
  byValue: Record<string, number>;
  /** Notes actually read. */
  scanned: number;
}

/** Whether a migration run would change anything under the given choice. */
export function okfMigrationPending(state: OkfVersionState, stripNoteVersion: boolean): boolean {
  const rootPending = state.rootIndex.exists && state.rootIndex.declared !== null && !state.rootIndex.current;
  return rootPending || (stripNoteVersion && state.notesWithVersion.length > 0);
}

/**
 * What the bundle declares and which notes still carry the per-note key.
 * Reads the root index once and each candidate note once; unreadable files
 * are skipped (a file that cannot be read is no statement about its keys).
 */
export async function scanOkfVersionState(input: OkfVersionScanInput): Promise<OkfVersionState> {
  const rootIndexPath = input.rootIndexPath ?? OKF_ROOT_INDEX_PATH;
  let rootIndex: OkfVersionState["rootIndex"] = { exists: false, declared: null, current: false };
  try {
    const declared = readRootOkfDeclaration(await input.readTextFile(rootIndexPath));
    rootIndex = { exists: true, declared, current: declared === OKF_VERSION };
  } catch {
    // No root index: nothing to declare (valid per spec).
  }

  const notesWithVersion: { path: string; value: string }[] = [];
  const byValue: Record<string, number> = {};
  let scanned = 0;
  for (const path of input.paths) {
    if (!path.toLowerCase().endsWith(".md")) continue;
    if (isReservedOkfName(path)) continue;
    if (isExcludedFromOkfScan(path, input.excludeFolders)) continue;
    let content: string;
    try {
      content = await input.readTextFile(path);
    } catch {
      continue;
    }
    scanned++;
    const raw = readFrontmatterPath(content, ["okf_version"]);
    if (raw === undefined || raw === null) continue;
    const value = String(raw);
    notesWithVersion.push({ path, value });
    byValue[value] = (byValue[value] ?? 0) + 1;
  }
  notesWithVersion.sort((a, b) => a.path.localeCompare(b.path));
  return { targetVersion: OKF_VERSION, rootIndex, notesWithVersion, byValue, scanned };
}
