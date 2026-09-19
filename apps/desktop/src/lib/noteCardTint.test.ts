import { describe, expect, it } from "vitest";
import { cardColorOf, noteCardTint, noteColorOfRow, withNoteColor } from "@plainva/ui";

/**
 * The colour of a note's card (finding 2026-09-19: "colour the whole board
 * card, like on the pinboard"). One module reads, mixes and writes it, so the
 * pinboard and the board cannot drift apart - these pin its rules.
 */
describe("the note's own colour on a database row", () => {
  it("reads the indexed plainva object, decoded or still a JSON string", () => {
    expect(noteColorOfRow({ plainva: { header_color: "#c94f4f" } })).toBe("#c94f4f");
    expect(noteColorOfRow({ plainva: JSON.stringify({ header_color: "#2F6F8F" }) })).toBe("#2f6f8f");
    // Short hex is normalised the way the database filter reads it.
    expect(noteColorOfRow({ plainva: { header_color: "#abc" } })).toBe("#aabbcc");
  });

  it("is null for a note without a colour and for anything that is not a hex colour", () => {
    expect(noteColorOfRow({})).toBeNull();
    expect(noteColorOfRow({ plainva: { icon: "x" } })).toBeNull();
    expect(noteColorOfRow({ plainva: { header_color: "red; background:url(x)" } })).toBeNull();
    expect(noteColorOfRow({ plainva: "{not json" })).toBeNull();
  });
});

describe("the tint", () => {
  it("is the pinboard's formula, on whichever ground the card stands", () => {
    expect(noteCardTint("#c94f4f")).toBe("color-mix(in srgb, #c94f4f calc(var(--pinboard-tint, 16) * 1%), var(--bg-secondary))");
    expect(noteCardTint("#c94f4f", "var(--bg-primary)")).toBe("color-mix(in srgb, #c94f4f calc(var(--pinboard-tint, 16) * 1%), var(--bg-primary))");
  });
});

describe("which colour a board card takes", () => {
  const priority = { key: "priority", options: [{ value: "high", color: "coral" }, { value: "low" }] };

  it("the note's own colour wins over the view's colour-by property", () => {
    expect(cardColorOf({ plainva: { header_color: "#2f6f8f" }, priority: "high" }, priority)).toBe("#2f6f8f");
  });

  it("without one, the option colour of the colour-by property - curated first, else derived from the value", () => {
    expect(cardColorOf({ priority: "high" }, priority)).toBe("#d85a30");
    expect(cardColorOf({ priority: "low" }, priority)).toMatch(/^#[0-9a-f]{6}$/);
    // The row may carry the bare key while the view names it with the note. prefix.
    expect(cardColorOf({ priority: "high" }, { ...priority, key: "note.priority" })).toBe("#d85a30");
    // A list takes its first value.
    expect(cardColorOf({ priority: ["high", "low"] }, priority)).toBe("#d85a30");
  });

  it("a plain card otherwise", () => {
    expect(cardColorOf({ priority: "high" }, null)).toBeNull();
    expect(cardColorOf({ priority: "" }, priority)).toBeNull();
    expect(cardColorOf({}, priority)).toBeNull();
  });
});

describe("writing the colour", () => {
  it("sets and removes plainva.header_color and leaves the rest of the note alone", () => {
    const note = "---\ntitle: A\n---\n# A\n\nText.\n";
    const coloured = withNoteColor(note, "#c94f4f");
    expect(coloured).toContain("header_color");
    expect(coloured).toContain("#c94f4f");
    expect(coloured.endsWith("# A\n\nText.\n")).toBe(true);
    expect(withNoteColor(coloured, null)).not.toContain("header_color");
  });
});
