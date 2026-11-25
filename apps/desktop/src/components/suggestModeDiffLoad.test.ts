// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * What a proposal is made of never depends on whether a chunk has loaded (review of L5, 2026-11-25). The word diff
 * of the suggestion mode is a chunk of its own; before it is there the marks may be drawn coarse, but the chunks a
 * shell writes come from the word diff only — the send waits for it, a failed load is tried again, and nothing is
 * left as an unhandled rejection. The coarse stand-in once went into the proposal: one block from the first change
 * to the last instead of one per clause (the finding of 2026-09-03 come back).
 */
const BASE = "The contract runs until the end of the year.\nThe electrician is a separate firm.\nReserve 10 %.\n";

async function fresh() {
  vi.resetModules();
  return import("../../../../packages/ui/src/components/suggestMode");
}

function edited(mode: { extension: import("@codemirror/state").Extension; start(view: EditorView, onChunks?: (n: number) => void): void }, counts: number[]) {
  const view = new EditorView({ state: EditorState.create({ doc: BASE, extensions: [mode.extension] }), parent: document.body });
  mode.start(view, (n) => counts.push(n));
  const first = BASE.indexOf("contract");
  const last = BASE.indexOf("10 %");
  view.dispatch({ changes: [{ from: first, to: first + 8, insert: "lease" }, { from: last, to: last + 2, insert: "15" }] });
  return view;
}

describe("the suggestion mode's word diff, loaded on demand", () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown) => unhandled.push(e);
  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
    vi.useRealTimers();
  });

  it("never hands out chunks of anything but the word diff, and the send waits for it", async () => {
    expect.hasAssertions();
    const m = await fresh();
    const counts: number[] = [];
    let release!: () => void;
    const real = await import("@codemirror/merge");
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const loaded = m.loadSuggestionDiff(async () => { await gate; return real; });
    const view = edited(m.createSuggestMode(), counts);
    try {
      expect(() => m.suggestionChunks(view.state)).toThrow(m.SuggestionDiffNotLoaded);
      const proposal = m.suggestionChunksReady(view.state);
      release();
      await loaded;
      expect((await proposal).map((c) => [c.fromA, c.toA])).toEqual([[4, 12], [90, 91]]);
      expect(m.suggestionChunks(view.state)).toHaveLength(2);
    } finally {
      view.destroy();
    }
  });

  it("tries a failed load again, and a load that gave up is tried anew on the next ask — no unhandled rejection", async () => {
    expect.hasAssertions();
    process.on("unhandledRejection", onUnhandled);
    const m = await fresh();
    const real = await import("@codemirror/merge");
    let calls = 0;
    // Fails three times: the first ask gives up after its tries, the second ask loads.
    const flaky = async () => {
      calls++;
      if (calls <= 3) throw new Error("the chunk did not load");
      return real;
    };
    await expect(m.loadSuggestionDiff(flaky)).rejects.toThrow("the chunk did not load");
    expect(calls).toBe(3);
    await m.loadSuggestionDiff(flaky);
    expect(calls).toBe(4);
    const counts: number[] = [];
    const view = edited(m.createSuggestMode(), counts);
    try {
      expect(await m.suggestionChunksReady(view.state)).toHaveLength(2);
    } finally {
      view.destroy();
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(unhandled).toEqual([]);
  }, 10_000);

  it("a mode started while the diff cannot load draws coarse, and leaves no unhandled rejection", async () => {
    expect.hasAssertions();
    process.on("unhandledRejection", onUnhandled);
    vi.doMock("@codemirror/merge", () => { throw new Error("offline"); });
    const m = await fresh();
    const counts: number[] = [];
    const view = edited(m.createSuggestMode(), counts);
    try {
      expect(counts[counts.length - 1]).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(unhandled).toEqual([]);
      expect(() => m.suggestionChunks(view.state)).toThrow(m.SuggestionDiffNotLoaded);
    } finally {
      view.destroy();
      vi.doUnmock("@codemirror/merge");
    }
  }, 10_000);
});
