/**
 * Which files a link could mean (ADR 0018; AI harness P5-7b).
 *
 * The app follows a link by more than one rule: the desktop's editor by a
 * note's title or its whole path, the phone by a path from the note it stands
 * in and by the file's name anywhere, the graph by the end of a path. Each
 * rule opens ONE file, and they do not always open the same one.
 *
 * The privacy gate asks another question. "Does this link name a note the
 * rules keep back?" must not depend on which shell assembles the text, and
 * its error is to miss a note, not to find one too many. So it asks for every
 * file a link of this spelling could mean under any of those rules — by path
 * from the note it stands in, by path from the vault's root, by the end of a
 * path, by the file's name, by the title of a note's properties — and
 * withholds the link where one of them is kept back.
 *
 * The same answer serves the source check of the writing tools: a link leads
 * "nowhere" only where no note could be meant by it.
 *
 * Names are compared as people read them: without regard to letter case, and
 * a composed and a decomposed spelling of one letter are the same name.
 */

/** A file as the index knows it: its path, and for a note the title its properties give it where it has one. */
export interface NamedFile {
  path: string;
  title?: string | null;
}

export interface LinkNameIndex {
  /** A file by its whole path; a note also by its path without the extension. */
  readonly byPath: ReadonlyMap<string, readonly string[]>;
  /** Files by the end of their path: the file's name, and every run of folders in front of it. */
  readonly byEnd: ReadonlyMap<string, readonly string[]>;
  /** Notes by the title of their properties. */
  readonly byTitle: ReadonlyMap<string, readonly string[]>;
}

/**
 * How many files of one name are asked about before the answer is "cannot
 * tell". A bare name can be shared by one note per folder; each of them is a
 * file to read for its own rule.
 */
export const LINK_CANDIDATE_LIMIT = 200;

const NOTE_EXTENSION = /\.md$/i;

/** Whether a path is a note's. */
export function isNotePath(path: string): boolean {
  return NOTE_EXTENSION.test(path);
}

/** One name, however its letters are cased and composed. */
const nameKey = (text: string) => text.normalize("NFC").toLowerCase();

/** A path with one kind of separator, as the vault writes it. */
const slashed = (path: string) => path.replace(/\\/g, "/");

/** Files are taken once each (`buildLinkNameIndex`), so a name's list needs no search for what is in it already. */
function put(map: Map<string, string[]>, key: string, path: string): void {
  const paths = map.get(key);
  if (!paths) map.set(key, [path]);
  else if (paths[paths.length - 1] !== path) paths.push(path);
}

/**
 * The lookup over a vault's files. A note is found with and without its
 * extension — `[[Brief]]` and `[[Brief.md]]` are one note —, any other file by
 * its name as it is.
 */
export function buildLinkNameIndex(files: readonly NamedFile[]): LinkNameIndex {
  const byPath = new Map<string, string[]>();
  const byEnd = new Map<string, string[]>();
  const byTitle = new Map<string, string[]>();
  const taken = new Set<string>();
  for (const file of files) {
    if (!file || typeof file.path !== "string") continue;
    const path = slashed(file.path).replace(/^\/+/, "");
    if (!path || taken.has(path)) continue;
    taken.add(path);
    const names = isNotePath(path) ? [path, path.replace(NOTE_EXTENSION, "")] : [path];
    for (const name of names) {
      if (!name) continue;
      put(byPath, nameKey(name), path);
      const parts = name.split("/");
      for (let from = 0; from < parts.length; from++) put(byEnd, nameKey(parts.slice(from).join("/")), path);
    }
    const title = typeof file.title === "string" ? file.title.trim() : "";
    if (title) put(byTitle, nameKey(title), path);
  }
  return { byPath, byEnd, byTitle };
}

/** The folder a note lies in; "" for the vault's root. */
function folderOf(path: string): string {
  const plain = slashed(path);
  const at = plain.lastIndexOf("/");
  return at < 0 ? "" : plain.slice(0, at);
}

/** `relative` read from `folder`, with its `.` and `..` taken out; null where it climbs out of the vault. */
function fromFolder(folder: string, relative: string): string | null {
  const parts = folder ? folder.split("/") : [];
  for (const part of relative.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

/**
 * A link's target in the spellings it may stand for a file in: as written,
 * and with its percent escapes resolved (a Markdown link writes a blank as
 * `%20`) — each with `/` as its only separator. The caller has taken a
 * heading (`#…`) and an alias (`|…`) off already: a file's name may contain
 * a `#`.
 */
export function linkTargetForms(target: string): string[] {
  const forms: string[] = [];
  const add = (text: string) => {
    const form = slashed(text).trim();
    if (form && !forms.includes(form)) forms.push(form);
  };
  add(target);
  if (target.includes("%")) {
    try {
      add(decodeURIComponent(target));
    } catch {
      // Not an escape after all: the spelling as written is the only one.
    }
  }
  return forms;
}

/**
 * Every file a link of this target, written in the note at `fromPath`, could
 * mean — under any rule the app follows a link by. In the order of how
 * closely a rule names a file: a path from the note the link stands in, a
 * path from the vault's root, the end of a path (the file's name among them),
 * the title of a note's properties. Not capped: whoever asks about each of
 * them bounds that with `LINK_CANDIDATE_LIMIT`.
 */
export function filesALinkCouldMean(index: LinkNameIndex, target: string, fromPath: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (paths: readonly string[] | undefined) => {
    for (const path of paths ?? []) {
      if (seen.has(path)) continue;
      seen.add(path);
      found.push(path);
    }
  };
  const folder = folderOf(fromPath);
  for (const form of linkTargetForms(target)) {
    const rooted = form.startsWith("/");
    const plain = form.replace(/^\/+/, "");
    if (!plain) continue;
    const climbs = plain.split("/").some((part) => part === "." || part === "..");
    if (!rooted) {
      const relative = fromFolder(folder, plain);
      if (relative) add(index.byPath.get(nameKey(relative)));
    }
    if (climbs) {
      // `.` and `..` only mean something as steps from a folder; as part of a name they are none.
      const fromRoot = fromFolder("", plain);
      if (fromRoot) add(index.byPath.get(nameKey(fromRoot)));
      continue;
    }
    add(index.byPath.get(nameKey(plain)));
    add(index.byEnd.get(nameKey(plain)));
    add(index.byTitle.get(nameKey(plain)));
  }
  return found;
}

/** The notes among them: what a link to a note could mean. */
export function notesALinkCouldMean(index: LinkNameIndex, target: string, fromPath: string): string[] {
  return filesALinkCouldMean(index, target, fromPath).filter(isNotePath);
}
