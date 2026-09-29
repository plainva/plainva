import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CODE_ROOTS, REPO, shippedSources, sourceTexts } from "./test-sourceTree";

/**
 * The shared source reader of the scan guards (test-sourceTree.ts) takes a
 * file's text from its snapshot while size and modification time match. The
 * one thing it must never do is hand a guard an OLD text: a guard reading
 * yesterday's file is green for the wrong reason. These tests change, add and
 * remove files between two reads, each through a fresh snapshot directory.
 */

const temp = mkdtempSync(join(tmpdir(), "plainva-source-tree-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

function tree(name: string, files: Record<string, string>): string {
  const base = join(temp, name);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(base, rel, ".."), { recursive: true });
    writeFileSync(join(base, rel), text);
  }
  return base;
}

const read = (base: string) => sourceTexts(["src"], "shipped", base, join(base, ".snapshots"));
const texts = (base: string) => Object.fromEntries(read(base).map((f) => [f.rel, f.text]));

describe("the scan guards' shared source reader", () => {
  it("reads the kind it is asked for, in path order", () => {
    const base = tree("kinds", {
      "src/b.ts": "b",
      "src/a/c.tsx": "c",
      "src/a.test.ts": "test",
      "src/style.css": "css",
      "src/node_modules/x.ts": "installed",
      "src/.hidden/y.ts": "dot folder",
    });
    expect(read(base).map((f) => f.rel)).toEqual(["src/a/c.tsx", "src/b.ts"]);
    expect(sourceTexts(["src"], "tests", base, join(base, ".snapshots")).map((f) => f.rel)).toEqual(["src/a.test.ts"]);
    expect(sourceTexts(["src"], "text", base, join(base, ".snapshots")).map((f) => f.rel)).toEqual(["src/a.test.ts", "src/a/c.tsx", "src/b.ts", "src/style.css"]);
  });

  it("writes a snapshot and serves an unchanged tree from it", () => {
    const base = tree("snapshot", { "src/a.ts": "one" });
    expect(texts(base)).toEqual({ "src/a.ts": "one" });
    expect(readdirSync(join(base, ".snapshots")).filter((f) => f.endsWith(".json"))).toHaveLength(1);
    expect(texts(base)).toEqual({ "src/a.ts": "one" });
  });

  it("sees an edited file even when its size stays the same", () => {
    const base = tree("edited", { "src/a.ts": "one", "src/b.ts": "keep" });
    expect(texts(base)["src/a.ts"]).toBe("one");
    writeFileSync(join(base, "src/a.ts"), "two");
    // A later modification time, as every real write gives.
    const later = new Date(statSync(join(base, "src/a.ts")).mtimeMs + 5_000);
    utimesSync(join(base, "src/a.ts"), later, later);
    expect(texts(base)).toEqual({ "src/a.ts": "two", "src/b.ts": "keep" });
  });

  it("sees an added and a removed file", () => {
    const base = tree("added", { "src/a.ts": "a" });
    expect(Object.keys(texts(base))).toEqual(["src/a.ts"]);
    writeFileSync(join(base, "src/b.ts"), "b");
    expect(texts(base)).toEqual({ "src/a.ts": "a", "src/b.ts": "b" });
    rmSync(join(base, "src/a.ts"));
    expect(texts(base)).toEqual({ "src/b.ts": "b" });
  });

  it("still reads everything when the snapshot is damaged", () => {
    const base = tree("damaged", { "src/a.ts": "a" });
    expect(texts(base)).toEqual({ "src/a.ts": "a" });
    for (const file of readdirSync(join(base, ".snapshots"))) writeFileSync(join(base, ".snapshots", file), "{ half a snapsh");
    writeFileSync(join(base, "src/b.ts"), "b");
    expect(texts(base)).toEqual({ "src/a.ts": "a", "src/b.ts": "b" });
  });

  it("finds the repository's own code roots", () => {
    // A guard that silently scanned nothing would be green forever.
    expect(CODE_ROOTS.every((root) => shippedSources([root]).length > 20)).toBe(true);
    const rels = new Set(shippedSources().map((f) => f.rel));
    expect(rels.has("packages/core/src/db/Schema.ts")).toBe(true);
    expect(rels.has("apps/desktop/src/test-sourceTree.ts")).toBe(true);
    expect(statSync(join(REPO, "pnpm-workspace.yaml")).isFile()).toBe(true);
  });
});
