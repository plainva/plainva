import { changeOf, readExactText, TextFileChangedError, type IVaultAdapter, type DeletionConfirmation, type TextChange, type TextFileChange, type TextFileState, type TextFileUpdate, type VaultFileInfo, type VaultListing, type WatchEvent } from "@plainva/core";
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

/** How often a change that lost against another writer is made again before it gives up. */
const UPDATE_ATTEMPTS = 4;

export class RemoteVaultAdapter implements IVaultAdapter {
  constructor(
    private readonly reads: IVaultAdapter,
    private readonly bus: WindowBus,
    private readonly vaultPath: string,
  ) {}

  async initialize(): Promise<void> {
    await this.reads.initialize();
  }

  async dispose(): Promise<void> {
    await this.reads.dispose();
  }

  // --- reads: local, unchanged -------------------------------------------

  /**
   * The file's text, or `NotTextFileError` where its bytes are not UTF-8 — the
   * answer the owner's adapter chain gives (`readExactText`). The reads of
   * this window do not pass that chain, and the reader below refuses such a
   * file with an error of its own: an auxiliary window's editor would call a
   * `.csv` in Windows-1252 missing where the main window says what it is.
   */
  readTextFile(path: string): Promise<string> {
    return readExactText(this.reads, path);
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

  listDir(path?: string, recursive?: boolean, options?: { signal?: AbortSignal }): Promise<VaultFileInfo[]> {
    return this.reads.listDir(path, recursive, options);
  }

  listDirReport(path?: string, recursive?: boolean, options?: { signal?: AbortSignal }): Promise<VaultListing> {
    return this.reads.listDirReport
      ? this.reads.listDirReport(path, recursive, options)
      : this.reads.listDir(path, recursive, options).then((files) => ({ files, skipped: [] }));
  }

  // --- writes: delegated to the owner ------------------------------------

  getConflictSession(path: string) { return this.bus.request("conflict-read", { path }, { vaultPath: this.vaultPath }); }
  listConflictSessions() { return this.bus.request("conflict-list", {}, { vaultPath: this.vaultPath }); }
  listConflictDiagnostics() { return this.bus.request("conflict-diagnostics", {}, { vaultPath: this.vaultPath }); }
  preserveConflict(path: string, content: string, writer: import("@plainva/core").ConflictWriter) {
    return this.bus.request("conflict-preserve", { path, content, writer }, { vaultPath: this.vaultPath });
  }
  writeEditorText(path: string, content: string, baseText: string | null) {
    return this.bus.request("editor-write", { path, content, baseText }, { vaultPath: this.vaultPath });
  }
  resolveConflict(path: string, resolution: import("@plainva/core").ConflictResolution) {
    return this.bus.request("conflict-resolve", { path, resolution }, { vaultPath: this.vaultPath });
  }
  resolveConflictBytes(path: string, resolution: import("@plainva/core").ConflictBytesResolution) {
    return this.bus.request("conflict-resolve-bytes", { path, resolution }, { vaultPath: this.vaultPath });
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    await this.bus.request("write", { path, content }, { vaultPath: this.vaultPath });
  }

  /**
   * The owner's entry for a change of a file where it lies. The change is a
   * function and cannot travel, and this window cannot run it inside the
   * owner's gate — so the owner hands out what the file is, the change is
   * made here, and the owner writes it only if the file still is what the
   * change was made of. Otherwise it is made again from what is there now: a
   * few times, then it gives up rather than write over somebody.
   */
  async updateTextFile(path: string, change: TextChange): Promise<TextFileUpdate> {
    for (let attempt = 0; attempt < UPDATE_ATTEMPTS; attempt++) {
      const state = await this.readTextFileState(path);
      const written = await this.writeTextFileChange(path, state, changeOf(state, change));
      if (written) return written;
    }
    throw new TextFileChangedError(path);
  }

  /** The two halves of that step, as the owner serves them: what the file is … */
  readTextFileState(path: string): Promise<TextFileState> {
    return this.bus.request("update-read", { path }, { vaultPath: this.vaultPath });
  }

  /** … and the texts made of it, written only if the file still is that (`null`: it is not). */
  writeTextFileChange(path: string, expected: TextFileState, next: TextFileChange): Promise<TextFileUpdate | null> {
    return this.bus.request("update-write", { path, expected, next }, { vaultPath: this.vaultPath });
  }

  async writeBinaryFile(path: string, content: Uint8Array): Promise<void> {
    // Base64 for the same reason the atomic-write IPC uses it: a JSON number
    // array would be roughly four times the bytes on the wire.
    await this.bus.request("write-binary", { path, base64: bytesToBase64(content) }, { vaultPath: this.vaultPath });
  }

  async deleteItem(path: string, recursive?: boolean, confirmation?: DeletionConfirmation): Promise<void> {
    await this.bus.request("delete", { path, recursive, ...(confirmation ? { confirmation } : {}) }, { vaultPath: this.vaultPath });
  }

  async retargetBookmarks(from: string, to: string): Promise<void> {
    await this.bus.request("rename-bookmarks", { from, to }, { vaultPath: this.vaultPath });
  }

  async renameItem(oldPath: string, newPath: string): Promise<void> {
    await this.bus.request("rename", { from: oldPath, to: newPath }, { vaultPath: this.vaultPath });
  }

  async createDir(path: string): Promise<void> {
    await this.bus.request("mkdir", { path }, { vaultPath: this.vaultPath });
  }

  /**
   * Not implemented on purpose — see the class comment. Kept off the object
   * entirely (rather than throwing) so callers that feature-detect `watch`
   * take their no-watcher branch, which is the correct one here.
   */
  watch?: (callback: (events: WatchEvent[]) => void) => Promise<() => void>;
}
