import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Encoding: { UTF8: "utf8" },
  Filesystem: {
    writeFile: vi.fn(async ({ path, data }: { path: string; data: string }) => {
      store.set(path, data);
    }),
    readFile: vi.fn(async ({ path }: { path: string }) => {
      if (!store.has(path)) throw new Error("not found");
      return { data: store.get(path)! };
    }),
    deleteFile: vi.fn(async ({ path }: { path: string }) => {
      store.delete(path);
    }),
    stat: vi.fn(async ({ path }: { path: string }) => {
      if (!store.has(path)) throw new Error("not found");
      return { type: "file", size: store.get(path)!.length, mtime: Date.now() };
    }),
    readdir: vi.fn(async ({ path }: { path: string }) => ({
      files: [...store.keys()]
        .filter((k) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes("/"))
        .map((k) => ({ name: k.slice(path.length + 1), type: "file", mtime: Date.now() })),
    })),
  },
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
  registerPlugin: () => ({}),
}));

import { adoptDraft, clearDraft, clearDraftIf, flushDrafts, offerDraft, readDraft, releaseLeftoverDrafts, relocateDrafts, relocatedPath, takeLeftoverDrafts, writeDraft } from "./draftJournal";

const vault = { vaultId: "local" } as any;

describe("draftJournal (M3E package G)", () => {
  beforeEach(() => {
    store.clear();
  });

  it("journals a scheduled text and reads it back", async () => {
    writeDraft(vault, "Inbox/Note.md", "hello draft");
    await new Promise((r) => setTimeout(r, 10)); // first write is immediate
    const d = await readDraft(vault, "Inbox/Note.md");
    expect(d?.text).toBe("hello draft");
    expect(typeof d?.ts).toBe("number");
  });

  it("throttles bursts but persists the LATEST text", async () => {
    writeDraft(vault, "a.md", "v1");
    writeDraft(vault, "a.md", "v2");
    writeDraft(vault, "a.md", "v3");
    await new Promise((r) => setTimeout(r, 500)); // past the 400ms throttle
    const d = await readDraft(vault, "a.md");
    expect(d?.text).toBe("v3");
  });

  it("clearDraft drops the journal entry (confirmed write)", async () => {
    writeDraft(vault, "b.md", "text");
    await new Promise((r) => setTimeout(r, 10));
    clearDraft(vault, "b.md");
    await new Promise((r) => setTimeout(r, 10));
    expect(await readDraft(vault, "b.md")).toBeNull();
  });

  it("keeps a draft that is newer than the write being confirmed (finding 2026-08-19)", async () => {
    writeDraft(vault, "c.md", "saved text", 1);
    await new Promise((r) => setTimeout(r, 10));
    // The user types on while the save is in flight...
    writeDraft(vault, "c.md", "typed while saving", 2);
    await new Promise((r) => setTimeout(r, 500));

    // ...and the older write comes back confirmed. Dropping the draft here
    // would throw away exactly the keystrokes the journal exists for.
    clearDraft(vault, "c.md", 1);
    await new Promise((r) => setTimeout(r, 10));
    expect((await readDraft(vault, "c.md"))?.text).toBe("typed while saving");

    // The confirmation for the newer text does clear it.
    clearDraft(vault, "c.md", 2);
    await new Promise((r) => setTimeout(r, 10));
    expect(await readDraft(vault, "c.md")).toBeNull();
  });

  it("discarding by hand forces the drop regardless of revision", async () => {
    writeDraft(vault, "d.md", "text", 7);
    await new Promise((r) => setTimeout(r, 10));
    clearDraft(vault, "d.md");
    await new Promise((r) => setTimeout(r, 10));
    expect(await readDraft(vault, "d.md")).toBeNull();
  });

  it("never writes the journal through a plain file write (finding 2026-08-19)", async () => {
    // A source guard, not a behaviour probe: on the web dev server the atomic
    // helper falls back to Filesystem.writeFile itself (IndexedDB commits
    // transactionally there), so no runtime assertion can tell the two apart.
    // What must hold is the CALL SITE — on a device the plain write is the one
    // a crash can tear in half.
    const src = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./draftJournal.ts", import.meta.url), "utf8"),
    );
    expect(src).toContain("atomicWriteText(");
    expect(src).not.toContain("Filesystem.writeFile");
  });
});

