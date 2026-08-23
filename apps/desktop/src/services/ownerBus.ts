import { PimConflictError, type IVaultAdapter, type VaultFileInfo } from "@plainva/core";
import { applyIndexChanges, type RenameReindexer } from "./fileActions";
import { requestSaveFlush } from "./saveFlush";
import { getWindowBus } from "./windowBus";
import { enqueueSend, appendDraftFor } from "./mail/sendQueue";
import { readComposeDraft } from "./mail/composeHandoff";
import { mailAccessTokenFor } from "@plainva/ui/mail";
import {
  findWindowForContent,
  focusAuxWindow,
  noteWindowBounds,
  noteWindowContent,
  noteWindowContents,
  noteWindowAlwaysOnTop,
  openComposeWindow,
  openOrFocusContent,
  noteWindowVault,
} from "./windowManager";
import { setHolderVault } from "./vaultRuntimes";
import { clearDraft, recordDraft } from "./draftJournal";
import { syncStatusStore } from "./syncStatusStore";
import type { PimRuntime } from "./pim/pimRuntime";

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
  /** The calendar runtime — only this window may talk to a provider. */
  pimRuntime: PimRuntime | null;
  /** Refresh the owner's own views (VaultContext.triggerFileTreeUpdate). */
  refresh: (paths?: string[]) => void;
  /** Re-read the vault (the cheap reconcile) — a client asks for it (C1). */
  refreshVault: () => Promise<unknown>;
  /** Drop every indexed row and parse the vault again — likewise (C1). */
  rebuildIndex: () => Promise<unknown>;
  /**
   * The one sync worker of this vault, or null when none is configured (C3).
   * A client shows its status and asks for "sync now" / "retry" through here.
   */
  syncWorker: {
    triggerImmediate: () => void;
    retryFailed: () => void;
    /** See the "sync-control" comment in windowBus.ts — this is a guard, not a button. */
    noteUserInitiatedDeletion: (paths: string[]) => void;
  } | null;
}

/** Path separator on either platform — the note name is the window title. */
const SEP = /[/\\]/;

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
export function broadcastIndexChanged(paths: string[], structural: boolean, vaultPath: string): void {
  void getWindowBus()
    .then((bus) => bus.broadcast("index-changed", { paths, structural }, vaultPath))
    .catch(() => {
      /* no bus (browser/test): a single window needs no broadcast */
    });
}


/**
 * Forwards two of the owner's own window events onto the bus.
 *
 * Both are LOCAL events with several dispatchers — a note save fires from the
 * editor, from two base views and from a delegated write; an external change
 * fires from the watcher, from the index.md regeneration and from a version
 * restore. Bridging the event instead of calling out from each site means a
 * seventh dispatcher is covered the day it is written, rather than the day
 * somebody notices the other window went stale.
 *
 * Only the owner installs this, so a re-dispatched broadcast in a client
 * cannot bounce back.
 */
function installEventBridges(vaultPath: string): () => void {
  const bridges: Array<[string, "note-saved" | "file-changed"]> = [
    ["plainva-note-saved", "note-saved"],
    ["plainva-external-update", "file-changed"],
  ];
  const offs = bridges.map(([local, channel]) => {
    const handler = (e: Event) => {
      const path = (e as CustomEvent).detail?.path;
      if (typeof path !== "string") return;
      void getWindowBus()
        .then((bus) => bus.broadcast(channel, { path }, vaultPath))
        .catch(() => {});
    };
    window.addEventListener(local, handler);
    return () => window.removeEventListener(local, handler);
  });
  return () => {
    for (const off of offs) off();
  };
}

/**
 * Mirrors the owner's sync status into the other windows (C3).
 *
 * Subscribed to the store rather than called at each writer: the worker's
 * status changes, the "idle" set on vault open and the reset on close all
 * converge there, and a mirror that misses one of them shows a client a state
 * the vault left minutes ago.
 */
export function installSyncStatusMirror(vaultPath: string): () => void {
  let last = "";
  // Subscription is process-wide, the read is not: every vault's emit wakes
  // this mirror and it looks only at ITS vault, so a second worker's poll
  // cannot make this one broadcast a status it never reached (stage D).
  return syncStatusStore.subscribe(() => {
    const s = syncStatusStore.get(vaultPath);
    // Cheap equality: the store also emits for fields no other window draws
    // (error history, authRecoverable), and every emit here is an IPC message.
    const key = [s.status, s.message, s.provider, s.retryAt, s.progress?.phase, s.progress?.current, s.progress?.total].join("|");
    if (key === last) return;
    last = key;
    void getWindowBus()
      .then((bus) =>
        bus.broadcast(
          "sync-status",
          {
            status: s.status,
            message: s.message,
            provider: s.provider,
            retryAt: s.retryAt ?? null,
            progress: s.progress ?? null,
          },
          vaultPath,
        ),
      )
      .catch(() => {});
  });
}

