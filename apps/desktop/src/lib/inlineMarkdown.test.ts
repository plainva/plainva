import { describe, expect, it } from "vitest";
import { parseInlineMarkdown, type InlineNode } from "./inlineMarkdown";

const text = (t: string): InlineNode => ({ kind: "text", text: t });

describe("parseInlineMarkdown", () => {
  it("parses bold, italic and bold-italic", () => {
    expect(parseInlineMarkdown("a **b** c")).toEqual([
      text("a "),
      { kind: "strong", children: [text("b")] },
      text(" c"),
    ]);
    expect(parseInlineMarkdown("*kursiv*")).toEqual([{ kind: "em", children: [text("kursiv")] }]);
    expect(parseInlineMarkdown("***beides***")).toEqual([{ kind: "strongEm", children: [text("beides")] }]);
  });

  it("parses nested emphasis inside bold", () => {
    expect(parseInlineMarkdown("**a *b* c**")).toEqual([
      { kind: "strong", children: [text("a "), { kind: "em", children: [text("b")] }, text(" c")] },
    ]);
  });

  it("parses strikethrough and highlight", () => {
    expect(parseInlineMarkdown("~~weg~~ ==markiert==")).toEqual([
      { kind: "strike", children: [text("weg")] },
      text(" "),
      { kind: "highlight", children: [text("markiert")] },
    ]);
  });

  it("keeps inline-code content verbatim (markers inside are not parsed)", () => {
    expect(parseInlineMarkdown("`**nicht fett**`")).toEqual([{ kind: "code", text: "**nicht fett**" }]);
  });

  it("honours backslash escapes", () => {
    expect(parseInlineMarkdown("\\*kein\\* Stern")).toEqual([text("*kein* Stern")]);
  });

  it("parses wiki links with alias and anchor", () => {
    expect(parseInlineMarkdown("[[Ziel|Alias]]")).toEqual([{ kind: "wikiLink", target: "Ziel", display: "Alias" }]);
    expect(parseInlineMarkdown("[[Ziel#Abschnitt]]")).toEqual([
      { kind: "wikiLink", target: "Ziel", display: "Ziel#Abschnitt" },
    ]);
    // Embed prefix is tolerated and treated as a link to the target.
    expect(parseInlineMarkdown("![[Bild.png]]")).toEqual([{ kind: "wikiLink", target: "Bild.png", display: "Bild.png" }]);
  });

  it("parses markdown links and classifies external vs vault-relative", () => {
    expect(parseInlineMarkdown("[x](https://a.example)")).toEqual([
      { kind: "link", href: "https://a.example", label: "x", external: true },
    ]);
    expect(parseInlineMarkdown("[Notiz](Ordner/Notiz.md)")).toEqual([
      { kind: "link", href: "Ordner/Notiz.md", label: "Notiz", external: false },
    ]);
  });

  it("parses bare URLs and leaves trailing punctuation as text", () => {
    expect(parseInlineMarkdown("siehe https://ex.example/pfad, Ende")).toEqual([
      text("siehe "),
      { kind: "url", href: "https://ex.example/pfad" },
      text(", Ende"),
    ]);
  });

  it("parses all <br> variants as line breaks", () => {
    for (const br of ["<br>", "<br/>", "<br />", "<BR>"]) {
      expect(parseInlineMarkdown(`a${br}b`)).toEqual([text("a"), { kind: "br" }, text("b")]);
    }
  });

  it("drops HTML comments like the read view does", () => {
    expect(parseInlineMarkdown("a <!-- geheim --> b")).toEqual([text("a  b")]);
  });

  it("keeps other HTML literal (no innerHTML injection surface)", () => {
    expect(parseInlineMarkdown("<img src=x onerror=alert(1)>")).toEqual([text("<img src=x onerror=alert(1)>")]);
    expect(parseInlineMarkdown("<b>kein HTML</b>")).toEqual([text("<b>kein HTML</b>")]);
  });

  it("does not emphasize intraword underscores", () => {
    expect(parseInlineMarkdown("snake_case_name")).toEqual([text("snake_case_name")]);
    expect(parseInlineMarkdown("_echt kursiv_")).toEqual([{ kind: "em", children: [text("echt kursiv")] }]);
    expect(parseInlineMarkdown("__echt fett__")).toEqual([{ kind: "strong", children: [text("echt fett")] }]);
  });
});
