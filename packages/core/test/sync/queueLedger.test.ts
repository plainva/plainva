import { describe, expect, it } from "vitest";
import {
  QueueLedger,
  heldLedgerPaths,
  parseQueueLedger,
  replayQueueLedger,
  serializeQueueLedger,
  type QueueLedgerEntry,
  type QueueLedgerStore,
  type QueueLedgerTarget,
} from "../../src/sync/queueLedger.ts";
import { QueueingVaultAdapter } from "../../src/vault/QueueingVaultAdapter.ts";
import { MemoryVaultAdapter } from "../helpers/memoryVault.ts";

/** The sync entries of a vault whose database did not open (stability plan R5). */

const REMOTE = "webdav:https://dav.example/notes";

function memoryStore(initial: string | null = null) {
  const state = { text: initial, asides: [] as string[], failSaves: 0, failClear: false, failSetAside: false };
  const store: QueueLedgerStore = {
    load: async () => state.text,
    save: async (text) => {
      if (state.failSaves > 0) { state.failSaves--; throw new Error("disk full"); }
      state.text = text;
    },
    clear: async () => {
      if (state.failClear) throw new Error("still there");
      state.text = null;
    },
    setAside: async () => {
      if (state.failSetAside) throw new Error("cannot move");
      if (state.text !== null) state.asides.push(state.text);
      state.text = null;
    },
  };
  return { store, state };
}

const entriesOf = (text: string | null) => parseQueueLedger(text)?.entries ?? [];

/** A queue and a disk, modelled: what is handed over, and what is on disk after the pull. */
function target(onDisk: Iterable<string> = [], remote: Iterable<string> = []) {
  const disk = new Set(onDisk);
  const known = new Set(remote);
  const calls: string[] = [];
  const queuedRenames = new Set<string>();
  const t: QueueLedgerTarget & { calls: string[]; disk: Set<string>; failNext?: string; existsThrows?: string; notReady?: boolean } = {
    calls,
    disk,
    ready: () => !t.notReady,
    exists: async (p) => {
      if (t.existsThrows === p) throw new Error(`no answer for ${p}`);
      return disk.has(p);
    },
    knownRemote: async (p) => known.has(p),
    hasQueuedRename: async (a, b) => queuedRenames.has(`${a} -> ${b}`),
    queueWrite: async (p) => { guard(`write ${p}`); calls.push(`write ${p}`); },
    queueDeletePaths: async (ps, c) => { guard(`delete ${ps.join(",")}`); calls.push(`delete ${ps.join(",")}${c?.confirmed ? " confirmed" : ""}`); },
    queueRename: async (a, b) => { guard(`rename ${a} -> ${b}`); queuedRenames.add(`${a} -> ${b}`); calls.push(`rename ${a} -> ${b}`); },
    queueMkdir: async (p) => { guard(`mkdir ${p}`); calls.push(`mkdir ${p}`); },
  };
  const guard = (call: string) => {
    if (t.failNext && call.startsWith(t.failNext)) { t.failNext = undefined; throw new Error("database is locked"); }
  };
  return t;
}

const ledger = (entries: QueueLedgerEntry[], binding = REMOTE) => serializeQueueLedger(binding, entries);

