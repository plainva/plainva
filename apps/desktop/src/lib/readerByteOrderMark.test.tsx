// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { prepareReaderSource, selectNoteFragment } from "@plainva/core";
import { findSourceTextRange, parseHeadings, readSourceSelection, rehypeReaderDirection, rehypeReaderSource } from "@plainva/ui";
import { remarkBrToBreak, remarkHtmlCheckbox, remarkMappedBreaks, remarkStripHighlightMarks, remarkStripHtmlComments, remarkTagPills, remarkTaskStates } from "../components/markdownReaderModel";

/**
 * The reading view and a note that starts with a byte order mark
 * (finding 2026-10-09).
 *
 * The note an editor shows reaches the reading view as the editor holds it,
 * without a mark. An EMBEDDED note is read from its file (`EmbeddedNote`), and
 * its text is the file's: with the mark. The places of its blocks were counted
 * without it, so the properties block was cut out one character early — the
 * mark went with it and the last `-` of the closing fence stayed as the first
 * line of the embed —, an embedded section began in front of its heading and
 * lost its last character, and each heading was looked up one line too high.
 *
 * These tests take the way the reading view takes — the fragment of the file,
 * the prepared text, the renderer with the reader's own plugins, the source
 * map — for the same note with and without a mark.
 */

// Built at run time: the character is not typed into this file.
const MARK = String.fromCharCode(0xfeff);

const NOTE = [
  "---", "title: Day", "tags: [a, b]", "---", "# Day", "", "First [[Other|paragraph]] with ==light== and a #tag ^intro", "",
  "## Über", "", "- [ ] open task", "- [x] done task", "", "### Detail", "", "Last words of the section", "", "## Über", "", "The second one of that name.",
].join("\n");

/** What `MarkdownReader` renders for `content`, with its remark and rehype steps. */
function read(content: string) {
  const source = prepareReaderSource(content);
  const container = document.createElement("div");
  container.className = "markdown-reader";
  container.innerHTML = renderToStaticMarkup(
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkTaskStates, remarkMappedBreaks, remarkStripHtmlComments, remarkBrToBreak, remarkHtmlCheckbox, remarkStripHighlightMarks, remarkTagPills]}
      rehypePlugins={[rehypeReaderSource(source, content) as never, rehypeReaderDirection(content) as never]}
    >{source.text}</ReactMarkdown>,
  );
  // The reader's heading ids: the outline's slug of the heading in that source line.
  const idByLine = new Map(parseHeadings(content).map((h) => [h.line, h.slug] as const));
  const headings = [...container.querySelectorAll("h1, h2, h3")].map((h) => {
    const line = Number(h.getAttribute("data-source-line"));
    return { text: h.textContent, line, id: idByLine.get(line) ?? null, source: content.slice(Number(h.getAttribute("data-source-from")), Number(h.getAttribute("data-source-to"))) };
  });
  const places = [...container.querySelectorAll("[data-source-from]")].map((el) => [el.tagName, Number(el.getAttribute("data-source-from")), Number(el.getAttribute("data-source-to")), el.getAttribute("data-source-line")]);
  return { source, container, headings, places, text: container.textContent ?? "" };
}

