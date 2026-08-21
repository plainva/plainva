import { describe, expect, it, vi } from "vitest";
import { runVaultReplace } from "@plainva/ui";
import type { VaultFindResult } from "@plainva/core";

/**
 * The write side of vault-wide find & replace (lifted to packages/ui for P5).
 *
 * What is pinned here is the rule the loop exists for: every note is re-read
 * immediately before it is written, so a preview that has gone stale can never
 * clobber newer content. The desktop had this inline; the phone needed the same
 * one, and two copies of a data-safety rule is how the two drift apart.
 */

const result = (path: string, title = path): VaultFindResult => ({
  path,
  title,
  matchCount: 1,
  matches: [{ line: 1, lineText: "alpha", start: 0, end: 5 }],
});

const deps = (files: Record<string, string>) => {
  const written: Record<string, string> = {};
  return {
    written,
    io: {
      read: vi.fn(async (p: string) => {
        if (!(p in files)) throw new Error(`missing ${p}`);
        return files[p];
      }),
      write: vi.fn(async (p: string, c: string) => {
        written[p] = c;
        files[p] = c;
      }),
    },
  };
};

describe("runVaultReplace", () => {
  it("writes only the selected notes", async () => {
    const { io, written } = deps({ "a.md": "alpha", "b.md": "alpha" });
    const res = await runVaultReplace(io, {
      results: [result("a.md"), result("b.md")],
      selected: new Set(["a.md"]),
      query: "alpha",
      replacement: "beta",
    });
    expect(res).toMatchObject({ notes: 1, hits: 1, cancelled: false });
    expect(written).toEqual({ "a.md": "beta" });
    expect(io.read).toHaveBeenCalledTimes(1);
  });

  it("skips — and names — a note that changed since the preview", async () => {
    // The preview said "alpha"; by the time we write, a sync has replaced the
    // content. Writing the previewed replacement here would destroy newer work.
    const { io, written } = deps({ "a.md": "something else entirely" });
    const res = await runVaultReplace(io, {
      results: [result("a.md")],
      selected: new Set(["a.md"]),
      query: "alpha",
      replacement: "beta",
    });
    expect(res.notes).toBe(0);
    expect(res.hits).toBe(0);
    expect(res.skipped).toEqual(["a.md"]);
    expect(written).toEqual({});
  });

  it("keeps going when one note cannot be read, and reports it", async () => {
    const { io, written } = deps({ "b.md": "alpha" }); // a.md is absent -> read throws
    const res = await runVaultReplace(io, {
      results: [result("a.md"), result("b.md")],
      selected: new Set(["a.md", "b.md"]),
      query: "alpha",
      replacement: "beta",
    });
    expect(res.notes).toBe(1);
    expect(res.skipped).toEqual(["a.md"]);
    expect(written).toEqual({ "b.md": "beta" });
  });

  it("stops at a note boundary when asked, leaving written notes written", async () => {
    // The phone asks this both from the cancel button and from moving to the
    // background: the safe exit of an interrupted replace is "stop", never
    // "finish unattended".
    const { io, written } = deps({ "a.md": "alpha", "b.md": "alpha", "c.md": "alpha" });
    let done = 0;
    const res = await runVaultReplace(io, {
      results: [result("a.md"), result("b.md"), result("c.md")],
      selected: new Set(["a.md", "b.md", "c.md"]),
      query: "alpha",
      replacement: "beta",
      onProgress: () => {
        done += 1;
      },
      shouldStop: () => done >= 2,
    });
    expect(res.cancelled).toBe(true);
    expect(res.notes).toBe(2);
    expect(Object.keys(written).sort()).toEqual(["a.md", "b.md"]);
    expect(written["c.md"]).toBeUndefined();
  });

  it("reports progress against the SELECTED notes, not the whole preview", async () => {
    const { io } = deps({ "b.md": "alpha" });
    const seen: Array<[number, number, string]> = [];
    await runVaultReplace(io, {
      results: [result("a.md"), result("b.md")],
      selected: new Set(["b.md"]),
      query: "alpha",
      replacement: "beta",
      onProgress: (d, t, p) => seen.push([d, t, p]),
    });
    expect(seen).toEqual([[1, 1, "b.md"]]);
  });

  it("does nothing without a query", async () => {
    const { io, written } = deps({ "a.md": "alpha" });
    const res = await runVaultReplace(io, {
      results: [result("a.md")],
      selected: new Set(["a.md"]),
      query: "",
      replacement: "beta",
    });
    expect(res).toEqual({ notes: 0, hits: 0, skipped: [], cancelled: false });
    expect(written).toEqual({});
    expect(io.read).not.toHaveBeenCalled();
  });
});
