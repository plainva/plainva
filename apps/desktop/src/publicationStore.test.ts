import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Walks four source trees from disk; the 5 s unit default is the wrong yardstick
// for a check whose runtime grows with the repo (six such guards timed out at
// once under the full suite's parallel load, 2026-08-24).
vi.setConfig({ testTimeout: 30_000 });

/**
 * One place derives a publication's folder (Stufe B, S1).
 *
 * A publication lives under `.pvws/publications/<id>/`, and that id is DERIVED
 * from the vault and the slice rather than stored - the publication document is
 * pinned to an exact key set and the protocol has no schema evolution, so a new
 * field would be a protocol change.
 *
 * Derived means reproducible, and reproducible only holds while exactly one
 * piece of code does the deriving. A second construction site would be free to
 * pass a different id, and a publication written under one name and refreshed
 * under another is a silent orphan: the old folder keeps serving stale objects
 * to everyone who already joined it, and nothing anywhere reports an error.
 *
 * Tests may build the store directly - that is how the store itself gets
 * checked. Production code goes through `publicationStoreFor`.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "../../..");
const TREES = ["packages/core/src", "packages/ui/src", "apps/desktop/src", "apps/mobile/src"];
const FACTORY = "packages/core/src/workspace/publishedSlices.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

function productionFilesContaining(needle: string): string[] {
  const hits: string[] = [];
  for (const tree of TREES) {
    for (const file of walk(join(ROOT, tree))) {
      if (readFileSync(file, "utf8").includes(needle)) hits.push(relative(ROOT, file).split("\\").join("/"));
    }
  }
  return hits.sort();
}

describe("publication namespace", () => {
  it("is constructed in exactly one place", () => {
    expect(productionFilesContaining("new PublishedSliceObjectStore")).toEqual([FACTORY]);
  });

  it("has its path assembled in exactly one place", () => {
    // The stricter half: somebody could skip the class entirely and hand a
    // hand-built `.pvws/publications/<something>/` prefix to the plain store,
    // which would pass the check above while producing the same orphan. Only
    // the template expression counts - the prose that explains the layout is
    // allowed to name it.
    expect(productionFilesContaining(".pvws/publications/${")).toEqual([FACTORY]);
  });
});
