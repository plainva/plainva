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
 * **Losing it.** Only a proven contradiction takes the trust back for good
 * (decision of the maintainer, 2026-11-27: "only proven"). A listing is not
 * one snapshot, and another device may save between a probe and a listing,
 * so what a listing alone shows is a doubt: the trust is gone and earned
 * anew from three clean pairs, and nothing is stored. A doubt from the
 * ancestor test becomes proof only when the folder, asked again on its own
 * after the listing, still carries its old tag while the change below it
 * is still there as listed (`Suspect`, checked by the target): an honest
 * server has moved that folder's tag by then. A probe that saw the old tag
 * before a listing with changes stays a doubt, since a save in between
 * explains it. A proven contradiction is stored for the host in the
 * vault's sync state, survives restarts, and holds for every account and
 * path of that vault there. Trust itself is never stored.
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

/**
 * A folder above a change that kept its tag in the listing: proof once the
 * folder, asked again, still has `was` and the changed entry is still as
 * listed (`entryTag`; null for an entry the listing no longer had).
 */
export interface Suspect {
  folder: string;
  was: string;
  entry: string;
  entryIsFolder: boolean;
  entryTag: string | null;
}

/** What a listing told: nothing against the property, a doubt, or suspects to ask again. */
export type Observation = { kind: "fine" } | { kind: "doubt" } | { kind: "suspect"; suspects: Suspect[] };

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
  observe(now: FolderTagListing, probedTag?: string): Observation {
    const before = this.last;
    this.last = now;
    if (this.refutedFlag || !before) return { kind: "fine" };
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
      // A save between the probe and the listing explains it: a doubt.
      this.restart();
      return { kind: "doubt" };
    }
    // Every folder above a change, in both listings, with a change below it.
    const affected = new Map<string, { path: string; kind: ChangeKind }>();
    for (const change of changed) {
      for (let folder = parentOf(change.path); ; folder = parentOf(folder)) {
        if (!affected.has(folder)) affected.set(folder, change);
        if (folder === "") break;
      }
    }
    const suspects: Suspect[] = [];
    let untagged = false;
    let noise = false;
    for (const [folder, tag] of now.folders) {
      if (!before.folders.has(folder)) continue;
      const was = before.folders.get(folder);
      if (tag === undefined || was === undefined) {
        untagged = true;
        continue;
      }
      const below = affected.get(folder);
      if (below) {
        if (tag === was) {
          const deleted = below.kind === "delete" || (below.kind === "folder" && !now.folders.has(below.path));
          suspects.push({
            folder,
            was,
            entry: below.path,
            entryIsFolder: below.kind === "folder",
            entryTag: deleted ? null : below.kind === "folder" ? (now.folders.get(below.path) ?? "") : now.files.get(below.path)!,
          });
        }
      } else if (tag !== was) {
        noise = true;
      }
    }
    if (suspects.length > 0) {
      this.restart();
      return { kind: "suspect", suspects };
    }
    if (untagged || noise || now.mounted !== false || before.mounted !== false) {
      this.restart();
      return { kind: "fine" };
    }
    if (changed.length === 0) return { kind: "fine" };
    const maxDepth = Math.max(0, ...[...now.files.keys(), ...now.folders.keys(), ...before.files.keys()].map(depthOf));
    const inside = Math.min(2, maxDepth);
    for (const { path, kind } of changed) {
      if (depthOf(path) >= inside) this.kinds.add(kind);
      if (depthOf(path) === maxDepth) this.deepest = true;
    }
    this.pairs++;
    return { kind: "fine" };
  }

  /** A suspect asked again held: the server's tags do not follow every change, for good. */
  refute(): void {
    this.refutedFlag = true;
    this.restart();
  }
}
