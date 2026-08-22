// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { IVaultAdapter } from "@plainva/core";

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
import { resetWindowRegistryForTest, setOwnerOpenContents } from "./windowManager";

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

async function setup(opts: { metaChanged?: boolean; auxTimeoutMs?: number } = {}) {
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

  const dispose = await installOwnerBus({
    vaultPath: "/vault",
    vaultAdapter: createAdapter(calls),
    indexer: indexer as never,
    refresh: (paths) => refreshed.push(paths),
  });

  return { aux, calls, refreshed, indexed, dispose };
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
