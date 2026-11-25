/**
 * Whether a WebDAV server's vault folder tells a change below it by its own
 * entity tag — learned from the server's own listings, never assumed from
 * its name.
 *
 * Asking the vault folder alone (`PROPFIND` with `Depth: 0`) costs one small
 * answer; listing the whole folder costs one entry per file. The first is
 * worth asking instead of the second only where a change anywhere below the
 * folder changes the folder's tag. Nextcloud and ownCloud work so; many
 * servers do not: a folder there has no tag, or one that follows the
 * folder's time on disk, which moves when an entry right inside it comes or
 * goes and not when a file below is written anew. A shortcut that took such
 * a tag at its word would miss changes on the server for good — a sync that
 * stands still without a word.
 *
 * So the shortcut is earned, from two full listings in a row:
 *
 * - **Evidence**: between them the vault folder's tag changed, every change
 *   lies inside a folder (none right inside the vault folder), and the vault
 *   folder's own entries stayed the same — so nothing but a change below can
 *   have moved its tag. One such pair proves the property.
 * - **Counter-evidence**: anything changed and the tag did not. Then the
 *   server does not have the property, and this watch never trusts its tag
 *   again (for as long as it lives — a vault's open).
 * - A tag that moved while nothing below did is no use either (it would
 *   send every probe on to a full listing): not trusted from then on.
 * - A listing without a tag for the vault folder tells nothing and takes
 *   back what was learned.
 *
 * The worker still lists everything at fixed times between such probes
 * (`FULL_LISTING_EVERY_N_CYCLES`, `FULL_LISTING_MAX_AGE_MS`): a server that
 * passes the evidence and still misses a change somewhere is caught by the
 * next full listing, which then counts against it.
 */
export interface RootTagListing {
  /** The vault folder's entity tag in that listing, undefined where it lists none. */
  rootTag: string | undefined;
  /** Every file below the vault folder, by vault-relative path, with its entity tag. */
  files: ReadonlyMap<string, string>;
  /** Every folder below the vault folder, by vault-relative path. */
  folders: readonly string[];
}

export class RootTagWatch {
  private last: { rootTag: string | undefined; files: Map<string, string>; folders: Set<string>; top: Set<string> } | null = null;
  private evidence = 0;
  private refuted = false;

  /** Whether the vault folder's tag is shown to follow every change below it. */
  get proven(): boolean {
    return !this.refuted && this.evidence > 0;
  }

  /** Whether a listing showed that it does not. */
  get disproven(): boolean {
    return this.refuted;
  }

  /** Takes in a full listing (`RootTagWatch` says what it learns from it). */
  observe(listing: RootTagListing): void {
    const top = new Set<string>([
      ...[...listing.files.keys()].map((path) => path.split("/")[0]),
      ...listing.folders.map((path) => path.split("/")[0]),
    ]);
    const now = { rootTag: listing.rootTag, files: new Map(listing.files), folders: new Set(listing.folders), top };
    const before = this.last;
    this.last = now;
    if (this.refuted || !before) return;
    if (now.rootTag === undefined || before.rootTag === undefined) {
      this.evidence = 0;
      return;
    }
    const changed: string[] = [];
    for (const [path, tag] of now.files) if (before.files.get(path) !== tag) changed.push(path);
    for (const path of before.files.keys()) if (!now.files.has(path)) changed.push(path);
    for (const path of now.folders) if (!before.folders.has(path)) changed.push(path);
    for (const path of before.folders) if (!now.folders.has(path)) changed.push(path);
    const topChanged = now.top.size !== before.top.size || [...now.top].some((name) => !before.top.has(name));
    if (changed.length === 0 && !topChanged) {
      // A tag that moves while nothing below it did tells no change apart
      // from none: asking it would cost a full listing every time anyway.
      if (now.rootTag !== before.rootTag) {
        this.refuted = true;
        this.evidence = 0;
      }
      return;
    }
    if (now.rootTag === before.rootTag) {
      this.refuted = true;
      this.evidence = 0;
      return;
    }
    if (!topChanged && changed.every((path) => path.includes("/"))) this.evidence++;
  }
}

/** The cursor the target hands the worker for its vault folder's tag (`getStartCursor`). */
export const ROOT_TAG_CURSOR = "webdav-root:";