/**
 * Serves the vault-scoped requests of the other windows — one installation per
 * OPEN vault (stage D).
 *
 * Every handler here is bound to `deps.vaultPath`, so a process holding two
 * vaults answers a write with the runtime the caller named. Without that
 * binding both installations would answer the same request and the faster one
 * would win, which on a write path means the wrong vault's adapter chain.
 *
 * The app- and window-scoped requests live in `installOwnerAppBus` instead:
 * they belong to the process, so N runtimes must not answer them N times.
 */
export async function installOwnerBus(deps: OwnerBusDeps): Promise<() => void> {
  const bus = await getWindowBus();
  const offs: Array<() => void> = [installEventBridges(deps.vaultPath)];

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
    }, { vaultPath: deps.vaultPath }),
  );

  offs.push(
    await bus.handle("write-binary", async ({ path, base64 }) => {
      await deps.vaultAdapter.writeBinaryFile(path, base64ToBytes(base64));
      await indexAfterWrite(path);
    }, { vaultPath: deps.vaultPath }),
  );

  offs.push(
    await bus.handle("rename", async ({ from, to }) => {
      await deps.vaultAdapter.renameItem(from, to);
      if (deps.indexer) await applyIndexChanges(deps.indexer, { removed: [from], added: [to] });
      deps.refresh();
    }, { vaultPath: deps.vaultPath }),
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
    }, { vaultPath: deps.vaultPath }),
  );

  offs.push(
    await bus.handle("mkdir", async ({ path }) => {
      await deps.vaultAdapter.createDir(path);
      deps.refresh();
    }, { vaultPath: deps.vaultPath }),
  );

  offs.push(
    await bus.handle("sync-control", async ({ what, paths }) => {
      // One worker per vault, in this window (C3). The client shows the status
      // and asks for the two things the status bar offers; the outcome comes
      // back as the ordinary status broadcast, not as a return value, because
      // the run outlives this request.
      if (what === "note-deletions") deps.syncWorker?.noteUserInitiatedDeletion(paths ?? []);
      else if (what === "retry") deps.syncWorker?.retryFailed();
      else deps.syncWorker?.triggerImmediate();
    }, { vaultPath: deps.vaultPath }),
  );

  offs.push(
    await bus.handle("reindex", async ({ scope }) => {
      // Both of these write to the index, and a client's connection is
      // read-only by design (C1). The toast lands in the central window because
      // that is where the work happens; the broadcast that follows updates
      // every window's tree.
      if (scope === "rebuild") await deps.rebuildIndex();
      else await deps.refreshVault();
    }, { vaultPath: deps.vaultPath }),
  );

  offs.push(
    await bus.handle("pim-write", async ({ accountId, op }) => {
      // The provider round trip happens HERE, in the window that owns the token
      // broker. The rules around it (a move is create-then-delete, a moved
      // remote means re-pull) already ran in the window the user clicked in.
      if (!deps.pimRuntime) throw new Error("no calendar runtime in this window");
      const account = (await deps.pimRuntime.cache.listAccounts()).find((a) => a.id === accountId);
      if (!account) throw new Error("unknown calendar account");
      const target = await deps.pimRuntime.buildTarget(account);
      if (!target) throw new Error("no writable target for this account");
      try {
        if (op.kind === "createEvent") {
          const res = await target.createEvent(op.calendarId, op.draft);
          return { ok: true as const, uid: res.uid, etag: res.etag, href: res.href };
        }
        if (op.kind === "updateEvent") {
          const res = await target.updateEvent(op.ref, op.draft);
          return { ok: true as const, etag: res.etag };
        }
        if (op.kind === "deleteEvent") {
          await target.deleteEvent(op.ref);
          return { ok: true as const };
        }
        if (!target.respondToEvent) throw new Error("this provider cannot answer invitations");
        await target.respondToEvent(op.ref, op.response);
        return { ok: true as const };
      } catch (err) {
        // A conflict is an ANSWER, not a failure: the caller re-pulls and lets
        // the user edit the fresh state. It travels as a value because
        // `PimConflictError` cannot survive JSON.
        if (err instanceof PimConflictError) return { conflict: true as const };
        throw err;
      }
    }, { vaultPath: deps.vaultPath }),
  );

  offs.push(
    await bus.handle("pim-refresh", async () => {
      // Only this window has a worker; an aux calendar asking for fresh data
      // must not start a second poller on the same cache tables.
      await deps.pimRuntime?.worker.triggerImmediate();
    }, { vaultPath: deps.vaultPath }),
  );

  offs.push(
    await bus.handle("toggle-bookmark", async ({ path }) => {
      // App.tsx owns the list and its optimistic state; the bus only carries
      // the request across the window boundary.
      window.dispatchEvent(new CustomEvent("plainva-toggle-bookmark", { detail: { path } }));
    }, { vaultPath: deps.vaultPath }),
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

/**
 * Serves the requests that belong to the PROCESS, not to a vault (stage D).
 *
 * Window routing, the compose hand-over, the mail queue, the draft journal and
 * the owner's own surfaces are all app-level: there is one window registry, one
 * send queue, one settings dialog. With a runtime per open vault these must be
 * installed exactly once, or two runtimes would answer the same request and a
 * compose window would be opened twice for one click.
 *
 * Two of them still need to know a vault — "who has this file open" and "open
 * this content" are questions about one vault's tree. They read it from the
 * CALLER, which is the window that asked, rather than from whatever the central
 * window happens to show.
 */
export async function installOwnerAppBus(): Promise<() => void> {
  const bus = await getWindowBus();
  const offs: Array<() => void> = [];

  offs.push(
    await bus.handle("focus-content", async ({ path }, _from, vaultPath) => {
      // Content is open once, app-wide (plan E2). The owner knows every window,
      // so it answers whether somebody else already has this file — and brings
      // that window forward when it does.
      // The CALLER's vault, not this window's: with two vaults open, asking
      // "who has this file" about the wrong one answers about a different tree.
      if (!vaultPath) return false;
      const win = findWindowForContent(vaultPath, path);
      if (!win) return false;
      return focusAuxWindow(win.label);
    }),
  );

  offs.push(
    await bus.handle("open-content", async ({ path, newWindow, from }, _sender, vaultPath) => {
      // One routing decision for the whole app (plan E2, hard dedup): the owner
      // knows every window, so it answers whether somebody else already has
      // this content — and only when nobody does may the caller draw it.
      if (!vaultPath) throw new Error("open-content needs the calling window's vault");
      const result = await openOrFocusContent({
        vaultPath,
        path,
        newWindow,
        from,
        title: path.split(SEP).pop(),
      });
      if (result.where === "owner") {
        // Bring the central window forward and let App open the tab.
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().setFocus().catch(() => {});
        window.dispatchEvent(new CustomEvent("plainva-window-show-content", { detail: { path } }));
      }
      if (result.where === "caller" && from) noteWindowContent(from, path);
      return { where: result.where };
    }),
  );

  offs.push(
    await bus.handle("mail-send", async (req) => {
      // The queue, the toast and the beforeunload flush all live here — see
      // sendQueue.ts. A compose window hands the message over and closes.
      await enqueueSend(req);
    }),
  );

  offs.push(
    await bus.handle("mail-draft", async (req) => {
      await appendDraftFor(req);
    }),
  );

  offs.push(
    await bus.handle("mail-token", async ({ vaultPath, accountId, force }) =>
      mailAccessTokenFor(vaultPath, accountId, force),
    ),
    await bus.handle("compose-draft", async ({ label }) => readComposeDraft(label)),
  );

  offs.push(
    await bus.handle("compose-popout", async ({ vaultPath, snapshot, title }) => {
      // Only this window may create windows (the aux capability withholds it),
      // and only this window keeps the draft until the new one collects it.
      await openComposeWindow({ vaultPath, snapshot, title });
    }),
  );

  offs.push(
    await bus.handle("window-bounds", async ({ label, bounds }) => {
      noteWindowBounds(label, bounds);
    }),
  );

  offs.push(
    await bus.handle("window-contents", async ({ label, active, contents }) => {
      // Dedup asks the registry, so the registry has to know every tab of every
      // window — not just the one in front (P4).
      noteWindowContents(label, active, contents);
    }),
  );

  offs.push(
    await bus.handle("window-always-on-top", async ({ label, value }) => {
      noteWindowAlwaysOnTop(label, value);
    }),
  );

  offs.push(
    await bus.handle("hold-vault", async ({ label, vaultPath }) => {
      // Two things at once, and they have to stay together: the registry decides
      // whether that vault gets a runtime here, and the window record decides
      // which vault's list remembers this window for the next start.
      setHolderVault(vaultPath, label);
      noteWindowVault(label, vaultPath);
    }),
  );

  offs.push(
    await bus.handle("owner-surface", async ({ surface, provider, area, vaultPath }) => {
      // Bring this window forward first: opening a dialog in a window the user
      // cannot see is the same as doing nothing, only more confusing.
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        await win.unminimize().catch(() => {});
        await win.setFocus();
      } catch {
        /* no backend (browser/test): the dispatch below still works */
      }
      // The event names are the ones the owner's own surfaces already listen
      // for, so a request from another window walks exactly the same path as a
      // click here — there is no second entry point that can drift.
      const events: Record<typeof surface, string> = {
        settings: "plainva-open-sync-settings",
        import: "plainva-open-import-wizard",
        "sync-error": "plainva-show-sync-error",
        "update-indexes": "plainva-update-all-indexes",
        backup: "plainva-backup-now",
        "new-window": "plainva-open-full-window",
      };
      // `new-window` carries the vault it should show: since stage D the asking
      // window may be looking at a different one than this window is.
      const detail =
        surface === "settings" ? { provider, area } : surface === "new-window" && vaultPath ? { vaultPath } : undefined;
      window.dispatchEvent(new CustomEvent(events[surface], detail ? { detail } : undefined));
    }),
  );

  offs.push(
    await bus.handle("draft-record", async ({ vaultPath, notePath, text, revision }) => {
      // The journal lives on disk next to the owner's own drafts; an auxiliary
      // window has no write access to it (aux capability) and needs none.
      await recordDraft(vaultPath, notePath, text, revision);
    }),
  );

  offs.push(
    await bus.handle("draft-clear", async ({ vaultPath, notePath, upToRevision }) => {
      await clearDraft(vaultPath, notePath, upToRevision ?? Infinity);
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
