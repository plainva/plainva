/**
 * The window bus (multi-window P0).
 *
 * Plainva runs every window in ONE process: the central window owns the
 * background services and all write paths, auxiliary windows read the vault
 * and the index directly and hand mutations over. This module is the wire
 * between them — two directions, deliberately narrow:
 *
 * - **Broadcast** (owner to everyone): "the index changed", "this file
 *   changed", "sync status", "a setting changed". Fire-and-forget, no reply.
 * - **RPC** (aux to owner): write/rename/delete/mkdir and the cross-window
 *   flows. Correlated by id, with a timeout and a real error path, because a
 *   silently dropped write is the one failure this design must not have.
 *
 * The 89 existing `plainva-*` DOM CustomEvents stay window-local. Only the
 * classes above get a bridge — a big-bang port of the event system would be a
 * much larger surface than the feature needs. Rule from P0 on: whoever adds a
 * new `plainva-*` event decides in the same commit whether it stays local or
 * needs a bridge; the coupling surface nearly doubled in one month and drifts
 * if nobody decides.
 *
 * The transport is injectable so the aux shell can be exercised in a browser
 * (Playwright, vitest) without a second OS window, and so nothing here calls
 * into `@tauri-apps/api` while the module is still loading (C20).
 */

import type { PimEventDraft, PimEventRef } from "@plainva/core";
import type { MailDraftRequest, MailSendRequest } from "./mail/sendQueue";
import type { ComposeSnapshot } from "./mail/composeHandoff";

/** Label of the window that owns the services. Tauri's own default label. */
export const OWNER_LABEL = "main";

/** The transport the bus rides on — Tauri events in the app, a fake in tests. */
export interface BusTransport {
  /** Label of the window this transport runs in. */
  label: string;
  /** Sends to every window (including, in Tauri, the sender itself). */
  emit(event: string, payload: unknown): Promise<void>;
  /** Sends to one window by label. */
  emitTo(target: string, event: string, payload: unknown): Promise<void>;
  /** Subscribes; resolves to an unsubscribe function. */
  listen(event: string, handler: (payload: unknown) => void): Promise<() => void>;
}

/** Payloads the owner broadcasts. Extend here, not with a second channel. */
export interface BroadcastMap {
  /** Paths the index just took in; `structural` when the tree shape changed. */
  "index-changed": { paths: string[]; structural: boolean };
  /** A file on disk changed — feeds the aux editor's external-update logic. */
  "file-changed": { path: string };
  /**
   * A note's BODY was saved. Separate from index-changed on purpose: a pure
   * prose edit deliberately skips the tree bump (fix C, 2026-07-08), so a
   * pinboard `.base` in another window would keep showing the old card text.
   */
  "note-saved": { path: string };
  /**
   * The owner's sync status, mirrored into every other window (C3).
   *
   * Carries the fields the status bar actually draws: without `provider` a
   * client cannot tell "no sync configured" from "sync running elsewhere", and
   * it would honestly but wrongly say "local" for a synced vault.
   */
  "sync-status": {
    status: string;
    message?: string | null;
    provider?: string | null;
    retryAt?: number | null;
    /** Mirrors core's SyncProgress verbatim — see services/syncStatusStore.ts. */
    progress?: { phase: "pull" | "push"; current: number; total: number } | null;
  };
  /** Calendar/task data changed (PIM worker cycle finished). */
  "pim-changed": Record<string, never>;
  /** A setting the other windows must re-apply (theme, density, font, zoom). */
  "settings-changed": { domain: string };
  /** Who has what open — the owner keeps the global open-registry from this. */
  "tab-registry": { label: string; contents: string[] };
  /** Owner to one window: bring this content forward (dedup / focus routing). */
  "focus-content": { label: string; path: string };
  /** Owner to one window: show this content instead of what it has open. */
  "set-content": { label: string; path: string | null };
}

export type BroadcastChannel = keyof BroadcastMap;

/**
 * One calendar write, as data (multi-window P2).
 *
 * The shape mirrors `IPimTarget`'s write methods rather than inventing a
 * vocabulary: whatever the aux window would have called on a target, it sends
 * as this and the owner calls it there.
 */
export type PimWriteOp =
  | { kind: "createEvent"; calendarId: string; draft: PimEventDraft }
  | { kind: "updateEvent"; ref: PimEventRef; draft: PimEventDraft }
  | { kind: "deleteEvent"; ref: PimEventRef }
  | { kind: "respondToEvent"; ref: PimEventRef; response: "accepted" | "declined" | "tentative" };

