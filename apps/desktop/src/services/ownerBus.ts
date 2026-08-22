import type { IVaultAdapter, VaultFileInfo } from "@plainva/core";
import { applyIndexChanges, type RenameReindexer } from "./fileActions";
import { requestSaveFlush } from "./saveFlush";
import { getWindowBus } from "./windowBus";
import { findWindowForContent, focusAuxWindow } from "./windowManager";

/**
 * The owner half of the window bus (multi-window P0).
 *
 * Auxiliary windows read the vault themselves but hand every mutation here, and
 * this is where those mutations join the ordinary owner path: the SAME adapter
 * chain the central window's own editor writes through (backup snapshot, sync
 * queue, conflict-aware merge, pending-write serialization), followed by the
 * SAME incremental index update. That is the whole point of the delegation — a
 * second window writing past the chain would quietly undo the July sync
 * hardening, and nobody would notice until a file came back wrong.
 *
 * The handlers are adapter-level on purpose. `rename` renames a file; it does
 * not rewrite the links pointing at it, exactly like `IVaultAdapter.renameItem`
 * in the owner. Note-level operations ("rename this note and fix its links")
 * are a different, higher-level request and get their own RPC when a window
 * actually needs one.
 */
export interface OwnerBusDeps {
  /** Absolute path of the open vault — auxiliary windows belong to one vault. */
  vaultPath: string;
  /** The full owner chain — never the raw adapter. */
  vaultAdapter: IVaultAdapter;
  /** The owner's indexer, so a delegated write lands in the index at once. */
  indexer: (RenameReindexer & { indexFile: (info: VaultFileInfo) => Promise<boolean> }) | null;
  /** Refresh the owner's own views (VaultContext.triggerFileTreeUpdate). */
  refresh: (paths?: string[]) => void;
}

/** Decodes the base64 an auxiliary window sends binary content as. */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Tells the other windows that the index moved. Called from the owner's single
 * refresh funnel, so no write path can forget it.
 */
export function broadcastIndexChanged(paths: string[], structural: boolean): void {
  void getWindowBus()
    .then((bus) => bus.broadcast("index-changed", { paths, structural }))
    .catch(() => {
      /* no bus (browser/test): a single window needs no broadcast */
    });
}

/** Mirrors the owner's sync status into the other windows. */
export function broadcastSyncStatus(status: string, message?: string | null): void {
  void getWindowBus()
    .then((bus) => bus.broadcast("sync-status", { status, message }))
    .catch(() => {});
}

/**
 * Serves the requests of the auxiliary windows. Returns a disposer; the owner
 * re-installs it whenever the open vault changes, because the adapter chain and
 * the indexer belong to that vault.
 */
export async function installOwnerBus(deps: OwnerBusDeps): Promise<() => void> {
  const bus = await getWindowBus();
  const offs: Array<() => void> = [];

  const indexAfterWrite = async (path: string) => {
    if (!deps.indexer) return;
    // Same shape as the owner's own save: re-read through the adapter so the
    // index matches what was actually written (the conflict-aware layer may
    // have merged), and pass the real mtime so the watcher's echo detection
    // can skip indexing this write a second time.
    let info: VaultFileInfo;
    try {
      info = await deps.vaultAdapter.getFileInfo(path);
    } catch {
      info = { path, name: path.split(/[/\\]/).pop() ?? path, isDirectory: false, mtime: Date.now(), size: 0 };
    }
    const metaChanged = await deps.indexer.indexFile(info);
    // The pinboard renders note BODIES and listens for this (plan Pinboard P2).
    window.dispatchEvent(new CustomEvent("plainva-note-saved", { detail: { path } }));
    if (metaChanged) deps.refresh([path]);
  };

  offs.push(
    await bus.handle("write", async ({ path, content }) => {
      await deps.vaultAdapter.writeTextFile(path, content);
      await indexAfterWrite(path);
    }),
  );

  offs.push(
    await bus.handle("write-binary", async ({ path, base64 }) => {
      await deps.vaultAdapter.writeBinaryFile(path, base64ToBytes(base64));
      await indexAfterWrite(path);
    }),
  );

  offs.push(
    await bus.handle("rename", async ({ from, to }) => {
      await deps.vaultAdapter.renameItem(from, to);
      if (deps.indexer) await applyIndexChanges(deps.indexer, { removed: [from], added: [to] });
      deps.refresh();
    }),
  );

  offs.push(
    await bus.handle("delete", async ({ path, recursive }) => {
      await deps.vaultAdapter.deleteItem(path, recursive);
      if (deps.indexer) {
        // A recursive delete takes an unknown number of descendants with it, so
        // the index has to be reconciled rather than patched.
        await applyIndexChanges(deps.indexer, recursive ? { needsFullScan: true } : { removed: [path] });
      }
      deps.refresh();
    }),
  );

  offs.push(
    await bus.handle("mkdir", async ({ path }) => {
      await deps.vaultAdapter.createDir(path);
      deps.refresh();
    }),
  );

  offs.push(
    await bus.handle("focus-content", async ({ path }) => {
      // Content is open once, app-wide (plan E2). The owner knows every window,
      // so it answers whether somebody else already has this file — and brings
      // that window forward when it does.
      const win = findWindowForContent(deps.vaultPath, path);
      if (!win) return false;
      return focusAuxWindow(win.label);
    }),
  );

  offs.push(
    await bus.handle("flush-pending", async ({ path }) => {
      // An editor in THIS window may hold an unsaved buffer for the file the
      // other window is about to rewrite. Same handshake the restore path uses.
      await requestSaveFlush(path);
    }),
  );

  return () => {
    for (const off of offs.splice(0)) {
      try {
        off();
      } catch {
        /* a listener that is already gone is not a problem */
      }
    }
  };
}
