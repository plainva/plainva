import { hasSpellingVariants, toPathIdentity } from "./pathIdentity.js";

/**
 * How a store answers "which names are in this folder?" for the spelling
 * lookup. `raw` is a stored spelling ("" is the root).
 */
export interface SpellingSource {
  /**
   * Names directly inside the folder at `raw`, exactly as stored; null when
   * the folder does not exist; undefined when this store cannot list a single
   * folder (then only what a listing already showed is known).
   */
  listNames(raw: string): Promise<string[] | null | undefined>;
  /**
   * Optional exact existence check, cheaper than a listing. A store that is
   * insensitive to normalization (APFS) may answer true for the other
   * spelling too, which is fine: it then finds the file under either one.
   */
  exists?(raw: string): Promise<boolean>;
}

/** One pass's folder listings, shared by several lookups (a sync push pass). */
export type SpellingListingCache = Map<string, Promise<string[] | null | undefined>>;

const join = (a: string, b: string): string => (a ? `${a}/${b}` : b);
const parentOf = (p: string): string => {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
};
const nameOf = (p: string): string => p.slice(p.lastIndexOf("/") + 1);
const depthOf = (p: string): number => (p ? p.split("/").length : 0);

/**
 * The bridge between path identity and stored spelling (ADR 0016).
 *
 * Everything inside Plainva names a file by its identity — the NFC form of the
 * path. A store (a disk, a WebDAV server, a bucket) keeps whatever bytes it was
 * given: macOS and iOS store decomposed accents, a folder made in Finder stays
 * decomposed on a WebDAV server, the same folder written by Plainva on Windows
 * arrives composed. This class keeps the two apart:
 *
 *  - `observe` turns the spellings of a listing into identities and remembers
 *    every spelling that differs from its identity (and every path that has
 *    variants at all, so a later access needs no lookup);
 *  - `resolve` turns an identity back into the stored spelling, segment by
 *    segment, before any read or write — an existing folder is found in
 *    whatever form it is stored, a new name is created in NFC;
 *  - nothing is ever renamed.
 *
 * Two spellings of one name side by side in one folder (a byte-exact store
 * holding both) are twins: the NFC one — or the first in code-point order when
 * neither is NFC — takes the identity, the other keeps its own bytes as its
 * identity and is reported by the sync instead of being synced.
 *
 * Paths without spelling variants (ASCII, scripts without composed characters)
 * never touch the maps: their identity IS their spelling.
 */
export class PathSpellings {
  /** identity -> stored spelling, for paths with variants. */
  private readonly spellingOf = new Map<string, string>();
  /** stored spelling -> identity, only where the two differ. */
  private readonly identityOf = new Map<string, string>();

  /** Forgets everything (a fresh full listing replaces what a store holds). */
  clear(): void {
    this.spellingOf.clear();
    this.identityOf.clear();
  }

  /** Forgets `identity` and everything under it (it was deleted or moved). */
  forget(identity: string): void {
    if (this.spellingOf.size === 0 && this.identityOf.size === 0) return;
    const id = toPathIdentity(identity);
    const under = (p: string) => p === identity || p === id || p.startsWith(`${identity}/`) || p.startsWith(`${id}/`);
    for (const [key, raw] of this.spellingOf) {
      if (under(key)) {
        this.spellingOf.delete(key);
        this.identityOf.delete(raw);
      }
    }
    for (const [raw, key] of this.identityOf) {
      if (under(key) || under(raw)) this.identityOf.delete(raw);
    }
  }

  /** Remembers that `identity` is stored as `raw` (after a write created it). */
  remember(identity: string, raw: string): void {
    if (!hasSpellingVariants(raw) && raw === identity) return;
    const ids = identity.split("/");
    const raws = raw.split("/");
    if (ids.length !== raws.length) return;
    for (let i = 1; i <= ids.length; i++) {
      const id = ids.slice(0, i).join("/");
      const r = raws.slice(0, i).join("/");
      if (!hasSpellingVariants(r) && id === r) continue;
      this.spellingOf.set(id, r);
      if (id !== r) this.identityOf.set(r, id);
    }
  }

