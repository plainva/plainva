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
 * Precompiled resolution corpus (P2.3): callers that resolve MANY links against
 * the same file list (graph load, backlinks, reverse-relation columns) build
 * this once and get O(1) lookups instead of an O(files) scan per link — the
 * naive form is O(links × files) and stalls the UI on large vaults.
 *
 * All keys are NFC-normalized (P3.7): macOS/APFS reports file names in NFD
 * while typed wiki links are NFC — byte-exact comparison silently broke every
 * umlaut/accent link on a Mac vault. Lookups normalize the query the same way
 * and always return the ORIGINAL path form.
 */
export interface LinkTargetIndex {
  /** NFC path form -> original path. */
  pathsByNfc: Map<string, string>;
  /** NFC basename (last path segment, case-preserving) -> original paths. */
  byBasename: Map<string, string[]>;
}

export function buildLinkTargetIndex(allFilePaths: string[]): LinkTargetIndex {
  const pathsByNfc = new Map<string, string>();
  const byBasename = new Map<string, string[]>();
  for (const p of allFilePaths) {
    const nfc = p.normalize("NFC");
    if (!pathsByNfc.has(nfc)) pathsByNfc.set(nfc, p);
    const base = nfc.split(/[/\\]/).pop();
    if (!base) continue;
    const bucket = byBasename.get(base);
    if (bucket) bucket.push(p);
    else byBasename.set(base, [p]);
  }
  return { pathsByNfc, byBasename };
}

export function resolveLinkTargetIndexed(
  sourcePath: string,
  linkTarget: string,
  index: LinkTargetIndex
): string | null {
  if (!linkTarget) return null;
  const query = linkTarget.normalize("NFC");

  // Try exact path match
  const exact = index.pathsByNfc.get(query);
  if (exact !== undefined) return exact;

  // Try with .md
  const targetWithMd = query.endsWith(".md") ? query : query + ".md";
  const withMd = index.pathsByNfc.get(targetWithMd);
  if (withMd !== undefined) return withMd;

  // Find all files that end with the target. The basename bucket is a strict
  // superset of the old full-scan candidates (endsWith("/…/name.md") implies
  // the same basename), so filtering the bucket is behavior-identical.
  const suffix = "/" + targetWithMd;
  const basename = targetWithMd.split(/[/\\]/).pop() ?? targetWithMd;
  const candidates = index.byBasename.get(basename) ?? [];
  const possiblePaths = candidates.filter(p => {
    const nfc = p.normalize("NFC");
    return nfc.endsWith(suffix) || nfc === targetWithMd;
  });

  if (possiblePaths.length === 0) return null;
  if (possiblePaths.length === 1) return possiblePaths[0];

  // Multiple matches: prefer the one in the same folder as the source
  const sourceFolder = sourcePath.includes("/") ? sourcePath.substring(0, sourcePath.lastIndexOf("/")) : "";
  const sameFolderMatch = possiblePaths.find(p => {
    const pFolder = p.includes("/") ? p.substring(0, p.lastIndexOf("/")) : "";
    return pFolder === sourceFolder;
  });

  if (sameFolderMatch) return sameFolderMatch;

  // Otherwise, prefer the shortest path
  possiblePaths.sort((a, b) => a.length - b.length);
  return possiblePaths[0];
}

/** Single-shot variant; hot loops should build the index once instead. */
export function resolveLinkTarget(
  sourcePath: string,
  linkTarget: string,
  allFilePaths: string[]
): string | null {
  return resolveLinkTargetIndexed(sourcePath, linkTarget, buildLinkTargetIndex(allFilePaths));
}
