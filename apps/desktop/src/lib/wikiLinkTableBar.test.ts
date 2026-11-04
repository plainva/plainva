// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  findImageEmbeds,
  findLinkAtOffset,
  firstStrongDirection,
  parseInlineMarkdown,
  parseWikiImageTarget,
  parseWikiLinkValue,
  readWikiLinkInner,
  resolveNoteEmbed,
  segmentInlineText,
  setPlatformServices,
  wikiLinkPlugin,
} from "@plainva/ui";
import { computeEmbedInfo } from "../services/embedStats";

/**
 * `[[Note\|alias]]` — the spelling of a wiki link in a table cell (Sammelplan
 * § 3.133 Nr. 1). The index, a rename and the reading view read it by the
 * core's rule (`wikiLinkParts`): a link to "Note" shown as "alias". The readers
 * above the core cut at the first `|` themselves and took the backslash into
 * the name — the editor drew "Note\" as not created yet, and a click made it.
 */
setPlatformServices({
  loadSettings: async () => ({}) as never,
  credentials: {} as never,
  openExternal: async () => {},
  flushPendingSave: async () => {},
});

const CELL = "| [[Note\\|shown]] | [[Other#Part\\|x\\|y]] |";

describe("a wiki link with the table cell's bar", () => {
  it("is read by the core's rule in the shared helper", () => {
    expect(readWikiLinkInner("Note\\|shown")).toMatchObject({ target: "Note", anchor: null, alias: "shown", head: "Note" });
    expect(readWikiLinkInner("Other#Part\\|x\\|y")).toMatchObject({ target: "Other", anchor: "#Part", alias: "x|y" });
    expect(readWikiLinkInner("Plain|alias")).toMatchObject({ target: "Plain", alias: "alias" });
  });

  it("opens the note a click in the editor names", () => {
    expect(findLinkAtOffset(CELL, 5)).toEqual({ type: "wiki", target: "Note" });
    expect(findLinkAtOffset(CELL, CELL.indexOf("Other") + 1)).toEqual({ type: "wiki", target: "Other", anchor: "#Part" });
  });

  it("is drawn by the editor as a link to the note, showing its alias", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const doc = "Text [[Note\\|shown]] end";
    const view = new EditorView({ state: EditorState.create({ doc, extensions: wikiLinkPlugin(() => {}, true), selection: { anchor: doc.length } }), parent });
    const spans = [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-wiki-link")];
    expect(spans.map((s) => [s.getAttribute("data-link-target"), s.textContent])).toEqual([["Note", "shown"]]);
    view.destroy();
  });

  it("reads the same in a database cell, a card and the journal", () => {
    expect(segmentInlineText("[[Note\\|shown]]")).toEqual([{ type: "wiki", target: "Note", display: "shown" }]);
    expect(parseInlineMarkdown("[[Note\\|shown]]")).toEqual([{ kind: "wikiLink", target: "Note", display: "shown" }]);
  });

  it("embeds the note and the picture it names", async () => {
    const asked: string[] = [];
    await resolveNoteEmbed("Note\\|shown", "x.md", { resolve: async (name) => (asked.push(name), "Note.md") });
    expect(asked).toEqual(["Note"]);
    expect(parseWikiImageTarget("foto.png\\|300")).toEqual({ target: "foto.png", width: 300, alt: null });
    expect(findImageEmbeds("| ![[foto.png\\|300]] |").map((e) => [e.target, e.width])).toEqual([["foto.png", 300]]);
    expect(computeEmbedInfo("| ![[Tasks.base\\|x]] |", new Map([["Lists/Tasks.base", 3]]))).toEqual({ bases: 1, baseEntries: 3, notes: 0 });
  });

  it("reads a property value and the direction of the alias", () => {
    expect(parseWikiLinkValue("[[Note\\|shown]]")).toMatchObject({ target: "Note", alias: "shown", display: "shown" });
    expect(firstStrongDirection("[[Note\\|שלום]]")).toBe("rtl");
  });
});
