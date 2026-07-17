import { describe, it, expect } from "vitest";
import { parseNoteCard, toggleTaskAtIndex, inlineToPlain } from "@plainva/ui";

// Plan Pinboard P3 (E6): the card parser covers the Keep "Zettel" subset and
// its task ordinals MUST match toggleTaskAtIndex exactly.
describe("parseNoteCard", () => {
  it("strips frontmatter and extracts title, plainva header_color/icon", () => {
    const c = "---\ntitle: Einkauf\nplainva:\n  header_color: \"#c94f4f\"\n  icon: \"🛒\"\n---\nMilch und Brot\n";
    const p = parseNoteCard(c);
    expect(p.fmTitle).toBe("Einkauf");
    expect(p.color).toBe("#c94f4f");
    expect(p.icon).toBe("🛒");
    expect(p.blocks).toEqual([{ kind: "para", inline: [{ kind: "text", text: "Milch und Brot" }] }]);
  });

  it("keeps the body when the frontmatter is malformed or unterminated", () => {
    expect(parseNoteCard("---\n: bad: [\n---\nText").blocks).toHaveLength(1);
    const unterminated = parseNoteCard("---\ntitle: x\nText ohne Ende");
    expect(unterminated.fmTitle).toBeNull();
    expect(unterminated.blocks.length).toBeGreaterThan(0);
  });

  it("promotes a leading H1 and drops it from the body on request (H1 dedupe, D6)", () => {
    const p = parseNoteCard("# Titelzeile\n\nInhalt", { dropLeadingH1: true });
    expect(p.leadingH1).toBe("Titelzeile");
    expect(p.blocks).toEqual([{ kind: "para", inline: [{ kind: "text", text: "Inhalt" }] }]);
    // Not the first content -> stays a heading block.
    const later = parseNoteCard("Text\n\n# Später", { dropLeadingH1: true });
    expect(later.leadingH1).toBeNull();
    expect(later.blocks.some((b) => b.kind === "heading")).toBe(true);
  });

  it("counts task ordinals exactly like toggleTaskAtIndex (fences and quotes included)", () => {
    const c = [
      "- [ ] eins", // ordinal 0
      "```",
      "- [ ] im Code — zählt nicht",
      "```",
      "> - [x] im Zitat — zählt, rendert als Zitat", // ordinal 1
      "- [ ] zwei", // ordinal 2
    ].join("\n");
    const p = parseNoteCard(c);
    const tasks = p.blocks.filter((b) => b.kind === "task") as Extract<ReturnType<typeof parseNoteCard>["blocks"][number], { kind: "task" }>[];
    expect(tasks.map((t) => t.ordinal)).toEqual([0, 2]);
    // Cross-check: toggling ordinal 2 flips "zwei", not the quote line.
    const toggled = toggleTaskAtIndex(c, 2, true).content;
    expect(toggled).toContain("- [x] zwei");
    expect(toggled).toContain("- [ ] eins");
  });

  it("renders lists, quotes, rulers and degrades tables/math/embeds to placeholders", () => {
    const c = [
      "- Punkt",
      "1. Nummer",
      "> Zitat",
      "---",
      "| a | b |",
      "| - | - |",
      "$$",
      "x^2",
      "$$",
      "![[Andere Notiz]]",
    ].join("\n");
    const kinds = parseNoteCard(c, { maxBlocks: 20 }).blocks.map((b) => b.kind);
    // ONE placeholder each: table (both rows), math (whole $$ block), embed.
    expect(kinds).toEqual(["bullet", "bullet", "quote", "hr", "placeholder", "placeholder", "placeholder"]);
  });

  it("shows images as image blocks and code fences as a short raw preview", () => {
    const c = "![[Attachments/foto.png]]\n```js\n1\n2\n3\n4\n5\n```";
    const p = parseNoteCard(c);
    expect(p.blocks[0]).toEqual({ kind: "image", target: "Attachments/foto.png", alt: "foto.png" });
    expect(p.blocks[1]).toMatchObject({ kind: "code", lines: ["1", "2", "3", "4"], truncated: true });
  });

  it("caps the block count and reports truncation", () => {
    const c = Array.from({ length: 30 }, (_, i) => `Zeile ${i}\n`).join("\n");
    const p = parseNoteCard(c, { maxBlocks: 5 });
    expect(p.blocks).toHaveLength(5);
    expect(p.truncated).toBe(true);
  });

  it("joins soft-wrapped lines into one paragraph", () => {
    const p = parseNoteCard("erste Zeile\nzweite Zeile\n\nneuer Absatz");
    expect(p.blocks).toHaveLength(2);
    expect(inlineToPlain((p.blocks[0] as { inline: any[] }).inline)).toBe("erste Zeile zweite Zeile");
  });
});
