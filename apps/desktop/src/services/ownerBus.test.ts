// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { PimConflictError, type IVaultAdapter } from "@plainva/core";

/**
 * What happens to a mutation an auxiliary window hands over (multi-window P0/P1).
 *
 * The claim this file exists to keep honest: a delegated write goes through the
 * SAME adapter chain as the central window's own save — backup snapshot, sync
 * queue, conflict-aware merge — and lands in the index right away. A second
 * window writing past that chain would quietly undo the July 2026 sync
 * hardening, and nobody would notice until a file came back wrong.
 */

const focusedWindows: string[] = [];
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    async setFocus() {
      focusedWindows.push("main");
    },
  }),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class {
    label: string;
    constructor(label: string) {
      this.label = label;
    }
    async onCloseRequested() {
      return () => {};
    }
    static async getByLabel() {
      return null;
    }
  },
}));

const drafts: Array<{ kind: string; notePath: string; revision?: number }> = [];
vi.mock("./draftJournal", () => ({
  recordDraft: async (_v: string, notePath: string, _t: string, revision: number) => {
    drafts.push({ kind: "record", notePath, revision });
  },
  clearDraft: async (_v: string, notePath: string, upToRevision: number) => {
    drafts.push({ kind: "clear", notePath, revision: upToRevision });
  },
}));

const flushed: string[] = [];
vi.mock("./saveFlush", () => ({
  requestSaveFlush: async (path: string) => {
    flushed.push(path);
  },
}));

let busForTest: any = null;
vi.mock("./windowBus", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./windowBus")>();
  return { ...actual, getWindowBus: async () => busForTest };
});

import { createWindowBus, OWNER_LABEL, type BusTransport } from "./windowBus";
import { installOwnerBus } from "./ownerBus";
import {
  findWindowForContent,
  listAuxWindows,
  openAuxWindow,
  resetWindowRegistryForTest,
  setOwnerOpenContents,
} from "./windowManager";

function createWire() {
  const listeners = new Map<string, Set<{ label: string; fn: (p: unknown) => void }>>();
  return (label: string): BusTransport => ({
    label,
    async emit(event, payload) {
      for (const e of listeners.get(event) ?? []) e.fn(payload);
    },
    async emitTo(target, event, payload) {
      for (const e of listeners.get(event) ?? []) if (e.label === target) e.fn(payload);
    },
    async listen(event, handler) {
      const entry = { label, fn: handler };
      const set = listeners.get(event) ?? new Set();
      set.add(entry);
      listeners.set(event, set);
      return () => set.delete(entry);
    },
  });
}

/** Records the order in which the chain was touched. */
function createAdapter(calls: string[]): IVaultAdapter {
  return {
    initialize: async () => {},
    dispose: async () => {},
    readTextFile: async () => "",
    writeTextFile: async (path: string) => {
      calls.push("write:" + path);
    },
    readBinaryFile: async () => new Uint8Array(),
    writeBinaryFile: async (path: string) => {
      calls.push("write-binary:" + path);
    },
    deleteItem: async (path: string, recursive?: boolean) => {
      calls.push("delete:" + path + ":" + (recursive ? "recursive" : "single"));
    },
    renameItem: async (from: string, to: string) => {
      calls.push("rename:" + from + "->" + to);
    },
    createDir: async (path: string) => {
      calls.push("mkdir:" + path);
    },
    exists: async () => true,
    listDir: async () => [],
    getFileInfo: async (path: string) => {
      calls.push("getFileInfo:" + path);
      return { path, name: path, isDirectory: false, mtime: 4711, size: 3 };
    },
  } as unknown as IVaultAdapter;
}

/** A provider target that records what it was asked to do. */
function createPimTarget(calls: string[], opts: { conflict?: boolean } = {}) {
  return {
    provider: "caldav" as const,
    async createEvent(calendarId: string) {
      calls.push("createEvent:" + calendarId);
      return { uid: "new-uid", etag: "e1" };
    },
    async updateEvent() {
      if (opts.conflict) throw new PimConflictError();
      calls.push("updateEvent");
      return { etag: "e2" };
    },
    async deleteEvent() {
      calls.push("deleteEvent");
    },
    async respondToEvent(_ref: unknown, response: string) {
      calls.push("respond:" + response);
    },
  } as never;
}

