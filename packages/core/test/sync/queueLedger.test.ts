import { describe, expect, it } from "vitest";
import { QueueLedger, parseQueueLedger, replayQueueLedger, serializeQueueLedger, type QueueLedgerStore, type QueueLedgerTarget } from "../../src/sync/queueLedger.ts";
import { QueueingVaultAdapter } from "../../src/vault/QueueingVaultAdapter.ts";
import { MemoryVaultAdapter } from "../helpers/memoryVault.ts";

/** The sync entries of a vault whose database did not open (stability plan R5). */

function memoryStore(initial: string | null = null) {
  const state = { text: initial, saves: 0, failNextSave: false, failClear: false };
  const store: QueueLedgerStore = {
    load: async () => state.text,
    save: async (text) => {
      if (state.failNextSave) { state.failNextSave = false; throw new Error("disk full"); }
      state.saves++;
      state.text = text;
    },
    clear: async () => {
      if (state.failClear) throw new Error("still there");
      state.text = null;
    },
  };
  return { store, state };
}

function recordingTarget(queued: string[] = [], onDisk: string[] = ["A.md", "C.md", "D"]): QueueLedgerTarget & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    exists: async (p) => onDisk.includes(p),
    queueWrite: async (p) => { calls.push(`write ${p}`); },
    queueDeletePaths: async (ps, c) => { calls.push(`delete ${ps.join(",")}${c?.confirmed ? " confirmed" : ""}`); },
    queueRename: async (a, b) => { calls.push(`rename ${a} -> ${b}`); },
    queueMkdir: async (p) => { calls.push(`mkdir ${p}`); },
    hasQueuedRename: async (a, b) => queued.includes(`${a} -> ${b}`),
  };
}

describe("QueueLedger", () => {
  it("keeps what the chain queues, in order, through the same adapter the real queue sits behind", async () => {
    const { store, state } = memoryStore();
    const vault = new MemoryVaultAdapter(1_000);
    await vault.writeTextFile("Old.md", "x");
    await vault.writeTextFile("Gone.md", "y");
    const chain = new QueueingVaultAdapter(vault, new QueueLedger(store));
    await chain.writeTextFile("A.md", "a");
    await chain.createDir("Folder");
    await chain.renameItem("Old.md", "Folder/New.md");
    await chain.deleteItem("Gone.md", false, { confirmed: true });
    // Device-local files never travel, as with the real queue.
    await chain.writeTextFile(".plainva/bookmarks.json", "[]");
    expect(parseQueueLedger(state.text)).toEqual([
      { op: "write", path: "A.md" },
      { op: "mkdir", path: "Folder" },
      { op: "rename", from: "Old.md", to: "Folder/New.md" },
      { op: "delete", paths: ["Gone.md"], confirmed: true },
    ]);
  });

  it("adds to the ledger an earlier start left", async () => {
    const { store, state } = memoryStore(serializeQueueLedger([{ op: "delete", paths: ["First.md"] }]));
    await new QueueLedger(store).queueWrite("Second.md");
    expect(parseQueueLedger(state.text)).toEqual([{ op: "delete", paths: ["First.md"] }, { op: "write", path: "Second.md" }]);
  });

  it("fails the entry whose save failed, and the next one starts from the file again", async () => {
    const { store, state } = memoryStore();
    const ledger = new QueueLedger(store);
    await ledger.queueWrite("A.md");
    state.failNextSave = true;
    await expect(ledger.queueWrite("B.md")).rejects.toThrow("disk full");
    await ledger.queueWrite("C.md");
    expect(parseQueueLedger(state.text).map((e) => (e.op === "write" ? e.path : e.op))).toEqual(["A.md", "C.md"]);
  });

  it("appends one at a time when entries come together", async () => {
    const { store, state } = memoryStore();
    const ledger = new QueueLedger(store);
    await Promise.all(["1.md", "2.md", "3.md"].map((p) => ledger.queueWrite(p)));
    expect(parseQueueLedger(state.text)).toHaveLength(3);
  });
});

describe("parseQueueLedger", () => {
  it("refuses a text it cannot read instead of taking it for an empty ledger", () => {
    expect(parseQueueLedger(null)).toEqual([]);
    expect(() => parseQueueLedger("{ broken")).toThrow();
    expect(() => parseQueueLedger(JSON.stringify({ version: 2, entries: [] }))).toThrow(/unknown format/);
    expect(() => parseQueueLedger(JSON.stringify({ version: 1, entries: [{ op: "write" }] }))).toThrow(/without a path/);
    expect(() => parseQueueLedger(JSON.stringify({ version: 1, entries: [{ op: "chmod", path: "x" }] }))).toThrow(/unknown entry/);
  });
});

describe("replayQueueLedger", () => {
  it("hands every entry to the queue in order, then removes the ledger", async () => {
    const { store, state } = memoryStore(serializeQueueLedger([
      { op: "write", path: "A.md" },
      { op: "rename", from: "B.md", to: "C.md" },
      { op: "delete", paths: ["E.md"], confirmed: true },
      { op: "mkdir", path: "D" },
    ]));
    const target = recordingTarget();
    expect(await replayQueueLedger(store, target)).toBe(4);
    expect(target.calls).toEqual(["write A.md", "rename B.md -> C.md", "delete E.md confirmed", "mkdir D"]);
    expect(state.text).toBeNull();
  });

  it("does a replay that ended early again without queueing its rename twice", async () => {
    const { store } = memoryStore(serializeQueueLedger([{ op: "rename", from: "B.md", to: "C.md" }, { op: "write", path: "C.md" }]));
    const target = recordingTarget(["B.md -> C.md"]);
    await replayQueueLedger(store, target);
    expect(target.calls).toEqual(["write C.md"]);
  });

  it("leaves a ledger it cannot read or hand over, and says so to the caller", async () => {
    const unreadable = memoryStore("{ broken");
    await expect(replayQueueLedger(unreadable.store, recordingTarget())).rejects.toThrow();
    expect(unreadable.state.text).toBe("{ broken");
    const refused = memoryStore(serializeQueueLedger([{ op: "write", path: "A.md" }]));
    const target = recordingTarget();
    target.queueWrite = async () => { throw new Error("database is locked"); };
    await expect(replayQueueLedger(refused.store, target)).rejects.toThrow("database is locked");
    expect(refused.state.text).not.toBeNull();
  });

  it("queues no deletion of a file that is back, and no rename whose old name is back", async () => {
    // An older version opened the vault in between and brought these back.
    const { store, state } = memoryStore(serializeQueueLedger([
      { op: "delete", paths: ["Back.md", "Gone.md"] },
      { op: "rename", from: "Old.md", to: "New.md" },
      { op: "rename", from: "X.md", to: "Missing.md" },
    ]));
    const target = recordingTarget([], ["Back.md", "Old.md", "New.md"]);
    await replayQueueLedger(store, target);
    expect(target.calls).toEqual(["delete Gone.md", "rename X.md -> Missing.md"]);
    expect(state.text).toBeNull();
  });

  it("carries a rename and a later deletion of the new name together", async () => {
    const { store } = memoryStore(serializeQueueLedger([{ op: "rename", from: "A.md", to: "B.md" }, { op: "delete", paths: ["B.md"] }]));
    const target = recordingTarget([], []);
    await replayQueueLedger(store, target);
    expect(target.calls).toEqual(["rename A.md -> B.md", "delete B.md"]);
  });

  it("does nothing without a ledger", async () => {
    const { store } = memoryStore();
    const target = recordingTarget();
    expect(await replayQueueLedger(store, target)).toBe(0);
    expect(target.calls).toEqual([]);
  });
});
