/**
 * Wiki target text for a vault path: the bare basename when it is unique
 * vault-wide, else the path without `.md` so the link stays unambiguous.
 * Used wherever Plainva writes wiki links itself (relations, reverse columns).
 */
export function wikiTargetForPath(path: string, allFilePaths: string[]): string {
  const base = path.split(/[/\\]/).pop()!.replace(/\.md$/i, "");
  const baseNorm = `${base.toLowerCase().normalize("NFC")}.md`;
  const collision = allFilePaths.some(
    (p) => p !== path && p.split(/[/\\]/).pop()?.toLowerCase().normalize("NFC") === baseNorm
  );
  return collision ? path.replace(/\.md$/i, "") : base;
}

/**
 * Extension-preserving variant of wikiTargetForPath for non-`.md` targets
 * (`.base` today): the bare file name when it is unique vault-wide, else the
 * full path. wikiTargetForPath is `.md`-centric — it strips/compares `.md`
 * basenames, so it would neither keep a `.base` extension in the link text
 * nor detect collisions between same-named `.base` files.
 */
export function wikiTargetForFile(path: string, allFilePaths: string[]): string {
  const base = path.split(/[/\\]/).pop()!;
  const baseNorm = base.toLowerCase().normalize("NFC");
  const collision = allFilePaths.some(
    (p) => p !== path && (p.split(/[/\\]/).pop() ?? "").toLowerCase().normalize("NFC") === baseNorm
  );
  return collision ? path : base;
}

/**
 * Where a link leads — the ONE rule (finding 2026-10-08, ADR 0027).
 *
 * `[[Brief]]` used to be resolved by three rules. The desktop's editor asked
 * the index for a note's TITLE or its whole path, the phone walked the vault
 * for the file's NAME, and the graph, the backlinks and the relations matched
 * the END of a path. A note whose properties carry a title of their own was a
 * dead link on the desktop and a working one on the phone; a link written with
 * part of a path was an edge in the graph and "not created yet" in the editor.
 *
 * Every surface asks `resolveLinkTargetIndexed` now: a click and a tap, the
 * dashed "not created yet" drawing, an embed, the graph, the backlinks, the
 * relations and rollups, the cascade and the clean-up. A target is tried in
 * this order:
 *
 *   1. An explicit path: `/Folder/Note` from the vault's root, `./Note` and
 *      `../Folder/Note` from the folder of the linking note. Nothing else is
 *      tried for these — whoever writes them names one place.
 *   2. The vault path as written, then with `.md`.
 *   3. The end of a path — the file's name alone or with folders in front of
 *      it (`Hafenkante/Brief`) — as Obsidian finds a note anywhere in a vault.
 *   4. The same for a target that names another kind of file by its extension
 *      (`plan.pdf`, `Tasks.base`). A target without one names a NOTE, so
 *      `[[Tasks]]` never becomes `Tasks.base`.
 *   5. The `title` of a note's properties. Last, so a file that is called
 *      like the target always comes before a note that is merely titled so.
 *      The desktop followed titles before this rule and Plainva's own `[[`
 *      completion wrote them — such links keep leading where they led.
 *
 * Names are compared as people read them: without regard to letter case, and
 * a composed and a decomposed spelling of one letter (macOS hands out the
 * latter) are one name. Where several files answer, the spelling as written
 * comes first, then the path read from the linking note's folder — for a bare
 * name that is the note beside it —, then the shortest path, then the
 * alphabet. The last step is what makes the answer the same on every device:
 * it never depends on the order a database or a directory listing hands the
 * files out.
 *
 * The answer is always the ORIGINAL stored path, never a normalised copy.
 */

/** A file as the rule sees it: its vault path and, for a note, the title the index holds for it. */
export interface LinkCorpusFile {
  path: string;
  title?: string | null;
}

/**
 * Precompiled resolution corpus (P2.3): callers that resolve MANY links against
 * the same file list (graph load, backlinks, reverse-relation columns) build
 * this once and get O(1) lookups instead of an O(files) scan per link — the
 * naive form is O(links × files) and stalls the UI on large vaults.
 *
 * Every key is one NAME as people read it (`nameKey`); every value keeps the
 * files' original paths. A key holds more than one file where spellings differ
 * in letter case or composition alone, where several folders hold a file of
 * one name, or where several notes carry one title.
 */