/**
 * Requests an auxiliary window sends to the owner.
 *
 * P0 covered the vault write subset plus the two cross-window flows the write
 * paths already depend on; P2 added the calendar writes. `mail-send` joins in
 * P3 — the shape is the same, only the handler moves with the feature.
 */
export interface RpcMap {
  write: { args: { path: string; content: string }; result: void };
  "write-binary": { args: { path: string; base64: string }; result: void };
  rename: { args: { from: string; to: string }; result: void };
  delete: { args: { path: string; recursive?: boolean }; result: void };
  mkdir: { args: { path: string }; result: void };
  /** Is this content open somewhere? Returns true when another window took it. */
  "focus-content": { args: { path: string }; result: boolean };
  /** Waits for a foreign editor's pending save before a write path touches it. */
  "flush-pending": { args: { path: string }; result: void };
  /** Draft snapshot of an unsaved buffer — the owner owns the journal on disk. */
  "draft-record": { args: { vaultPath: string; notePath: string; text: string; revision: number }; result: void };
  /** Clears a journal entry; `upToRevision: null` forces (Infinity over JSON). */
  "draft-clear": { args: { vaultPath: string; notePath: string; upToRevision: number | null }; result: void };
  /**
   * Open this content wherever it belongs: the owner focuses the window that
   * already has it, otherwise it tells the caller to show it itself. `where`
   * says what happened, so the caller does not guess.
   */
  "open-content": {
    args: { path: string; newWindow?: boolean; from?: string };
    result: { where: "focused" | "caller" | "owner" };
  };
  /**
   * A calendar write executed BY THE OWNER (multi-window P2).
   *
   * Not because the rules live there — those are shared (`eventWrite.ts`) and
   * run in whichever window the user clicked in. The provider call is what
   * must not be duplicated: since cloud accounts stage B, ONE refresh token
   * serves files, calendar and mail of an account, and two windows refreshing
   * it in parallel invalidate the account as a whole. So the aux window keeps
   * the decision and hands over the round trip.
   *
   * `conflict` is a value here, not an exception: `PimConflictError` cannot
   * survive JSON, and the caller re-throws it on its side.
   */
  "pim-write": {
    args: { accountId: string; op: PimWriteOp };
    result: { ok: true; etag?: string; uid?: string; href?: string } | { conflict: true };
  };
  /**
   * Toggle a bookmark. The list is owner state — its sidebar renders it — so
   * an auxiliary window asks instead of writing `.plainva/bookmarks.json`
   * from a list it never loaded, which would drop every other entry.
   */
  "toggle-bookmark": { args: { path: string }; result: void };
  /** Ask the owner's PIM worker for a cycle now (an aux view has no worker). */
  "pim-refresh": { args: Record<string, never>; result: void };
  /**
   * Show one of the owner-only surfaces (stage C2).
   *
   * Settings, the import wizard and the sync-error dialog start services, bind
   * credentials or write across the whole vault, so they exist in exactly one
   * window. A full second window keeps the buttons that lead to them — a
   * greyed-out gear explains nothing — and this request brings the central
   * window forward and opens the surface THERE. One request rather than six:
   * the ask is always the same shape, only the target differs.
   *
   * The last three are runs rather than dialogs — the index.md sweep, the
   * manual backup, the vault switcher — and they belong here for the same
   * reason (multi-window C2): they touch the whole vault, and the window that
   * owns the schedulers and the indexer is the one that should be doing it.
   */
  "owner-surface": {
    args: {
      surface: "settings" | "import" | "sync-error" | "update-indexes" | "backup" | "switch-vault";
      provider?: string;
      area?: string;
    };
    result: void;
  };
  /**
   * Send a message the writer composed in a compose window. The delayed-send
   * queue belongs to the owner (plan §12.4): a compose window is the most
   * likely window in the app to be closed while the undo timer runs, and its
   * closing must not decide between sending and losing.
   */
  "mail-send": { args: MailSendRequest; result: void };
  /** Same routing for "save as draft" — one provider round trip, one window. */
  "mail-draft": { args: MailDraftRequest; result: void };
  /**
   * An access token for one mailbox, minted BY THE OWNER (finding 2026-08-23).
   *
   * Reading and writing a mailbox is safe from any window — IMAP was built for
   * several clients, and Graph calls carry a bearer token. Refreshing is not:
   * Microsoft ROTATES the refresh token, so two windows renewing at the same
   * time leave one of them holding a token that no longer works, and the
   * account falls over. The owner is therefore the only refresher; every other
   * window asks here. `force` passes a 401 through, so a stale token is
   * renewed once rather than by each window on its own.
   */
  "mail-token": { args: { vaultPath: string; accountId: string; force: boolean }; result: string };
  /**
   * What this compose window was popped out with. Recipients, subject, body
   * and attachments are handed over here rather than in the URL: attachments
   * are base64.
   */
  "compose-draft": { args: { label: string }; result: ComposeSnapshot | null };
  "compose-popout": { args: { vaultPath: string; snapshot: ComposeSnapshot; title: string }; result: void };
  /** An auxiliary window reports its geometry so a restart can restore it. */
  "window-bounds": {
    args: { label: string; bounds: { x: number; y: number; width: number; height: number } };
    result: void;
  };
  /**
   * Everything an auxiliary window has open (P4). The owner needs the whole
   * list, not just the visible tab: dedup answers "is this note open anywhere",
   * and with tabs the answer is no longer a single field.
   */
  "window-contents": {
    args: { label: string; active: string | null; contents: string[] };
    result: void;
  };
  /** An auxiliary window reports its always-on-top pin so it survives a restart. */
  "window-always-on-top": { args: { label: string; value: boolean }; result: void };
  /**
   * Re-read the vault, or rebuild the index from scratch (multi-window C1).
   *
   * The indexer stays with the owner — a client holds a read-only connection to
   * the index by design, and both of these WRITE. `refresh` is the cheap
   * reconcile behind the tree-header button; `rebuild` is the maintenance page's
   * "rebuild index", which drops every row first. Either way the owner
   * broadcasts `index-changed` afterwards, so this window follows without
   * asking again.
   */
  reindex: { args: { scope: "refresh" | "rebuild" }; result: void };
  /**
   * Ask the central window to sync now, or to retry what failed (C3).
   *
   * There is exactly one sync worker per vault, in the owner — that is what the
   * whole July 2026 hardening assumes. A client therefore SHOWS the status and
   * asks for the two things a user can trigger from the status bar; the result
   * comes back as the usual `sync-status` broadcast rather than as a return
   * value, because the run outlives the request.
   */
  /**
   * Sync control from another window (C3). "now"/"retry" are the two buttons
   * the status bar offers; "note-deletions" is not a button at all — it is the
   * record that a HUMAN asked for these deletions, which is what keeps the
   * owner's mass-deletion guard from stopping the cycle and asking the central
   * window about a folder somebody deleted in this one.
   */
  "sync-control": { args: { what: "now" | "retry" | "note-deletions"; paths?: string[] }; result: void };
}