describe("QueueLedger", () => {
  it("keeps what the chain queues, in order, through the same adapter the real queue sits behind", async () => {
    const { store, state } = memoryStore();
    const vault = new MemoryVaultAdapter(1_000);
    await vault.writeTextFile("Old.md", "x");
    await vault.writeTextFile("Gone.md", "y");
    const chain = new QueueingVaultAdapter(vault, new QueueLedger(store, REMOTE));
    await chain.writeTextFile("A.md", "a");
    await chain.createDir("Folder");
    await chain.renameItem("Old.md", "Folder/New.md");
    await chain.deleteItem("Gone.md", false, { confirmed: true });
    // Device-local files never travel, as with the real queue.
    await chain.writeTextFile(".plainva/bookmarks.json", "[]");
    expect(parseQueueLedger(state.text)).toEqual({
      binding: REMOTE,
      entries: [
        { op: "write", path: "A.md" },
        { op: "mkdir", path: "Folder" },
        { op: "rename", from: "Old.md", to: "Folder/New.md" },
        { op: "delete", paths: ["Gone.md"], confirmed: true },
      ],
    });
  });

  it("adds to the ledger an earlier start left", async () => {
    const { store, state } = memoryStore(ledger([{ op: "delete", paths: ["First.md"] }]));
    await new QueueLedger(store, REMOTE).queueWrite("Second.md");
    expect(entriesOf(state.text)).toEqual([{ op: "delete", paths: ["First.md"] }, { op: "write", path: "Second.md" }]);
  });

  it("never writes back entries a replay handed over (it reads the file at every append)", async () => {
    const { store, state } = memoryStore();
    const appender = new QueueLedger(store, REMOTE);
    await appender.queueDeletePaths(["C.md"]);
    await replayQueueLedger(store, target(), { binding: REMOTE });
    expect(state.text).toBeNull();
    await appender.queueWrite("Later.md");
    expect(entriesOf(state.text)).toEqual([{ op: "write", path: "Later.md" }]);
  });

  it("stays as long as the list of things changed: a save adds nothing where a write is already recorded", async () => {
    const { store, state } = memoryStore();
    const appender = new QueueLedger(store, REMOTE);
    for (let i = 0; i < 1000; i++) await appender.queueWrite("Inbox.md");
    await appender.queueRename("Inbox.md", "Done.md");
    await appender.queueWrite("Inbox.md");
    await appender.queueWrite("Inbox.md");
    expect(entriesOf(state.text)).toEqual([
      { op: "write", path: "Inbox.md" },
      { op: "rename", from: "Inbox.md", to: "Done.md" },
      { op: "write", path: "Inbox.md" },
    ]);
  });

  it("never fails the save that made the entry: a failure goes to onFailure, and the next append starts from the file", async () => {
    const { store, state } = memoryStore();
    const failures: unknown[] = [];
    const appender = new QueueLedger(store, REMOTE, { onFailure: (e) => failures.push(e) });
    await appender.queueWrite("A.md");
    state.failSaves = 1;
    await expect(appender.queueWrite("B.md")).resolves.toBeUndefined();
    await appender.queueWrite("C.md");
    expect(entriesOf(state.text).map((e) => (e.op === "write" ? e.path : e.op))).toEqual(["A.md", "C.md"]);
    expect(failures).toHaveLength(1);
  });

  it("sets an unreadable ledger aside and begins a new one, saying so", async () => {
    const { store, state } = memoryStore("{ torn");
    const failures: unknown[] = [];
    await new QueueLedger(store, REMOTE, { onFailure: (e) => failures.push(e) }).queueWrite("A.md");
    expect(state.asides).toEqual(["{ torn"]);
    expect(entriesOf(state.text)).toEqual([{ op: "write", path: "A.md" }]);
    expect(failures).toHaveLength(1);
  });

  it("does not mix a ledger of another remote into this one", async () => {
    const other = ledger([{ op: "delete", paths: ["X.md"] }], "webdav:https://old.example");
    const { store, state } = memoryStore(other);
    await new QueueLedger(store, REMOTE).queueWrite("A.md");
    expect(state.asides).toEqual([other]);
    expect(parseQueueLedger(state.text)).toEqual({ binding: REMOTE, entries: [{ op: "write", path: "A.md" }] });
  });

  it("appends one at a time when entries come together", async () => {
    const { store, state } = memoryStore();
    const appender = new QueueLedger(store, REMOTE);
    await Promise.all(["1.md", "2.md", "3.md"].map((p) => appender.queueWrite(p)));
    expect(entriesOf(state.text)).toHaveLength(3);
  });
});

