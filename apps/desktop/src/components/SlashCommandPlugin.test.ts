import { describe, it, expect } from "vitest";
import { getSlashCommands, filterSlashCommands } from "@plainva/ui";

const EXPECTED_TYPES = [
  // Grundlagen
  "text", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "task", "quote", "code", "table", "hr", "math", "mermaid",
  // Text formatieren
  "bold", "italic", "strike", "inlinecode", "highlight", "footnote", "emoji",
  // Verknüpfen & Einbetten
  "link", "wikilink", "image", "internalimage", "embed", "embedbase", "newbase",
  // Dokument (Icon + Header-Farbe, W3)
  "icon", "headercolor",
  // Callouts (Obsidian variants)
  "callout-note", "callout-info", "callout-todo", "callout-abstract", "callout-tip",
  "callout-success", "callout-question", "callout-warning", "callout-failure",
  "callout-danger", "callout-bug", "callout-example", "callout-quote",
];

const CALLOUT_TYPES = EXPECTED_TYPES.filter((t) => t.startsWith("callout-"));

describe("getSlashCommands", () => {
  const commands = getSlashCommands();

  it("returns the full markdown command set in display order", () => {
    expect(commands.map((c) => c.type)).toEqual(EXPECTED_TYPES);
  });

  it("gives every command a title, icon type, description, section and apply payload", () => {
    for (const c of commands) {
      expect(typeof c.label).toBe("string");
      expect(c.label.length).toBeGreaterThan(0);
      expect(typeof c.type).toBe("string");
      expect(typeof c.description).toBe("string");
      expect((c.description ?? "").length).toBeGreaterThan(0);
      expect(c.section).toBeTruthy();
      expect(["string", "function"]).toContain(typeof c.apply);
    }
  });

  it("has unique icon types", () => {
    const types = commands.map((c) => c.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it("groups commands into the five ranked sections", () => {
    const rank = (type: string) => {
      const s = commands.find((c) => c.type === type)?.section;
      return typeof s === "object" ? s.rank : undefined;
    };
    expect(rank("h1")).toBe(1); // Grundlagen
    expect(rank("bold")).toBe(2); // Text formatieren
    expect(rank("link")).toBe(3); // Verknüpfen & Einbetten
    expect(rank("icon")).toBe(4); // Dokument
    expect(rank("headercolor")).toBe(4); // Dokument
    expect(rank("callout-warning")).toBe(5); // Callouts
  });

  it("offers every Obsidian callout variant with a canonical marker", () => {
    expect(commands.filter((c) => (c.type ?? "").startsWith("callout-")).map((c) => c.type)).toEqual(
      CALLOUT_TYPES,
    );
    for (const type of CALLOUT_TYPES) {
      const c = commands.find((x) => x.type === type)!;
      const variant = type.slice("callout-".length);
      expect(c.apply).toBe(`> [!${variant}] `);
      expect(c.detail).toBe(`[!${variant}]`);
    }
  });

  it("inserts block prefixes as strings and wraps/inline formats via functions", () => {
    const apply = (type: string) => commands.find((c) => c.type === type)?.apply;
    expect(apply("h1")).toBe("# ");
    expect(apply("ul")).toBe("- ");
    expect(apply("hr")).toBe("---");
    // Wrap-style formats place the caret themselves -> function apply.
    expect(typeof apply("bold")).toBe("function");
    expect(typeof apply("italic")).toBe("function");
    expect(typeof apply("code")).toBe("function");
    // "Text" just clears the slash -> function apply.
    expect(typeof apply("text")).toBe("function");
  });

  it("shows a markdown-syntax hint as detail for syntax commands but not for plain text", () => {
    const detail = (type: string) => commands.find((c) => c.type === type)?.detail;
    expect(detail("h2")).toBe("##");
    expect(detail("bold")).toBe("**");
    expect(detail("text")).toBeUndefined();
  });
});

describe("filterSlashCommands (dynamic narrowing)", () => {
  const types = (query: string) => filterSlashCommands(query).map((c) => c.type);

  it("returns the full list for an empty query or a bare slash", () => {
    expect(filterSlashCommands("").length).toBe(EXPECTED_TYPES.length);
    expect(filterSlashCommands("/").length).toBe(EXPECTED_TYPES.length);
  });

  it("narrows to commands whose key, title or keywords match", () => {
    // keyword shared by all headings
    expect(types("heading")).toEqual(["h1", "h2", "h3", "h4", "h5", "h6"]);
    // exact short code
    expect(types("h1")).toEqual(["h1"]);
    // English + German keywords both resolve to the same command
    expect(types("bold")).toEqual(["bold"]);
    expect(types("fett")).toEqual(["bold"]);
    // "zitat" matches both the blockquote and the quote callout variant
    expect(types("zitat")).toEqual(["quote", "callout-quote"]);
  });

  it("treats the leading slash and casing/whitespace as optional", () => {
    expect(types("/TASK")).toEqual(types("task"));
    expect(types("  WARNUNG  ")).toEqual(["callout-warning"]);
  });

  it("matches substrings across related commands", () => {
    // 'link' is a substring of 'wikilink' too
    expect(types("link")).toEqual(["link", "wikilink"]);
  });

  it("resolves /emoji to the text-insertion command only (not the document icon)", () => {
    // "emoji" was removed from the /icon keywords so the two no longer collide.
    expect(types("emoji")).toEqual(["emoji"]);
  });

  it("returns nothing when no command matches", () => {
    expect(filterSlashCommands("definitelynotacommand")).toEqual([]);
  });

  it("keeps filtered results inside their original sections", () => {
    const [bold] = filterSlashCommands("bold");
    expect(typeof bold.section === "object" && bold.section.rank).toBe(2);
  });
});

describe("callout variants", () => {
  const types = (query: string) => filterSlashCommands(query).map((c) => c.type);

  it("surfaces every callout variant under the shared 'callout' keyword", () => {
    expect(types("callout")).toEqual(CALLOUT_TYPES);
  });

  it("resolves callout aliases to the canonical variant", () => {
    expect(types("error")).toEqual(["callout-danger"]); // danger alias
    expect(types("summary")).toEqual(["callout-abstract"]); // abstract alias
    expect(types("caution")).toEqual(["callout-warning"]); // warning alias
    expect(types("faq")).toEqual(["callout-question"]); // question alias
    expect(types("info")).toEqual(["callout-info"]);
  });

  it("all callout variants live in the ranked callouts section", () => {
    for (const c of filterSlashCommands("callout")) {
      expect(typeof c.section === "object" && c.section.rank).toBe(5);
    }
  });
});