export type RpcKind = keyof RpcMap;

const EV_BROADCAST = "pv:broadcast";
const EV_RPC = "pv:rpc";
const EV_RPC_REPLY = "pv:rpc-reply";

/** How long an aux window waits for the owner before it reports a failure. */
export const RPC_TIMEOUT_MS = 15_000;

interface BroadcastEnvelope {
  from: string;
  channel: string;
  payload: unknown;
}

interface RpcEnvelope {
  from: string;
  id: string;
  kind: string;
  args: unknown;
}

interface RpcReply {
  id: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}

export interface WindowBus {
  readonly label: string;
  /** Owner side: tell every other window something happened. */
  broadcast<C extends BroadcastChannel>(channel: C, payload: BroadcastMap[C]): Promise<void>;
  /** Any side: react to a broadcast. Own emissions are filtered out. */
  onBroadcast<C extends BroadcastChannel>(
    channel: C,
    handler: (payload: BroadcastMap[C], from: string) => void,
  ): Promise<() => void>;
  /** Aux side: ask the owner to do something and wait for the outcome. */
  request<K extends RpcKind>(kind: K, args: RpcMap[K]["args"]): Promise<RpcMap[K]["result"]>;
  /** Owner side: answer one request kind. Throwing rejects the caller's promise. */
  handle<K extends RpcKind>(
    kind: K,
    handler: (
      args: RpcMap[K]["args"],
      from: string,
    ) => Promise<RpcMap[K]["result"]> | RpcMap[K]["result"],
  ): Promise<() => void>;
  /** Drops every subscription this bus made. */
  dispose(): Promise<void>;
}

