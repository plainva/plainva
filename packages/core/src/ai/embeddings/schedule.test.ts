import { describe, expect, it } from "vitest";
import type { EmbeddingOutcome, EmbeddingPlan, EmbeddingWork } from "./pipeline.js";
import { EmbeddingScheduler, type EmbeddingProgress } from "./schedule.js";

const NOW = 1_000_000;
const work = (path: string, mtime = 0, sha256 = `sha-${path}`): EmbeddingWork => ({ path, title: path, sha256, mtime });

/** An indexer over a list of notes: embedding a note makes it current, a listed path fails, a withheld one is kept out. */
function fakeIndexer(notes: EmbeddingWork[], fail: Set<string> = new Set(), withhold: Set<string> = new Set()) {
  const done = new Set<string>();
  const kept = new Set<string>();
  const calls: string[][] = [];
  let onEmbed: (() => void) | null = null;
  return {
    notes,
    done,
    calls,
    fail,
    whenEmbedding(fn: () => void) {
      onEmbed = fn;
    },
    async plan(): Promise<EmbeddingPlan> {
      const pending = notes.filter((note) => !done.has(`${note.path}@${note.sha256}`) && !kept.has(note.path)).sort((a, b) => b.mtime - a.mtime);
      return { pending, orphans: [], total: notes.length, withheld: kept.size };
    },
    async embed(works: readonly EmbeddingWork[]): Promise<Map<string, EmbeddingOutcome>> {
      calls.push(works.map((w) => w.path));
      onEmbed?.();
      if (works.some((w) => fail.has(w.path))) throw new Error(`cannot embed ${works.map((w) => w.path).join(", ")}`);
      const out = new Map<string, EmbeddingOutcome>();
      for (const w of works) {
        if (withhold.has(w.path)) {
          kept.add(w.path);
          out.set(w.path, "withheld");
        } else {
          done.add(`${w.path}@${w.sha256}`);
          out.set(w.path, "embedded");
        }
      }
      return out;
    },
    async forget() {},
  };
}

function scheduler(indexer: ReturnType<typeof fakeIndexer>, extra: Partial<ConstructorParameters<typeof EmbeddingScheduler>[0]> = {}) {
  const progress: EmbeddingProgress[] = [];
  const wakes: { run: () => void; ms: number }[] = [];
  const s = new EmbeddingScheduler({
    indexer,
    stepNotes: 2,
    now: () => NOW,
    later: (run, ms) => {
      wakes.push({ run, ms });
      return () => undefined;
    },
    onProgress: (p) => progress.push(p),
    ...extra,
  });
  return { s, progress, wakes };
}

