// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { formulaHoldsWikiLink, prepareReaderSource, remarkFormulasYieldToLinks } from "@plainva/core";
import { markdownToPlainText, rehypeReaderSource } from "@plainva/ui";
import { remarkStripHtmlComments } from "../components/markdownReaderModel";
import FROZEN_MAIN from "./readerFormulas.main.json";
import FROZEN_MAIN_PLACES from "./readerFormulaPlaces.main.json";

/**
 * Edges of the reading view (Fehlerliste 0.9.0, B3 to B5), through the text
 * the reader prepares and the renderer with its formulas, as `MarkdownReader`
 * takes them: the formulas giving way to links first, then the parse's own.
 */
function html(content: string): string {
  const source = prepareReaderSource(content, { tables: true });
  return renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkFormulasYieldToLinks(source), remarkGfm, remarkStripHtmlComments, remarkMath]} urlTransform={(url) => url}>{source.text}</ReactMarkdown>,
  );
}

function element(markup: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = markup;
  return container;
}

const read = (content: string) => element(html(content));

/** The same, with the source places `MarkdownReader` gives each element (`rehypeReaderSource`). */
function placed(content: string): HTMLElement {
  const source = prepareReaderSource(content, { tables: true });
  return element(renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkFormulasYieldToLinks(source), remarkGfm, remarkStripHtmlComments, remarkMath]} rehypePlugins={[rehypeReaderSource(source, content) as never]} urlTransform={(url) => url}>{source.text}</ReactMarkdown>,
  ));
}

/** Each element with a place, as `tag from to line`. */
const places = (el: HTMLElement) => [...el.querySelectorAll("[data-source-from]")].map((node) => ({
  text: `${node.tagName.toLowerCase()} ${node.getAttribute("data-source-from")} ${node.getAttribute("data-source-to")} ${node.getAttribute("data-source-line") ?? ""}`,
  from: Number(node.getAttribute("data-source-from")),
  to: Number(node.getAttribute("data-source-to")),
}));

const links = (el: HTMLElement) => [...el.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
const formulas = (el: HTMLElement) => [...el.querySelectorAll(".language-math")].map((m) => m.textContent);
/** Each formula with its kind: `i:` inline, `d:` a block. */
const kindedFormulas = (el: HTMLElement) => [...el.querySelectorAll(".language-math")].map((m) => `${m.classList.contains("math-display") ? "d" : "i"}:${m.textContent}`);
/** Where the wiki links and embeds of a rendering lead. */
const wikiTargets = (el: HTMLElement) => [...el.querySelectorAll("a[href^='wiki'], img[src^='wiki']")].map((node) => node.getAttribute("href") ?? node.getAttribute("src") ?? "");
/** The wiki links and embeds a formula of main's rendering took in, written as in the text it was handed. */
const takenIn = (formula: string) => [...formula.matchAll(/\]\((wiki(?:-[a-z]+)?:\/\/[^)\s]*)\)/g)].map((match) => match[1]);
/** `list` without one of each of `taken`. */
const without = (list: string[], taken: string[]) => {
  const left = [...list];
  for (const item of taken) {
    const at = left.indexOf(item);
    if (at >= 0) left.splice(at, 1);
  }
  return left;
};
const backslashes = (markup: string) => (markup.match(/\\|%5C/gi) ?? []).length;