async function setup(opts: { metaChanged?: boolean; auxTimeoutMs?: number; pimConflict?: boolean } = {}) {
  const wire = createWire();
  const owner = createWindowBus(wire(OWNER_LABEL));
  const aux = createWindowBus(wire("aux-1"), opts.auxTimeoutMs);
  busForTest = owner;

  const calls: string[] = [];
  const refreshed: Array<string[] | undefined> = [];
  const indexed: string[] = [];
  const indexer = {
    indexFile: async (info: { path: string; mtime: number }) => {
      indexed.push(info.path + "@" + info.mtime);
      return opts.metaChanged ?? false;
    },
    indexPath: async (path: string) => {
      calls.push("indexPath:" + path);
      return "ok" as never;
    },
    removePathFromIndex: async (path: string) => {
      calls.push("removeFromIndex:" + path);
    },
    indexVaultFull: async () => {
      calls.push("indexVaultFull");
    },
  };

  const triggered: string[] = [];
  const pimRuntime = {
    cache: { listAccounts: async () => [{ id: "acc-1", provider: "caldav", config: {} }] },
    buildTarget: async () => createPimTarget(calls, { conflict: opts.pimConflict }),
    worker: {
      start: () => {},
      stop: () => {},
      triggerImmediate: async () => {
        triggered.push("now");
      },
    },
    stop: () => {},
  } as never;

  const reindexed: string[] = [];
  const dispose = await installOwnerBus({
    vaultPath: "/vault",
    vaultAdapter: createAdapter(calls),
    indexer: indexer as never,
    pimRuntime,
    refresh: (paths) => refreshed.push(paths),
    refreshVault: async () => {
      reindexed.push("refresh");
    },
    rebuildIndex: async () => {
      reindexed.push("rebuild");
    },
  });

  return { aux, calls, refreshed, indexed, triggered, reindexed, dispose };
}

beforeEach(() => {
  resetWindowRegistryForTest();
  setOwnerOpenContents([]);
  focusedWindows.length = 0;
  drafts.length = 0;
  flushed.length = 0;
});

