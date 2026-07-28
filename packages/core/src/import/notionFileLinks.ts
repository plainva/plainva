/**
 * Rewrites the internal links of a Notion ZIP export onto the notes Plainva
 * actually wrote.
 *
 * A Notion export links between pages with a relative, URL-encoded path that
 * carries the 32-character page ID in every segment:
 *
 * ```
 * [Sub page](Parent%20Page%20abc…32hex…/Sub%20page%20def…32hex….md)
 * ```
 *
 * The importer strips those IDs from the file NAMES, but used to write the
 * markdown body unchanged — so after an import every internal link pointed at
 * a path that no longer existed. The API path never had this problem, which is
 * why a test import through the token can look perfectly healthy while the
 * file path is broken.
 */

/** Normalizes a POSIX-ish path, resolving `.` and `..` without touching disk. */
export function normalizePath(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

/** Directory of a path, or `''` for a top-level file. */
export function dirOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

/** Resolves a link target that is relative to `fromDir`. */
export function resolveFrom(fromDir: string, target: string): string {
  if (target.startsWith('/')) return normalizePath(target);
  return normalizePath(fromDir ? `${fromDir}/${target}` : target);
}

/** Path of `toPath` as seen from `fromDir`, using `../` where needed. */
export function relativeFrom(fromDir: string, toPath: string): string {
  const from = fromDir ? fromDir.split('/') : [];
  const to = toPath.split('/');
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared += 1;
  const up = new Array(from.length - shared).fill('..');
  return [...up, ...to.slice(shared)].join('/');
}

/**
 * Percent-encodes a path for a markdown link target.
 *
 * Only the characters that would end the target or confuse a parser — the
 * slashes stay slashes, so the link is still readable in the file.
 */
export function encodeTarget(path: string): string {
  return path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

function decodeTarget(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    // A stray `%` is not an encoding — take the target as written.
    return target;
  }
}

/** Link targets that address something other than a file in the export. */
function isExternal(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('//');
}

export interface NotionLinkRewriteResult {
  content: string;
  /** How many internal links were pointed at an imported note. */
  rewritten: number;
  /** Internal targets that matched no imported file (attachments, skipped pages). */
  unresolved: number;
}

/**
 * Rewrites every internal markdown link in `content`.
 *
 * @param sourceOriginalPath the export-relative path of the file being written
 * @param sourceFinalPath    where that file landed in the vault (import-relative)
 * @param pathMap            original export path -> final import-relative path
 */
export function rewriteNotionLinks(
  content: string,
  sourceOriginalPath: string,
  sourceFinalPath: string,
  pathMap: Map<string, string>
): NotionLinkRewriteResult {
  const fromDirOriginal = dirOf(normalizePath(sourceOriginalPath));
  const fromDirFinal = dirOf(normalizePath(sourceFinalPath));
  let rewritten = 0;
  let unresolved = 0;

  // `[text](target)` and `![alt](target)`; targets with a closing paren inside
  // are rare in a Notion export and stay untouched rather than half-rewritten.
  const out = content.replace(/(!?)\[([^\]]*)\]\(([^()\s]+)\)/g, (whole, bang: string, text: string, rawTarget: string) => {
    if (isExternal(rawTarget)) return whole;

    const hashAt = rawTarget.indexOf('#');
    const anchor = hashAt >= 0 ? rawTarget.slice(hashAt) : '';
    const targetPath = hashAt >= 0 ? rawTarget.slice(0, hashAt) : rawTarget;
    if (!targetPath) return whole;

    const resolved = resolveFrom(fromDirOriginal, decodeTarget(targetPath));
    const finalPath = pathMap.get(resolved);
    if (!finalPath) {
      unresolved += 1;
      return whole;
    }

    rewritten += 1;
    const rel = relativeFrom(fromDirFinal, finalPath);
    return `${bang}[${text}](${encodeTarget(rel)}${anchor})`;
  });

  return { content: out, rewritten, unresolved };
}
