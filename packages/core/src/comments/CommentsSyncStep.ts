/**
 * The comment files of a vault WITHOUT an encrypted workspace, and the
 * sideband step that carries them (Stufe D, D4; Nachschaerfung, N2).
 *
 * ONE FILE PER DEVICE. Until N2 the whole vault shared `comments.json`, which
 * was fine as long as a Plainva sync connection merged it - and broke the
 * moment two devices wrote the same file through anything else: a network
 * share, Dropbox, iCloud, Syncthing, Git. The last writer won, or the foreign
 * sync left a conflict copy nobody read. Now every device writes ONLY
 * `.plainva/sync/comments.<deviceId>.json` (or `.enc` once a passphrase
 * exists) and reads the union of every `comments.*` file in the folder.
 * Remote files still have one writer. Recovery records also travel in this
 * device's file with their original immutable IDs, so missing mirrors and a
 * new connection cannot strand previously received comments.
 *
 * The old `comments.json`/`comments.enc` is the LEGACY file: read forever,
 * written never. Its records are copied into the current device file with
 * unchanged IDs; concurrent migrations therefore converge without duplicates.
 *
 * The sideband (a Plainva sync connection) carries the files directly,
 * OUTSIDE the file queue, through the worker's raw adapter - never the
 * conflict-aware app adapter, which would mint sync_state rows and `.CONFLICT`
 * copies. A comment must never become a write to the note. Since no provider
 * lists `.plainva/`, the devices announce themselves in a small grow-only
 * roster (`comments.devices.json`, device ids only - the same ids that stand
 * in the file names in the clear); every device re-adds itself each cycle, so
 * a lost entry heals on the next one.
 *
 * A file that cannot be read is never overwritten. This device's OWN broken
 * file is set aside (`.broken-<time>`) so it can keep writing; anybody else's
 * is left exactly where it is - a foreign sync would carry a rename to its
 * origin as a deletion - and reported with a reason code (N3).
 */
import { withCommentsWrite, withCommentsSync } from "./commentsCoordinator.js";
import { CommentIdentityConflictError, sameCommentContent } from "./commentIdentity.js";
import type { IVaultAdapter } from "../vault/IVaultAdapter.js";
import type { ISyncTarget } from "../sync/ISyncTarget.js";
import { COMMENTS_DEVICES_PATH, COMMENTS_ENC_PATH, COMMENTS_SYNC_DIR, COMMENTS_SYNC_PATH } from "../settingsSync/paths.js";
import {
  CommentBundleError,
  emptyCommentsBundle,
  mergeCommentsBundles,
  parseCommentsBundle,
  serializeCommentsBundle,
  type CommentsBundle,
  type LocalCommentRecord,
  type LocalMoveRecord,
} from "./commentsBundle.js";

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

/**
 * Sealed-bundle crypto, injected by the shell once a master key exists.
 *
 * It seals under the EXISTING `settings` purpose rather than a new one: the
 * purpose is a byte in the PVE1 frame, so minting a `comments` purpose would be
 * a protocol change that older devices could not open. The comment bundle is a
 * settings-class sideband document and shares its key.
 */
export interface CommentsCrypto {
  seal(plaintext: Uint8Array): Uint8Array;
  open(bytes: Uint8Array): Uint8Array;
}

/* ------------------------------------------------------------------ */
/* Faults                                                              */

/**
 * Why a comment file could not be read (N3) - a small closed list, so a
 * surface can say it in the person's language and a diagnosis export can name
 * it. The sentence stays in `message` for the export.
 */
export type CommentBundleFaultReason = "bundle-json" | "bundle-schema" | "bundle-version" | "bundle-sealed" | "bundle-read" | "bundle-backup";

export const COMMENT_BUNDLE_FAULT_REASONS: readonly CommentBundleFaultReason[] = ["bundle-json", "bundle-schema", "bundle-version", "bundle-sealed", "bundle-read", "bundle-backup"];

