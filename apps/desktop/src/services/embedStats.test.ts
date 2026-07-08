import { describe, it, expect } from "vitest";
import { computeEmbedInfo } from "./embedStats";

const counts = (o: Record<string, number>) => new Map(Object.entries(o));

describe("computeEmbedInfo", () => {
  it("returns zeros when there are no embeds", () => {
    expect(computeEmbedInfo("# Title\n\nJust prose.", counts({}))).toEqual({ bases: 0, baseEntries: 0, notes: 0 });
  });

  it("counts one embedded base and its entries (matched by filename across folders)", () => {
    const md = "Intro\n\n![[Efforts/Projekte_Cockpit.base]]\n";
    expect(computeEmbedInfo(md, counts({ "Efforts/Projekte_Cockpit.base": 12 }))).toEqual({ bases: 1, baseEntries: 12, notes: 0 });
  });

  it("sums entries across multiple distinct bases", () => {
    const md = "![[A.base]] text ![[sub/B.base]]";
    expect(computeEmbedInfo(md, counts({ "A.base": 3, "sub/B.base": 5 }))).toEqual({ bases: 2, baseEntries: 8, notes: 0 });
  });

  it("de-duplicates a base embedded twice (one base, counted once)", () => {
    const md = "![[Tasks.base]]\n\n![[Tasks.base]]";
    expect(computeEmbedInfo(md, counts({ "Tasks.base": 7 }))).toEqual({ bases: 1, baseEntries: 7, notes: 0 });
  });

  it("still reports the base when its row count isn't known yet", () => {
    expect(computeEmbedInfo("![[Unloaded.base]]", counts({}))).toEqual({ bases: 1, baseEntries: 0, notes: 0 });
  });

  it("strips a #section and |alias from the reference", () => {
    const md = "![[Data.base#View|My alias]]";
    expect(computeEmbedInfo(md, counts({ "Data.base": 4 }))).toEqual({ bases: 1, baseEntries: 4, notes: 0 });
  });

  it("counts note embeds separately and ignores image embeds", () => {
    const md = "![[Daily Note]]\n![[Other.md]]\n![[diagram.png]]\n![[photo.JPG]]";
    expect(computeEmbedInfo(md, counts({}))).toEqual({ bases: 0, baseEntries: 0, notes: 2 });
  });

  it("handles a mix of bases and notes", () => {
    const md = "![[Board.base]] and ![[Notes/Weekly]] plus ![[cover.svg]]";
    expect(computeEmbedInfo(md, counts({ "Board.base": 9 }))).toEqual({ bases: 1, baseEntries: 9, notes: 1 });
  });
});