  /**
   * The identities of the stored spellings `raws`, all of them below `anchor`
   * (a folder whose spelling and identity the caller already knows; the root
   * by default). Folders are implied by the paths, so a flat key listing works
   * as well as a walk. Siblings that collapse into one identity are twins: the
   * NFC spelling wins, the others keep their bytes.
   */
  observe(raws: Iterable<string>, anchor: { raw: string; identity: string } = { raw: "", identity: "" }): Map<string, string> {
    const all = new Set<string>();
    const anchorDepth = depthOf(anchor.raw);
    for (const raw of raws) {
      let p = raw;
      while (p && p !== anchor.raw && depthOf(p) > anchorDepth && !all.has(p)) {
        all.add(p);
        p = parentOf(p);
      }
    }
    const ids = new Map<string, string>([[anchor.raw, anchor.identity]]);
    const byDepth = new Map<number, string[]>();
    for (const p of all) {
      const d = depthOf(p);
      const level = byDepth.get(d) ?? [];
      level.push(p);
      byDepth.set(d, level);
    }
    for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
      const groups = new Map<string, string[]>();
      for (const raw of byDepth.get(depth)!) {
        const parentRaw = parentOf(raw);
        const parentId = ids.get(parentRaw) ?? this.identityOfStored(parentRaw);
        const name = nameOf(raw);
        const key = join(parentId, hasSpellingVariants(name) ? toPathIdentity(name) : name);
        const group = groups.get(key);
        if (group) group.push(raw);
        else groups.set(key, [raw]);
      }
      for (const [key, group] of groups) {
        if (group.length === 1) {
          ids.set(group[0]!, key);
          continue;
        }
        const sorted = [...group].sort();
        const winner = sorted.find((raw) => nameOf(raw) === toPathIdentity(nameOf(raw))) ?? sorted[0]!;
        for (const raw of sorted) {
          ids.set(raw, raw === winner ? key : join(parentOf(key), nameOf(raw)));
        }
      }
    }
    ids.delete(anchor.raw);
    for (const [raw, id] of ids) {
      if (raw === id && !hasSpellingVariants(raw)) continue;
      this.spellingOf.set(id, raw);
      if (raw !== id) this.identityOf.set(raw, id);
      else this.identityOf.delete(raw);
    }
    return ids;
  }

  /**
   * The identity of one stored spelling without a listing around it (a watcher
   * event, an incremental change): what a listing established wins, anything
   * else is its NFC form.
   */
  identityOfStored(raw: string): string {
    if (!raw || !hasSpellingVariants(raw)) return raw;
    const direct = this.identityOf.get(raw);
    if (direct !== undefined) return direct;
    let id = "";
    let prefix = "";
    for (const segment of raw.split("/")) {
      prefix = join(prefix, segment);
      const known = this.identityOf.get(prefix);
      id = known !== undefined ? known : join(id, toPathIdentity(segment));
    }
    return id;
  }

  /**
   * The stored spelling of `identity` from what listings established, without
   * asking the store. A segment nothing is known about keeps its identity's
   * spelling (a new name is created in NFC).
   */
  resolveKnown(identity: string): string {
    if (!hasSpellingVariants(identity)) return identity;
    const direct = this.spellingOf.get(identity);
    if (direct !== undefined) return direct;
    let raw = "";
    let id = "";
    for (const segment of identity.split("/")) {
      id = join(id, segment);
      const known = this.spellingOf.get(id);
      raw = known !== undefined ? known : join(raw, segment);
    }
    return raw;
  }

  /**
   * The stored spelling of `identity`, asking `source` where no listing has
   * established it yet. Segment by segment: a known folder is followed, an
   * exact name is taken, a name stored in the other normalization form is
   * found through its parent's listing, and a name that is not there at all
   * is new — it and everything below it keep the identity's (NFC) spelling.
   *
   * A segment that is not NFC names a twin spelling literally, but only while
   * that twin really stands next to its composed form; otherwise it addresses
   * the composed identity like any other caller's spelling would.
   */
  async resolve(identity: string, source: SpellingSource, cache: SpellingListingCache = new Map()): Promise<string> {
    if (!hasSpellingVariants(identity)) return identity;
    const direct = this.spellingOf.get(identity);
    if (direct !== undefined) return direct;
    const list = (raw: string) => {
      let names = cache.get(raw);
      if (!names) {
        names = source.listNames(raw);
        cache.set(raw, names);
      }
      return names;
    };
    let raw = "";
    let id = "";
    let absent = false;
    for (const given of identity.split("/")) {
      let segment = given;
      if (absent || !hasSpellingVariants(segment)) {
        id = join(id, segment);
        raw = join(raw, segment);
        continue;
      }
      if (segment !== toPathIdentity(segment)) {
        const known = this.spellingOf.get(join(id, segment));
        if (known !== undefined) {
          id = join(id, segment);
          raw = known;
          continue;
        }
        const names = await list(raw);
        if (names && names.includes(segment) && names.some((n) => n !== segment && toPathIdentity(n) === toPathIdentity(segment))) {
          id = join(id, segment);
          raw = join(raw, segment);
          continue;
        }
        segment = toPathIdentity(segment);
      }
      id = join(id, segment);
      const known = this.spellingOf.get(id);
      if (known !== undefined) {
        raw = known;
        continue;
      }
      const candidate = join(raw, segment);
      if (source.exists && (await source.exists(candidate))) {
        raw = candidate;
        continue;
      }
      const names = await list(raw);
      if (names === undefined || names === null) {
        absent = true;
        raw = candidate;
        continue;
      }
      if (names.includes(segment)) {
        raw = candidate;
        continue;
      }
      const twins = names.filter((n) => toPathIdentity(n) === segment).sort();
      if (twins.length === 0) {
        absent = true;
        raw = candidate;
        continue;
      }
      raw = join(raw, twins[0]!);
      this.spellingOf.set(id, raw);
      this.identityOf.set(raw, id);
    }
    return raw;
  }
}

/** True for the error a store throws when a path is not there. */
export function isNotFoundError(error: unknown): boolean {
  const e = error as { name?: string; code?: string } | null;
  return e?.name === "VaultFileNotFoundError" || e?.code === "FILE_NOT_FOUND" || e?.code === "ENOENT";
}

/**
 * Runs `io` on the stored spelling of `identity`. A remembered spelling can go
 * stale when something outside renamed the file; a not-found answer then drops
 * what was remembered for the path and tries once more with a fresh lookup.
 */
export async function withStoredSpelling<T>(
  spellings: PathSpellings,
  identity: string,
  source: SpellingSource,
  io: (raw: string) => Promise<T>,
): Promise<T> {
  const raw = await spellings.resolve(identity, source);
  try {
    return await io(raw);
  } catch (error) {
    if (raw === identity || !isNotFoundError(error)) throw error;
    const parts = toPathIdentity(identity).split("/");
    for (let i = 1; i <= parts.length; i++) spellings.forget(parts.slice(0, i).join("/"));
    const again = await spellings.resolve(identity, source);
    if (again === raw) throw error;
    return io(again);
  }
}
