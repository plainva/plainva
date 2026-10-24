// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import i18n from "@plainva/ui/i18n";
import { editedNoteProperties, toast, toastStore, withNoteColor, withNoteIcon } from "@plainva/ui";

/**
 * A note's icon and colour, set from the editor that holds the note (finding
 * 2026-10-09).
 *
 * Both shells change the editor's own text and hand the result back to it.
 * Each of them caught a note that refuses the change — a block at its top that
 * is no YAML map — and wrote that to the console: picking an icon did nothing
 * and said nothing. Both go through `editedNoteProperties` now; what is pinned
 * here is what it hands the editor and what it says, for the three changes the
 * two editors make.
 */

const LIST = "---\n- a\n- list\n---\n# Note\n";
const UNPARSEABLE = "---\ntitle: [unclosed\n---\nSecret line of the note\n";
const PLAIN = "---\ntype: note\nowner: Anna # kept\n---\n# Note\n";

/** The three changes an editor makes, as both shells make them. */
const CHANGES: [string, (text: string) => string][] = [
  ["an emoji as the icon", (text) => withNoteIcon(text, "🚀", null)],
  ["an icon of the set with its tint", (text) => withNoteIcon(text, "lucide:rocket", "#c94f4f")],
  ["the icon removed", (text) => withNoteIcon(text, null, null)],
  ["a colour", (text) => withNoteColor(text, "#c94f4f")],
  ["the colour removed", (text) => withNoteColor(text, null)],
];

const messages = () => toastStore.get().map((item) => `${item.kind}: ${item.message}`);

beforeEach(async () => {
  await i18n.changeLanguage("en");
  toast.clearAll();
});

describe("a note that refuses a change of its icon or colour", () => {
  it.each(CHANGES.filter(([label]) => !label.endsWith("removed")))("says so and hands the editor nothing: %s on a YAML list", (_label, change) => {
    expect(editedNoteProperties(LIST, change)).toBeNull();
    expect(messages()).toEqual([
      "error: Property could not be saved: The block at the top of the note cannot be read as properties. Correct it in the note's text and try again.",
    ]);
  });

  it.each(CHANGES)("says so without a word of the note's text: %s on YAML that cannot be parsed", (_label, change) => {
    expect(editedNoteProperties(UNPARSEABLE, change)).toBeNull();
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toMatch(/^error: Property could not be saved: The block at the top of the note cannot be read as properties\./);
    // The YAML parser's own message quotes the line it failed on.
    expect(messages()[0]).not.toContain("unclosed");
    expect(messages()[0]).not.toContain("Secret");
  });

  it("removing what a list block cannot hold is refused as well, not passed off as done", () => {
    for (const [, change] of CHANGES.filter(([label]) => label.endsWith("removed"))) {
      toast.clearAll();
      expect(editedNoteProperties(LIST, change)).toBeNull();
      expect(messages()).toHaveLength(1);
    }
  });
});

describe("a note that takes the change", () => {
  it("hands the editor the new text and says nothing", () => {
    expect(editedNoteProperties(PLAIN, (text) => withNoteIcon(text, "🚀", null))).toBe("---\ntype: note\nowner: Anna # kept\nplainva:\n  icon: 🚀\n---\n# Note\n");
    expect(messages()).toEqual([]);
  });

  it("hands the editor nothing where nothing changes, and says nothing", () => {
    expect(editedNoteProperties(PLAIN, (text) => withNoteIcon(text, null, null))).toBeNull();
    expect(editedNoteProperties(PLAIN, (text) => withNoteColor(text, null))).toBeNull();
    expect(messages()).toEqual([]);
  });
});

describe("withNoteIcon: icon and tint are one write", () => {
  const read = (text: string) => text.slice(4, text.indexOf("\n---\n", 4));

  it("an icon of the set keeps its tint, an emoji clears a stale one", () => {
    const tinted = withNoteIcon("---\ntype: note\n---\nText\n", "lucide:rocket", "#c94f4f");
    expect(read(tinted)).toBe('type: note\nplainva:\n  icon: lucide:rocket\n  icon_color: "#c94f4f"');
    expect(read(withNoteIcon(tinted, "🚀", null))).toBe("type: note\nplainva:\n  icon: 🚀");
  });

  it("removing the icon removes its tint and an emptied namespace, and leaves a colour alone", () => {
    const tinted = withNoteIcon("---\ntype: note\n---\nText\n", "lucide:rocket", "#c94f4f");
    expect(withNoteIcon(tinted, null, null)).toBe("---\ntype: note\n---\nText\n");
    const coloured = withNoteColor(tinted, "#3d7fbf");
    expect(read(withNoteIcon(coloured, null, null))).toBe('type: note\nplainva:\n  header_color: "#3d7fbf"');
  });
});
