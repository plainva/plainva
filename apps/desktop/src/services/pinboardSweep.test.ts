// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createIndexAutoUpdater, dropPinboardRefs, notifyFileOps, sweepPinboardRefs } from "@plainva/ui";

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

describe("dropPinboardRefs: a delete in the app takes the note out of every pinboard", () => {
  // A pin, an unpin or a drag keeps every entry it does not show; a deleted
  // note's entry left behind was taken over by the next note of that name — a
  // quick capture came back pinned at the place of a deleted one.
  it("drops deleted files from order and pinned, and every entry below a deleted folder", async () => {
    const v = fakeVault({ "Pinnwand.base": pinboardBase, "Andere.base": plainBase });
    expect(await dropPinboardRefs(v.deps, ["Zettel/C.md"])).toEqual(["Pinnwand.base"]);
    expect(v.files["Pinnwand.base"]).not.toContain("Zettel/C.md");
    expect(v.files["Pinnwand.base"]).toContain("Zettel/A.md");
    expect(v.writes).toEqual(["Pinnwand.base"]);
    await dropPinboardRefs(v.deps, [], ["Zettel"]);
    expect(v.files["Pinnwand.base"]).not.toContain("Zettel/");
    expect(v.files["Andere.base"]).toBe(plainBase);
  });

  it("a name taken again after a delete starts unarranged, not at the deleted note's place", async () => {
    const v = fakeVault({ "Pinnwand.base": pinboardBase });
    await dropPinboardRefs(v.deps, ["Zettel/C.md"]);
    // A new "Zettel/C.md" is not listed: it is drawn among the unarranged cards on top.
    expect(v.files["Pinnwand.base"]).not.toContain("pinboardPinned");
  });

  it("runs for every delete either shell announces (`notifyFileOps`), through the shared updater", async () => {
    const v = fakeVault({ "Pinnwand.base": pinboardBase });
    const written: string[] = [];
    const updater = createIndexAutoUpdater({
      adapter: v.deps.adapter as never,
      queryService: v.deps.queryService as never,
      vaultName: () => "V",
      subfoldersHeading: () => "Folders",
      onWritten: (p) => void written.push(p),
      debounceMs: 1,
    });
    const onOps = (e: Event) => updater.notify((e as CustomEvent).detail.ops);
    window.addEventListener("plainva-file-ops", onOps);
    try {
      notifyFileOps([{ type: "delete", path: "Zettel/A.md" }]);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(v.files["Pinnwand.base"]).not.toContain("Zettel/A.md");
      expect(v.files["Pinnwand.base"]).toContain("Zettel/B.md");
      expect(written).toContain("Pinnwand.base");
    } finally {
      window.removeEventListener("plainva-file-ops", onOps);
      updater.dispose();
    }
  });

  it("reads the board again before the index follows, and also where the index cannot", async () => {
    const v = fakeVault({ "Pinnwand.base": pinboardBase });
    const order: string[] = [];
    const updater = createIndexAutoUpdater({
      adapter: v.deps.adapter as never,
      queryService: v.deps.queryService as never,
      vaultName: () => "V",
      subfoldersHeading: () => "Folders",
      onWritten: (p) => void order.push(`read ${p}`),
      reindex: async (paths) => { order.push(`index ${paths.join(",")}`); throw new Error("index closed"); },
      debounceMs: 1,
    });
    try {
      updater.notify([{ type: "delete", path: "Zettel/A.md" }]);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(order).toEqual(["read Pinnwand.base", "index Pinnwand.base"]);
    } finally {
      updater.dispose();
    }
  });
});