export interface CommentBundleFault {
  /** Vault-relative path of the file that could not be read. */
  path: string;
  reason: CommentBundleFaultReason;
  message: string;
  /** Where this device's own broken file was set aside, if it was. */
  movedTo?: string;
}

export function commentBundleFaultReason(error: unknown): CommentBundleFaultReason {
  const message = error instanceof Error ? error.message : String(error);
  if (/cannot be opened/.test(message)) return "bundle-sealed";
  if (/not valid JSON/.test(message)) return "bundle-json";
  if (/version is unsupported/.test(message)) return "bundle-version";
  return "bundle-schema";
}

/* ------------------------------------------------------------------ */
/* File names                                                          */

/** The legacy single file (read-only since N2). Sealed and plaintext are never the same path. */
export function commentsPathFor(sealed: boolean): string {
  return sealed ? COMMENTS_ENC_PATH : COMMENTS_SYNC_PATH;
}

/** A device id as it may appear in a file name. Ids are UUIDs; anything else is flattened the same way on every device. */
function safeDeviceName(deviceId: string): string {
  return deviceId.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function commentsDeviceFileName(deviceId: string, sealed: boolean): string {
  return `comments.${safeDeviceName(deviceId)}.${sealed ? "enc" : "json"}`;
}

/** This device's own file. */
export function commentsDevicePath(deviceId: string, sealed: boolean): string {
  return `${COMMENTS_SYNC_DIR}/${commentsDeviceFileName(deviceId, sealed)}`;
}

export interface CommentsFileName {
  /** The legacy file has no device: it is read as the device "legacy". */
  deviceId: string;
  sealed: boolean;
  legacy: boolean;
}

/** What a file in `.plainva/sync/` is, or null for anything that is not a comment bundle (the roster, a set-aside file, other sidebands). */
export function parseCommentsFileName(name: string): CommentsFileName | null {
  if (name === "comments.json") return { deviceId: "legacy", sealed: false, legacy: true };
  if (name === "comments.enc") return { deviceId: "legacy", sealed: true, legacy: true };
  const match = /^comments\.([A-Za-z0-9_-]+)\.(json|enc)$/.exec(name);
  if (!match || match[1] === "devices") return null;
  return { deviceId: match[1], sealed: match[2] === "enc", legacy: false };
}

/* ------------------------------------------------------------------ */
/* Reading and writing                                                 */

function decode(bytes: Uint8Array | null, crypto: CommentsCrypto | undefined, origin: string): CommentsBundle | null {
  if (!bytes) return null;
  if (!crypto) {
    const bundle = parseCommentsBundle(decoder.decode(bytes as BufferSource));
    if (!bundle) throw new CommentBundleError("comments bundle root is empty");
    return bundle;
  }
  let plain: Uint8Array;
  try {
    plain = crypto.open(bytes);
  } catch (error) {
    // Never overwrite an unreadable bundle with local data: on the wrong key
    // that would erase every comment the other devices ever wrote.
    throw new CommentBundleError(`${origin} comments bundle cannot be opened: ${error instanceof Error ? error.message : String(error)}`);
  }
  const bundle = parseCommentsBundle(decoder.decode(plain as BufferSource));
  if (!bundle) throw new CommentBundleError("comments bundle root is empty");
  return bundle;
}

function encode(bundle: CommentsBundle, crypto: CommentsCrypto | undefined): Uint8Array {
  const text = serializeCommentsBundle(bundle);
  const bytes = encoder.encode(text);
  return crypto ? crypto.seal(bytes) : bytes;
}

async function readFileBytes(vault: IVaultAdapter, path: string, sealed: boolean): Promise<Uint8Array | null> {
  if (!(await vault.exists(path))) return null;
  return sealed ? vault.readBinaryFile(path) : encoder.encode(await vault.readTextFile(path));
}

async function writeFileBytes(vault: IVaultAdapter, path: string, bytes: Uint8Array, sealed: boolean): Promise<void> {
  if (sealed) await vault.writeBinaryFile(path, bytes);
  else await vault.writeTextFile(path, decoder.decode(bytes as BufferSource));
}

function bytesEqual(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Reads ONE bundle file. A file that cannot be read is reported into `faults`
 * and answered as absent - never thrown, so one broken file does not take the
 * whole vault's remarks down with it.
 */
export async function readCommentsFile(
  vault: IVaultAdapter,
  path: string,
  sealed: boolean,
  crypto: CommentsCrypto | undefined,
  faults?: CommentBundleFault[],
): Promise<CommentsBundle | null> {
  let bytes: Uint8Array | null;
  try { bytes = await readFileBytes(vault, path, sealed); }
  catch (error) {
    faults?.push({ path, reason: "bundle-read", message: errorMessage(error) });
    return null;
  }
  if (!bytes) return null;
  try {
    return decode(bytes, sealed ? crypto : undefined, path);
  } catch (error) {
    faults?.push({ path, reason: commentBundleFaultReason(error), message: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/** Reads the legacy single file (kept for the tests of the pre-N2 shape and the legacy fold below). */
export async function readLocalComments(vault: IVaultAdapter, crypto?: CommentsCrypto): Promise<CommentsBundle | null> {
  const path = commentsPathFor(!!crypto);
  return decode(await readFileBytes(vault, path, !!crypto), crypto, "local");
}

/** Writes a bundle to `path` through the RAW adapter (see the module note). */
export async function writeCommentsFile(vault: IVaultAdapter, path: string, bundle: CommentsBundle, crypto?: CommentsCrypto): Promise<void> {
  await writeFileBytes(vault, path, encode(bundle, crypto), !!crypto);
}

/** Writes the legacy single file - tests of the pre-N2 shape only; nothing in the app writes it any more. */
export async function writeLocalComments(vault: IVaultAdapter, bundle: CommentsBundle, crypto?: CommentsCrypto): Promise<void> {
  await writeCommentsFile(vault, commentsPathFor(!!crypto), bundle, crypto);
}

/**
 * This device's own file, or null. A broken own file is SET ASIDE - moved to
 * `comments.<device>.broken-<time>.json` byte for byte - so the device can keep
 * writing; the fault says where it went (N3). Only the own file is ever moved:
 * a foreign sync would carry that rename to the origin device as a deletion.
 */
export interface CommentsReadOptions {
  faults?: CommentBundleFault[];
  now?: string;
  vaultKey?: string;
}

export function readOwnComments(
  vault: IVaultAdapter,
  deviceId: string,
  crypto: CommentsCrypto | undefined,
  options: CommentsReadOptions = {},
): Promise<CommentsBundle | null> {
  return withCommentsWrite(vault, { ...options, deviceId }, () => readOwnCommentsUnlocked(vault, deviceId, crypto, options));
}

async function readOwnCommentsUnlocked(
  vault: IVaultAdapter,
  deviceId: string,
  crypto: CommentsCrypto | undefined,
  options: CommentsReadOptions = {},
): Promise<CommentsBundle | null> {
  const sealed = !!crypto;
  const path = commentsDevicePath(deviceId, sealed);
  let bytes: Uint8Array | null;
  try { bytes = await readFileBytes(vault, path, sealed); }
  catch (error) {
    options.faults?.push({ path, reason: "bundle-read", message: errorMessage(error) });
    throw error;
  }
  if (!bytes) return null;
  try { return decode(bytes, crypto, path); }
  catch (error) {
    const stamp = (options.now ?? new Date().toISOString()).replace(/[:.]/g, "-");
    let movedTo = path.replace(/\.(json|enc)$/, `.broken-${stamp}.$1`);
    try {
      // Never replace an earlier recovery copy, even at the same timestamp.
      for (let suffix = 1; await vault.exists(movedTo); suffix += 1) {
        if (suffix > 1000) throw new Error("No free comment recovery filename", { cause: error });
        movedTo = path.replace(/\.(json|enc)$/, `.broken-${stamp}-${suffix}.$1`);
      }
      await writeFileBytes(vault, movedTo, bytes, sealed);
      const saved = await readFileBytes(vault, movedTo, sealed);
      if (!bytesEqual(bytes, saved)) throw new Error("Comment recovery copy could not be verified", { cause: error });
      if (!bytesEqual(bytes, await readFileBytes(vault, path, sealed))) throw new Error("Comment source changed during recovery", { cause: error });
      await vault.deleteItem(path);
    } catch (backupError) {
      options.faults?.push({ path, reason: "bundle-backup", message: errorMessage(backupError) });
      // The caller must not replace an own file whose recovery failed.
      throw backupError;
    }
    options.faults?.push({ path, reason: commentBundleFaultReason(error), message: errorMessage(error), movedTo });
    return null;
  }
}

export interface CommentsFileEntry extends CommentsFileName {
  path: string;
}

/** Every comment bundle file in the sideband folder, own and foreign, legacy included. */
export async function listCommentsFiles(vault: IVaultAdapter, faults?: CommentBundleFault[]): Promise<CommentsFileEntry[]> {
  let names: string[];
  try {
    names = (await vault.listDir(COMMENTS_SYNC_DIR, false)).filter((entry) => !entry.isDirectory).map((entry) => entry.name);
  } catch (error) {
    // Still ask known paths, but do not present a refused listing as an empty
    // comment folder. Only a confirmed missing folder is a normal first use.
    let missing = false;
    try { missing = !(await vault.exists(COMMENTS_SYNC_DIR)); } catch { /* Access is still unknown. */ }
    if (!missing) faults?.push({ path: COMMENTS_SYNC_DIR, reason: "bundle-read", message: errorMessage(error) });
    names = [];
  }
  const out: CommentsFileEntry[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const parsed = parseCommentsFileName(name);
    if (!parsed) continue;
    seen.add(name);
    out.push({ ...parsed, path: `${COMMENTS_SYNC_DIR}/${name}` });
  }
  for (const legacy of ["comments.json", "comments.enc"]) {
    if (seen.has(legacy)) continue;
    const path = `${COMMENTS_SYNC_DIR}/${legacy}`;
    try {
      if (await vault.exists(path)) out.push({ ...parseCommentsFileName(legacy)!, path });
    } catch (error) {
      faults?.push({ path, reason: "bundle-read", message: errorMessage(error) });
    }
  }
  return out;
}

/**
 * The union of every readable comment file in the vault (N2): this device's
 * own, every other device's, and the legacy file. Sealed files are opened
 * only with a key; without one they are skipped, not reported - a device
 * without the key is `locked`, and the store says so before reading.
 */
export function readAllComments(vault: IVaultAdapter, deviceId: string, crypto: CommentsCrypto | undefined, options: CommentsReadOptions = {}): Promise<CommentsBundle | null> {
  return withCommentsWrite(vault, { ...options, deviceId }, () => readAllCommentsUnlocked(vault, deviceId, crypto, options));
}

async function readAllCommentsUnlocked(
  vault: IVaultAdapter,
  deviceId: string,
  crypto: CommentsCrypto | undefined,
  options: CommentsReadOptions = {},
): Promise<CommentsBundle | null> {
  const now = options.now ?? new Date().toISOString();
  const ownName = commentsDeviceFileName(deviceId, !!crypto);
  const files = await listCommentsFiles(vault, options.faults);
  let merged: CommentsBundle | null = null;
  let sawOwn = false;
  const readOwnForDisplay = async () => {
    try { return await readOwnCommentsUnlocked(vault, deviceId, crypto, options); }
    catch {
      // readOwnComments reported the access/recovery failure and kept the
      // source. A display can still show the other healthy bundles; a writer
      // calls the strict reader directly and cannot replace the failed one.
      return null;
    }
  };
  for (const file of files) {
    if (file.sealed && !crypto) continue;
    const isOwn = file.path === `${COMMENTS_SYNC_DIR}/${ownName}`;
    if (isOwn) sawOwn = true;
    const bundle = isOwn ? await readOwnForDisplay() : await readCommentsFile(vault, file.path, file.sealed, crypto, options.faults);
    if (!bundle) continue;
    merged = merged ? mergeCommentsBundles(merged, bundle, now) : bundle;
  }
  if (!sawOwn) {
    // The listing may have missed it (an adapter that cannot list here): the
    // own file is the one path always asked by name.
    const own = await readOwnForDisplay();
    if (own) merged = merged ? mergeCommentsBundles(merged, own, now) : own;
  }
  return merged;
}

/**
 * Appends one immutable record to this device's OWN file and, if given, the
 * author's display name. The shell calls this the moment somebody presses
 * send, so the comment is on disk before the next cycle: a reply must not wait
 * on the network to appear.
 */
export async function appendLocalComment(
  vault: IVaultAdapter,
  record: LocalCommentRecord,
  options: { deviceId: string; vaultKey?: string; resolveCrypto?: () => Promise<CommentsCrypto | undefined>; crypto?: CommentsCrypto; authorName?: string; /** Whose name it is: a named author's id, else this device. */ authorKey?: string; now?: string; faults?: CommentBundleFault[] },
): Promise<CommentsBundle> {
  return withCommentsWrite(vault, options, async () => {
    const crypto = options.resolveCrypto ? await options.resolveCrypto() : options.crypto;
    const now = options.now ?? new Date().toISOString();
    const current = (await readOwnCommentsUnlocked(vault, options.deviceId, crypto, { faults: options.faults, now })) ?? emptyCommentsBundle(now);
    const existing = current.comments[record.commentId];
    if (existing) {
      if (!sameCommentContent(existing, record)) throw new CommentIdentityConflictError(record.commentId);
      return current;
    }
    const authors = { ...current.authors };
    const name = options.authorName?.trim();
    if (name) authors[options.authorKey ?? record.authorDeviceId] = { name, updatedAt: now };
    const next: CommentsBundle = {
      ...current,
      updatedAt: now,
      comments: { ...current.comments, [record.commentId]: record },
      authors,
    };
    await writeCommentsFile(vault, commentsDevicePath(options.deviceId, !!crypto), next, crypto);
    return next;
  });
}

/**
 * Appends move markers (N1) to this device's own file - one immutable record
 * each, exactly like a comment. Written after the rename succeeded; if this
 * fails the rename stands and the caller says so.
 */
export async function appendLocalMoves(
  vault: IVaultAdapter,
  moves: readonly LocalMoveRecord[],
  options: { deviceId: string; vaultKey?: string; resolveCrypto?: () => Promise<CommentsCrypto | undefined>; crypto?: CommentsCrypto; now?: string; faults?: CommentBundleFault[] },
): Promise<CommentsBundle> {
  return withCommentsWrite(vault, options, async () => {
    const crypto = options.resolveCrypto ? await options.resolveCrypto() : options.crypto;
    const now = options.now ?? new Date().toISOString();
    const current = (await readOwnCommentsUnlocked(vault, options.deviceId, crypto, { faults: options.faults, now })) ?? emptyCommentsBundle(now);
    const next: CommentsBundle = {
      ...current,
      updatedAt: now,
      moves: { ...(current.moves ?? {}) },
    };
    for (const move of moves) next.moves![move.moveId] = move;
    await writeCommentsFile(vault, commentsDevicePath(options.deviceId, !!crypto), next, crypto);
    return next;
  });
}

/* ------------------------------------------------------------------ */
/* The roster                                                          */

/**
 * The devices that write comment files in this vault - ids only, grow-only.
 * Exists because no provider lists `.plainva/`: without it the sideband could
 * not know which `comments.<device>` files to fetch. Every device re-adds
 * itself each cycle; a write that lost somebody's entry (last writer wins on
 * the target) heals on that device's next cycle.
 */
export interface CommentDevicesRoster {
  format: "plainva-comment-devices";
  version: 1;
  devices: Record<string, { updatedAt: string }>;
}

export function parseCommentDevicesRoster(text: string | null): CommentDevicesRoster | null {
  if (!text || !text.trim()) return null;
  try {
    const value = JSON.parse(text) as Partial<CommentDevicesRoster>;
    if (!value || value.format !== "plainva-comment-devices" || value.version !== 1 || typeof value.devices !== "object" || value.devices === null) return null;
    const devices: Record<string, { updatedAt: string }> = {};
    for (const [id, entry] of Object.entries(value.devices)) {
      if (/^[A-Za-z0-9_-]+$/.test(id) && entry && typeof (entry as { updatedAt?: unknown }).updatedAt === "string") devices[id] = { updatedAt: (entry as { updatedAt: string }).updatedAt };
    }
    return { format: "plainva-comment-devices", version: 1, devices };
  } catch {
    // A roster that cannot be read is not worth a fault: it is rebuilt from
    // this device and heals as the others re-add themselves.
    return null;
  }
}

export function mergeCommentDevicesRoster(a: CommentDevicesRoster | null, b: CommentDevicesRoster | null): CommentDevicesRoster {
  const devices: Record<string, { updatedAt: string }> = {};
  for (const source of [a, b]) {
    for (const [id, entry] of Object.entries(source?.devices ?? {})) {
      const known = devices[id];
      devices[id] = known && known.updatedAt >= entry.updatedAt ? known : entry;
    }
  }
  return { format: "plainva-comment-devices", version: 1, devices };
}

export function serializeCommentDevicesRoster(roster: CommentDevicesRoster): string {
  const devices: Record<string, { updatedAt: string }> = {};
  for (const id of Object.keys(roster.devices).sort()) devices[id] = roster.devices[id];
  return JSON.stringify({ format: roster.format, version: roster.version, devices }, null, 2);
}

function sameRoster(a: CommentDevicesRoster | null, b: CommentDevicesRoster | null): boolean {
  return JSON.stringify(Object.keys(a?.devices ?? {}).sort()) === JSON.stringify(Object.keys(b?.devices ?? {}).sort());
}

/* ------------------------------------------------------------------ */
/* The sideband step                                                   */

export interface CommentsSyncOptions {
  /** Workspace upgrades receive old clients' history, but publish via signed objects. */
  downloadOnly?: boolean;
  /** Same stable vault identity as the shell store, independent of adapter instances. */
  vaultKey?: string;
  /** This device's stable id - the same one the store writes as the author. */
  deviceId: string;
  /** Present once a master key is cached; absent means plaintext mode. */
  crypto?: CommentsCrypto;
  now?: () => string;
  /** Files that could not be read this cycle (N3); the shell shows them once. */
  onFaults?: (faults: CommentBundleFault[]) => void;
}

function writeOp(path: string, content: Uint8Array) {
  return { id: 0, file_path: path, operation: "write" as const, content, retry_count: 0, next_retry_at: 0, queued_at: 0 };
}

function deleteOp(path: string) {
  return { id: 0, file_path: path, operation: "delete" as const, retry_count: 0, next_retry_at: 0, queued_at: 0 };
}

export class CommentsSyncStep {
  constructor(private readonly options: CommentsSyncOptions) {}

  run(target: ISyncTarget, vault: IVaultAdapter): Promise<void> {
    return withCommentsSync(vault, this.options, async () => {
      const faults: CommentBundleFault[] = [];
      try { await this.runCycle(target, vault, faults); }
      finally { if (faults.length > 0) this.options.onFaults?.(faults); }
    });
  }

  private async runCycle(target: ISyncTarget, vault: IVaultAdapter, faults: CommentBundleFault[]): Promise<void> {
    const now = (this.options.now ?? (() => new Date().toISOString()))();
    const { crypto, deviceId } = this.options;
    const sealed = !!crypto;
    const ownPath = commentsDevicePath(deviceId, sealed);
    const initial = await withCommentsWrite(vault, this.options, async () => ({
      files: await listCommentsFiles(vault, faults),
      roster: await readLocalRoster(vault),
    }));
    const rosterBytes = await target.download(COMMENTS_DEVICES_PATH);
    const remoteRoster = parseCommentDevicesRoster(rosterBytes ? decoder.decode(rosterBytes as BufferSource) : null);
    const devices = new Set([
      ...Object.keys(initial.roster?.devices ?? {}),
      ...Object.keys(remoteRoster?.devices ?? {}),
      ...initial.files.filter((file) => !file.legacy).map((file) => file.deviceId),
      safeDeviceName(deviceId),
    ]);
    const paths = new Map<string, boolean>();
    for (const device of devices) {
      for (const encrypted of sealed ? [true, false] : [false]) paths.set(commentsDevicePath(device, encrypted), encrypted);
    }
    paths.set(COMMENTS_SYNC_PATH, false);
    if (sealed) paths.set(COMMENTS_ENC_PATH, true);
    const downloaded = new Map<string, { bytes: Uint8Array | null; bundle: CommentsBundle | null; sealed: boolean }>();
    // No disk gate spans a network request: replies remain immediately durable.
    for (const [path, encrypted] of paths) {
      const bytes = await target.download(path);
      downloaded.set(path, { bytes, bundle: this.decodeRemote(bytes, encrypted ? crypto : undefined, path, faults), sealed: encrypted });
    }
    const ownRemote = downloaded.get(ownPath)!;
    const ownRemoteUnreadable = ownRemote.bytes !== null && ownRemote.bundle === null;
    const saved = await withCommentsWrite(vault, this.options, async () => {
      // Downloading may have taken minutes. Re-read the actual latest disk state
      // only now, under the SAME gate used by posts, moves and quarantine.
      const own = await readOwnCommentsUnlocked(vault, deviceId, crypto, { faults, now });
      let merged = await readAllCommentsUnlocked(vault, deviceId, crypto, { faults, now });
      merged = mergeOptional(merged, own, now);
      for (const entry of downloaded.values()) merged = mergeOptional(merged, entry.bundle, now);
      const localRoster = await readLocalRoster(vault);
      if (!merged && !localRoster && !remoteRoster && ![...downloaded.values()].some((entry) => entry.bytes !== null)) return null;
      if (merged && (!own || !sameBundle(own, merged))) await writeCommentsFile(vault, ownPath, merged, crypto);

      // Readable foreign/legacy files are recovery sources. Their records travel
      // in OUR file with unchanged IDs/authors; we never upload a foreign file.
      // An existing local mirror is never replaced by an absent/older remote.
      for (const [path, entry] of downloaded) {
        if (path === ownPath || !entry.bundle || !entry.bytes || (sealed && !entry.sealed)) continue;
        if (!(await vault.exists(path))) await writeFileBytes(vault, path, entry.bytes, entry.sealed);
      }
      const self: CommentDevicesRoster = { format: "plainva-comment-devices", version: 1, devices: { [safeDeviceName(deviceId)]: { updatedAt: now } } };
      const roster = mergeCommentDevicesRoster(mergeCommentDevicesRoster(localRoster, remoteRoster), self);
      if (!sameRoster(roster, localRoster)) await vault.writeTextFile(COMMENTS_DEVICES_PATH, serializeCommentDevicesRoster(roster));
      const plainFiles = sealed ? (await listCommentsFiles(vault, faults)).filter((file) => !file.sealed).map((file) => file.path) : [];
      return { merged, roster, plainFiles };
    });
    if (!saved || this.options.downloadOnly) return;
    if (saved.merged && !ownRemoteUnreadable && (!ownRemote.bundle || !sameBundle(saved.merged, ownRemote.bundle))) {
      await target.push(writeOp(ownPath, encode(saved.merged, crypto)));
    }
    if (!sameRoster(saved.roster, remoteRoster)) {
      await target.push(writeOp(COMMENTS_DEVICES_PATH, encoder.encode(serializeCommentDevicesRoster(saved.roster))));
    }
    if (!sealed || !saved.merged || ownRemoteUnreadable) return;
    const ownPlainPath = commentsDevicePath(deviceId, false);
    const remotePlainPaths = [ownPlainPath, COMMENTS_SYNC_PATH].filter((path) => downloaded.get(path)?.bundle);
    if (saved.plainFiles.length === 0 && remotePlainPaths.length === 0) return;
    // An upload acknowledgement alone is insufficient for retiring the only
    // recovery source. Check the readable sealed result before any cleanup.
    const confirmed = this.decodeRemote(await target.download(ownPath), crypto, ownPath, faults);
    if (!confirmed || !bundleContains(confirmed, saved.merged)) return;
    await withCommentsWrite(vault, this.options, async () => {
      const currentOwn = await readCommentsFile(vault, ownPath, true, crypto, faults);
      if (!currentOwn) return;
      for (const path of saved.plainFiles) {
        const source = await readCommentsFile(vault, path, false, undefined, faults);
        if (source && bundleContains(confirmed, source) && bundleContains(currentOwn, source)) await vault.deleteItem(path);
      }
    });
    for (const path of remotePlainPaths) {
      // Only our own file and the read-only legacy file may be retired here.
      // A foreign device remains responsible for its remote plaintext.
      const current = this.decodeRemote(await target.download(path), undefined, path, faults);
      if (current && bundleContains(confirmed, current)) await target.push(deleteOp(path));
    }
  }

  private decodeRemote(bytes: Uint8Array | null, crypto: CommentsCrypto | undefined, path: string, faults: CommentBundleFault[]): CommentsBundle | null {
    if (bytes === null) return null;
    try { return decode(bytes, crypto, path); }
    catch (error) {
      faults.push({ path: `remote:${path}`, reason: commentBundleFaultReason(error), message: errorMessage(error) });
      return null;
    }
  }
}

async function readLocalRoster(vault: IVaultAdapter): Promise<CommentDevicesRoster | null> {
  return parseCommentDevicesRoster((await vault.exists(COMMENTS_DEVICES_PATH)) ? await vault.readTextFile(COMMENTS_DEVICES_PATH) : null);
}

/** A conflicting immutable ID is not proof that the source was preserved. */
function bundleContains(container: CommentsBundle, source: CommentsBundle): boolean {
  for (const [id, record] of Object.entries(source.comments)) if (JSON.stringify(container.comments[id]) !== JSON.stringify(record)) return false;
  for (const [id, move] of Object.entries(source.moves ?? {})) if (JSON.stringify(container.moves?.[id]) !== JSON.stringify(move)) return false;
  return sameBundle(mergeCommentsBundles(container, source, container.updatedAt), container);
}

function mergeOptional(a: CommentsBundle | null, b: CommentsBundle | null, now: string): CommentsBundle | null {
  if (!a) return b;
  if (!b) return a;
  return mergeCommentsBundles(a, b, now);
}

/** Compares content, ignoring the bundle timestamp - which changes on every merge. */
export function sameBundle(a: CommentsBundle, b: CommentsBundle): boolean {
  return (
    JSON.stringify({ c: sortedKeys(a.comments), a: sortedKeys(a.authors), m: sortedKeys(a.moves ?? {}) })
    === JSON.stringify({ c: sortedKeys(b.comments), a: sortedKeys(b.authors), m: sortedKeys(b.moves ?? {}) })
  );
}

function sortedKeys<T>(record: Record<string, T>): Array<[string, T]> {
  return Object.keys(record)
    .sort()
    .map((key) => [key, record[key]] as [string, T]);
}