describe("delegated mutations", () => {
  it("writes through the owner's adapter and indexes the result", async () => {
    const { aux, calls, indexed, dispose } = await setup();

    await aux.request("write", { path: "Note.md", content: "hi" });

    expect(calls).toContain("write:Note.md");
    // Re-read AFTER the write, not the content that was sent: the conflict-aware
    // layer may have merged, and the index must match the file on disk.
    expect(calls.indexOf("getFileInfo:Note.md")).toBeGreaterThan(calls.indexOf("write:Note.md"));
    // The real mtime travels along, so the watcher can recognise its own echo.
    expect(indexed).toEqual(["Note.md@4711"]);
    dispose();
  });

  it("refreshes the views only when the metadata actually moved", async () => {
    const quiet = await setup({ metaChanged: false });
    await quiet.aux.request("write", { path: "Body.md", content: "prose" });
    // A pure prose edit deliberately skips the tree bump (fix C, 2026-07-08).
    expect(quiet.refreshed).toEqual([]);
    quiet.dispose();

    const loud = await setup({ metaChanged: true });
    await loud.aux.request("write", { path: "Meta.md", content: "---\ntitle: x\n---\n" });
    expect(loud.refreshed).toEqual([["Meta.md"]]);
    loud.dispose();
  });

  it("tells the other windows about a saved body", async () => {
    const { aux, dispose } = await setup();
    const heard: string[] = [];
    window.addEventListener("plainva-note-saved", (e) => heard.push((e as CustomEvent).detail.path));

    await aux.request("write", { path: "Card.md", content: "text" });

    // A pinboard card renders the BODY; without this it keeps the old text,
    // because a prose edit produces no index change to travel on.
    expect(heard).toEqual(["Card.md"]);
    dispose();
  });

  it("reconciles the whole index after a recursive delete", async () => {
    const { aux, calls, dispose } = await setup();

    await aux.request("delete", { path: "Folder", recursive: true });

    expect(calls).toContain("delete:Folder:recursive");
    // The descendants are unknown here, so patching single paths would leave
    // orphan rows behind.
    expect(calls).toContain("indexVaultFull");
    dispose();
  });

  it("patches just the one path for a single delete", async () => {
    const { aux, calls, dispose } = await setup();
    await aux.request("delete", { path: "Note.md" });
    expect(calls).toContain("removeFromIndex:Note.md");
    expect(calls).not.toContain("indexVaultFull");
    dispose();
  });

  it("moves the index entry with a rename", async () => {
    const { aux, calls, dispose } = await setup();
    await aux.request("rename", { from: "Old.md", to: "New.md" });
    expect(calls).toContain("rename:Old.md->New.md");
    expect(calls).toContain("removeFromIndex:Old.md");
    expect(calls).toContain("indexPath:New.md");
    dispose();
  });

  it("keeps the journal on the owner's side of the wire", async () => {
    const { aux, dispose } = await setup();

    await aux.request("draft-record", { vaultPath: "/vault", notePath: "A.md", text: "typed", revision: 7 });
    // An auxiliary window has no write access to app data, so a snapshot it
    // could not store would be a crash-safety promise that is not kept.
    expect(drafts).toEqual([{ kind: "record", notePath: "A.md", revision: 7 }]);

    await aux.request("draft-clear", { vaultPath: "/vault", notePath: "A.md", upToRevision: null });
    // `null` is how Infinity survives JSON — a forced clear, not "revision 0".
    expect(drafts[1]).toEqual({ kind: "clear", notePath: "A.md", revision: Infinity });
    dispose();
  });

  it("flushes a pending save in this window before the other one writes", async () => {
    const { aux, dispose } = await setup();
    await aux.request("flush-pending", { path: "Shared.md" });
    expect(flushed).toEqual(["Shared.md"]);
    dispose();
  });
});


describe("calendar writes from another window", () => {
  it("runs the provider call in the owner, with the owner's target", async () => {
    const { aux, calls, dispose } = await setup();

    const res = await aux.request("pim-write", {
      accountId: "acc-1",
      op: { kind: "createEvent", calendarId: "cal-1", draft: { title: "Standup", allDay: false, start: { ts: 1 }, end: { ts: 2 } } },
    });

    // One refresh token now serves files, calendar and mail of an account
    // (cloud accounts stage B): a second window renewing it in parallel
    // invalidates the whole account, so the round trip belongs here.
    expect(calls).toContain("createEvent:cal-1");
    expect(res).toEqual({ ok: true, uid: "new-uid", etag: "e1", href: undefined });
    dispose();
  });

  it("answers a moved remote with a value instead of an exception", async () => {
    const { aux, dispose } = await setup({ pimConflict: true });

    const res = await aux.request("pim-write", {
      accountId: "acc-1",
      op: { kind: "updateEvent", ref: { calendarId: "cal-1", uid: "u1" }, draft: { title: "x", allDay: false, start: { ts: 1 }, end: { ts: 2 } } },
    });

    // PimConflictError cannot survive JSON, and the caller's instanceof check
    // is what decides between "re-pull and reopen" and "show an error".
    expect(res).toEqual({ conflict: true });
    dispose();
  });

  it("forwards an RSVP", async () => {
    const { aux, calls, dispose } = await setup();
    await aux.request("pim-write", {
      accountId: "acc-1",
      op: { kind: "respondToEvent", ref: { calendarId: "cal-1", uid: "u1" }, response: "accepted" },
    });
    expect(calls).toContain("respond:accepted");
    dispose();
  });

  it("refuses an account this vault does not have", async () => {
    const { aux, dispose } = await setup();
    await expect(
      aux.request("pim-write", { accountId: "ghost", op: { kind: "deleteEvent", ref: { calendarId: "c", uid: "u" } } }),
    ).rejects.toThrow(/unknown calendar account/);
    dispose();
  });

  it("hands a refresh to the one worker there is", async () => {
    const { aux, triggered, dispose } = await setup();
    await aux.request("pim-refresh", {});
    // A poller per window would multiply provider traffic and write the same
    // cache tables from several sides.
    expect(triggered).toEqual(["now"]);
    dispose();
  });
});

