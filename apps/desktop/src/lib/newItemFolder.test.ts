import { describe, expect, it } from "vitest";
import { applyNewItemFolder, newItemFolderMode, resolveNewItemTarget, suggestNewItemFolder } from "@plainva/ui";

/** Build-91 feedback, P2: the one storage-folder rule both shells run. */
describe("newItemFolder", () => {
  const tagBase = { filters: { and: ['file.hasTag("zettel")'] }, views: [{ type: "table", name: "Pinnwand" }] };
  const bareBase = { views: [{ type: "table", name: "T" }] };
  const twoFolders = { filters: { or: ['file.folder == "A"', 'file.folder == "B"'] } };

  it("a tag-sourced base keeps its tags and only remembers the folder", () => {
    const next = applyNewItemFolder(tagBase, "/Zettel/", "setup");
    expect(next.newItemFolder).toBe("Zettel");
    expect(next.filters.and).toEqual(['file.hasTag("zettel")']);
    expect(resolveNewItemTarget(next).folder).toBe("Zettel");
    expect(resolveNewItemTarget(next).inheritTags).toEqual(["zettel"]);
    // The input is untouched.
    expect((tagBase as any).newItemFolder).toBeUndefined();
  });

  it("a base without any source gets the folder as its source", () => {
    const next = applyNewItemFolder(bareBase, "Notizen/Neu", "setup");
    expect(next.filters.and).toEqual(['file.folder == "Notizen/Neu"']);
    expect(next.newItemFolder).toBe("Notizen/Neu");
    expect(applyNewItemFolder(next, "Notizen/Neu", "setup").filters.and).toHaveLength(1);
  });

  it("choosing between folder sources changes no source", () => {
    const next = applyNewItemFolder(twoFolders, "B", "choice");
    expect(next.filters.or).toEqual(['file.folder == "A"', 'file.folder == "B"']);
    expect(next.newItemFolder).toBe("B");
  });

  it("an empty answer is no answer", () => {
    expect(applyNewItemFolder(tagBase, "  / ", "setup")).toBeNull();
  });

  it("knows when the question is needed and what to suggest", () => {
    expect(newItemFolderMode(resolveNewItemTarget(tagBase))).toBe("setup");
    expect(newItemFolderMode(resolveNewItemTarget(twoFolders))).toBe("choice");
    expect(newItemFolderMode(resolveNewItemTarget({ filters: { and: ['file.folder == "A"'] } }))).toBeNull();
    expect(suggestNewItemFolder("Zettel.base", tagBase)).toBe("Zettel");
    expect(suggestNewItemFolder("Datenbanken/Zettel.base", tagBase)).toBe("Datenbanken/Zettel");
    expect(suggestNewItemFolder("x.base", twoFolders)).toBe("A");
    expect(suggestNewItemFolder("x.base", { ...tagBase, newItemFolder: "/Mine/" })).toBe("Mine");
  });
});
