/**
 * Sideband comment sync for vaults WITHOUT an encrypted workspace (Stufe D, D4).
 *
 * Runs once per cycle, OUTSIDE the file queue: it carries
 * `.plainva/sync/comments.json` (or `.enc`) directly through the sync target and
 * reads/writes the local copy through the worker's raw adapter — never the
 * conflict-aware app adapter, which would mint sync_state rows and `.CONFLICT`
 * copies of the comment file. Same shape as `SettingsSyncStep`/`SecretsSyncStep`,
 * for the same reason: a comment must never become a write to the note.
 *
 * Unlike the settings profile there is no port here. For settings the truth
 * lives in the native store and the file is a courier; for comments the file IS
 * the store, so the shell reads and appends through the helpers below and the
 * step only moves the file.
 */
import type { IVaultAdapter } from "../vault/IVaultAdapter.js";
import type { ISyncTarget } from "../sync/ISyncTarget.js";
import { COMMENTS_ENC_PATH, COMMENTS_SYNC_PATH } from "../settingsSync/paths.js";
import {
  CommentBundleError,
  emptyCommentsBundle,
  mergeCommentsBundles,
  parseCommentsBundle,
  serializeCommentsBundle,
  type CommentsBundle,
  type LocalCommentRecord,
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

/** Which file holds the bundle. Sealed and plaintext are never the same path. */
export function commentsPathFor(sealed: boolean): string {
  return sealed ? COMMENTS_ENC_PATH : COMMENTS_SYNC_PATH;
}

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

/** Reads the local bundle. Returns null when this vault has no comments yet. */
export async function readLocalComments(vault: IVaultAdapter, crypto?: CommentsCrypto): Promise<CommentsBundle | null> {
  const path = commentsPathFor(!!crypto);
  if (!(await vault.exists(path))) return null;
  const bytes = crypto ? await vault.readBinaryFile(path) : encoder.encode(await vault.readTextFile(path));
  return decode(bytes, crypto, "local");
}

/** Writes the local bundle through the RAW adapter (see the module note). */
export async function writeLocalComments(vault: IVaultAdapter, bundle: CommentsBundle, crypto?: CommentsCrypto): Promise<void> {
  const path = commentsPathFor(!!crypto);
  const bytes = encode(bundle, crypto);
  if (crypto) await vault.writeBinaryFile(path, bytes);
  else await vault.writeTextFile(path, decoder.decode(bytes as BufferSource));
}

/**
 * Appends one immutable record and, if given, this device's display name.
 *
 * The shell calls this the moment somebody presses send, so the comment is on
 * disk before the next cycle: a reply must not wait on the network to appear.
 */
export async function appendLocalComment(
  vault: IVaultAdapter,
  record: LocalCommentRecord,
  options: { crypto?: CommentsCrypto; authorName?: string; now?: string } = {},
): Promise<CommentsBundle> {
  const now = options.now ?? new Date().toISOString();
  const current = (await readLocalComments(vault, options.crypto)) ?? emptyCommentsBundle(now);
  const authors = { ...current.authors };
  const name = options.authorName?.trim();
  if (name) authors[record.authorDeviceId] = { name, updatedAt: now };
  const next: CommentsBundle = {
    ...current,
    updatedAt: now,
    comments: { ...current.comments, [record.commentId]: record },
    authors,
  };
  await writeLocalComments(vault, next, options.crypto);
  return next;
}

export interface CommentsSyncOptions {
  /** Present once a master key is cached; absent means plaintext mode. */
  crypto?: CommentsCrypto;
  now?: () => string;
}

export class CommentsSyncStep {
  constructor(private readonly options: CommentsSyncOptions = {}) {}

  private get sealed(): boolean {
    return !!this.options.crypto;
  }

  private get path(): string {
    return commentsPathFor(this.sealed);
  }

  /**
   * One cycle: local + remote (+ a leftover plaintext copy) merge into a union,
   * and each side is written only when it actually differs.
   *
   * The union is what makes the stale-plaintext case harmless here. For the
   * settings profile a leftover plaintext file is a competing TRUTH and needs a
   * newer-wins rule; comments only ever grow, so a plaintext copy written by a
   * still-locked device is simply more records to take along.
   */
  async run(target: ISyncTarget, vault: IVaultAdapter): Promise<void> {
    const now = (this.options.now ?? (() => new Date().toISOString()))();
    const crypto = this.options.crypto;

    const local = await readLocalComments(vault, crypto);
    const remote = decode(await target.download(this.path), crypto, "remote");

    let stalePlaintext: CommentsBundle | null = null;
    if (this.sealed) {
      // Read before deleting: dropping it unread would discard whatever that
      // device wrote while it had no key.
      stalePlaintext = decode(await target.download(COMMENTS_SYNC_PATH), undefined, "plaintext");
      if (!stalePlaintext && (await vault.exists(COMMENTS_SYNC_PATH))) {
        stalePlaintext = decode(encoder.encode(await vault.readTextFile(COMMENTS_SYNC_PATH)), undefined, "local plaintext");
      }
    }

    // Nothing on either side: a vault that never carried a comment must not
    // get an empty file put into it - and pushed to the cloud - every cycle.
    if (!local && !remote && !stalePlaintext) return;

    let merged = mergeCommentsBundles(local, remote, now);
    if (stalePlaintext) merged = mergeCommentsBundles(merged, stalePlaintext, now);

    if (!local || !sameBundle(merged, local)) await writeLocalComments(vault, merged, crypto);
    if (!remote || !sameBundle(merged, remote)) {
      await target.push({
        id: 0,
        file_path: this.path,
        operation: "write",
        content: encode(merged, crypto),
        retry_count: 0,
        next_retry_at: 0,
        queued_at: 0,
      });
    }
    // Only once the merged state is safely inside the sealed file.
    if (stalePlaintext) await this.dropStalePlaintext(target, vault);
  }

  /** Best-effort removal of a leftover plaintext bundle after going sealed. */
  private async dropStalePlaintext(target: ISyncTarget, vault: IVaultAdapter): Promise<void> {
    try {
      if (await vault.exists(COMMENTS_SYNC_PATH)) await vault.deleteItem(COMMENTS_SYNC_PATH);
      await target.push({
        id: 0,
        file_path: COMMENTS_SYNC_PATH,
        operation: "delete",
        retry_count: 0,
        next_retry_at: 0,
        queued_at: 0,
      });
    } catch {
      // A leftover plaintext copy is a hygiene warning, not a failure.
    }
  }
}

/** Compares content, ignoring the bundle timestamp — which changes on every merge. */
function sameBundle(a: CommentsBundle, b: CommentsBundle): boolean {
  return (
    JSON.stringify({ c: sortedKeys(a.comments), a: sortedKeys(a.authors) })
    === JSON.stringify({ c: sortedKeys(b.comments), a: sortedKeys(b.authors) })
  );
}

function sortedKeys<T>(record: Record<string, T>): Array<[string, T]> {
  return Object.keys(record)
    .sort()
    .map((key) => [key, record[key]] as [string, T]);
}
