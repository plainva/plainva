import type { ISyncTarget } from "./ISyncTarget.js";
import type { IVaultAdapter, VaultFileInfo } from "../vault/IVaultAdapter.js";
import { readLocalFile } from "../vault/localText.js";
import { foldPathForCollision, isTwinSpelling, toPathIdentity, type NameCollision } from "./pathIdentity.js";

/**
 * The "Two spellings, one file" card as cases a person can act on (finding
 * 2026-11-03).
 *
 * The worker reports a collision as a pair of paths (`NameCollision`). For a
 * twin spelling (ADR 0016) the two paths are the same name in two Unicode
 * forms: the card printed `Notiz.md ↔ Notiz.md`, told the person to rename
 * one, and gave no way to tell them apart or to act — on the phone the twin
 * was not even reachable in the file list. This module turns the pairs into
 * one case per name with the facts that tell the copies apart (size, time,
 * whether their bytes are the same) and resolves a case on request:
 *
 *  - a twin whose bytes are the same as its composed file is a leftover copy
 *    and is removed (**Remove duplicates**);
 *  - a twin whose bytes differ becomes a file of its own under a free name
 *    (`Name (2).md`) and syncs like any other (**Keep both**).
 *
 * The composed file — the one Plainva syncs — is never touched.
 */

/** Size and modification time of one copy; null where the store did not say. */
export interface CollisionCopy {
  size: number | null;
  modifiedMs: number | null;
}

export type NameCollisionAction = "remove-duplicate" | "keep-both";

export interface NameCollisionCase {
  /** One case per name: the folded name, whichever side reported it. */
  key: string;
  /**
   * `spelling`: the same name in two Unicode forms, side by side in one
   * folder (ADR 0016) — the copies LOOK alike. `case`: names that differ in
   * letter case only — two names a person can see.
   */
  kind: "spelling" | "case";
  /** The name the card shows: the file Plainva syncs (the composed identity of a twin). */
  path: string;
  /** The other spelling(s) of the case. */
  others: string[];
  /** Whether the facts below were established (false: the card shows names only). */
  described: boolean;
  /** The synced copy: here on this device, else in the cloud; null where there is none. */
  synced: CollisionCopy | null;
  /** The other copy: here on this device, else in the cloud. */
  other: CollisionCopy | null;
  /** Where the other copy lives. */
  where: { here: boolean; remote: boolean };
  /** Whether the bytes of the two copies are the same; null where they could not be compared. */
  identical: boolean | null;
  /** What the card can do about the case. */
  action: NameCollisionAction | null;
}

/**
 * One case per name. Pairs reported from both sides of the sync, or once per
 * direction, belong to the same case; a twin spelling's composed identity is
 * the name shown. Pure: no facts, no action — the worker adds those.
 */
export function groupNameCollisions(collisions: readonly NameCollision[]): NameCollisionCase[] {
  const groups = new Map<string, { names: string[]; spelling: boolean; shown: string }>();
  for (const c of collisions) {
    const spelling = isTwinSpelling(c.path) && toPathIdentity(c.path) === c.twin;
    const shown = spelling ? c.twin : c.path;
    const key = foldPathForCollision(shown);
    let group = groups.get(key);
    if (!group) {
      group = { names: [], spelling: true, shown };
      groups.set(key, group);
    }
    if (!spelling) group.spelling = false;
    for (const name of [c.path, c.twin]) if (!group.names.includes(name)) group.names.push(name);
  }
  return [...groups].map(([key, g]) => ({
    key,
    kind: g.spelling ? "spelling" : "case",
    path: g.shown,
    others: g.names.filter((n) => n !== g.shown),
    described: false,
    synced: null,
    other: null,
    where: { here: false, remote: false },
    identical: null,
    action: null,
  }));
}

/**
 * The first free name for a copy of `path`: `path` itself, then
 * `Name (2).md`, `Name (3).md`, … — the numbering the import uses for a
 * second note of the same name. "Free" compares the way a name collides:
 * without letter case and Unicode form (`foldPathForCollision`), so the new
 * name cannot itself become the next case on the card.
 */