export interface LinkTargetIndex {
  /** Whole vault path -> the files spelled so. */
  readonly byPath: ReadonlyMap<string, readonly string[]>;
  /** File name (last path segment, extension included) -> the files called so. */
  readonly byName: ReadonlyMap<string, readonly string[]>;
  /** Title of a note's properties -> the notes titled so. */
  readonly byTitle: ReadonlyMap<string, readonly string[]>;
}

const NOTE_EXTENSION = /\.md$/i;

/** One name, however its letters are cased and composed (macOS/APFS reports file names decomposed, P3.7). */
function nameKey(text: string): string {
  return text.normalize("NFC").toLowerCase().normalize("NFC");
}

function lastSegment(path: string): string {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
}

/** The folder a file lies in; "" for the vault's root. */
function folderOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at);
}

/** `relative` read from `folder`, its `.` and `..` taken out; null where it climbs out of the vault or names nothing. */
function fromFolder(folder: string, relative: string): string | null {
  const parts = folder ? folder.split("/") : [];
  for (const part of relative.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.length > 0 ? parts.join("/") : null;
}

/**
 * Step 1 of the rule on its own: the vault path a target names when it is
 * written as an explicit path — `/Folder/Note` from the vault's root, `./Note`
 * and `../Folder/Note` from the folder of the note at `sourcePath`. Null where
 * such a target climbs out of the vault, undefined for every other target.
 * Whoever CREATES the note a link names asks this too, so the note lands
 * where the rule will look for it.
 */
export function explicitLinkPath(sourcePath: string, linkTarget: string): string | null | undefined {
  const target = linkTarget.trim();
  if (target.startsWith("/")) return fromFolder("", target);
  if (target.startsWith("./") || target.startsWith("../")) return fromFolder(folderOf(sourcePath), target);
  return undefined;
}

function put(map: Map<string, string[]>, key: string, path: string): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(path);
  else map.set(key, [path]);
}

/**
 * The lookup over a vault's files. Plain paths are accepted for a corpus that
 * has no titles to give (a directory listing); whatever is read from the index
 * hands in `{ path, title }`, or step 5 of the rule has nothing to find.
 */
export function buildLinkTargetIndex(files: readonly (string | LinkCorpusFile)[]): LinkTargetIndex {
  const byPath = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  const byTitle = new Map<string, string[]>();
  const taken = new Set<string>();
  for (const file of files) {
    const path = typeof file === "string" ? file : file?.path;
    if (typeof path !== "string" || !path || taken.has(path)) continue;
    taken.add(path);
    put(byPath, nameKey(path), path);
    const name = lastSegment(path);
    if (!name) continue;
    put(byName, nameKey(name), path);
    const title = typeof file === "string" ? null : file.title;
    if (typeof title !== "string" || !NOTE_EXTENSION.test(name)) continue;
    // Where a note's properties give no title, the index holds its file's
    // name instead. That is step 3's, not a second way in.
    const titleKey = nameKey(title.trim());
    if (titleKey && titleKey !== nameKey(name.replace(NOTE_EXTENSION, ""))) put(byTitle, titleKey, path);
  }
  return { byPath, byName, byTitle };
}

/**
 * One of several files that answer to a name.
 *
 * `written` is the link's own spelling of the end of the path it names; a
 * file spelled exactly so comes before one that only reads the same.
 * `fromNote` is that path read from the linking note's folder — where the
 * link names no path (a title), the files of the note's folder stand in.
 */
function choose(candidates: readonly string[], sourceFolder: string, written: string | null, fromNote: string | null): string | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  let pool = candidates;
  const narrow = (keep: (path: string) => boolean): string | null => {
    const kept = pool.filter(keep);
    if (kept.length === 1) return kept[0];
    if (kept.length > 1) pool = kept;
    return null;
  };
  if (written !== null) {
    const exact = narrow((p) => {
      const nfc = p.normalize("NFC");
      return nfc === written || nfc.endsWith(`/${written}`);
    });
    if (exact !== null) return exact;
  }
  const nearKey = fromNote === null ? nameKey(sourceFolder) : nameKey(fromNote);
  const near = narrow((p) => nameKey(fromNote === null ? folderOf(p) : p) === nearKey);
  if (near !== null) return near;
  return [...pool].sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))[0];
}