describe("parseQueueLedger and heldLedgerPaths", () => {
  it("refuse a text they cannot read instead of taking it for an empty ledger", () => {
    expect(parseQueueLedger(null)).toBeNull();
    expect(() => parseQueueLedger("{ broken")).toThrow(/not JSON/);
    expect(() => parseQueueLedger(JSON.stringify({ version: 1, entries: [] }))).toThrow(/unknown format/);
    expect(() => parseQueueLedger(JSON.stringify({ version: 2, binding: REMOTE, entries: [{ op: "write" }] }))).toThrow(/without a path/);
    expect(() => parseQueueLedger(JSON.stringify({ version: 2, binding: REMOTE, entries: [{ op: "chmod", path: "x" }] }))).toThrow(/unknown entry/);
  });

  it("name the paths a ledger still owes a deletion or a rename for", () => {
    const text = ledger([{ op: "write", path: "W.md" }, { op: "delete", paths: ["C.md"] }, { op: "rename", from: "A.md", to: "B.md" }]);
    expect([...heldLedgerPaths(text)].sort()).toEqual(["A.md", "B.md", "C.md"]);
    expect(heldLedgerPaths("{ torn").size).toBe(0);
  });
});

describe("replayQueueLedger", () => {
  it("hands every entry to the queue in order, then removes the ledger", async () => {
    const { store, state } = memoryStore(ledger([
      { op: "write", path: "A.md" },
      { op: "rename", from: "B.md", to: "C.md" },
      { op: "delete", paths: ["E.md"], confirmed: true },
      { op: "mkdir", path: "D" },
    ]));
    const t = target(["A.md", "C.md", "D"]);
    expect((await replayQueueLedger(store, t, { binding: REMOTE })).handed).toBe(4);
    expect(t.calls).toEqual(["write A.md", "rename B.md -> C.md", "delete E.md confirmed", "mkdir D"]);
    expect(state.text).toBeNull();
  });

  it("hands each entry over at most once: a replay that stops keeps only what it did not reach, and a sync and a restore later delete nothing again", async () => {
    // The reviewer's sequence: delete C, rename A -> B, delete D; the check of D fails.
    const { store, state } = memoryStore(ledger([
      { op: "delete", paths: ["C.md"] },
      { op: "rename", from: "A.md", to: "B.md" },
      { op: "delete", paths: ["D.md"] },
    ]));
    const first = target(["B.md"]);
    first.existsThrows = "D.md";
    // One entry per step, so the stop falls between hand-overs.
    const stopped = await replayQueueLedger(store, first, { binding: REMOTE, step: 1 });
    expect(stopped.stoppedBy).toBeInstanceOf(Error);
    expect(first.calls).toEqual(["delete C.md", "rename A.md -> B.md"]);
    expect(entriesOf(state.text)).toEqual([{ op: "delete", paths: ["D.md"] }]);
    // The sync pushes both; another device restores C.md, the pull brings it here.
    // The next start: only D is left to hand over, and C stays.
    const second = target(["B.md", "C.md"]);
    const done = await replayQueueLedger(store, second, { binding: REMOTE, step: 1 });
    expect(second.calls).toEqual(["delete D.md"]);
    expect(done.handed).toBe(1);
    expect(state.text).toBeNull();
  });

  it("hands nothing of a step whose shortened ledger cannot be written", async () => {
    const { store, state } = memoryStore(ledger([{ op: "delete", paths: ["C.md"] }]));
    state.failSaves = 1;
    const t = target();
    const result = await replayQueueLedger(store, t, { binding: REMOTE });
    expect(t.calls).toEqual([]);
    expect(result.stoppedBy).toBeInstanceOf(Error);
    expect(entriesOf(state.text)).toEqual([{ op: "delete", paths: ["C.md"] }]);
  });

  it("drops an entry whose hand-over fails after it left the ledger, and says so, rather than hand it over twice", async () => {
    const { store, state } = memoryStore(ledger([{ op: "delete", paths: ["C.md"] }, { op: "write", path: "W.md" }]));
    const t = target(["W.md"]);
    t.failNext = "delete";
    const result = await replayQueueLedger(store, t, { binding: REMOTE });
    expect(result.dropped).toEqual([{ op: "delete", paths: ["C.md"] }, { op: "write", path: "W.md" }]);
    expect(result.stoppedBy).toBeInstanceOf(Error);
    expect(entriesOf(state.text)).toEqual([]);
    // Nothing is replayed at the next start.
    const again = target(["W.md"]);
    await replayQueueLedger(store, again, { binding: REMOTE });
    expect(again.calls).toEqual([]);
  });

  it("never replays a ledger handed over completely, even when its removal fails", async () => {
    const { store, state } = memoryStore(ledger([{ op: "delete", paths: ["C.md"] }]));
    state.failClear = true;
    const first = target();
    await replayQueueLedger(store, first, { binding: REMOTE });
    expect(first.calls).toEqual(["delete C.md"]);
    expect(entriesOf(state.text)).toEqual([]);
    const second = target();
    await replayQueueLedger(store, second, { binding: REMOTE });
    expect(second.calls).toEqual([]);
  });

  it("is never replayed into another remote: a ledger of another folder is set aside", async () => {
    const text = ledger([{ op: "delete", paths: ["C.md"] }], "webdav:https://old.example");
    const { store, state } = memoryStore(text);
    const t = target();
    expect((await replayQueueLedger(store, t, { binding: REMOTE })).setAside).toBe("other-remote");
    expect(t.calls).toEqual([]);
    expect(state.asides).toEqual([text]);
    expect(state.text).toBeNull();
  });

  it("sets an unreadable ledger aside instead of reading it again at every start", async () => {
    const { store, state } = memoryStore("{ broken");
    expect((await replayQueueLedger(store, target(), { binding: REMOTE })).setAside).toBe("unreadable");
    expect(state.asides).toEqual(["{ broken"]);
    expect(state.text).toBeNull();
  });

  it("leaves the ledger as it is when the queue cannot decide yet (a workspace whose runtime is not open)", async () => {
    const text = ledger([{ op: "delete", paths: ["C.md"] }]);
    const { store, state } = memoryStore(text);
    const t = target();
    t.notReady = true;
    const result = await replayQueueLedger(store, t, { binding: REMOTE });
    expect(result.stoppedBy).toBeInstanceOf(Error);
    expect(t.calls).toEqual([]);
    expect(state.text).toBe(text);
  });

  it("does not delete or move what came back with the pull: another device changed it meanwhile", async () => {
    const { store } = memoryStore(ledger([
      { op: "delete", paths: ["Back.md", "Gone.md"] },
      { op: "rename", from: "Old.md", to: "New.md" },
    ]));
    // Back.md and Old.md are on disk again: the pull of this cycle brought another device's version.
    const t = target(["Back.md", "Old.md", "New.md"]);
    const result = await replayQueueLedger(store, t, { binding: REMOTE });
    expect(t.calls).toEqual(["delete Gone.md"]);
    expect(result.skipped).toEqual(["Back.md", "Old.md"]);
  });

  it("moves nothing onto a name the remote holds already: the old name goes, the new one stays as the pull met it", async () => {
    const { store } = memoryStore(ledger([{ op: "rename", from: "A.md", to: "B.md" }]));
    const t = target(["B.md"], ["B.md"]);
    await replayQueueLedger(store, t, { binding: REMOTE });
    expect(t.calls).toEqual(["delete A.md"]);
  });

  it("carries a rename and a later deletion of the new name together, and does a rename it reached before only once", async () => {
    const { store } = memoryStore(ledger([{ op: "rename", from: "A.md", to: "B.md" }, { op: "delete", paths: ["B.md"] }]));
    const t = target();
    await replayQueueLedger(store, t, { binding: REMOTE });
    expect(t.calls).toEqual(["rename A.md -> B.md", "delete B.md"]);
  });

  it("does nothing without a ledger", async () => {
    const { store } = memoryStore();
    const t = target();
    expect((await replayQueueLedger(store, t, { binding: REMOTE })).handed).toBe(0);
    expect(t.calls).toEqual([]);
  });
});