describe("routing a request for content", () => {
  it("brings the central window forward when a tab holds the content", async () => {
    const { aux, dispose } = await setup();
    setOwnerOpenContents(["Tabbed.md"]);
    const shown: string[] = [];
    window.addEventListener("plainva-window-show-content", (e) =>
      shown.push((e as CustomEvent).detail.path),
    );

    const result = await aux.request("open-content", { path: "Tabbed.md", from: "aux-1" });

    expect(result).toEqual({ where: "owner" });
    expect(focusedWindows).toEqual(["main"]);
    expect(shown).toEqual(["Tabbed.md"]);
    dispose();
  });

  it("lets the asking window draw content nobody has", async () => {
    const { aux, dispose } = await setup();
    const result = await aux.request("open-content", { path: "Fresh.md", from: "aux-1" });
    expect(result).toEqual({ where: "caller" });
    expect(focusedWindows).toEqual([]);
    dispose();
  });
});

describe("the disposer", () => {
  it("stops answering after the vault changes", async () => {
    // A short timeout so the test measures "nobody answers" rather than the
    // production 15 s an auxiliary window is willing to wait.
    const { aux, calls, dispose } = await setup({ auxTimeoutMs: 50 });
    dispose();
    busForTest = null;

    // The handler is gone, so nothing writes through a chain that belongs to a
    // vault which is no longer open.
    await expect(aux.request("write", { path: "Stale.md", content: "x" })).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe("what an auxiliary window reports about itself (P4)", () => {
  it("makes its background tabs findable for dedup", async () => {
    const { aux, dispose } = await setup();
    const rec = await openAuxWindow({ role: "aux", vaultPath: "/vault", content: "One.md" });

    await aux.request("window-contents", { label: rec.label, active: "Two.md", contents: ["One.md", "Two.md"] });

    // The registry lives in the central window; without this report it would
    // only ever know the note a window was OPENED with, and every further tab
    // over there would be invisible to the "open once" rule.
    expect(findWindowForContent("/vault", "Two.md")?.label).toBe(rec.label);
    expect(findWindowForContent("/vault", "One.md")?.label).toBe(rec.label);
    dispose();
  });

  it("remembers a pin across a restart", async () => {
    const { aux, dispose } = await setup();
    const rec = await openAuxWindow({ role: "aux", vaultPath: "/vault", content: "Note.md" });

    await aux.request("window-always-on-top", { label: rec.label, value: true });

    // The pin belongs to the window, and the window list is what a restart
    // reads: a pin the central window never heard about would be gone.
    expect(listAuxWindows().find((w) => w.label === rec.label)?.alwaysOnTop).toBe(true);
    dispose();
  });
});

describe("re-reading the vault from a client window", () => {
  it("runs the cheap reconcile in the central window", async () => {
    const { aux, reindexed, dispose } = await setup();

    await aux.request("reindex", { scope: "refresh" });

    // The indexer belongs to the owner: a client holds a read-only connection
    // to the index by design, so the button in its tree header asks rather than
    // writes (multi-window C1).
    expect(reindexed).toEqual(["refresh"]);
    dispose();
  });

  it("runs the full rebuild in the central window", async () => {
    const { aux, reindexed, dispose } = await setup();

    await aux.request("reindex", { scope: "rebuild" });

    expect(reindexed).toEqual(["rebuild"]);
    dispose();
  });
});
