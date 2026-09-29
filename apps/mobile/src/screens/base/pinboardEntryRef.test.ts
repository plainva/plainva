import { describe, expect, it } from "vitest";
import { parsePinboardEntryRef, serializePinboardEntryRef, type PinboardEntryRef } from "./pinboardEntryRef";

/** The "New entry" page's nav payload (plan Befunde 2026-09-24, E17). */
describe("pinboardEntryRef", () => {
  const ref: PinboardEntryRef = {
    base: "Zettel.base",
    draft: {
      path: "Zettel/2026-09-24 09.12.05.md",
      folder: "Zettel",
      stem: "2026-09-24 09.12.05",
      initial: "---\ntype: Note\n---\n",
      caret: null,
      chips: [{ id: "tag:tags:einkauf", kind: "tag", key: "tags", value: "einkauf", from: "label" }],
    },
  };

  it("round-trips a draft, chips included", () => {
    expect(parsePinboardEntryRef(serializePinboardEntryRef(ref))).toEqual(ref);
  });

  it("is total: a malformed or outdated value yields null instead of throwing", () => {
    expect(parsePinboardEntryRef("")).toBeNull();
    expect(parsePinboardEntryRef("not json")).toBeNull();
    expect(parsePinboardEntryRef(JSON.stringify({ draft: { path: "" } }))).toBeNull();
    expect(parsePinboardEntryRef(JSON.stringify({ base: "x" }))).toBeNull();
  });

  it("drops chips it cannot read and keeps the rest of the draft", () => {
    const raw = JSON.parse(serializePinboardEntryRef(ref));
    raw.draft.chips.push({ id: 1 }, null);
    raw.draft.caret = "7";
    const parsed = parsePinboardEntryRef(JSON.stringify(raw));
    expect(parsed?.draft.chips).toHaveLength(1);
    expect(parsed?.draft.caret).toBeNull();
  });
});