describe("the reading view of a wiki link", () => {
  it("behind a `]` is the link, not the label of a reference", () => {
    const el = read("[x][[a]]\n\n[a]: https://e.com");
    expect(links(el)).toEqual([["a", "wiki://a"]]);
    expect(el.textContent).toBe("[x]a");
  });

  it("with an alias over a delimiter row stays in a paragraph, as in the note", () => {
    const el = read("[[a|b]] | c\n|---|---|\n");
    expect(el.querySelector("table")).toBeNull();
    expect(links(el)).toEqual([["b", "wiki://a"]]);
    expect(el.textContent).toBe("b | c\n|---|---|");
    // A table the note has stays one.
    expect(read("| [[a\\|b]] | c |\n|---|---|\n").querySelector("table th a")?.getAttribute("href")).toBe("wiki://a");
    // The plain text of a card (the phone's embeds) reads no sign of it.
    expect(markdownToPlainText(prepareReaderSource("[[a|b]] | c\n|---|---|\nnext").text)).toBe(markdownToPlainText("b | c\n|---|---|\nnext"));
    // A line with too many cells for the row makes no table in the note or
    // here, and gets nothing: a formula over it shows no sign of a comment.
    const formula = read("[[Notiz|n]] - $5 | a | b |\n|---|---|\n| $5");
    expect(formula.innerHTML).not.toContain("&lt;!--");
  });

  it("is never taken into a formula, and every other formula stays one", () => {
    const el = read("Preis $3 [[Notiz]] und $4, dazu $x^2$");
    expect(links(el)).toEqual([["Notiz", "wiki://Notiz"]]);
    expect(formulas(el)).toEqual(["x^2"]);
    expect(el.textContent).toContain("Preis $3 Notiz und $4");
    const inside = read("Sei $a [[b]] c$ und $y$\n\n$$\nx = [[b]]\n$$\n\n$$z$$");
    expect(links(inside)).toEqual([["b", "wiki://b"], ["b", "wiki://b"]]);
    expect(formulas(inside)).toEqual(["y", "z"]);
  });

  it("reads a block formula over a link as one paragraph of its lines, which opens no block", () => {
    // What Markdown would read as a block in a line of such a formula (a
    // footnote's definition, a table, a list, a heading, code) stays text of
    // the paragraph: no sign main shows is gone, no footnote section is made.
    // In a quote the marks of the container stay out of the text.
    const cases: Array<[string, string, string[]]> = [
      ["$$\n[^1]: [[A]] text\n$$", "$$\n[^1]: A text\n$$", ["wiki://A"]],
      ["$$\n$$||\n-|-\nA||[[m]]", "$$\n$$||\n-|-\nA||m", ["wiki://m"]],
      ["$$[^1]![[H]]\n[^1]:\n$$\n$", "$$[^1]\n[^1]:\n$$", ["wiki-embed://H"]],
      ["$$\na^2 + [[x]]\n- b^2\n$$", "$$\na^2 + x\n- b^2\n$$", ["wiki://x"]],
      ["$$\n# H [[A]]\n- item\n$$", "$$\n# H A\n- item\n$$", ["wiki://A"]],
      ["1. x\n$$\n\n    $$[[2]]", "$$\n\n$$2", ["wiki://2"]],
      ["> $$\n> a = [[B]]\n> $$\n> next", "$$\na = B\n$$", ["wiki://B"]],
      ["$$\n[[A]] x\n```\ny\n$$", "$$\nA x\n```\ny\n$$", ["wiki://A"]],
      ["$$\n[[g]]$a$", "$$\ng$a$", ["wiki://g"]],
    ];
    for (const [form, text, targets] of cases) {
      const el = read(form);
      expect(formulas(el), form).toEqual([]);
      expect(wikiTargets(el), form).toEqual(targets);
      expect(el.querySelector("p")?.textContent, form).toBe(text);
      expect(el.querySelectorAll("ul, h1, h2, table, pre, section, sup").length, form).toBe(0);
      expect(el.querySelectorAll("ol").length, form).toBe(form.startsWith("1.") ? 1 : 0);
      expect(el.querySelectorAll("blockquote").length, form).toBe(form.startsWith(">") ? 1 : 0);
    }
  });

  it("writes in no sign that shows: not where a line may be code, not under a line a heading reads", () => {
    // Behind the block, the indented line is code: it stays as it is written.
    const code = html("$$\nx\n$$\n    ][[B]]");
    expect(code).not.toContain("&lt;!--");
    expect([...element(code).querySelectorAll("pre code")].map((node) => node.textContent)).toEqual(["x", "][B](wiki://B)\n"]);
    // Under a delimiter row a `---` or `===` makes the lines a heading, as in
    // the note — never a table the note does not have.
    for (const [under, tag] of [["---", "h2"], ["===", "h1"]]) {
      const el = read(`[[a|b]] | c\n|---|---|\n${under}\n`);
      expect(el.querySelector("table"), under).toBeNull();
      expect(el.querySelector(tag)?.textContent, under).toBe("b | c\n|---|---|");
    }
    // A heading's own underline is never taken for a row: it stays a heading.
    const heading = html("x [[A|a|b]]\n---\n");
    expect(heading).not.toContain("&lt;!--");
    expect(element(heading).querySelector("h2")?.textContent).toBe("x a|b");
  });

  it("decides with the editor which formula holds a link, by one function", () => {
    const inners = ["x [[a]] y", "[[a\\]b]]", "[[a]b]]", "[[a[b]]", "[[ ]]", "[[]]", "\\[[a]]", "\\text{[[a]]}", "[[#H]]", "[[|x]]", "[[a|b|c]]", "![[img.png]]", "[[a\\|b]]", "[[<b>]]", "[[a]]]", "[[[a]]]", "[[a%%b]]", "A[[1,2]]", "[[a]] `c`", "a [[b", "[[ a ]]", "[[a\tb]]", "[[a^b]]", "[[*a*]]", "[[x|]]"];
    const forms: Array<[string, string]> = [];
    for (const inner of inners) forms.push([`x $${inner}$ y`, `$${inner}$`], [`$$\n${inner}\n$$`, `$$\n${inner}\n$$`]);
    for (const inner of ["[[x\ny]]", "a\n[[b]]\nc", "[[a]]\n\\\\ b"]) forms.push([`$$\n${inner}\n$$`, `$$\n${inner}\n$$`]);
    expect(forms).toHaveLength(53);
    for (const [note, written] of forms) expect(formulas(read(note)).length === 0, note).toBe(formulaHoldsWikiLink(written));
  });

  it("reads every block formula of a random note: over a link one paragraph of its lines, else a formula", () => {
    let seed = 7;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
    // What would open a block at the start of a line, and words a formula has.
    const starts = ["", "", "- ", "* ", "+ ", "# ", "## ", "1. ", "2) ", "> ", "    ", "[^1]: ", "[a]: ", "| ", "-|-", "```", "~~~", "***", "===", "---", ":--|--"];
    const words = ["a", "x^2", "b_1", "+", "=", "|", "$", "[^1]", "[x]", "\\frac{1}{2}", "y"];
    const linkOf = /\[\[(L\d+)\]\]/g;
    for (let round = 0; round < 300; round++) {
      const blocks: Array<{ lines: string[]; link: boolean }> = [];
      for (let count = 1 + Math.floor(random() * 3); count > 0; count--) {
        const lines: string[] = [];
        let link = false;
        for (let many = Math.floor(random() * 4); many > 0; many--) {
          let line = pick(starts);
          for (let w = Math.floor(random() * 3); w >= 0; w--) {
            if (random() < 0.2) {
              line += `[[L${round}]] `;
              link = true;
            } else line += `${pick(words)} `;
          }
          lines.push(line.trimEnd());
        }
        if (!link) lines.push("z");
        blocks.push({ lines, link });
      }
      const note = blocks.map((block) => ["$$", ...block.lines, "$$"].join("\n")).join("\n\n");
      // A link is one where the note has one: a fence a line opens makes what
      // follows code, there and at main.
      const source = prepareReaderSource(note, { tables: true });
      const live = new Set(source.wikiLinks.map(([from]) => source.toOriginal(from)));
      let at = 0;
      const expected = blocks.map((block) => {
        at += 3;
        const targets: string[] = [];
        const lines = block.lines.map((line) => {
          const shown = line.replace(linkOf, (written, name: string, index: number) => {
            if (!live.has(at + index)) return written;
            targets.push(`wiki://${name}`);
            return name;
          });
          at += line.length + 1;
          return shown.trim();
        });
        at += 4;
        return { text: ["$$", ...lines, "$$"].join("\n"), targets };
      });
      const linked = expected.filter((block) => block.targets.length > 0);
      const el = read(note);
      expect([...el.querySelectorAll("p")].map((p) => p.textContent), note).toEqual(linked.map((block) => block.text));
      expect(formulas(el), note).toHaveLength(blocks.length - linked.length);
      expect(el.querySelectorAll("ul, ol, h1, h2, table, blockquote, section, sup, hr").length, note).toBe(0);
      expect(el.querySelectorAll("pre").length, note).toBe(blocks.length - linked.length);
      expect(wikiTargets(el), note).toEqual(linked.flatMap((block) => block.targets));
      expect(html(note), note).not.toContain("&lt;!--");
    }
  });

  it("gives back every kind of wiki link and embed, and leaves a Markdown link where main has it", () => {
    const cases: Array<[string, string[], string]> = [
      ["a $x ![[bild.png]] y$ b", ["wiki-image://bild.png"], "a $x  y$ b"],
      ["a $x ![[A]] y$ b", ["wiki-embed://A"], "a $x  y$ b"],
      ["a $x [[A|alias]] y$ b", ["wiki://A"], "a $x alias y$ b"],
      ["a $x [[A#h]] y$ b", ["wiki://A%23h"], "a $x A#h y$ b"],
      ["a $x [[P $5]] y$ b", ["wiki://P%20%245"], "a $x P $5 y$ b"],
      ["a $x [[A|q $ r]] y$ b", ["wiki://A"], "a $x q $ r y$ b"],
    ];
    for (const [form, targets, text] of cases) {
      const el = read(form);
      expect(wikiTargets(el), form).toEqual(targets);
      expect(formulas(el), form).toEqual([]);
      expect(el.textContent, form).toBe(text);
    }
    // The rule is the wiki link's (B4): a Markdown link in a formula stays
    // in it, as at main — a named limit of this rule.
    const markdown = read("a $x [t](ziel.md) y$ b");
    expect(formulas(markdown)).toEqual(["x [t](ziel.md) y"]);
    expect(markdown.querySelector("a")).toBeNull();
  });

  it("reads what a formula held without formulas, and the formula behind it stays one", () => {
    // At main one formula up to the first closing sign, then `$x$`.
    const el = read("Vorher $a [[L]] b$ c $x$ nachher");
    expect(links(el)).toEqual([["L", "wiki://L"]]);
    expect(formulas(el)).toEqual(["x"]);
    expect(el.textContent).toBe("Vorher $a L b$ c x nachher");
  });

  // In a quote, a callout, a list item and a table cell, on one line and over
  // two (a cell has one line only; there, one formula over a link and one
  // without): every element before and behind the formula keeps the place
  // main gives it, the link stands at the place of its `[[…]]`, and the
  // containers are main's.
  it("keeps the places of the elements around it, in every container", () => {
    for (const [form, rendered] of Object.entries(FROZEN_MAIN_PLACES as Record<string, string>)) {
      const before = element(rendered), after = placed(form);
      const taken = [...before.querySelectorAll(".language-math")].filter((node) => takenIn(node.textContent ?? "").length > 0).map((node) => {
        const holder = node.closest("[data-source-from]")!;
        return [Number(holder.getAttribute("data-source-from")), Number(holder.getAttribute("data-source-to"))] as const;
      });
      expect(taken.length, form).toBe(1);
      const [from, to] = taken[0];
      const outside = (list: ReturnType<typeof places>) => list.filter((place) => place.to <= from || place.from >= to).map((place) => place.text);
      expect(outside(places(after)), form).toEqual(outside(places(before)));
      for (const tag of ["blockquote", "ul", "li", "table", "td", "pre"]) {
        expect(after.querySelectorAll(tag).length, `${form} — ${tag}`).toBe(tag === "pre" ? 0 : before.querySelectorAll(tag).length);
      }
      const name = /\[\[[^\]]+\]\]/.exec(form)!;
      const link = after.querySelector("a[href^='wiki']")!;
      expect([link.getAttribute("data-source-from"), link.getAttribute("data-source-to")], form).toEqual([String(name.index), String(name.index + name[0].length)]);
      expect(formulas(after), form).toEqual(formulas(before).filter((formula) => takenIn(formula ?? "").length === 0));
    }
  });

  // The rule of the coordination (Fehlerliste 0.9.0, F45 and the reviews
  // after it): the note is read once, as main reads it, and only a formula
  // over a wiki link gives way. main's renderings as of 2026-11-17 and
  // 2026-11-18 (`readerFormulas.main.json`), frozen: where main takes no link
  // into a formula, the rendering is main's; where it does, the formulas are
  // main's without those, every link of main stays and the taken ones come
  // back, and no backslash and no comment shows that main does not show.
  it("renders as main rendered, but for a formula over a link", () => {
    for (const [form, rendered] of Object.entries(FROZEN_MAIN as Record<string, string>)) {
      const head = html(form);
      const before = element(rendered), after = element(head);
      const mainFormulas = kindedFormulas(before), headFormulas = kindedFormulas(after);
      const gone = without(mainFormulas, headFormulas);
      if (gone.length === 0) {
        expect(head, form).toBe(rendered);
        continue;
      }
      expect(without(headFormulas, mainFormulas), form).toEqual([]);
      // Each formula gone held a link: in it, or on the line of a `$$` behind its signs.
      for (const formula of gone) expect(takenIn(formula).length > 0 || (formula.startsWith("d:") && /\$\$[^\n]*\[\[/.test(form)), `${form} — ${formula}`).toBe(true);
      expect(without(wikiTargets(before), wikiTargets(after)), form).toEqual([]);
      expect(without(gone.flatMap(takenIn), without(wikiTargets(after), wikiTargets(before))), form).toEqual([]);
      expect(backslashes(head), form).toBeLessThanOrEqual(backslashes(rendered));
      expect(head, form).not.toContain("&lt;!--");
    }
  });
});
