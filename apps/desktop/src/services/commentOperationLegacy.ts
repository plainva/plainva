import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, remove } from "@tauri-apps/plugin-fs";
import { checkedReadDirectory, checkedReadTextFile } from "../adapters/checkedFilesystem";
import { legacyPathHash } from "./draftJournal";

/**
 * The comment-operation queue used to live in `drafts/<legacyPathHash>/
 * comment-operations`. That hash is lossy (64 bit), so two vaults could share
 * the folder; "forget app data" of one used to delete the other's unsent
 * operations. The queue now lives under the SHA-256 key the drafts use. These
 * helpers move or remove only the entries of ONE vault (`contextKey` is its
 * path) and leave everything else where it is.
 */

const FOLDER = "comment-operations";

export function commentOperationsFolder(base: string, key: string): Promise<string> {
  return join(base, "drafts", key, FOLDER);
}

/** Entries of the old folder that provably belong to `vaultPath`. */
async function ownLegacyEntries(vaultPath: string): Promise<{ dir: string; parent: string; rootId: string; own: Array<{ file: string; raw: string }> } | null> {
  const base = await appDataDir();
  const dir = await commentOperationsFolder(base, legacyPathHash(vaultPath));
  if (!(await exists(dir))) return null;
  const parent = await join(base, "drafts", legacyPathHash(vaultPath));
  const rootId = await invoke<string>("register_write_root", { path: dir });
  const own: Array<{ file: string; raw: string }> = [];
  for (const entry of await checkedReadDirectory(rootId, "") ?? []) {
    if (entry.unreadable || !entry.isFile || !entry.name.endsWith(".json")) continue;
    const raw = await checkedReadTextFile(rootId, entry.name);
    if (raw === null) continue;
    try {
      // Anything that cannot be proven this vault's stays: it may be another's.
      if ((JSON.parse(raw) as { contextKey?: unknown }).contextKey === vaultPath) own.push({ file: entry.name, raw });
    } catch { /* unreadable entry: leave it */ }
  }
  return { dir, parent, rootId, own };
}

/** Removes the old folder (and its parent) only once nothing is left in it. */
async function removeIfEmpty(dir: string, rootId: string, parent: string): Promise<void> {
  if ((await checkedReadDirectory(rootId, "") ?? []).length > 0) return;
  await remove(dir);
  try {
    const parentRoot = await invoke<string>("register_write_root", { path: parent });
    if ((await checkedReadDirectory(parentRoot, "") ?? []).length === 0) await remove(parent);
  } catch { /* the parent may hold other drafts; it is not ours to force */ }
}

/**
 * Moves this vault's entries from the old folder to `target` (a registered
 * write root of the new folder). An entry already present in the new folder
 * wins: the new copy may have progressed (completed) since.
 */
export async function migrateLegacyCommentOperations(vaultPath: string, target: string): Promise<void> {
  const legacy = await ownLegacyEntries(vaultPath);
  if (!legacy) return;
  for (const { file, raw } of legacy.own) {
    if ((await checkedReadTextFile(target, file)) === null) {
      await invoke("write_file_atomic", { rootId: target, relPath: file, contents: raw, encoding: "utf8" });
      if ((await checkedReadTextFile(target, file)) !== raw) throw new Error("The comment operation could not be moved");
    }
    await remove(await join(legacy.dir, file));
  }
  await removeIfEmpty(legacy.dir, legacy.rootId, legacy.parent);
}

/** "Forget app data": the new folder goes with the vault's draft folder; here only this vault's old entries. */
export async function removeLegacyCommentOperations(vaultPath: string): Promise<void> {
  const legacy = await ownLegacyEntries(vaultPath);
  if (!legacy) return;
  for (const { file } of legacy.own) await remove(await join(legacy.dir, file));
  await removeIfEmpty(legacy.dir, legacy.rootId, legacy.parent);
}