export function resolveLinkTargetIndexed(
  sourcePath: string,
  linkTarget: string,
  index: LinkTargetIndex
): string | null {
  if (!linkTarget) return null;
  const query = linkTarget.normalize("NFC").trim();
  if (!query) return null;
  const source = sourcePath.normalize("NFC");
  const sourceFolder = folderOf(source);

  /** A whole vault path: as written, then as a note's. */
  const atPath = (path: string): string | null => {
    const asWritten = choose(index.byPath.get(nameKey(path)) ?? [], sourceFolder, path, null);
    if (asWritten !== null || NOTE_EXTENSION.test(path)) return asWritten;
    return choose(index.byPath.get(nameKey(`${path}.md`)) ?? [], sourceFolder, `${path}.md`, null);
  };

  // 1. An explicit path names one place.
  const named = explicitLinkPath(source, query);
  if (named !== undefined) return named === null ? null : atPath(named);

  // 2. The vault path as written, then with `.md`.
  const exact = atPath(query);
  if (exact !== null) return exact;

  // 3. and 4. The end of a path. Only the files of that NAME can end so; of
  // those, the ones whose path ends with the whole target.
  const atEnd = (target: string): string | null => {
    const key = nameKey(target);
    const candidates = (index.byName.get(nameKey(lastSegment(target))) ?? []).filter((p) => {
      const pathKey = nameKey(p);
      return pathKey === key || pathKey.endsWith(`/${key}`);
    });
    return choose(candidates, sourceFolder, target, sourceFolder ? `${sourceFolder}/${target}` : target);
  };
  const namesNote = NOTE_EXTENSION.test(query);
  const asNote = atEnd(namesNote ? query : `${query}.md`);
  if (asNote !== null) return asNote;
  // A target that names another kind of file by its extension ("Tasks.base",
  // "plan.pdf") can never match through the `.md` form above. Tried AFTER it,
  // so "v1.2" keeps meaning the note "v1.2.md" (pinned by tests).
  if (!namesNote && /\.[A-Za-z0-9]+$/.test(lastSegment(query))) {
    const asFile = atEnd(query);
    if (asFile !== null) return asFile;
  }

  // 5. The title of a note's properties.
  return choose(index.byTitle.get(nameKey(query)) ?? [], sourceFolder, null, null);
}

/** Single-shot variant; hot loops should build the index once instead. */
export function resolveLinkTarget(
  sourcePath: string,
  linkTarget: string,
  allFiles: readonly (string | LinkCorpusFile)[]
): string | null {
  return resolveLinkTargetIndexed(sourcePath, linkTarget, buildLinkTargetIndex(allFiles));
}

/**
 * The rule for a question about NOTES: where a link leads, unless that is an
 * attachment or a database (`mode` "attachment" in the index) — then it is no
 * relation between notes and the answer is null. A relation's reverse column,
 * a rollup, the cascade's "what hangs on this note" and the clean-up of a
 * relation ask this. They resolve over the WHOLE corpus like everything else
 * and only then look at what was found: a corpus of notes alone would make
 * the same link lead somewhere else here than in the editor.
 */
export function noteLinkResolver(
  files: readonly (LinkCorpusFile & { mode?: string | null })[]
): (sourcePath: string, linkTarget: string) => string | null {
  const index = buildLinkTargetIndex(files);
  const notes = new Set<string>();
  for (const file of files) if (file.mode !== "attachment") notes.add(file.path);
  return (sourcePath, linkTarget) => {
    const resolved = resolveLinkTargetIndexed(sourcePath, linkTarget, index);
    return resolved !== null && notes.has(resolved) ? resolved : null;
  };
}

/**
 * A link's target as the rule takes it: without the alias behind `|` and
 * without the anchor from the first `#` or `^` on — the cut the index's own
 * scanner makes (`parseLinkTarget` in ast-scanner.ts), so a click and a link
 * row always ask about the same text.
 */
export function linkTargetName(raw: string): string {
  const withoutAlias = raw.split("|")[0];
  const hash = withoutAlias.indexOf("#");
  const caret = withoutAlias.indexOf("^");
  const at = hash === -1 ? caret : caret === -1 ? hash : Math.min(hash, caret);
  return (at === -1 ? withoutAlias : withoutAlias.slice(0, at)).trim();
}
