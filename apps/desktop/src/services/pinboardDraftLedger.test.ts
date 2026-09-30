// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  answerEditorPathProbe,
  discardPinboardEntry,
  finalizePinboardEntry,
  pinboardDraftHash,
  pinboardDraftKey,
  pinboardDraftLedger,
  planPinboardEntry,
  sweepPinboardDrafts,
  type DraftLedgerStorage,
  type PinboardEntryFiles,
} from "@plainva/ui";

/**
 * What an app that was closed or killed during a pinboard entry left behind
 * (plan Befunde 2026-09-24, E15). The draft is a real file from the moment the
 * entry opens; closing an EMPTY entry takes it back — and an app that went
 * away never closed it. The ledger remembers each draft with a hash of exactly
 * the bytes Plainva wrote, and the sweep finishes what is left: unchanged →
 * removed, changed → kept, gone → forgotten, open → untouched.
 */

const encoder = new TextEncoder();

function memoryStorage(initial: Record<string, string> = {}): DraftLedgerStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

function memoryFiles(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const removed: string[] = [];
  const files: PinboardEntryFiles = {
    exists: async (p) => store.has(p),
    read: async (p) => {
      const v = store.get(p);
      if (v === undefined) throw new Error(`missing ${p}`);
      return v;
    },
    readBytes: async (p) => {
      const v = store.get(p);
      if (v === undefined) throw new Error(`missing ${p}`);
      return encoder.encode(v);
    },
    write: async (p, c) => void store.set(p, c),
    rename: async (p, stem) => {
      const next = `${p.slice(0, p.lastIndexOf("/") + 1)}${stem}.md`;
      store.set(next, store.get(p)!);
      store.delete(p);
      return next;
    },
    remove: async (p) => {
      removed.push(p);
      store.delete(p);
    },
  };
  return { files, store, removed };
}

const DRAFT = "---\ntype: Note\ntags:\n  - zettel\n---\n";
const A = "Zettel/2026-09-24 09.12.05.md";
const B = "Zettel/2026-09-24 09.13.00.md";

/** A ledger as a previous run of the app left it: on record, open nowhere. */
function leftOver(entries: Array<{ path: string; content: string }>, vault = "V") {
  return memoryStorage(Object.fromEntries(entries.map((e) => [pinboardDraftKey(vault, e.path), JSON.stringify({ path: e.path, sha256: pinboardDraftHash(e.content), at: 1 })])));
}

