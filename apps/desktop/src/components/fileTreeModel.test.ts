import { describe, expect, it } from "vitest";
import {
  ancestorsOf,
  applyClickSelection,
  buildTree,
  clickSelectionMode,
  collectFolderPaths,
  copyCandidate,
  flattenVisibleTree,
  parentOf,
  pruneNestedPaths,
  resolveCreateTarget,
} from "./fileTreeModel";

const rows = [
  { path: "Zettel.md", title: "Zettel" },
  { path: "Atlas/Idee.md", title: "Idee" },
  { path: "Atlas/Tief/Notiz.md", title: "Notiz" },
  { path: "Bilder/foto.png", title: "foto.png", mode: "attachment" },
  { path: "Leer", title: "Leer", isDir: true },
];

describe("paths", () => {
  it("parentOf returns the folder ('' at root)", () => {
    expect(parentOf("Atlas/Tief/Notiz.md")).toBe("Atlas/Tief");
    expect(parentOf("Zettel.md")).toBe("");
  });

  it("ancestorsOf lists outer folders without the path itself", () => {
    expect(ancestorsOf("Atlas/Tief/Notiz.md")).toEqual(["Atlas", "Atlas/Tief"]);
    expect(ancestorsOf("Zettel.md")).toEqual([]);
  });

  it("collectFolderPaths includes explicit dirs and file ancestors", () => {
    const folders = collectFolderPaths(rows);
    expect(folders.has("Atlas")).toBe(true);
    expect(folders.has("Atlas/Tief")).toBe(true);
    expect(folders.has("Leer")).toBe(true);
    expect(folders.has("Zettel.md")).toBe(false);
  });

  it("resolveCreateTarget targets the folder or the file's parent", () => {
    expect(resolveCreateTarget(null)).toBe("");
    expect(resolveCreateTarget({ path: "Atlas", isFolder: true })).toBe("Atlas");
    expect(resolveCreateTarget({ path: "Atlas/Idee.md", isFolder: false })).toBe("Atlas");
    expect(resolveCreateTarget({ path: "Zettel.md", isFolder: false })).toBe("");
  });
});

describe("flattenVisibleTree", () => {
  it("walks folders-first in render order, descending only into expanded folders", () => {
    const tree = buildTree(rows);
    expect(flattenVisibleTree(tree, new Set()).map((v) => v.path)).toEqual([
      "Atlas",
      "Bilder",
      "Leer",
      "Zettel.md",
    ]);
    expect(flattenVisibleTree(tree, new Set(["Atlas"])).map((v) => v.path)).toEqual([
      "Atlas",
      "Atlas/Tief",
      "Atlas/Idee.md",
      "Bilder",
      "Leer",
      "Zettel.md",
    ]);
  });

  it("puts a folder's own index.md at the top of the files, below subfolders (Issue #9)", () => {
    const tree = buildTree([
      { path: "Notes/index.md", title: "Notes" },
      { path: "Notes/apple.md", title: "apple" },
      { path: "Notes/Sub/Deep.md", title: "Deep" },
      { path: "index.md", title: "Home" },
      { path: "Atlas/Idee.md", title: "Idee" },
    ]);
    // Root: folders A-Z first, then its own index.md at the top of the files.
    expect(flattenVisibleTree(tree, new Set()).map((v) => v.path)).toEqual([
      "Atlas",
      "Notes",
      "index.md",
    ]);
    // Inside "Notes": the Sub folder first, then index.md, then apple.md.
    expect(flattenVisibleTree(tree, new Set(["Notes"])).map((v) => v.path)).toEqual([
      "Atlas",
      "Notes",
      "Notes/Sub",
      "Notes/index.md",
      "Notes/apple.md",
      "index.md",
    ]);
  });
});