import { Filesystem } from "@capacitor/filesystem";
import type { MobileVault } from "./vaultService";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("ordered journal recovery", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps equal paths in two vaults independent through write, flush and clear", async () => {
    const a = { vaultId: "alpha" } as MobileVault;
    const b = { vaultId: "beta" } as MobileVault;
    writeDraft(a, "shared.md", "alpha", 1);
    writeDraft(b, "shared.md", "beta", 1);
    await flushDrafts();
    expect((await readDraft(a, "shared.md"))?.text).toBe("alpha");
    expect((await readDraft(b, "shared.md"))?.text).toBe("beta");
    clearDraft(a, "shared.md", 1);
    await new Promise((r) => setTimeout(r, 10));
    expect(await readDraft(a, "shared.md")).toBeNull();
    expect((await readDraft(b, "shared.md"))?.text).toBe("beta");
  });

  it("retains a failed atomic snapshot for the next explicit flush", async () => {
    const failed = gate();
    const original = Filesystem.writeFile;
    vi.spyOn(Filesystem, "writeFile").mockImplementationOnce(async () => {
      failed.resolve();
      throw new Error("device storage busy");
    });
    writeDraft(vault, "failed-atomic.md", "recover me", 1);
    await failed.promise;
    await flushDrafts(vault);
    expect((await readDraft(vault, "failed-atomic.md"))?.text).toBe("recover me");
    expect(original).toHaveBeenCalled();
  });

  it("does not remove a new draft when an old confirmation finishes its read", async () => {
    const path = "late-clear-read.md";
    writeDraft(vault, path, "saved", 1);
    await flushDrafts(vault);
    const entered = gate(), release = gate();
    const read = Filesystem.readFile.bind(Filesystem);
    vi.spyOn(Filesystem, "readFile").mockImplementationOnce(async (opts) => {
      const old = await read(opts);
      entered.resolve();
      await release.promise;
      return old;
    });
    clearDraft(vault, path, 1);
    await entered.promise;
    writeDraft(vault, path, "typed while checking", 2);
    const flushed = flushDrafts(vault);
    release.resolve();
    await flushed;
    expect((await readDraft(vault, path))?.text).toBe("typed while checking");
  });

  it("queues a later snapshot behind a slow delete, including manual discard", async () => {
    const path = "slow-delete.md";
    writeDraft(vault, path, "discarded", 8);
    await flushDrafts(vault);
    const entered = gate(), release = gate();
    const remove = Filesystem.deleteFile.bind(Filesystem);
    vi.spyOn(Filesystem, "deleteFile").mockImplementationOnce(async (opts) => {
      entered.resolve();
      await release.promise;
      return remove(opts);
    });
    clearDraft(vault, path);
    await entered.promise;
    writeDraft(vault, path, "typed after discard", 9);
    const flushed = flushDrafts(vault);
    release.resolve();
    await flushed;
    expect((await readDraft(vault, path))?.text).toBe("typed after discard");
  });

  it("keeps a newer draft behind an in-flight atomic write and its confirmation", async () => {
    const path = "slow-atomic.md";
    const entered = gate(), release = gate();
    const write = Filesystem.writeFile.bind(Filesystem);
    vi.spyOn(Filesystem, "writeFile").mockImplementationOnce(async (opts) => {
      entered.resolve();
      await release.promise;
      return write(opts);
    });
    writeDraft(vault, path, "old", 1);
    await entered.promise;
    clearDraft(vault, path, 1);
    writeDraft(vault, path, "new", 2);
    const flushed = flushDrafts(vault);
    release.resolve();
    await flushed;
    expect((await readDraft(vault, path))?.text).toBe("new");
  });

  it("preserves the disk draft when a finite confirmation cannot read it", async () => {
    const path = "unreadable-clear.md";
    writeDraft(vault, path, "keep this", 3);
    await flushDrafts(vault);
    vi.spyOn(Filesystem, "readFile").mockRejectedValueOnce(new Error("permission denied"));
    clearDraft(vault, path, 3);
    await new Promise((r) => setTimeout(r, 10));
    expect((await readDraft(vault, path))?.text).toBe("keep this");
  });
});

describe("drafts follow an in-app move (issue 113)", () => {
  beforeEach(() => store.clear());

  it("maps a note and everything under a moved folder, nothing else", () => {
    expect(relocatedPath("A/n.md", { from: "A/n.md", to: "B/n.md" })).toBe("B/n.md");
    expect(relocatedPath("A/sub/n.md", { from: "A", to: "X/A" })).toBe("X/A/sub/n.md");
    expect(relocatedPath("AB/n.md", { from: "A", to: "X/A" })).toBeNull();
  });

  it("moves the entry, including a snapshot still buffered, to the new path", async () => {
    writeDraft(vault, "Inbox/Note.md", "unsaved", 3);
    await relocateDrafts(vault, [{ from: "Inbox", to: "Archive/Inbox" }]);
    expect(await readDraft(vault, "Inbox/Note.md")).toBeNull();
    expect(await readDraft(vault, "Archive/Inbox/Note.md")).toMatchObject({ text: "unsaved", revision: 3 });
  });
});

/** Makes the journal of `path` look as an earlier run of the app left it. */
function leftByAnEarlierRun(path: string) {
  const file = [...store.keys()].find((key) => (JSON.parse(store.get(key)!).entries ?? []).some((entry: { notePath: string }) => entry.notePath === path))!;
  const journal = JSON.parse(store.get(file)!);
  store.set(file, JSON.stringify({ ...journal, entries: journal.entries.map((entry: object) => ({ ...entry, savedAt: 1 })) }));
}

