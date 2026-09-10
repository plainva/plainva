import type { IVaultAdapter } from "../vault/IVaultAdapter.js";
import type { CommentBundleFault } from "./CommentsSyncStep.js";
import { withCommentsWrite, type CommentsCoordination } from "./commentsCoordinator.js";
import { emptyCommentsBundle, mergeCommentsBundles, parseCommentsBundle, serializeCommentsBundle, type CommentsBundle, type LocalMoveRecord } from "./commentsBundle.js";

const ROOT = ".plainva";
const prefixFor = (deviceId: string): string => `comment-moves.${deviceId.replace(/[^A-Za-z0-9_-]/g, "_")}.`;
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** One immutable local file per confirmed rename batch. Never a sideband path:
 * locked devices can record paths without writing unsealed transport history.
 * Native local adapters write atomically; a partial external-provider write
 * cannot replace an older batch. Read-back verifies the acknowledged bytes. */
export async function persistCommentMoves(
  vault: IVaultAdapter,
  moves: readonly LocalMoveRecord[],
  options: CommentsCoordination & { now: string },
): Promise<void> {
  if (moves.length === 0) return;
  const bundle: CommentsBundle = { ...emptyCommentsBundle(options.now), moves: Object.fromEntries(moves.map(move => [move.moveId, move])) };
  const text = serializeCommentsBundle(bundle);
  validate(text, options.deviceId, moves[0].moveId);
  await withCommentsWrite(vault, options, async () => {
    const path = `${ROOT}/${prefixFor(options.deviceId)}${moves[0].moveId}.json`;
    if (await vault.exists(path)) {
      if (await vault.readTextFile(path) === text) return;
      throw new Error("A different comment move journal already occupies this path");
    }
    await vault.writeTextFile(path, text);
    if (await vault.readTextFile(path) !== text) throw new Error("The comment move journal could not be verified");
  });
}

function validate(text: string, deviceId: string, firstId: string): CommentsBundle {
  const bundle = parseCommentsBundle(text);
  if (!bundle?.moves?.[firstId] || Object.keys(bundle.comments).length || Object.keys(bundle.authors).length ||
      Object.values(bundle.moves).some(move => move.deviceId !== deviceId)) {
    throw new Error("Invalid local comment move journal");
  }
  return bundle;
}

/** Caller holds the common comment write gate. Bad batches remain untouched
 * and are reported through the existing diagnostic surface; healthy batches
 * continue to protect late comments. Replaying never changes their timestamps
 * or IDs, and no batch is retired after a bundle write or upload. */
export async function readCommentMoveJournals(
  vault: IVaultAdapter,
  deviceId: string,
  now: string,
  faults?: CommentBundleFault[],
): Promise<CommentsBundle | null> {
  const prefix = prefixFor(deviceId);
  let names: string[];
  try {
    names = (await vault.listDir(ROOT, false)).filter(entry => !entry.isDirectory).map(entry => entry.name);
  } catch (error) {
    try { if (!(await vault.exists(ROOT))) return null; } catch { /* Access remains unknown. */ }
    faults?.push({ path: ROOT, reason: "bundle-read", message: message(error) });
    return null;
  }
  let merged: CommentsBundle | null = null;
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const match = /^([a-f0-9]{32})\.json$/.exec(name.slice(prefix.length));
    if (!match) continue;
    const path = `${ROOT}/${name}`;
    let text: string;
    try { text = await vault.readTextFile(path); }
    catch (error) { faults?.push({ path, reason: "bundle-read", message: message(error) }); continue; }
    try {
      const bundle = validate(text, deviceId, match[1]);
      merged = merged ? mergeCommentsBundles(merged, bundle, now) : bundle;
    } catch (error) {
      faults?.push({ path, reason: "bundle-schema", message: message(error) });
    }
  }
  return merged;
}
