import { describe, expect, it } from "vitest";
import i18n from "@plainva/ui/i18n";
import { errorText, propertyNameFixed, renamedNoteProperty } from "@plainva/ui";

/**
 * A property of one note renamed in its properties surface (Sammelplan
 * § 3.173 no. 2): the desktop's panel and the phone's note sheet rename
 * through `renamedNoteProperty` — the name changes where it stands, nothing
 * else of the note does, and a name the note has already is refused.
 */
describe("renamedNoteProperty", () => {
  it("changes the name where it stands and keeps the value, its comment, the order and the line ends", () => {
    const text = "---\r\ntype: note\r\nprio: 2 # kept\r\nowner: Anna\r\n---\r\nBody\r\n";
    expect(renamedNoteProperty(text, "prio", "priority")).toBe("---\r\ntype: note\r\npriority: 2 # kept\r\nowner: Anna\r\n---\r\nBody\r\n");
  });

  it("keeps a value the reader would read otherwise", () => {
    // `title: 2024` is read as the text "2024"; renaming must not write it as one.
    expect(renamedNoteProperty("---\ntitle: 2024\n---\n", "title", "heading")).toBe("---\nheading: 2024\n---\n");
  });

  it("changes the casing of a name", () => {
    expect(renamedNoteProperty("---\nprio: 1\n---\n", "prio", "Prio")).toBe("---\nPrio: 1\n---\n");
  });

  it("refuses a name the note has, in any casing, with the vault's sentence", () => {
    for (const to of ["owner", "Owner"]) {
      let caught: unknown = null;
      try {
        renamedNoteProperty("---\nprio: 1\nowner: Anna\n---\n", "prio", to);
      } catch (e) {
        caught = e;
      }
      expect(caught, to).not.toBeNull();
      expect(errorText(caught)).toBe(i18n.t("inputRejected.propertyNameTaken"));
    }
  });

  it("refuses an entry it cannot rename where it stands, and changes nothing", () => {
    expect(() => renamedNoteProperty("---\nowner: Anna\n---\n", "missing", "other")).toThrow(/can be renamed where it stands/);
    expect(() => renamedNoteProperty("# no block\n", "owner", "other")).toThrow();
  });

  it("names the keys whose name is fixed", () => {
    for (const key of ["type", "okf_version", "status", "stale_after"]) expect(propertyNameFixed(key), key).toBe(true);
    for (const key of ["owner", "Status", "tags"]) expect(propertyNameFixed(key), key).toBe(false);
  });
});
