import type { IVaultAdapter, VaultFileInfo, VaultListing, WatchEvent } from "@plainva/core";
import { bytesToBase64 } from "./TauriVaultAdapter";
import type { WindowBus } from "../services/windowBus";

/**
 * The vault as an auxiliary window sees it (multi-window P0).
 *
 * Reads go straight to disk through the ordinary adapter — they are safe from
 * any window, they need no coordination, and routing them through the owner
 * would add latency to every keystroke that renders a preview.
 *
 * Writes do NOT. Every mutation is handed to the owner over the bus, and the
 * owner runs it through its existing chain: backup snapshot, sync queue,
 * conflict-aware merge, and the `pendingWrites` serialization that keeps two
 * saves of the same file in order. That chain is the reason the July sync
 * hardening holds; a second window writing past it would quietly undo it.
 *
 * `watch` is deliberately absent: the file watcher belongs to the owner, which
 * broadcasts `bus:file-changed`. An aux window that started its own watcher
 * would re-index the same events a second time.
 */
export class RemoteVaultAdapter implements IVaultAdapter {
  constructor(
    private readonly reads: IVaultAdapter,
    private readonly bus: WindowBus,
  ) {}

  async initialize(): Promise<void> {
    await this.reads.initialize();
  }

  async dispose(): Promise<void> {
    await this.reads.dispose();
  }

  // --- reads: local, unchanged -------------------------------------------

  readTextFile(path: string): Promise<string> {
    return this.reads.readTextFile(path);
  }

  readBinaryFile(path: string): Promise<Uint8Array> {
    return this.reads.readBinaryFile(path);
  }

  exists(path: string): Promise<boolean> {
    return this.reads.exists(path);
  }

  getFileInfo(path: string): Promise<VaultFileInfo> {
    return this.reads.getFileInfo(path);
  }

  listDir(path?: string, recursive?: boolean): Promise<VaultFileInfo[]> {
    return this.reads.listDir(path, recursive);
  }

  listDirReport(path?: string, recursive?: boolean): Promise<VaultListing> {
    return this.reads.listDirReport
      ? this.reads.listDirReport(path, recursive)
      : this.reads.listDir(path, recursive).then((files) => ({ files, skipped: [] }));
  }

  // --- writes: delegated to the owner ------------------------------------

  async writeTextFile(path: string, content: string): Promise<void> {
    await this.bus.request("write", { path, content });
  }

  async writeBinaryFile(path: string, content: Uint8Array): Promise<void> {
    // Base64 for the same reason the atomic-write IPC uses it: a JSON number
    // array would be roughly four times the bytes on the wire.
    await this.bus.request("write-binary", { path, base64: bytesToBase64(content) });
  }

  async deleteItem(path: string, recursive?: boolean): Promise<void> {
    await this.bus.request("delete", { path, recursive });
  }

  async renameItem(oldPath: string, newPath: string): Promise<void> {
    await this.bus.request("rename", { from: oldPath, to: newPath });
  }

  async createDir(path: string): Promise<void> {
    await this.bus.request("mkdir", { path });
  }

  /**
   * Not implemented on purpose — see the class comment. Kept off the object
   * entirely (rather than throwing) so callers that feature-detect `watch`
   * take their no-watcher branch, which is the correct one here.
   */
  watch?: (callback: (events: WatchEvent[]) => void) => Promise<() => void>;
}