export function freeCopyPath(path: string, taken: Iterable<string>): string {
  const folded = new Set<string>();
  for (const p of taken) folded.add(foldPathForCollision(p));
  const slash = path.lastIndexOf("/");
  const dir = slash < 0 ? "" : path.slice(0, slash + 1);
  const name = slash < 0 ? path : path.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 1; n <= 1000; n++) {
    const candidate = toPathIdentity(n === 1 ? path : `${dir}${stem} (${n})${ext}`);
    if (!folded.has(foldPathForCollision(candidate))) return candidate;
  }
  throw new Error(`No free name for a copy of ${path}`);
}

/** The numbered copies of `path` already there (`Name (2).md`, …) among `paths`. */
function numberedCopies(path: string, paths: Iterable<string>): string[] {
  const slash = path.lastIndexOf("/");
  const dir = slash < 0 ? "" : path.slice(0, slash + 1);
  const name = slash < 0 ? path : path.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const out: string[] = [];
  for (const p of paths) {
    if (!p.startsWith(dir) || p.slice(dir.length).includes("/")) continue;
    const rest = p.slice(dir.length);
    if (!rest.startsWith(`${stem} (`) || !rest.endsWith(`)${ext}`)) continue;
    const n = rest.slice(stem.length + 2, rest.length - ext.length - 1);
    if (/^[0-9]+$/.test(n)) out.push(p);
  }
  return out;
}

