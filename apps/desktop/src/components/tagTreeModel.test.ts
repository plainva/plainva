import { describe, expect, it } from "vitest";
import { pruneTagTree, type TagNode } from "./tagTreeModel";

const node = (fullTag: string, children: Record<string, TagNode> = {}): TagNode => ({
  name: fullTag.split("/").pop()!,
  fullTag,
  count: 1,
  children,
  isExpanded: false,
});

const tree = (): Record<string, TagNode> => ({
  projekt: node("projekt", {
    intern: node("projekt/intern"),
    extern: node("projekt/extern"),
  }),
  archiv: node("archiv"),
});

describe("pruneTagTree", () => {
  it("returns the tree unchanged for an empty or whitespace query", () => {
    const input = tree();
    expect(pruneTagTree(input, "")).toBe(input);
    expect(pruneTagTree(input, "   ")).toBe(input);
  });

  it("keeps parents of matching children and drops the rest", () => {
    const pruned = pruneTagTree(tree(), "intern");
    expect(Object.keys(pruned)).toEqual(["projekt"]);
    expect(Object.keys(pruned.projekt.children)).toEqual(["intern"]);
  });

  it("keeps the whole subtree under a matching parent", () => {
    const pruned = pruneTagTree(tree(), "projekt");
    expect(Object.keys(pruned)).toEqual(["projekt"]);
    expect(Object.keys(pruned.projekt.children)).toEqual(["intern", "extern"]);
  });

  it("matches case-insensitively", () => {
    expect(Object.keys(pruneTagTree(tree(), "ARCHIV"))).toEqual(["archiv"]);
  });

  it("returns an empty tree when nothing matches", () => {
    expect(pruneTagTree(tree(), "nichtda")).toEqual({});
  });
});
