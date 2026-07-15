/**
 * Ordered candidate vault paths for a PATH-style link target — a markdown
 * relative/absolute link such as `Folder/index.md`, `../Other/note` or a
 * generated `index.md` listing entry. Resolved against the host note's folder
 * first, then the vault root; a target without a `.md`/`.base` extension also
 * yields both extension candidates.
 *
 * Returns an empty list for a bare wiki name (no slash, no extension) — those
 * resolve by note title instead (see vaultService.resolveWikiTarget).
 *
 * Pure by design: the path grammar (percent-decoding, normalization of `.`/`..`,
 * extension fill-in and candidate order) is unit-tested here without a vault.
 * The caller checks each candidate against the vault and returns the first hit.
 */
export function relativeLinkCandidates(target: string, hostPath?: string): string[] {
  const raw = target.split("#")[0].split("|")[0].trim();
  if (!raw) return [];
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* a stray % that is not an escape — keep the raw target */
  }
  // A bare note name has neither a folder separator nor a note extension.
  if (!decoded.includes("/") && !/\.(md|base)$/i.test(decoded)) return [];

  const normalize = (p: string): string => {
    const out: string[] = [];
    for (const seg of p.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") out.pop();
      else out.push(seg);
    }
    return out.join("/");
  };

  const hostDir = hostPath ? hostPath.split("/").slice(0, -1).join("/") : "";
  const candidates: string[] = [];
  for (const base of [normalize(`${hostDir}/${decoded}`), normalize(decoded)]) {
    if (!base) continue;
    const withExt = /\.(md|base)$/i.test(base) ? [base] : [base, `${base}.md`, `${base}.base`];
    for (const c of withExt) {
      if (!candidates.includes(c)) candidates.push(c);
    }
  }
  return candidates;
}
