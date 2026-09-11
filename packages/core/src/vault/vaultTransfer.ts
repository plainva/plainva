import type { IVaultAdapter } from "./IVaultAdapter.js";
import type { ISyncTarget } from "../sync/ISyncTarget.js";
import { sha256Hex } from "../workspace/encoding.js";

export interface TransferFile { path: string; bytes: Uint8Array; hash: string }
export interface TransferCollision { path: string; copyPath: string; local: TransferFile; remote: TransferFile }
export interface VaultTransferPlan {
  local: TransferFile[];
  remote: TransferFile[];
  collisions: TransferCollision[];
  files: TransferFile[];
  etags: Map<string, string>;
  targetFiles: TransferFile[];
}
const safePath = (path: string) => path.length > 0 && !path.startsWith("/") && !/[\\:]/.test(path) && ![...path].some(c => c.charCodeAt(0) < 32) && !path.split("/").some(p => !p || p === "." || p === "..");
const transferable = (path: string) => ![".plainva", ".pvws"].some(root => path === root || path.startsWith(root + "/"));

/** Fails closed when any directory cannot be read. Private vault metadata is
 * transferred through its own device-local stores, never as cloud file data. */
export async function readTransferFiles(adapter: IVaultAdapter): Promise<TransferFile[]> {
  const files: TransferFile[] = [];
  const seen = new Set<string>();
  const walk = async (path: string) => {
    const report = adapter.listDirReport ? await adapter.listDirReport(path, false) : null;
    if (report?.skipped.length) throw new Error("transfer_incomplete_inventory");
    const entries = report ? report.files : await adapter.listDir(path, false);
    for (const entry of entries) {
      const parent = entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : "";
      if (!safePath(entry.path) || parent !== path || seen.has(entry.path)) throw new Error("transfer_invalid_path");
      seen.add(entry.path);
      if (!transferable(entry.path)) continue;
      if (entry.isDirectory) await walk(entry.path);
      else { const bytes = await adapter.readBinaryFile(entry.path); files.push({ path: entry.path, bytes, hash: sha256Hex(bytes) }); }
    }
  };
  await walk("");
  return files;
}

/** Read-only preview. The caller must review every collision before commit. */
export async function planVaultTransfer(source: IVaultAdapter, remote: ISyncTarget, target?: IVaultAdapter): Promise<VaultTransferPlan> {
  const listing = await remote.pull();
  if (listing.needsFullListing) throw new Error("transfer_incomplete_inventory");
  const local = await readTransferFiles(source);
  const targetFiles = target ? await readTransferFiles(target) : [];
  const remoteFiles: TransferFile[] = [];
  for (const path of listing.etagMap.keys()) {
    if (!safePath(path)) throw new Error("transfer_invalid_path");
    if (!transferable(path)) continue;
    const bytes = await remote.download(path);
    if (bytes === null) throw new Error("transfer_source_changed");
    remoteFiles.push({ path, bytes, hash: sha256Hex(bytes) });
  }
  const files = new Map(remoteFiles.map(file => [file.path, file]));
  const allLocal = [...targetFiles, ...local];
  const reserved = new Set([...files.keys(), ...allLocal.map(f => f.path)]);
  const collisions: TransferCollision[] = [];
  for (const file of allLocal) {
    const other = files.get(file.path);
    if (!other) { files.set(file.path, file); continue; }
    if (other.hash === file.hash) continue;
    const dot = file.path.lastIndexOf(".");
    const split = dot > file.path.lastIndexOf("/") ? dot : file.path.length;
    const copyPath = `${file.path.slice(0, split)} — ${file.hash}${file.path.slice(split)}`;
    const occupied = files.get(copyPath) ?? allLocal.find(f => f.path === copyPath);
    if (reserved.has(copyPath) && occupied?.hash !== file.hash) throw new Error("transfer_destination_changed");
    reserved.add(copyPath);
    files.set(copyPath, { ...file, path: copyPath });
    collisions.push({ path: file.path, copyPath, local: file, remote: other });
  }
  // Mobile and desktop may differ in case/Unicode filesystem behaviour. A
  // path that aliases another path must never overwrite it during transfer.
  const portable = new Map<string, string>();
  for (const path of files.keys()) {
    const key = path.normalize("NFC").toLowerCase();
    const previous = portable.get(key);
    if (previous && previous !== path) throw new Error("transfer_invalid_path");
    portable.set(key, path);
  }
  for (const key of portable.keys()) {
    let parent = key;
    while (parent.includes("/")) {
      parent = parent.slice(0, parent.lastIndexOf("/"));
      if (portable.has(parent)) throw new Error("transfer_invalid_path");
    }
  }
  return { local, remote: remoteFiles, files: [...files.values()], collisions, etags: listing.etagMap, targetFiles };
}

/** Revalidate the displayed snapshot; never replace a pre-existing destination
 * with different bytes. A retry reuses identical files after an interruption. */
export async function commitVaultTransfer(plan: VaultTransferPlan, source: IVaultAdapter, target: IVaultAdapter, remote: ISyncTarget): Promise<void> {
  const listing = await remote.pull();
  if (listing.needsFullListing || listing.etagMap.size !== plan.etags.size || [...plan.etags].some(([p, tag]) => listing.etagMap.get(p) !== tag)) throw new Error("transfer_source_changed");
  const latest = await readTransferFiles(source);
  if (latest.length !== plan.local.length || latest.some(f => plan.local.find(p => p.path === f.path)?.hash !== f.hash)) throw new Error("transfer_source_changed");
  // Check every destination before the first write; protect existing local edits.
  const before = new Map(plan.targetFiles.map(f => [f.path, f.hash]));
  for (const f of plan.targetFiles) if (!await target.exists(f.path) || sha256Hex(await target.readBinaryFile(f.path)) !== f.hash) throw new Error("transfer_destination_changed");
  for (const f of plan.files) if (await target.exists(f.path)) {
    const hash = sha256Hex(await target.readBinaryFile(f.path));
    if (hash !== f.hash && hash !== before.get(f.path)) throw new Error("transfer_destination_changed");
  }
  // Copies first, originals last: an interruption always leaves every version.
  const ordered = [...plan.files].sort((a, b) => Number(before.has(a.path)) - Number(before.has(b.path)));
  for (const f of ordered) {
    if (await target.exists(f.path)) {
      const hash = sha256Hex(await target.readBinaryFile(f.path));
      if (hash !== f.hash) {
        if (hash !== before.get(f.path)) throw new Error("transfer_destination_changed");
        const preserved = plan.files.find(copy => copy.path !== f.path && copy.hash === hash);
        if (!preserved || !await target.exists(preserved.path) || sha256Hex(await target.readBinaryFile(preserved.path)) !== hash) throw new Error("transfer_copy_missing");
        await target.writeBinaryFile(f.path, f.bytes);
      }
    } else await target.writeBinaryFile(f.path, f.bytes);
    if (sha256Hex(await target.readBinaryFile(f.path)) !== f.hash) throw new Error("transfer_storage_failed");
  }
}
