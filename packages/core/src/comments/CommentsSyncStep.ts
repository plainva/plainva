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
 * Nothing ever writes another device's file, so there is nothing to collide.
 *
 * The old `comments.json`/`comments.enc` is the LEGACY file: read forever,
 * written never. No migration run - copying it on two devices at once would be
 * exactly the collision this removes. It dies when the user deletes it, or not.
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
export type CommentBundleFaultReason = "bundle-json" | "bundle-schema" | "bundle-version" | "bundle-sealed";

export const COMMENT_BUNDLE_FAULT_REASONS: readonly CommentBundleFaultReason[] = ["bundle-json", "bundle-schema", "bundle-version", "bundle-sealed"];

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
  if (!crypto) return parseCommentsBundle(decoder.decode(bytes as BufferSource));
  let plain: Uint8Array;
  try {
    plain = crypto.open(bytes);
  } catch (error) {
    // Never overwrite an unreadable bundle with local data: on the wrong key
    // that would erase every comment the other devices ever wrote.
    throw new CommentBundleError(`${origin} comments bundle cannot be opened: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseCommentsBundle(decoder.decode(plain as BufferSource));
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
  const bytes = await readFileBytes(vault, path, sealed);
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
export async function readOwnComments(
  vault: IVaultAdapter,
  deviceId: string,
  crypto: CommentsCrypto | undefined,
  options: { faults?: CommentBundleFault[]; now?: string } = {},
): Promise<CommentsBundle | null> {
  const sealed = !!crypto;
  const path = commentsDevicePath(deviceId, sealed);
  const bytes = await readFileBytes(vault, path, sealed);
  if (!bytes) return null;
  try {
    return decode(bytes, crypto, path);
  } catch (error) {
    const stamp = (options.now ?? new Date().toISOString()).replace(/[:.]/g, "-");
    const movedTo = path.replace(/\.(json|enc)$/, `.broken-${stamp}.$1`);
    try {
      await vault.renameItem(path, movedTo);
    } catch {
      // Cannot set it aside: leave it, and the next write will try again.
    }
    options.faults?.push({ path, reason: commentBundleFaultReason(error), message: error instanceof Error ? error.message : String(error), movedTo });
    return null;
  }
}

export interface CommentsFileEntry extends CommentsFileName {
  path: string;
}

/** Every comment bundle file in the sideband folder, own and foreign, legacy included. */
export async function listCommentsFiles(vault: IVaultAdapter): Promise<CommentsFileEntry[]> {
  let names: string[];
  try {
    names = (await vault.listDir(COMMENTS_SYNC_DIR, false)).filter((entry) => !entry.isDirectory).map((entry) => entry.name);
  } catch {
    // No folder yet, or a listing the platform refused: the known paths are
    // still asked below, so an unlistable folder does not hide the own file.
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
    if (await vault.exists(path)) out.push({ ...parseCommentsFileName(legacy)!, path });
  }
  return out;
}

/**
 * The union of every readable comment file in the vault (N2): this device's
 * own, every other device's, and the legacy file. Sealed files are opened
 * only with a key; without one they are skipped, not reported - a device
 * without the key is `locked`, and the store says so before reading.
 */
export async function readAllComments(
  vault: IVaultAdapter,
  deviceId: string,
  crypto: CommentsCrypto | undefined,
  options: { faults?: CommentBundleFault[]; now?: string } = {},
): Promise<CommentsBundle | null> {
  const now = options.now ?? new Date().toISOString();
  const ownName = commentsDeviceFileName(deviceId, !!crypto);
  const files = await listCommentsFiles(vault);
  let merged: CommentsBundle | null = null;
  let sawOwn = false;
  for (const file of files) {
    if (file.sealed && !crypto) continue;
    let bundle: CommentsBundle | null;
    if (file.path === `${COMMENTS_SYNC_DIR}/${ownName}`) {
      sawOwn = true;
      bundle = await readOwnComments(vault, deviceId, crypto, { faults: options.faults, now });
    } else {
      bundle = await readCommentsFile(vault, file.path, file.sealed, crypto, options.faults);
    }
    if (!bundle) continue;
    merged = merged ? mergeCommentsBundles(merged, bundle, now) : bundle;
  }
  if (!sawOwn) {
    // The listing may have missed it (an adapter that cannot list here): the
    // own file is the one path always asked by name.
    const own = await readOwnComments(vault, deviceId, crypto, { faults: options.faults, now });
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
  options: { deviceId: string; crypto?: CommentsCrypto; authorName?: string; /** Whose name it is: a named author's id, else this device. */ authorKey?: string; now?: string; faults?: CommentBundleFault[] },
): Promise<CommentsBundle> {
  const now = options.now ?? new Date().toISOString();
  const current = (await readOwnComments(vault, options.deviceId, options.crypto, { faults: options.faults, now })) ?? emptyCommentsBundle(now);
  const authors = { ...current.authors };
  const name = options.authorName?.trim();
  if (name) authors[options.authorKey ?? record.authorDeviceId] = { name, updatedAt: now };
  const next: CommentsBundle = {
    ...current,
    updatedAt: now,
    comments: { ...current.comments, [record.commentId]: record },
    authors,
  };
  await writeCommentsFile(vault, commentsDevicePath(options.deviceId, !!options.crypto), next, options.crypto);
  return next;
}

/**
 * Appends move markers (N1) to this device's own file - one immutable record
 * each, exactly like a comment. Written after the rename succeeded; if this
 * fails the rename stands and the caller says so.
 */
export async function appendLocalMoves(
  vault: IVaultAdapter,
  moves: readonly LocalMoveRecord[],
  options: { deviceId: string; crypto?: CommentsCrypto; now?: string; faults?: CommentBundleFault[] },
): Promise<CommentsBundle> {
  const now = options.now ?? new Date().toISOString();
  const current = (await readOwnComments(vault, options.deviceId, options.crypto, { faults: options.faults, now })) ?? emptyCommentsBundle(now);
  const next: CommentsBundle = {
    ...current,
    updatedAt: now,
    moves: { ...(current.moves ?? {}) },
  };
  for (const move of moves) next.moves![move.moveId] = move;
  await writeCommentsFile(vault, commentsDevicePath(options.deviceId, !!options.crypto), next, options.crypto);
  return next;
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

  private get sealed(): boolean {
    return !!this.options.crypto;
  }

  /**
   * One cycle. In order: this device's own file goes up (union with its own
   * remote copy, never with anybody else's), the roster is exchanged, every
   * other device's file comes down as a read-only mirror, and the legacy file
   * is mirrored the same way. A plaintext copy of the own file left over from
   * before the passphrase is folded into the sealed one and dropped - the
   * legacy plaintext too, exactly as before N2.
   *
   * A vault that never carried a comment gets no file put into it - and
   * pushed to the cloud - every cycle: nothing here, nothing there, return.
   */
  async run(target: ISyncTarget, vault: IVaultAdapter): Promise<void> {
    const now = (this.options.now ?? (() => new Date().toISOString()))();
    const { crypto, deviceId } = this.options;
    const faults: CommentBundleFault[] = [];
    const sealed = this.sealed;
    const ownPath = commentsDevicePath(deviceId, sealed);

    const own = await readOwnComments(vault, deviceId, crypto, { faults, now });

    // Plaintext to fold into the sealed file, then drop (D4's rule): this
    // device's own plaintext file from before the passphrase, and the legacy
    // plaintext file. Read before deleting - dropping it unread would discard
    // whatever was written while there was no key.
    const fold: Array<{ bundle: CommentsBundle; path: string; remote: boolean; local: boolean }> = [];
    if (sealed) {
      const ownPlainPath = commentsDevicePath(deviceId, false);
      const ownPlainLocal = await readCommentsFile(vault, ownPlainPath, false, undefined, faults);
      const ownPlainRemote = this.decodeTolerant(await target.download(ownPlainPath), undefined, ownPlainPath, faults);
      const ownPlain = mergeOptional(ownPlainLocal, ownPlainRemote, now);
      if (ownPlain) fold.push({ bundle: ownPlain, path: ownPlainPath, remote: ownPlainRemote !== null, local: ownPlainLocal !== null });
      const legacyLocal = await readCommentsFile(vault, COMMENTS_SYNC_PATH, false, undefined, faults);
      const legacyRemote = this.decodeTolerant(await target.download(COMMENTS_SYNC_PATH), undefined, COMMENTS_SYNC_PATH, faults);
      const legacy = mergeOptional(legacyLocal, legacyRemote, now);
      if (legacy) fold.push({ bundle: legacy, path: COMMENTS_SYNC_PATH, remote: legacyRemote !== null, local: legacyLocal !== null });
    }

    const localRoster = parseCommentDevicesRoster((await vault.exists(COMMENTS_DEVICES_PATH)) ? await vault.readTextFile(COMMENTS_DEVICES_PATH) : null);
    const remoteRosterBytes = await target.download(COMMENTS_DEVICES_PATH);
    const remoteRoster = parseCommentDevicesRoster(remoteRosterBytes ? decoder.decode(remoteRosterBytes as BufferSource) : null);

    // The legacy file, read-only: mirrored down so the store sees it. In
    // sealed mode the plaintext one is folded above; the sealed one is mirrored.
    const legacyRemoteBytes = await target.download(commentsPathFor(sealed));
    const ownRemoteBytes = await target.download(ownPath);

    if (!own && !ownRemoteBytes && fold.length === 0 && !remoteRoster && !legacyRemoteBytes && !localRoster) {
      this.report(faults);
      return;
    }

    // 1. The own file: union with its own remote copy, then up if it differs.
    let ownRemote: CommentsBundle | null = null;
    let ownRemoteUnreadable = false;
    if (ownRemoteBytes) {
      try {
        ownRemote = decode(ownRemoteBytes, crypto, ownPath);
      } catch (error) {
        // Ours, but not readable with the key at hand (a rotated key, a
        // truncated upload): never overwrite what cannot be read. Reported,
        // and the local file stays local until somebody looks.
        ownRemoteUnreadable = true;
        faults.push({ path: `remote:${ownPath}`, reason: commentBundleFaultReason(error), message: error instanceof Error ? error.message : String(error) });
      }
    }
    let merged = own;
    if (ownRemote) merged = mergeOptional(merged, ownRemote, now);
    for (const entry of fold) merged = mergeOptional(merged, entry.bundle, now);
    if (merged && (!own || !sameBundle(merged, own))) await writeCommentsFile(vault, ownPath, merged, crypto);
    if (merged && !ownRemoteUnreadable && (!ownRemote || !sameBundle(merged, ownRemote))) {
      await target.push(writeOp(ownPath, encode(merged, crypto)));
    }
    // Only once the merged state is safely inside the sealed file.
    for (const entry of fold) {
      if (entry.local) await vault.deleteItem(entry.path).catch(() => undefined);
      if (entry.remote) await target.push(deleteOp(entry.path)).catch(() => undefined);
    }

    // 2. The roster: union of local, remote and this device.
    const self: CommentDevicesRoster = { format: "plainva-comment-devices", version: 1, devices: { [safeDeviceName(deviceId)]: { updatedAt: now } } };
    const roster = mergeCommentDevicesRoster(mergeCommentDevicesRoster(localRoster, remoteRoster), self);
    const rosterText = serializeCommentDevicesRoster(roster);
    if (!sameRoster(roster, localRoster)) await vault.writeTextFile(COMMENTS_DEVICES_PATH, rosterText);
    if (!sameRoster(roster, remoteRoster)) await target.push(writeOp(COMMENTS_DEVICES_PATH, encoder.encode(rosterText)));

    // 3. Every other device's file: a read-only mirror. Never written up,
    // never merged into - absence on the remote is mirrored as absence here,
    // because the origin dropped it (its plaintext, after unlocking).
    for (const device of Object.keys(roster.devices)) {
      if (device === safeDeviceName(deviceId)) continue;
      for (const remoteSealed of sealed ? [true, false] : [false]) {
        await this.mirror(target, vault, `${COMMENTS_SYNC_DIR}/${commentsDeviceFileName(device, remoteSealed)}`, remoteSealed, crypto, faults, true);
      }
    }
    // 4. The legacy file, the same way - except that absence is not mirrored:
    // nothing writes it, so a missing remote copy means it never existed there.
    if (sealed) await this.mirror(target, vault, COMMENTS_ENC_PATH, true, crypto, faults, false);
    else await this.mirror(target, vault, COMMENTS_SYNC_PATH, false, undefined, faults, false);

    this.report(faults);
  }

  /** Downloads `path` and writes it locally byte for byte if it is readable and differs. */
  private async mirror(target: ISyncTarget, vault: IVaultAdapter, path: string, sealed: boolean, crypto: CommentsCrypto | undefined, faults: CommentBundleFault[], mirrorAbsence: boolean): Promise<void> {
    const remote = await target.download(path);
    if (!remote) {
      if (mirrorAbsence && (await vault.exists(path))) await vault.deleteItem(path).catch(() => undefined);
      return;
    }
    try {
      decode(remote, sealed ? crypto : undefined, path);
    } catch (error) {
      // Somebody else's file, unreadable: left alone here AND there. The local
      // mirror, if any, stays as it was - it read fine when it arrived.
      faults.push({ path: `remote:${path}`, reason: commentBundleFaultReason(error), message: error instanceof Error ? error.message : String(error) });
      return;
    }
    const local = await readFileBytes(vault, path, sealed);
    if (!bytesEqual(local, remote)) await writeFileBytes(vault, path, remote, sealed);
  }

  private decodeTolerant(bytes: Uint8Array | null, crypto: CommentsCrypto | undefined, path: string, faults: CommentBundleFault[]): CommentsBundle | null {
    if (!bytes) return null;
    try {
      return decode(bytes, crypto, path);
    } catch (error) {
      faults.push({ path: `remote:${path}`, reason: commentBundleFaultReason(error), message: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  private report(faults: CommentBundleFault[]): void {
    if (faults.length > 0) this.options.onFaults?.(faults);
  }
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