describe("sweepPinboardDrafts: finishing what a crash left", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a draft still byte-identical to what Plainva wrote is removed through the ordinary delete, and forgotten", async () => {
    const { files, store, removed } = memoryFiles({ [A]: DRAFT });
    const ledger = pinboardDraftLedger("V", leftOver([{ path: A, content: DRAFT }]));
    expect(await sweepPinboardDrafts(files, ledger)).toEqual({ removed: [A], kept: [], forgotten: [], open: [] });
    expect(removed).toEqual([A]);
    expect(store.has(A)).toBe(false);
    expect(ledger.list()).toEqual([]);
  });

  it("a draft that changed in any way — typed text, a sync from another device — is kept and only forgotten", async () => {
    const { files, store, removed } = memoryFiles({ [A]: DRAFT + "Kaffee\n", [B]: DRAFT.replace("zettel", "zettel\n  - sync") });
    const ledger = pinboardDraftLedger("V", leftOver([{ path: A, content: DRAFT }, { path: B, content: DRAFT }]));
    expect(await sweepPinboardDrafts(files, ledger)).toEqual({ removed: [], kept: [A, B], forgotten: [], open: [] });
    expect(removed).toEqual([]);
    expect(store.get(A)).toBe(DRAFT + "Kaffee\n");
    expect(ledger.list()).toEqual([]);
  });

  it("even one byte decides: a line ending changed on the way counts as changed", async () => {
    const { files, removed } = memoryFiles({ [A]: DRAFT.replace(/\n/g, "\r\n") });
    const ledger = pinboardDraftLedger("V", leftOver([{ path: A, content: DRAFT }]));
    expect((await sweepPinboardDrafts(files, ledger)).kept).toEqual([A]);
    expect(removed).toEqual([]);
  });

  it("a draft that is gone — renamed or deleted elsewhere — is only forgotten", async () => {
    const { files, removed } = memoryFiles({ "Zettel/Umbenannt.md": DRAFT });
    const ledger = pinboardDraftLedger("V", leftOver([{ path: A, content: DRAFT }]));
    expect(await sweepPinboardDrafts(files, ledger)).toEqual({ removed: [], kept: [], forgotten: [A], open: [] });
    expect(removed).toEqual([]);
    expect(ledger.list()).toEqual([]);
  });

  it("nothing that was not remembered is ever removed — not even a file with the same bytes", async () => {
    const { files, store, removed } = memoryFiles({ [A]: DRAFT, [B]: DRAFT });
    const ledger = pinboardDraftLedger("V", leftOver([{ path: A, content: DRAFT }]));
    await sweepPinboardDrafts(files, ledger);
    expect(removed).toEqual([A]);
    expect(store.get(B)).toBe(DRAFT);
  });

  it("a draft that is open in an entry of this window is left alone and stays remembered", async () => {
    const { files, removed } = memoryFiles();
    const ledger = pinboardDraftLedger("V-open", memoryStorage());
    ledger.remember(A, DRAFT);
    await files.write(A, DRAFT);
    expect(await sweepPinboardDrafts(files, ledger)).toEqual({ removed: [], kept: [], forgotten: [], open: [A] });
    expect(removed).toEqual([]);
    expect(ledger.list().map((e) => e.path)).toEqual([A]);
    // Once the entry has ended, it is none of the sweep's business any more.
    ledger.forget(A);
    expect(ledger.list()).toEqual([]);
  });

  it("a draft an editor of this window shows is left alone", async () => {
    const { files, removed } = memoryFiles({ [A]: DRAFT });
    const ledger = pinboardDraftLedger("V", leftOver([{ path: A, content: DRAFT }]));
    const stop = answerEditorPathProbe(() => ({ vaultKey: "V", path: A }));
    try {
      expect((await sweepPinboardDrafts(files, ledger)).open).toEqual([A]);
      expect(removed).toEqual([]);
    } finally {
      stop();
    }
    // An editor of ANOTHER vault that shows the same path does not count.
    const other = answerEditorPathProbe(() => ({ vaultKey: "W", path: A }));
    try {
      expect((await sweepPinboardDrafts(files, ledger)).removed).toEqual([A]);
    } finally {
      other();
    }
  });

  it("a draft whose entry is open in another window of the app (a held Web Lock) is left alone", async () => {
    const { files, removed } = memoryFiles({ [A]: DRAFT });
    const ledger = pinboardDraftLedger("V", leftOver([{ path: A, content: DRAFT }]));
    vi.stubGlobal("navigator", {
      locks: {
        request: () => new Promise(() => {}),
        query: async () => ({ held: [{ name: `plainva-pinboard-draft:V:${A}` }] }),
      },
    });
    expect((await sweepPinboardDrafts(files, ledger)).open).toEqual([A]);
    expect(removed).toEqual([]);
  });

  it("an entry holds a Web Lock from remember to forget", async () => {
    const releases: string[] = [];
    const granted: string[] = [];
    vi.stubGlobal("navigator", {
      locks: {
        request: (name: string, cb: () => Promise<void>) => {
          granted.push(name);
          return cb().then(() => void releases.push(name));
        },
      },
    });
    const ledger = pinboardDraftLedger("V-lock", memoryStorage());
    ledger.remember(A, DRAFT);
    expect(granted).toEqual([`plainva-pinboard-draft:V-lock:${A}`]);
    await Promise.resolve();
    expect(releases).toEqual([]);
    ledger.forget(A);
    await new Promise((r) => setTimeout(r, 0));
    expect(releases).toEqual([`plainva-pinboard-draft:V-lock:${A}`]);
  });

  it("a step that fails leaves the draft remembered, and the next sweep finishes it", async () => {
    const { files, removed } = memoryFiles({ [A]: DRAFT });
    const ledger = pinboardDraftLedger("V", leftOver([{ path: A, content: DRAFT }]));
    const failing: PinboardEntryFiles = { ...files, remove: async () => { throw new Error("locked"); } };
    expect(await sweepPinboardDrafts(failing, ledger)).toEqual({ removed: [], kept: [], forgotten: [], open: [] });
    expect(ledger.list().map((e) => e.path)).toEqual([A]);
    const unreadable: PinboardEntryFiles = { ...files, readBytes: async () => { throw new Error("busy"); } };
    await sweepPinboardDrafts(unreadable, ledger);
    expect(ledger.list().map((e) => e.path)).toEqual([A]);
    expect((await sweepPinboardDrafts(files, ledger)).removed).toEqual([A]);
    expect(removed).toEqual([A]);
  });

  it("each vault keeps its own record — also a vault whose name continues another's", async () => {
    const entry = (path: string) => JSON.stringify({ path, sha256: pinboardDraftHash(DRAFT), at: 1 });
    const storage = memoryStorage({
      [pinboardDraftKey("V", A)]: entry(A),
      [pinboardDraftKey("W", B)]: entry(B),
      // Vault "V:Zettel" shares the key prefix of vault "V".
      [pinboardDraftKey("V:Zettel", B)]: entry(B),
      "plainva-other-setting": "keep",
    });
    const { files, removed } = memoryFiles({ [A]: DRAFT, [B]: DRAFT });
    await sweepPinboardDrafts(files, pinboardDraftLedger("V", storage));
    expect(removed).toEqual([A]);
    expect(pinboardDraftLedger("W", storage).list().map((e) => e.path)).toEqual([B]);
    expect(pinboardDraftLedger("V:Zettel", storage).list().map((e) => e.path)).toEqual([B]);
    expect(storage.data.get("plainva-other-setting")).toBe("keep");
  });

  it("each draft is its own key: an entry ended in one window cannot come back through another", () => {
    const storage = memoryStorage();
    const here = pinboardDraftLedger("V-two", storage);
    const there = pinboardDraftLedger("V-two", storage);
    here.remember(A, DRAFT);
    there.remember(B, DRAFT);
    here.forget(A);
    expect(there.list().map((e) => e.path)).toEqual([B]);
    there.forget(B);
    expect(storage.data.size).toBe(0);
  });

  it("a storage that is missing, refuses or holds garbage costs nothing but the clean-up", async () => {
    const none = pinboardDraftLedger("V", null);
    none.remember(A, DRAFT);
    expect(none.list()).toEqual([]);
    none.forget(A);
    const refusing: DraftLedgerStorage = {
      get length(): number { throw new Error("blocked"); },
      key: () => { throw new Error("blocked"); },
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("quota"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    const blocked = pinboardDraftLedger("V", refusing);
    blocked.remember(B, DRAFT);
    expect(blocked.list()).toEqual([]);
    blocked.forget(B);
    const garbage = pinboardDraftLedger("V", memoryStorage({ [pinboardDraftKey("V", A)]: "{not json", [pinboardDraftKey("V", B)]: JSON.stringify({ path: 3 }) }));
    expect(garbage.list()).toEqual([]);
    // An entry filed under another path's key is not trusted either.
    const misfiled = pinboardDraftLedger("V", memoryStorage({ [pinboardDraftKey("V", A)]: JSON.stringify({ path: B, sha256: "x", at: 1 }) }));
    expect(misfiled.list()).toEqual([]);
  });
});

