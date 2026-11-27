/**
 * Whether a WebDAV server's folder tags tell every change below them, so a
 * sync cycle may ask the vault folder's tag alone (`PROPFIND`, `Depth: 0`)
 * instead of listing everything (plan L7b, decision of 2026-11-27: a foreign
 * change may arrive at most once per device and host, and at most one
 * minute later than with a full listing every cycle).
 *
 * Nextcloud and ownCloud change a folder's entity tag with every change
 * anywhere below it. Most other servers do not: a folder there has no tag,
 * or one that follows the folder's time on disk (Apache mod_dav, Synology),
 * which moves when an entry right inside it comes or goes and not when a
 * file below is written anew. So the property is never assumed from a
 * server's name; it is earned from the server's own full listings, and every
 * later full listing tests it again.
 *
 * **The ancestor test.** Two full listings in a row are compared on every
 * level: for each file edited, created or deleted and each folder created or
 * deleted, every folder above it — up to the vault folder — must carry
 * another tag than before. One such folder with the same tag is a
 * contradiction. A folder whose tag moved while nothing below it changed is
 * noise: no contradiction, but the evidence starts again.
 *
 * **Earning trust.** `PAIRS_NEEDED` clean pairs with changes, together
 * covering an edit, a creation, a deletion and a folder created or deleted,
 * each inside a folder where the vault has folders, and one change at the
 * vault's deepest level; no noise, no folder without a tag, and no entry the
 * server marks as mounted (`oc:permissions` with "M": external storage, an
 * incoming share), since a mount's changes past WebDAV are seen only by a
 * deep listing.
 *
 * **Keeping it.** While trusted, a full listing is preceded by a probe of
 * the vault folder's tag. Where that probe saw the tag of the last listing
 * and the listing right after it shows changes, the probes missed them: a
 * contradiction. This also catches a server that notices changes past
 * WebDAV only when listed deeply.
 *
 * **Losing it.** One contradiction takes the trust back for good: it is
 * stored for the host (`store`), survives restarts, and holds for every
 * account and path there. Trust itself is never stored; after a restart it
 * is earned anew.
 */

export const PAIRS_NEEDED = 3;

/** Prefix of the stored contradictions, one key per host. */
export const FOLDER_TAGS_REFUTED_KEY = "webdav-folder-tags:refuted:v1:";

/** One full listing as the ledger compares it. */
export interface FolderTagListing {
  /** Every file below the vault folder, by vault-relative path, with its tag as listed. */
  files: ReadonlyMap<string, string>;
  /** Every folder, by vault-relative path ("" is the vault folder), with its tag as listed (undefined: none). */
  folders: ReadonlyMap<string, string | undefined>;
  /** Whether the listing asked for mount marks and an entry carries one; undefined where it did not ask. */
  mounted: boolean | undefined;
}

type ChangeKind = "edit" | "create" | "delete" | "folder";

const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const depthOf = (path: string) => (path === "" ? 0 : path.split("/").length);

export class FolderTagLedger {
  private last: FolderTagListing | null = null;
  private pairs = 0;
  private kinds = new Set<ChangeKind>();
  private deepest = false;
  private refutedFlag: boolean;

  constructor(refuted = false) {
    this.refutedFlag = refuted;
  }

  /** Whether a contradiction was ever seen (here or, by the store, before). */
  get refuted(): boolean {
    return this.refutedFlag;
  }

  /** The vault folder's tag in the last full listing. */
  get rootTag(): string | undefined {
    return this.last?.folders.get("");
  }

  /** Whether a listing may ask for mount marks: only a server whose vault folder has a tag can earn trust. */
  get candidate(): boolean {
    return !this.refutedFlag && this.rootTag !== undefined;
  }

  /** Whether the vault folder's tag is shown to follow every change below it. */
  get trusted(): boolean {
    if (this.refutedFlag || !this.last || this.rootTag === undefined || this.last.mounted !== false) return false;
    if (this.pairs < PAIRS_NEEDED || !this.deepest) return false;
    const hasFolders = [...this.last.folders.keys()].some((path) => path !== "");
    const needed: ChangeKind[] = hasFolders ? ["edit", "create", "delete", "folder"] : ["edit", "create", "delete"];
    return needed.every((kind) => this.kinds.has(kind));
  }

  /** Forgets the evidence (not a contradiction). */
  private restart(): void {
    this.pairs = 0;
    this.kinds.clear();
    this.deepest = false;
  }

  /**
   * Takes in a full listing. `probedTag` is the vault folder's tag a probe
   * saw right before it, where one was made. Returns "contradiction" where
   * the listing disproves the property (the caller stores it).
   */
  observe(now: FolderTagListing, probedTag?: string): "contradiction" | undefined {
    const before = this.last;
    this.last = now;
    if (this.refutedFlag || !before) return undefined;
    const changed: Array<{ path: string; kind: ChangeKind }> = [];
    for (const [path, tag] of now.files) {
      const was = before.files.get(path);
      if (was === undefined) changed.push({ path, kind: "create" });
      else if (was !== tag) changed.push({ path, kind: "edit" });
    }
    for (const path of before.files.keys()) if (!now.files.has(path)) changed.push({ path, kind: "delete" });
    for (const path of now.folders.keys()) if (!before.folders.has(path)) changed.push({ path, kind: "folder" });
    for (const path of before.folders.keys()) if (!now.folders.has(path)) changed.push({ path, kind: "folder" });

    if (changed.length > 0 && probedTag !== undefined && probedTag === before.folders.get("")) {
      return this.refute();
    }
    // Every folder above a change, in both listings.
    const affected = new Set<string>();
    for (const { path } of changed) {
      for (let folder = parentOf(path); ; folder = parentOf(folder)) {
        affected.add(folder);
        if (folder === "") break;
      }
    }
    let untagged = false;
    let noise = false;
    for (const [folder, tag] of now.folders) {
      if (!before.folders.has(folder)) continue;
      const was = before.folders.get(folder);
      if (tag === undefined || was === undefined) {
        untagged = true;
        continue;
      }
      if (affected.has(folder)) {
        if (tag === was) return this.refute();
      } else if (tag !== was) {
        noise = true;
      }
    }
    if (untagged || noise || now.mounted !== false || before.mounted !== false) {
      this.restart();
      return undefined;
    }
    if (changed.length === 0) return undefined;
    const maxDepth = Math.max(0, ...[...now.files.keys(), ...now.folders.keys(), ...before.files.keys()].map(depthOf));
    const inside = Math.min(2, maxDepth);
    for (const { path, kind } of changed) {
      if (depthOf(path) >= inside) this.kinds.add(kind);
      if (depthOf(path) === maxDepth) this.deepest = true;
    }
    this.pairs++;
    return undefined;
  }

  private refute(): "contradiction" {
    this.refutedFlag = true;
    this.restart();
    return "contradiction";
  }
}