describe("applyClickSelection", () => {
  const tree = buildTree(rows);
  const visible = flattenVisibleTree(tree, new Set(["Atlas", "Bilder"]));

  it("single click replaces the selection and moves the anchor", () => {
    const res = applyClickSelection(new Set(["Zettel.md"]), "Zettel.md", visible, "Atlas", "single");
    expect([...res.selection]).toEqual(["Atlas"]);
    expect(res.anchor).toBe("Atlas");
  });

  it("toggle adds and removes without touching the rest", () => {
    const once = applyClickSelection(new Set(["Atlas"]), "Atlas", visible, "Zettel.md", "toggle");
    expect(once.selection).toEqual(new Set(["Atlas", "Zettel.md"]));
    const twice = applyClickSelection(once.selection, once.anchor, visible, "Atlas", "toggle");
    expect(twice.selection).toEqual(new Set(["Zettel.md"]));
  });

  it("range selects between anchor and click in both directions, keeping the anchor", () => {
    const down = applyClickSelection(new Set(["Atlas"]), "Atlas", visible, "Bilder", "range");
    expect(down.selection).toEqual(new Set(["Atlas", "Atlas/Tief", "Atlas/Idee.md", "Bilder"]));
    expect(down.anchor).toBe("Atlas");
    const up = applyClickSelection(down.selection, "Bilder", visible, "Atlas/Tief", "range");
    expect(up.selection).toEqual(new Set(["Atlas/Tief", "Atlas/Idee.md", "Bilder"]));
    expect(up.anchor).toBe("Bilder");
  });

  it("range without a resolvable anchor behaves like a single click", () => {
    const res = applyClickSelection(new Set(), null, visible, "Bilder", "range");
    expect([...res.selection]).toEqual(["Bilder"]);
  });
});

describe("clickSelectionMode", () => {
  const WIN = false;
  const MAC = true;
  const ev = (m: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    ...m,
  });

  it("a plain click selects on both platforms", () => {
    expect(clickSelectionMode(ev(), WIN)).toBe("single");
    expect(clickSelectionMode(ev(), MAC)).toBe("single");
  });

  it("Shift ranges on both platforms", () => {
    expect(clickSelectionMode(ev({ shiftKey: true }), WIN)).toBe("range");
    expect(clickSelectionMode(ev({ shiftKey: true }), MAC)).toBe("range");
  });

  it("the toggle modifier is Ctrl on Windows/Linux — the Super key never toggles", () => {
    expect(clickSelectionMode(ev({ ctrlKey: true }), WIN)).toBe("toggle");
    expect(clickSelectionMode(ev({ metaKey: true }), WIN)).toBe("single");
  });

  it("the toggle modifier is ⌘ on macOS; Ctrl+click is the OS right-click, not a toggle (Issue #13)", () => {
    expect(clickSelectionMode(ev({ metaKey: true }), MAC)).toBe("toggle");
    // The heart of the macOS bug: Ctrl+click must NOT flip the selection — it is
    // the secondary-click gesture, so the click is a no-op the contextmenu owns.
    expect(clickSelectionMode(ev({ ctrlKey: true }), MAC)).toBe("none");
    expect(clickSelectionMode(ev({ ctrlKey: true, shiftKey: true }), MAC)).toBe("none");
  });

  it("Shift wins over the toggle modifier (a contiguous range)", () => {
    expect(clickSelectionMode(ev({ shiftKey: true, ctrlKey: true }), WIN)).toBe("range");
    expect(clickSelectionMode(ev({ shiftKey: true, metaKey: true }), MAC)).toBe("range");
  });
});

describe("pruneNestedPaths", () => {
  it("drops children of selected folders and keeps siblings", () => {
    expect(pruneNestedPaths(["Atlas/Idee.md", "Atlas", "Zettel.md"])).toEqual(["Atlas", "Zettel.md"]);
  });

  it("does not treat name prefixes as nesting", () => {
    expect(pruneNestedPaths(["Atlas", "Atlas2/x.md"])).toEqual(["Atlas", "Atlas2/x.md"]);
  });
});

describe("copyCandidate", () => {
  it("inserts the suffix before the extension and counts from 2", () => {
    expect(copyCandidate("Atlas/Idee.md", "Kopie", 1)).toBe("Atlas/Idee (Kopie).md");
    expect(copyCandidate("Atlas/Idee.md", "Kopie", 2)).toBe("Atlas/Idee (Kopie 2).md");
    expect(copyCandidate("foto.png", "Copy", 3)).toBe("foto (Copy 3).png");
  });

  it("appends for extension-less names", () => {
    expect(copyCandidate("Atlas/Ordnernotiz", "Kopie", 1)).toBe("Atlas/Ordnernotiz (Kopie)");
  });
});