const sameBytes = (a: Uint8Array | null, b: Uint8Array | null): boolean => {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/**
 * A file of this device as bytes, read the way the index reads it
 * (`readLocalFile`): the text where the file is UTF-8 — that text IS the
 * file —, the bytes where it is not. A plain byte read would do on a disk, but
 * not on every store: the phone's web shell keeps a text file as a string and
 * cannot hand it out as bytes.
 */
async function localBytes(vault: IVaultAdapter, path: string): Promise<Uint8Array> {
  const file = await readLocalFile(vault, path);
  return file.bytes ?? new TextEncoder().encode(file.text);
}

const parentOf = (p: string): string => {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
};

/** What the last listings of the cloud said about a path. */
export interface RemoteFacts {
  etag: string;
  modifiedMs?: number;
}

/**
 * What the twin work needs from the worker. `vault` is the worker's raw,
 * backup-capable adapter (a deletion there snapshots the file first); `target`
 * the spelling proxy around the provider, so a twin's own bytes address
 * exactly the twin.
 */
export interface NameTwinContext {
  vault: IVaultAdapter;
  target: ISyncTarget;
  queue: { queueWrite(path: string): Promise<void>; discardOperationsOf?(path: string): Promise<void> };
  stateRepo: { deleteSyncState(path: string): Promise<void> };
  /** The cloud as the listings showed it. */
  remote(path: string): RemoteFacts | undefined;
  /** Every path the cloud listed, for free names. */
  remotePaths(): Iterable<string>;
  /** Keeps `bytes` in the version history of `path` (BackupVaultAdapter.keepSnapshot), where the vault can. */
  keepSnapshot?(path: string, bytes: Uint8Array): Promise<void>;
  /** A sign of life for the cycle watchdog. */
  touch?(): void;
  /** A fresh full listing of the cloud (identities), to check the composed files after a removal. */
  relist?(): Promise<ReadonlySet<string>>;
}

interface CopyBytes {
  here: Uint8Array | null;
  remote: Uint8Array | null;
}

/**
 * The facts of one case, read fresh. Local presence is read from the parent
 * folder's listing, never with `exists`: for a twin spelling the adapter
 * answers `exists` for the composed name too (on APFS the two ARE one file).
 */
async function readCase(
  ctx: NameTwinContext,
  c: NameCollisionCase,
  listings: Map<string, Promise<VaultFileInfo[] | null>>,
  downloads?: Map<string, { etag: string; bytes: Uint8Array | null }>,
): Promise<{ syncedHere: VaultFileInfo | null; otherHere: VaultFileInfo | null; syncedRemote: RemoteFacts | undefined; otherRemote: RemoteFacts | undefined; synced: CopyBytes; other: CopyBytes } | null> {
  const otherPath = c.others[0];
  if (!otherPath) return null;
  const listing = (folder: string) => {
    let entries = listings.get(folder);
    if (!entries) {
      entries = Promise.resolve()
        .then(() => ctx.vault.listDir(folder, false))
        .catch((e: unknown) => {
          if ((e as { name?: string } | null)?.name === "VaultFileNotFoundError") return [];
          return null;
        });
      listings.set(folder, entries);
    }
    return entries;
  };
  const here = async (path: string): Promise<VaultFileInfo | null> => {
    const entries = await listing(parentOf(path));
    if (entries === null) throw new Error(`could not list ${parentOf(path) || "the vault root"}`);
    return entries.find((e) => !e.isDirectory && e.path === path) ?? null;
  };
  const download = async (path: string, facts: RemoteFacts): Promise<Uint8Array | null> => {
    const cached = downloads?.get(path);
    if (cached && cached.etag === facts.etag) return cached.bytes;
    ctx.touch?.();
    const bytes = await ctx.target.download(path);
    downloads?.set(path, { etag: facts.etag, bytes });
    return bytes;
  };
  const syncedHere = await here(c.path);
  const otherHere = await here(otherPath);
  const syncedRemote = ctx.remote(c.path);
  const otherRemote = ctx.remote(otherPath);
  const synced: CopyBytes = { here: null, remote: null };
  const other: CopyBytes = { here: null, remote: null };
  // Bytes only where they decide something: a twin spelling is compared, a
  // letter-case pair is two names a person can tell apart.
  if (c.kind === "spelling") {
    if (syncedHere) synced.here = await localBytes(ctx.vault, c.path);
    if (otherHere) other.here = await localBytes(ctx.vault, otherPath);
    if (otherRemote) other.remote = await download(otherPath, otherRemote);
    // The composed file's cloud copy is read only where this device has none:
    // the copy here is the one Plainva compares and keeps.
    if (!syncedHere && syncedRemote) synced.remote = await download(c.path, syncedRemote);
  }
  return { syncedHere, otherHere, syncedRemote, otherRemote, synced, other };
}

/**
 * Adds the facts and the action to each case. A twin spelling is compared
 * byte for byte with its composed file — the copy on this device where there
 * is one. `downloads` keeps a cloud copy's bytes per ETag, so a card shown
 * every cycle downloads a twin once, not every minute.
 */
export async function describeNameCollisions(
  ctx: NameTwinContext,
  collisions: readonly NameCollision[],
  downloads: Map<string, { etag: string; bytes: Uint8Array | null }>,
): Promise<NameCollisionCase[]> {
  const cases = groupNameCollisions(collisions);
  const listings = new Map<string, Promise<VaultFileInfo[] | null>>();
  for (const c of cases) {
    try {
      const read = await readCase(ctx, c, listings, downloads);
      if (!read) continue;
      const { syncedHere, otherHere, syncedRemote, otherRemote } = read;
      c.described = true;
      c.where = { here: !!otherHere, remote: !!otherRemote };
      c.synced = syncedHere
        ? { size: syncedHere.size, modifiedMs: syncedHere.mtime || null }
        : syncedRemote
          ? { size: read.synced.remote?.length ?? null, modifiedMs: syncedRemote.modifiedMs ?? null }
          : null;
      c.other = otherHere
        ? { size: otherHere.size, modifiedMs: otherHere.mtime || null }
        : otherRemote
          ? { size: read.other.remote?.length ?? null, modifiedMs: otherRemote.modifiedMs ?? null }
          : null;
      if (c.kind === "spelling") {
        const reference = read.synced.here ?? read.synced.remote;
        const copies = [read.other.here, read.other.remote].filter((b): b is Uint8Array => b !== null);
        c.identical = reference && copies.length > 0 ? copies.every((b) => sameBytes(b, reference)) : copies.length > 0 && !c.synced ? false : null;
        c.action = c.identical === true ? "remove-duplicate" : c.identical === false ? "keep-both" : null;
      } else {
        // Letter case: two names a person can tell apart. Kept both by giving
        // this device's file a free name through the app's own rename (the
        // shell does it: links to it follow). Only where that file is here.
        c.action = syncedHere ? "keep-both" : null;
      }
    } catch (e) {
      console.warn(`[nameTwins] could not compare the copies of ${c.path}`, e);
    }
  }
  return cases;
}

export interface NameTwinResolution {
  /** Twin copies removed (here or in the cloud). */
  removed: number;
  /** Twin copies that became a file of their own. */
  kept: string[];
  /** Cases left as they were: their bytes changed, or a step failed. */
  skipped: number;
  /** Composed files the cloud lost during the pass and that go up again from here. */
  restored: string[];
}

/**
 * Resolves the twin spellings among `cases` the way `action` says, each case
 * read fresh first. Letter-case cases are not handled here (the shell renames
 * them through its own rename path).
 *
 * Removal (`remove-duplicate`): only where every copy of the twin has the same
 * bytes as the composed file at this moment. Here, the backup adapter's delete
 * snapshots the twin first (and the desktop deletes into the trash); in the
 * cloud, the bytes are kept in the composed file's version history first, and
 * the composed file itself holds the same bytes.
 *
 * Keep both (`keep-both`): only where a copy differs. The twin's copy here is
 * renamed to a free composed name, the cloud's copy is written here under one,
 * and either is queued for upload as a new file; the twin itself then goes. A
 * copy that equals the composed file or an existing numbered copy is not
 * written a second time.
 *
 * The cloud's twin is removed through the same target call every remote
 * deletion takes, by its own stored spelling — and never through the queue or
 * the deletion journal: the engine drops a queued twin DELETE on purpose, and
 * the journal names paths by their composed identity, so an entry would make
 * every other device delete the composed note (deletionJournal.ts).
 */
export async function resolveTwinSpellings(
  ctx: NameTwinContext,
  cases: readonly NameCollisionCase[],
  action: NameCollisionAction,
  changedPaths: string[],
): Promise<NameTwinResolution> {
  const result: NameTwinResolution = { removed: 0, kept: [], skipped: 0, restored: [] };
  /** Composed files the cloud listed when their twin was removed there. */
  const remoteBefore = new Set<string>();
  let remoteDeleted = false;
  const removeRemote = async (twin: string, synced: string, bytes: Uint8Array, keepIn: string) => {
    // The twin's own bytes are its identity, and the proxy resolves them to
    // exactly that spelling. Never anything whose identity is the composed name.
    if (!isTwinSpelling(twin) || twin === synced) throw new Error(`refusing to delete ${twin}: not a twin spelling`);
    if (ctx.keepSnapshot) await ctx.keepSnapshot(keepIn, bytes);
    ctx.touch?.();
    await ctx.target.push({ id: 0, file_path: twin, operation: "delete", retry_count: 0, next_retry_at: 0, queued_at: Date.now() });
    remoteDeleted = true;
    await ctx.stateRepo.deleteSyncState(twin);
  };
  const removeHere = async (twin: string, synced: string) => {
    if (!isTwinSpelling(twin)) throw new Error(`refusing to delete ${twin}: not a twin spelling`);
    // The adapter names the twin literally only while it stands next to its
    // composed file; alone, the same spelling would address the composed one.
    const names = (await ctx.vault.listDir(parentOf(twin), false)).map((e) => e.path);
    if (!names.includes(twin) || !names.includes(synced)) throw new Error(`refusing to delete ${twin}: it no longer stands next to ${synced}`);
    await ctx.vault.deleteItem(twin, false);
    await ctx.queue.discardOperationsOf?.(twin);
    changedPaths.push(twin);
  };

  for (const c of cases) {
    if (c.kind !== "spelling") continue;
    const twin = c.others.find((o) => isTwinSpelling(o) && toPathIdentity(o) === c.path);
    if (!twin) {
      result.skipped++;
      continue;
    }
    try {
      // Read fresh for every case: an earlier case may have changed the folder.
      const read = await readCase(ctx, { ...c, others: [twin] }, new Map());
      if (!read) {
        result.skipped++;
        continue;
      }
      if (read.syncedRemote) remoteBefore.add(c.path);
      const reference = read.synced.here ?? read.synced.remote;
      const copies = [read.other.here, read.other.remote].filter((b): b is Uint8Array => b !== null);
      // Gone since the card was drawn: nothing left to resolve.
      if (copies.length === 0) continue;
      const identical = !!reference && copies.every((b) => sameBytes(b, reference));
      if (action === "remove-duplicate") {
        if (!identical) {
          result.skipped++;
          continue;
        }
        if (read.other.here) {
          await removeHere(twin, c.path);
          result.removed++;
        }
        if (read.other.remote) {
          await removeRemote(twin, c.path, read.other.remote, c.path);
          result.removed++;
        }
        continue;
      }
      // Keep both.
      if (identical) {
        result.skipped++;
        continue;
      }
      // Names here and in the cloud, so the copy takes a name free on both.
      const entries = (await ctx.vault.listDir(parentOf(c.path), false).catch(() => [] as VaultFileInfo[])).map((e) => e.path);
      const taken = new Set<string>([...entries, ...ctx.remotePaths(), c.path, twin]);
      // Bytes this case already keeps under a composed name: the composed
      // file and every numbered copy here (a twin another device kept already).
      const keptBytes: Uint8Array[] = [];
      if (reference) keptBytes.push(reference);
      for (const copy of numberedCopies(c.path, entries)) keptBytes.push(await localBytes(ctx.vault, copy));
      const alreadyKept = (b: Uint8Array) => keptBytes.some((k) => sameBytes(k, b));
      const keepAt = () => {
        const path = freeCopyPath(c.path, taken);
        taken.add(path);
        result.kept.push(path);
        changedPaths.push(path);
        return path;
      };
      if (read.other.here) {
        if (alreadyKept(read.other.here)) {
          await removeHere(twin, c.path);
          result.removed++;
        } else {
          const to = keepAt();
          await ctx.vault.renameItem(twin, to);
          await ctx.queue.discardOperationsOf?.(twin);
          changedPaths.push(twin);
          await ctx.queue.queueWrite(to);
          keptBytes.push(read.other.here);
        }
      }
      if (read.other.remote) {
        let keptIn = c.path;
        if (!alreadyKept(read.other.remote)) {
          const to = keepAt();
          await ctx.vault.writeBinaryFile(to, read.other.remote);
          // The copy must lie here, whole, before the cloud's twin goes.
          if (!sameBytes(await ctx.vault.readBinaryFile(to), read.other.remote)) throw new Error(`the copy ${to} does not hold the twin's bytes`);
          await ctx.queue.queueWrite(to);
          keptBytes.push(read.other.remote);
          keptIn = to;
        }
        await removeRemote(twin, c.path, read.other.remote, keptIn);
        result.removed++;
      }
    } catch (e) {
      console.warn(`[nameTwins] could not resolve ${c.path}`, e);
      result.skipped++;
    }
  }
  // The composed file must still be in the cloud. Every provider deleted the
  // twin by its own stored name; should one have taken the composed file with
  // it (a store that matched the name looser than it listed it), the copy here
  // goes up again as a new file at once.
  if (remoteDeleted && ctx.relist) {
    const listed = await ctx.relist();
    const here = new Map<string, Promise<VaultFileInfo[] | null>>();
    for (const path of remoteBefore) {
      if (listed.has(path)) continue;
      const entries = await (here.get(parentOf(path)) ?? (here.set(parentOf(path), ctx.vault.listDir(parentOf(path), false).catch(() => null)), here.get(parentOf(path))!));
      if (!entries?.some((e) => !e.isDirectory && e.path === path)) continue;
      console.warn(`[nameTwins] the cloud no longer lists ${path} after its twin was removed; uploading it again`);
      await ctx.stateRepo.deleteSyncState(path);
      await ctx.queue.queueWrite(path);
      result.restored.push(path);
    }
  }
  return result;
}