let rpcCounter = 0;

export function createWindowBus(transport: BusTransport, timeoutMs = RPC_TIMEOUT_MS): WindowBus {
  const unlisteners: Array<() => void> = [];
  const pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  let replyListener: Promise<void> | null = null;

  /**
   * One reply listener per bus, wired on the first request. Doing it eagerly
   * would make every window subscribe to a channel most of them never use.
   */
  const ensureReplyListener = () => {
    if (replyListener) return replyListener;
    replyListener = transport
      .listen(EV_RPC_REPLY, (raw) => {
        const reply = raw as RpcReply;
        const waiting = pending.get(reply.id);
        if (!waiting) return;
        pending.delete(reply.id);
        clearTimeout(waiting.timer);
        if (reply.ok) waiting.resolve(reply.value);
        else waiting.reject(new Error(reply.error || "window RPC failed"));
      })
      .then((un) => {
        unlisteners.push(un);
      });
    return replyListener;
  };

  return {
    label: transport.label,

    async broadcast(channel, payload) {
      const envelope: BroadcastEnvelope = { from: transport.label, channel, payload };
      await transport.emit(EV_BROADCAST, envelope);
    },

    async onBroadcast(channel, handler) {
      const un = await transport.listen(EV_BROADCAST, (raw) => {
        const env = raw as BroadcastEnvelope;
        // Tauri delivers an emit to the sender as well; a window reacting to
        // its own broadcast would double every effect.
        if (!env || env.channel !== channel || env.from === transport.label) return;
        handler(env.payload as never, env.from);
      });
      unlisteners.push(un);
      return un;
    },

    async request(kind, args) {
      await ensureReplyListener();
      rpcCounter += 1;
      const id = `${transport.label}-${rpcCounter}-${Math.random().toString(36).slice(2, 8)}`;
      const envelope: RpcEnvelope = { from: transport.label, id, kind, args };
      const result = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`window RPC "${kind}" timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
      });
      await transport.emitTo(OWNER_LABEL, EV_RPC, envelope);
      return (await result) as never;
    },

    async handle(kind, handler) {
      const un = await transport.listen(EV_RPC, (raw) => {
        const env = raw as RpcEnvelope;
        if (!env || env.kind !== kind || env.from === transport.label) return;
        void (async () => {
          let reply: RpcReply;
          try {
            const value = await handler(env.args as never, env.from);
            reply = { id: env.id, ok: true, value };
          } catch (e) {
            // The caller gets the message, not a silent no-op: an aux window
            // whose write vanished must be able to say so.
            reply = { id: env.id, ok: false, error: e instanceof Error ? e.message : String(e) };
          }
          await transport.emitTo(env.from, EV_RPC_REPLY, reply).catch((e) => {
            console.error("[windowBus] could not deliver RPC reply", e);
          });
        })();
      });
      unlisteners.push(un);
      return un;
    },

    async dispose() {
      for (const un of unlisteners.splice(0)) {
        try {
          un();
        } catch {
          /* a listener that is already gone is not a problem */
        }
      }
      for (const waiting of pending.values()) {
        clearTimeout(waiting.timer);
        waiting.reject(new Error("window bus disposed"));
      }
      pending.clear();
      replyListener = null;
    },
  };
}

/**
 * The real transport. Imported lazily inside the function so nothing from
 * `@tauri-apps/api` runs while this module is loading (C20 — that exact shape
 * shipped a white window twice).
 */
export async function createTauriTransport(): Promise<BusTransport> {
  const [{ emit, emitTo, listen }, { getCurrentWindow }] = await Promise.all([
    import("@tauri-apps/api/event"),
    import("@tauri-apps/api/window"),
  ]);
  const label = getCurrentWindow().label;
  return {
    label,
    emit: (event, payload) => emit(event, payload),
    emitTo: (target, event, payload) => emitTo(target, event, payload),
    listen: (event, handler) => listen(event, (e) => handler(e.payload)),
  };
}

let busPromise: Promise<WindowBus> | null = null;

/** The bus of this window. One per window, created on first use. */
export function getWindowBus(): Promise<WindowBus> {
  if (!busPromise) busPromise = createTauriTransport().then((t) => createWindowBus(t));
  return busPromise;
}

/** Test seam: install a fake bus (never called by the app). */
export function setWindowBusForTest(bus: WindowBus | null): void {
  busPromise = bus ? Promise.resolve(bus) : null;
}