describe.each([{ name: "\\n", eol: "\n" }, { name: "\\r\\n", eol: "\r\n" }])("an embedded note that starts with a byte order mark, line ends $name", ({ eol }) => {
  const plain = NOTE.split("\n").join(eol);
  const marked = MARK + plain;

  it("is shown as the note without one: no rest of the properties block, no mark in the text", () => {
    // The whole note: what `![[Day]]` embeds is the file's text.
    const fragment = selectNoteFragment(marked, null);
    expect(fragment).toMatchObject({ status: "found", kind: "note", text: marked });
    const shown = read(marked), expected = read(plain);
    expect(shown.source.text).toBe(expected.source.text);
    // It began with "-": the fence's last character, read as an empty list item above the title.
    expect(shown.source.text.trimStart().startsWith("# Day")).toBe(true);
    expect(shown.container.firstElementChild?.tagName).toBe("H1");
    expect(shown.container.querySelectorAll("li")).toHaveLength(2);
    expect(shown.text).toBe(expected.text);
    expect(shown.text).not.toContain(MARK);
    expect(shown.text).not.toContain("title: Day");
  });

  it("gives each heading the line and the id the outline gives it", () => {
    const shown = read(marked), expected = read(plain);
    expect(shown.headings.map((h) => [h.text, h.line, h.id])).toEqual([["Day", 5, "day"], ["Über", 9, "über"], ["Detail", 14, "detail"], ["Über", 18, "über-1"]]);
    expect(shown.headings.map((h) => [h.text, h.line, h.id])).toEqual(expected.headings.map((h) => [h.text, h.line, h.id]));
    // Each element's place is a place in the file's text, mark included: one further than in the note without.
    for (const heading of shown.headings) expect(heading.source.replace(/^#+ /, "")).toBe(heading.text);
    expect(shown.places).toEqual(expected.places.map(([tag, from, to, line]) => [tag, Number(from) + 1, Number(to) + 1, line]));
  });

  it("runs right-to-left text the way the note without a mark does, from its first line on", () => {
    // A block's direction is read from the lines of the file. The mark stood in
    // front of the first one: a task there kept its box in what was read, and
    // the "x" in it decided for a line written in Arabic; a properties block
    // was not seen as one, and every block of the note ran left to right.
    const directions = (content: string) => [...read(content).container.querySelectorAll("[dir]")].map((el) => [el.tagName, el.getAttribute("dir")]);
    const tasks = ["- [x] مهمة أولى", "- [ ] مهمة ثانية", "", "# عنوان", "", "English paragraph."].join(eol);
    expect(directions(MARK + tasks)).toEqual([["UL", "rtl"], ["LI", "rtl"], ["LI", "rtl"], ["H1", "rtl"], ["P", "ltr"]]);
    expect(directions(MARK + tasks)).toEqual(directions(tasks));
    const withProperties = ["---", "title: عنوان", "---", "نص عربي", "", "Latin text."].join(eol);
    expect(directions(MARK + withProperties)).toEqual([["P", "rtl"], ["P", "ltr"]]);
    expect(directions(MARK + withProperties)).toEqual(directions(withProperties));
  });

  it("leads a selection in the rendered text back to its place in the file", () => {
    const shown = read(marked);
    document.body.append(shown.container);
    try {
      for (const word of ["paragraph", "Last words", "second one"]) {
        const from = marked.indexOf(word);
        const range = findSourceTextRange(shown.container, from, from + word.length, marked);
        expect(range?.toString(), word).toBe(word);
        const selection = document.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range!);
        expect(readSourceSelection(shown.container, marked), word).toEqual({ anchor: from, head: from + word.length });
      }
    } finally {
      shown.container.remove();
    }
  });

  it("embeds a section from its heading to its last character, and a block as it stands", () => {
    // `![[Day#Detail]]`: the section used to begin with the line break in front
    // of its heading and to end one character early — "Last words of the sectio".
    const section = selectNoteFragment(marked, "#Detail"), plainSection = selectNoteFragment(plain, "#Detail");
    if (section.status !== "found" || plainSection.status !== "found") throw new Error("the section was not found");
    expect(section.text).toBe(`### Detail${eol}${eol}Last words of the section${eol}${eol}`);
    expect(section.text).toBe(plainSection.text);
    expect([section.range.from, section.range.to, section.range.line]).toEqual([plainSection.range.from + 1, plainSection.range.to + 1, 14]);
    expect(read(section.text).text).toBe(read(plainSection.text).text);
    expect(read(section.text).text).toContain("Last words of the section");

    // Two headings of one name: an embed refuses to guess, with or without a mark.
    expect(selectNoteFragment(marked, "#Über")).toEqual({ status: "ambiguous" });
    expect(selectNoteFragment(marked, "#über-1")).toMatchObject({ status: "found", range: { line: 18 } });

    // `![[Day#^intro]]`: the paragraph, without the line break in front of it.
    const block = selectNoteFragment(marked, "^intro"), plainBlock = selectNoteFragment(plain, "^intro");
    if (block.status !== "found" || plainBlock.status !== "found") throw new Error("the block was not found");
    expect(block.text).toBe("First [[Other|paragraph]] with ==light== and a #tag ^intro");
    expect([block.range.from, block.range.to, block.range.line]).toEqual([plainBlock.range.from + 1, plainBlock.range.to + 1, 7]);
    expect(read(block.text).text).toBe(read(plainBlock.text).text);
    expect(read(block.text).text.startsWith("First paragraph with")).toBe(true);
    expect(read(block.text).text).not.toContain("^intro");
  });
});