describe("EmbeddingScheduler", () => {
  it("embeds the newest notes first, a step at a time, and reports", async () => {
    const indexer = fakeIndexer([work("a", 1), work("b", 3), work("c", 2)]);
    const { s, progress } = scheduler(indexer);
    await s.kick();
    expect(indexer.calls).toEqual([["b", "c"], ["a"]]);
    expect(s.status).toMatchObject({ state: "idle", total: 3, current: 3, deferred: 0 });
    expect(progress.some((p) => p.state === "working" && p.working === "b")).toBe(true);
  });

  it("lets a note that changed a moment ago settle, then wakes for it", async () => {
    const indexer = fakeIndexer([work("typing", NOW - 2_000), work("older", NOW - 60_000), work("skewed", NOW + 3_600_000)]);
    const { s, wakes } = scheduler(indexer);
    await s.kick();
    expect(indexer.calls.flat().sort()).toEqual(["older", "skewed"]);
    expect(s.status.deferred).toBe(1);
    expect(wakes.map((w) => w.ms)).toEqual([3_000]);
    indexer.notes[0]!.mtime = NOW - 10_000;
    wakes[0]!.run();
    await s.kick();
    expect(indexer.calls.flat()).toContain("typing");
    expect(s.status).toMatchObject({ current: 3, deferred: 0 });
  });

  it("plans again when told the index changed, after at least one step", async () => {
    const indexer = fakeIndexer([work("a", 5), work("b", 4), work("c", 3), work("d", 2)]);
    const { s } = scheduler(indexer);
    indexer.whenEmbedding(() => {
      if (indexer.calls.length === 1) {
        indexer.notes.push(work("new", 10));
        void s.kick();
      }
    });
    await s.kick();
    expect(indexer.calls).toEqual([["a", "b"], ["new", "c"], ["d"]]);
  });

  it("pauses after the step under way and resumes where it stopped", async () => {
    const indexer = fakeIndexer([work("a", 3), work("b", 2), work("c", 1)]);
    const { s } = scheduler(indexer, { stepNotes: 1 });
    indexer.whenEmbedding(() => {
      if (indexer.calls.length === 1) s.pause();
    });
    await s.kick();
    expect(indexer.calls).toEqual([["a"]]);
    expect(s.status.state).toBe("paused");
    await s.kick();
    expect(indexer.calls).toHaveLength(1);
    await s.resume();
    expect(indexer.calls).toEqual([["a"], ["b"], ["c"]]);
    expect(s.status.state).toBe("idle");
  });

  it("stops for good", async () => {
    const indexer = fakeIndexer([work("a", 2), work("b", 1)]);
    const { s, progress } = scheduler(indexer, { stepNotes: 1 });
    indexer.whenEmbedding(() => s.stop());
    await s.kick();
    const seen = progress.length;
    await s.kick();
    expect(indexer.calls).toEqual([["a"]]);
    expect(progress).toHaveLength(seen);
  });

  it("waits for the device between steps", async () => {
    const indexer = fakeIndexer([work("a", 2), work("b", 1)]);
    let open = 0;
    const { s } = scheduler(indexer, { stepNotes: 1, ready: async () => void open++ });
    await s.kick();
    expect(open).toBe(2);
  });

  it("skips a note that fails alone until its text changes", async () => {
    const indexer = fakeIndexer([work("a", 3), work("odd", 2), work("c", 1)], new Set(["odd"]));
    const { s } = scheduler(indexer);
    await s.kick();
    expect(indexer.calls).toEqual([["a", "odd"], ["a"], ["odd"], ["c"]]);
    expect(s.status).toMatchObject({ state: "idle", current: 2, deferred: 1 });
    await s.kick();
    expect(indexer.calls.flat().filter((path) => path === "odd")).toHaveLength(2);
    indexer.fail.clear();
    indexer.notes[1] = work("odd", 2, "sha-new");
    await s.kick();
    expect(s.status).toMatchObject({ current: 3, deferred: 0 });
  });

  it("stops with the error when notes fail one after another, without blaming them", async () => {
    const notes = [work("a", 4), work("b", 3), work("c", 2), work("d", 1)];
    const indexer = fakeIndexer(notes, new Set(["a", "b", "c", "d"]));
    const { s } = scheduler(indexer, { stepNotes: 4 });
    await s.kick();
    expect(s.status.state).toBe("failed");
    expect(s.status.error).toBe("cannot embed c");
    indexer.fail.clear();
    await s.kick();
    expect(s.status).toMatchObject({ state: "idle", current: 4, deferred: 0 });
  });
  it("counts the notes the rules keep from a cloud as withheld — neither missing nor done", async () => {
    const indexer = fakeIndexer([work("a.md"), work("b.md"), work("c.md")], new Set(), new Set(["b.md"]));
    const { s } = scheduler(indexer);
    await s.kick();
    expect(s.status).toMatchObject({ state: "idle", total: 3, current: 2, withheld: 1 });
    await s.kick();
    expect(s.status).toMatchObject({ total: 3, current: 2, withheld: 1 });
    expect(indexer.calls.flat().filter((path) => path === "b.md")).toHaveLength(1);
  });
});
