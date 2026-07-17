import { describe, it, expect } from "vitest";
import { sweepPinboardRefs } from "@plainva/ui";

// Plan Pinboard P5: path retargeting of pinboard arrangements after renames
// and moves — wired into both shells; these tests pin the core sweep.

function fakeVault(files: Record<string, string>) {
  const writes: string[] = [];
  return {
    files,
    writes,
    deps: {
      adapter: {
        readTextFile: async (p: string) => {
          if (!(p in files)) throw new Error("not found: " + p);
          return files[p];
        },
        writeTextFile: async (p: string, c: string) => {
          files[p] = c;
          writes.push(p);
        },
      },
      queryService: { listBaseFilePaths: async () => Object.keys(files).filter((p) => p.endsWith(".base")) },
    },
  };
}

const pinboardBase = [
  "views:",
  "  - type: table",
  "    name: Pinnwand",
  "    plainva:",
  "      render: pinboard",
  "      pinboardOrder:",
  '        - "Zettel/A.md"',
  '        - "Zettel/B.md"',
  "      pinboardPinned:",
  '        - "Zettel/C.md"',
  "",
].join("\n");

const plainBase = ["views:", "  - type: table", "    name: Tabelle", ""].join("\n");

describe("sweepPinboardRefs", () => {
  it("retargets exact file moves in order AND pinned of every affected base", async () => {
    const v = fakeVault({ "Pinnwand.base": pinboardBase, "Andere.base": plainBase });
    const changed = await sweepPinboardRefs(v.deps, [
      { from: "Zettel/A.md", to: "Zettel/A neu.md" },
      { from: "Zettel/C.md", to: "Archiv/C.md" },
    ]);
    expect(changed).toEqual(["Pinnwand.base"]);
    expect(v.files["Pinnwand.base"]).toContain("Zettel/A neu.md");
    expect(v.files["Pinnwand.base"]).toContain("Archiv/C.md");
    expect(v.files["Pinnwand.base"]).toContain("Zettel/B.md"); // untouched entry stays
  });

  it("never parses or rewrites a base without pinboard keys (no format normalization)", async () => {
    const v = fakeVault({ "Andere.base": plainBase });
    const changed = await sweepPinboardRefs(v.deps, [{ from: "Zettel/A.md", to: "X.md" }]);
    expect(changed).toEqual([]);
    expect(v.writes).toEqual([]);
    expect(v.files["Andere.base"]).toBe(plainBase); // byte-identical
  });

  it("rewrites folder moves by prefix", async () => {
    const v = fakeVault({ "Pinnwand.base": pinboardBase });
    const changed = await sweepPinboardRefs(v.deps, [], [{ from: "Zettel", to: "Notizen/Zettel" }]);
    expect(changed).toEqual(["Pinnwand.base"]);
    expect(v.files["Pinnwand.base"]).toContain("Notizen/Zettel/A.md");
    expect(v.files["Pinnwand.base"]).toContain("Notizen/Zettel/C.md");
    // Prefix must match whole segments: "Zettelkasten/..." would not move.
    expect(v.files["Pinnwand.base"]).not.toContain("Notizen/Zettelkasten");
  });

  it("skips unreadable bases and missing services without breaking the operation", async () => {
    const v = fakeVault({ "Pinnwand.base": pinboardBase });
    const brokenDeps = {
      adapter: { readTextFile: async () => { throw new Error("io"); }, writeTextFile: v.deps.adapter.writeTextFile },
      queryService: v.deps.queryService,
    };
    await expect(sweepPinboardRefs(brokenDeps, [{ from: "a", to: "b" }])).resolves.toEqual([]);
    await expect(sweepPinboardRefs({ ...v.deps, queryService: null }, [{ from: "a", to: "b" }])).resolves.toEqual([]);
    await expect(sweepPinboardRefs(v.deps, [])).resolves.toEqual([]);
    expect(v.writes).toEqual([]);
  });
});