describe("a draft left from an earlier run (finding 2026-10-11)", () => {
  beforeEach(() => store.clear());

  it("is handed out once — and a draft of this run, which belongs to the note's saver, never", async () => {
    writeDraft(vault, "Old.csv", "left when the app went", 4);
    writeDraft(vault, "New.csv", "typed in this run", 1);
    await flushDrafts(vault);
    // The first one as an earlier run of the app left it.
    leftByAnEarlierRun("Old.csv");
    expect(await takeLeftoverDrafts(vault, "Old.csv")).toMatchObject([{ text: "left when the app went", revision: 4 }]);
    expect(await takeLeftoverDrafts(vault, "Old.csv")).toEqual([]);
    expect(await takeLeftoverDrafts(vault, "New.csv")).toEqual([]);
    expect(await takeLeftoverDrafts(vault, "None.csv")).toEqual([]);
  });

  it("is cleared once kept only while the journal still holds that draft — a newer one of this run, counted from 1 again, stays", async () => {
    writeDraft(vault, "Kept.csv", "kept beside the file", 4);
    await flushDrafts(vault);
    const kept = (await readDraft(vault, "Kept.csv"))!;
    // Typing in this run journals revision 1 — lower than the earlier run's 4.
    writeDraft(vault, "Kept.csv", "typed in this run", 1);
    await flushDrafts(vault);
    clearDraftIf(vault, "Kept.csv", kept);
    await new Promise((r) => setTimeout(r, 10));
    expect((await readDraft(vault, "Kept.csv"))?.text).toBe("typed in this run");
    // Counted up to the same revision again, later: still another draft.
    await new Promise((r) => setTimeout(r, 5));
    writeDraft(vault, "Kept.csv", "typed later in this run", 4);
    await flushDrafts(vault);
    clearDraftIf(vault, "Kept.csv", kept);
    await new Promise((r) => setTimeout(r, 10));
    expect((await readDraft(vault, "Kept.csv"))?.text).toBe("typed later in this run");
    // Still that draft: it goes.
    const now = (await readDraft(vault, "Kept.csv"))!;
    clearDraftIf(vault, "Kept.csv", now);
    await new Promise((r) => setTimeout(r, 10));
    expect(await readDraft(vault, "Kept.csv")).toBeNull();
  });

  it("hands a draft out again that could not be kept", async () => {
    writeDraft(vault, "Again.csv", "not kept the first time", 2);
    await flushDrafts(vault);
    leftByAnEarlierRun("Again.csv");
    const first = await takeLeftoverDrafts(vault, "Again.csv");
    expect(await takeLeftoverDrafts(vault, "Again.csv")).toEqual([]);
    releaseLeftoverDrafts(vault, "Again.csv", first);
    expect(await takeLeftoverDrafts(vault, "Again.csv")).toMatchObject([{ text: "not kept the first time" }]);
  });
});

describe("an offered draft stays until it is restored or discarded (open-items plan 3.125)", () => {
  beforeEach(() => store.clear());
  const tick = () => new Promise((r) => setTimeout(r, 10));
  /** The journal file of `path` as the first phone journal wrote it: one text per note. */
  const oldShape = (path: string, draft: { text: string; ts: number; revision?: number }) =>
    store.set(`drafts/local/${btoa(path)}.json`, JSON.stringify({ path, ...draft }));

  it("survives typing on and the confirmed save of that typing", async () => {
    oldShape("Offer.md", { text: "left unsaved", ts: 1, revision: 4 });
    expect((await readDraft(vault, "Offer.md"))?.text).toBe("left unsaved");
    // Typing on without answering the offer; the save of it is confirmed.
    writeDraft(vault, "Offer.md", "typed on", 1);
    await flushDrafts(vault);
    clearDraft(vault, "Offer.md", 1);
    await tick();
    expect((await readDraft(vault, "Offer.md", "typed on"))?.text).toBe("left unsaved");
  });

  it("is held apart from this run's saver when it is this run's own unsaved text, and goes when discarded", async () => {
    writeDraft(vault, "Same.md", "unsaved in this run", 3);
    await flushDrafts(vault);
    const offer = await offerDraft(vault, "Same.md", "the file");
    expect(offer).toMatchObject({ text: "unsaved in this run", revision: 3 });
    writeDraft(vault, "Same.md", "typed on", 4);
    await flushDrafts(vault);
    clearDraft(vault, "Same.md", 4);
    await tick();
    expect((await readDraft(vault, "Same.md", "typed on"))?.text).toBe("unsaved in this run");
    clearDraftIf(vault, "Same.md", offer!);
    await tick();
    expect(await readDraft(vault, "Same.md", "typed on")).toBeNull();
  });

  it("goes once restored and journaled as this run's text — and never comes back after that text is saved", async () => {
    oldShape("Restore.md", { text: "left unsaved", ts: 1, revision: 2 });
    const offer = (await offerDraft(vault, "Restore.md", "the file"))!;
    // Restoring schedules the text like typing does, then adopts the offer.
    writeDraft(vault, "Restore.md", "left unsaved", 7);
    await adoptDraft(vault, "Restore.md", offer);
    expect(await readDraft(vault, "Restore.md", "the file")).toMatchObject({ text: "left unsaved", revision: 7 });
    clearDraft(vault, "Restore.md", 7);
    await tick();
    // The note is edited further and saved: the old offer is not offered again.
    expect(await readDraft(vault, "Restore.md", "edited later")).toBeNull();
  });
});