describe("the entry and the ledger", () => {
  const config = { filters: { and: ['file.hasTag("zettel")', 'file.folder == "Zettel"'] }, views: [{ type: "table", name: "P" }] };
  const plan = (files: PinboardEntryFiles, ledger: ReturnType<typeof pinboardDraftLedger>, now: Date) =>
    planPinboardEntry(files, { config, viewIndex: 0, activeLabels: [], labelProperty: null, noteType: "Note", now, ledger });

  it("the next plan finishes a crash's leftover first, then remembers its own draft with the bytes it wrote", async () => {
    const leftover = "Zettel/2026-09-23 18.00.00.md";
    const { files, store, removed } = memoryFiles({ [leftover]: DRAFT });
    const storage = leftOver([{ path: leftover, content: DRAFT }], "V-plan");
    const ledger = pinboardDraftLedger("V-plan", storage);
    const result = await plan(files, ledger, new Date(2026, 8, 24, 9, 12, 5));
    expect(removed).toEqual([leftover]);
    expect(store.has(leftover)).toBe(false);
    if (result.status !== "ready") throw new Error(result.status);
    expect(ledger.list()).toEqual([{ path: result.draft.path, sha256: pinboardDraftHash(store.get(result.draft.path)!), at: expect.any(Number) }]);
  });

  it("finalize forgets the entry whether it was kept or taken back; a close that failed stays remembered", async () => {
    const { files } = memoryFiles();
    const ledger = pinboardDraftLedger("V-end", memoryStorage());
    const r1 = await plan(files, ledger, new Date(2026, 8, 24, 10, 0, 0));
    const r2 = await plan(files, ledger, new Date(2026, 8, 24, 10, 0, 1));
    const r3 = await plan(files, ledger, new Date(2026, 8, 24, 10, 0, 2));
    if (r1.status !== "ready" || r2.status !== "ready" || r3.status !== "ready") throw new Error("not ready");
    expect(ledger.list()).toHaveLength(3);
    await finalizePinboardEntry(files, { draft: r1.draft, title: "", intent: "close", ledger });
    await finalizePinboardEntry(files, { draft: r2.draft, title: "Behalten", intent: "save", ledger });
    const broken: PinboardEntryFiles = { ...files, write: async () => { throw new Error("disk full"); } };
    await expect(finalizePinboardEntry(broken, { draft: r3.draft, title: "Neu", intent: "close", ledger })).rejects.toThrow("disk full");
    expect(ledger.list().map((e) => e.path)).toEqual([r3.draft.path]);
  });

  it("a save is forgotten before it writes: a saved template nobody typed into is never taken for a leftover", async () => {
    const { files, store, removed } = memoryFiles();
    const storage = memoryStorage();
    const ledger = pinboardDraftLedger("V-save", storage);
    const withTemplate = await planPinboardEntry(files, {
      config, viewIndex: 0, activeLabels: [], labelProperty: null, noteType: "Note", now: new Date(2026, 8, 24, 13, 0, 0), ledger,
      template: async () => ({ text: "- [ ] \n", caret: null }),
    });
    if (withTemplate.status !== "ready") throw new Error(withTemplate.status);
    // The app goes away in the middle of the save: after the decision, before its end.
    let seen: string[] = ["not read"];
    const interrupted: PinboardEntryFiles = { ...files, read: async (p) => { seen = ledger.list().map((e) => e.path); throw new Error(`gone mid-save ${p}`); } };
    await finalizePinboardEntry(interrupted, { draft: withTemplate.draft, title: "", intent: "save", ledger }).catch(() => {});
    expect(seen).toEqual([]);
    // The next start finds nothing of it on record, and the saved note stays.
    await sweepPinboardDrafts(files, pinboardDraftLedger("V-save", storage));
    expect(removed).toEqual([]);
    expect(store.get(withTemplate.draft.path)).toBe(withTemplate.draft.initial);
  });

  it("Discard forgets only an entry it removed", async () => {
    const { files, store } = memoryFiles();
    const ledger = pinboardDraftLedger("V-discard", memoryStorage());
    const r = await plan(files, ledger, new Date(2026, 8, 24, 11, 0, 0));
    if (r.status !== "ready") throw new Error(r.status);
    store.set(r.draft.path, store.get(r.draft.path)! + "Text\n");
    expect(await discardPinboardEntry(files, { draft: r.draft, title: "", confirm: async () => false, ledger })).toBe("kept");
    expect(ledger.list()).toHaveLength(1);
    expect(await discardPinboardEntry(files, { draft: r.draft, title: "", confirm: async () => true, ledger })).toBe("removed");
    expect(ledger.list()).toEqual([]);
  });

  it("a draft whose write fails is not left on record", async () => {
    const { files } = memoryFiles();
    const ledger = pinboardDraftLedger("V-write", memoryStorage());
    const broken: PinboardEntryFiles = { ...files, write: async () => { throw new Error("read-only"); } };
    await expect(plan(broken, ledger, new Date(2026, 8, 24, 12, 0, 0))).rejects.toThrow("read-only");
    expect(ledger.list()).toEqual([]);
  });
});
