import { describe, expect, it } from "vitest";
import { parseAnswer } from "@plainva/ui";

describe("answer blocks", () => {
  it("reads the Markdown an assistant writes", () => {
    const blocks = parseAnswer(
      [
        "## Offer",
        "The rates follow **2025**.",
        "",
        "- Concept",
        "- [x] Kick-off",
        "  - nested",
        "1. first",
        "2. second",
        "",
        "> quoted",
        "> twice",
        "",
        "```ts",
        "const a = 1;",
        "```",
        "---",
        "| Item | Price |",
        "|---|---:|",
        "| A \\| B | 1 |",
      ].join("\n"),
    );
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "list", "list", "quote", "code", "rule", "table"]);
    expect(blocks[2]).toEqual({ kind: "list", ordered: false, start: 1, items: [{ text: "Concept", depth: 0 }, { text: "Kick-off", task: "done", depth: 0 }, { text: "nested", depth: 1 }] });
    expect(blocks[3]).toMatchObject({ kind: "list", ordered: true, start: 1, items: [{ text: "first" }, { text: "second" }] });
    expect(blocks[4]).toEqual({ kind: "quote", blocks: [{ kind: "paragraph", text: "quoted\ntwice" }] });
    expect(blocks[5]).toEqual({ kind: "code", lang: "ts", text: "const a = 1;" });
    expect(blocks[7]).toEqual({ kind: "table", header: ["Item", "Price"], rows: [["A | B", "1"]] });
  });

  it("is total: a half-streamed answer and odd input parse without throwing", () => {
    expect(parseAnswer("```js\nconst a = ")).toEqual([{ kind: "code", lang: "js", text: "const a = " }]);
    for (const odd of ["", "\n\n", "|", "| a |\n|---|", "-", "1.", "> ", "#", "***", "<script>alert(1)</script>"]) {
      expect(() => parseAnswer(odd)).not.toThrow();
    }
    expect(parseAnswer("<img src=x onerror=alert(1)>")).toEqual([{ kind: "paragraph", text: "<img src=x onerror=alert(1)>" }]);
  });
});
