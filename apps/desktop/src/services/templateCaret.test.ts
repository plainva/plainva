import { beforeEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { editorTextOf, upsertFrontmatterKeys } from "@plainva/core";
import {
  clearPendingTemplateCaret,
  consumePendingTemplateCaret,
  handTemplateCaretOver,
  markFreshNote,
  parkTemplateCaret,
  resetFreshNotesForTests,
  takeTemplateCaret,
  templateAsNewNote,
  templateCaretInEditor,
  templateCaretInNote,
  templateInsertInEditor,
} from "@plainva/ui";

/**
 * The caret an editor is handed for a note that was just made from a template
 * (finding 2026-10-09).
 *
 * The builders say where `{{cursor}}` stands in the FILE they wrote
 * (`templateAsNewNote`, `templateCaretInNote` — newNote.test.ts). An editor
 * holds that file with `\n` line ends and without its byte order mark, and a
 * note from a template keeps the template's line ends and its mark. The place
 * used to be parked as the builders counted it: for a template written on
 * Windows the caret stood one character too far right for every line above
 * it, and one more behind a mark. `parkTemplateCaret` converts it — the one
 * way into the store, for every way a note is created on both shells. A
 * template inserted into a note that is open goes through the same conversion
 * (`templateInsertInEditor`, further down).
 *
 * The cases of parking itself stood in templateInteractive.test.ts while
 * parking was a function of the desktop that took a bare number.
 */

// Built at run time: the mark is never typed into this file.
const MARK = String.fromCharCode(0xfeff);
const PATH = "Notes/A.md";

/** A template as the engine hands it over: `|` marks where `{{cursor}}` stood. */
function resolved(marked: string): { text: string; cursor: number | null } {
  const at = marked.indexOf("|");
  return at < 0 ? { text: marked, cursor: null } : { text: marked.slice(0, at) + marked.slice(at + 1), cursor: at };
}

/**
 * Parks a note's caret the way every creation path does, and answers with what
 * stands behind it in the editor that opens the note; "" is the end.
 */
function behindCaretInEditor(note: { content: string; caret: number | null }): string {
  parkTemplateCaret(PATH, note.content, note.caret);
  const parked = consumePendingTemplateCaret(PATH);
  if (!parked) throw new Error("no caret was parked");
  return editorTextOf(note.content).slice(parked.offset);
}

describe("parkTemplateCaret: the place an editor is handed", () => {
  beforeEach(() => clearPendingTemplateCaret());

  it("is the builder's own number for a template with \\n and without a mark", () => {
    for (const marked of ["# Titel\n\n- [ ] |\n", "---\nstatus: entwurf\n---\n# Titel\n\n|Text\n", "---\nstatus: |\n---\n# Titel\n", "# Titel\n|", "|"]) {
      const note = templateAsNewNote(resolved(marked), "Note");
      parkTemplateCaret(PATH, note.content, note.caret);
      expect(consumePendingTemplateCaret(PATH), JSON.stringify(marked)).toEqual({ path: PATH, offset: note.caret });
    }
  });

  it("stands where the template says for a template with Windows line ends, with and without a properties block", () => {
    const block = templateAsNewNote(resolved("---\r\nstatus: entwurf\r\n---\r\n# Titel\r\n\r\n|Text\r\n"), "Note");
    expect(block.content).toBe("---\r\nstatus: entwurf\r\ntype: Note\r\n---\r\n# Titel\r\n\r\nText\r\n");
    expect(behindCaretInEditor(block)).toBe("Text\n");
    const plain = templateAsNewNote(resolved("# Titel\r\n\r\n- [ ] |\r\nEnde\r\n"), "Note");
    expect(plain.content).toBe("---\r\ntype: Note\r\n---\r\n# Titel\r\n\r\n- [ ] \r\nEnde\r\n");
    expect(behindCaretInEditor(plain)).toBe("\nEnde\n");
  });

  it("stands where the template says for a template with a byte order mark, with and without a properties block", () => {
    const block = templateAsNewNote(resolved(`${MARK}---\nstatus: entwurf\n---\n# Titel\n|Text\n`), "Note");
    expect(block.content).toBe(`${MARK}---\nstatus: entwurf\ntype: Note\n---\n# Titel\nText\n`);
    expect(behindCaretInEditor(block)).toBe("Text\n");
    const plain = templateAsNewNote(resolved(`${MARK}# Titel\n|Text\n`), "Note");
    expect(plain.content).toBe(`${MARK}---\ntype: Note\n---\n# Titel\nText\n`);
    expect(behindCaretInEditor(plain)).toBe("Text\n");
  });

  it("stands there with both at once, and at the start of the text for a caret the template put into its block", () => {
    const both = templateAsNewNote(resolved(`${MARK}---\r\nstatus: entwurf\r\n---\r\n# Titel\r\n|Text\r\n`), "Note");
    expect(both.content).toBe(`${MARK}---\r\nstatus: entwurf\r\ntype: Note\r\n---\r\n# Titel\r\nText\r\n`);
    expect(behindCaretInEditor(both)).toBe("Text\n");
    const inBlock = templateAsNewNote(resolved(`${MARK}---\r\nstatus: |\r\n---\r\n# Titel\r\n`), "Note");
    expect(behindCaretInEditor(inBlock)).toBe("# Titel\n");
    // A template that ends on its cursor: the end of the note is the end of the editor's text.
    const atEnd = templateAsNewNote(resolved(`${MARK}# Titel\r\n\r\n|`), "Note");
    expect(behindCaretInEditor(atEnd)).toBe("");
  });

  it("is converted once, behind every rewrite of the block — the steps before it count in the file", () => {
    // A database item: the builder's note, then the source tag and the view's
    // prefill into its block. The caret is asked on from note to note in the
    // file's text, and parked with the note that was written last.
    const built = templateAsNewNote(resolved(`${MARK}# Titel\r\n\r\n- [ ] |\r\nEnde\r\n`), "Note");
    const content = upsertFrontmatterKeys(built.content, { tags: ["zettel"], status: "offen" });
    expect(content).toBe(`${MARK}---\r\ntype: Note\r\ntags:\r\n  - zettel\r\nstatus: offen\r\n---\r\n# Titel\r\n\r\n- [ ] \r\nEnde\r\n`);
    const caret = templateCaretInNote(built.content, content, built.caret!);
    expect(content.slice(caret)).toBe("\r\nEnde\r\n");
    expect(behindCaretInEditor({ content, caret })).toBe("\nEnde\n");
    // Converted in between, the number would be taken for a place in the file
    // again, and the caret would stand in front of where the template put it.
    const early = templateCaretInNote(built.content, content, templateCaretInEditor(built.content, built.caret!));
    expect(content.slice(early)).toBe("- [ ] \r\nEnde\r\n");
  });

  it("holds for every template and every caret: behind the parked place the editor has what the file has behind its caret", () => {
    let seed = 20261011;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
    const entries = ["status: entwurf", "tags: [a, b]", "tags:\n- a\n- b", "type: Meeting", "type:", "# comment", "broken: [unclosed"];
    const lines = ["# Titel", "", "Text", "---", "- [ ] ", "a: b", "  eingerückt"];
    let cases = 0;
    let shifted = 0;
    for (let i = 0; i < 3000; i++) {
      const eol = random() < 0.5 ? "\r\n" : "\n";
      const parts: string[] = [];
      if (random() < 0.5) {
        const block = Array.from({ length: Math.floor(random() * 3) }, () => pick(entries));
        parts.push("---", ...block.join("\n").split("\n"), "---");
      }
      for (let n = Math.floor(random() * 5); n > 0; n--) parts.push(pick(lines));
      let template = parts.join(eol);
      if (template && random() < 0.8) template += eol;
      if (random() < 0.3) template = MARK + template;
      const cursor = Math.floor(random() * (template.length + 1));
      // `{{cursor}}` is text of a line; it never stands inside a line end.
      if (template[cursor - 1] === "\r" && template[cursor] === "\n") continue;
      const note = templateAsNewNote({ text: template, cursor }, "Note");
      parkTemplateCaret(PATH, note.content, note.caret);
      const parked = consumePendingTemplateCaret(PATH);
      const at = JSON.stringify({ template, cursor, note });
      expect(parked, at).not.toBeNull();
      expect(editorTextOf(note.content).slice(parked!.offset), at).toBe(note.content.slice(note.caret!).replace(/\r\n/g, "\n"));
      cases++;
      if (parked!.offset !== note.caret) shifted++;
    }
    expect(cases).toBeGreaterThan(2500);
    // Not a test of notes that need no conversion.
    expect(shifted).toBeGreaterThan(800);
  });
});

/**
 * A template inserted INTO a note (finding 2026-10-11, measured on the
 * editor's state). The editor turns every `\r\n` of a text it is handed into
 * one line end, and both shells set the caret by a number counted in the text
 * as it was read.
 */
describe("templateInsertInEditor: a template inserted into a note", () => {
  /**
   * Inserts the way both shells do — the text at `from`, the caret at
   * `from + (cursor ?? text.length)` — into the real editor state.
   */
  function inserted(doc: string, from: number, template: { text: string; cursor: number | null }): { doc: string; behindCaret: string } {
    const { text, cursor } = templateInsertInEditor(template);
    const state = EditorState.create({ doc }).update({ changes: { from, insert: text }, selection: { anchor: from + (cursor ?? text.length) } }).state;
    return { doc: state.doc.toString(), behindCaret: state.doc.toString().slice(state.selection.main.anchor) };
  }

  it("puts the caret where a template with Windows line ends says", () => {
    const template = resolved("## Agenda\r\n\r\n- |\r\nEnde\r\n");
    expect(inserted("# Notiz\n", 8, template)).toEqual({ doc: "# Notiz\n## Agenda\n\n- \nEnde\n", behindCaret: "\nEnde\n" });
    expect(inserted("# Notiz\n\nRest\n", 8, template).behindCaret).toBe("\nEnde\n\nRest\n");
  });

  it("puts it behind the inserted text when the template has no cursor marker — at the end of a note the editor refused the change", () => {
    const template = resolved("## Agenda\r\n\r\n- \r\n");
    // Handed over as it was read, the text is three characters longer than
    // what the editor makes of it, and the caret was asked for outside the document.
    expect(() => EditorState.create({ doc: "# Notiz\n" }).update({ changes: { from: 8, insert: template.text }, selection: { anchor: 8 + template.text.length } })).toThrow(RangeError);
    expect(inserted("# Notiz\n", 8, template)).toEqual({ doc: "# Notiz\n## Agenda\n\n- \n", behindCaret: "" });
    expect(inserted("# Notiz\n\nRest\n", 8, template).behindCaret).toBe("\nRest\n");
  });

  it("leaves a mark the template opens with out of the note, and counts the caret without it", () => {
    const template = resolved(`${MARK}## Agenda\r\n- |\r\nEnde\r\n`);
    expect(inserted("# Notiz\n", 8, template)).toEqual({ doc: "# Notiz\n## Agenda\n- \nEnde\n", behindCaret: "\nEnde\n" });
  });

  it("hands a template with \\n on as it is", () => {
    const template = resolved("## Agenda\n\n- |\nEnde\n");
    expect(templateInsertInEditor(template)).toEqual(template);
    expect(templateInsertInEditor({ text: "Zeile", cursor: null })).toEqual({ text: "Zeile", cursor: null });
    expect(inserted("# Notiz\n", 8, template).behindCaret).toBe("\nEnde\n");
  });
});

describe("the parked caret", () => {
  beforeEach(() => clearPendingTemplateCaret());

  it("parks nothing when the template had no cursor marker", () => {
    parkTemplateCaret(PATH, "---\ntype: Note\n---\n# Titel\n", null);
    expect(consumePendingTemplateCaret(PATH)).toBeNull();
  });

  it("is handed only to the note it was parked for, and only once", () => {
    parkTemplateCaret(PATH, "---\ntype: Note\n---\n# Titel\n", 19);
    expect(consumePendingTemplateCaret("Notes/B.md")).toBeNull();
    expect(consumePendingTemplateCaret(null)).toBeNull();
    expect(consumePendingTemplateCaret(PATH)).toEqual({ path: PATH, offset: 19 });
    expect(consumePendingTemplateCaret(PATH)).toBeNull();
  });

  it("is replaced by the caret of the note that was created next", () => {
    parkTemplateCaret(PATH, "# A\n", 4);
    parkTemplateCaret("Notes/B.md", "# B\r\nText", 5);
    expect(consumePendingTemplateCaret(PATH)).toBeNull();
    expect(consumePendingTemplateCaret("Notes/B.md")).toEqual({ path: "Notes/B.md", offset: 4 });
  });
});

/**
 * Who is handed the parked caret (finding 2026-10-12).
 *
 * The desktop opens a new database entry in the peek window, and the editor in
 * that window is never the active pane. Only the active pane asked the store,
 * so the caret of such an entry was not applied where the entry opened. It
 * stayed parked, and the tab that showed the entry later took it: a place
 * counted when the note was written, whatever had been typed in the window
 * since. `takeTemplateCaret` is the one question the desktop's editor asks —
 * base.spec.ts drives the window and the tab behind it.
 */
describe("takeTemplateCaret: the editor that is handed the parked caret", () => {
  beforeEach(() => clearPendingTemplateCaret());

  /** A database entry as it is written, and where its template put the caret. */
  const entry = templateAsNewNote(resolved("---\nstatus: entwurf\n---\n# Eintrag\n\nZiel: | (bis Freitag)\n"), "Note");
  const BEHIND = " (bis Freitag)\n";

  it("hands a preview window the caret of the note it shows, and leaves none for the tab that opens the note later", () => {
    parkTemplateCaret(PATH, entry.content, entry.caret);
    const taken = takeTemplateCaret(PATH, "preview");
    expect(taken).toEqual({ path: PATH, offset: entry.caret, focus: false });
    expect(editorTextOf(entry.content).slice(taken!.offset)).toBe(BEHIND);
    expect(takeTemplateCaret(PATH, "pane")).toBeNull();
    expect(consumePendingTemplateCaret(PATH)).toBeNull();
  });

  it("gives the text the keyboard in the pane the person works in, and leaves the keyboard alone in a preview", () => {
    parkTemplateCaret(PATH, entry.content, entry.caret);
    expect(takeTemplateCaret(PATH, "pane")).toEqual({ path: PATH, offset: entry.caret, focus: true });
    parkTemplateCaret(PATH, entry.content, entry.caret);
    expect(takeTemplateCaret(PATH, "preview")?.focus).toBe(false);
  });

  it("hands over the place in the text an editor holds, for a template with Windows line ends and a byte order mark too", () => {
    const windows = templateAsNewNote(resolved(`${MARK}---\r\nstatus: entwurf\r\n---\r\n# Eintrag\r\n\r\nZiel: | (bis Freitag)\r\n`), "Note");
    parkTemplateCaret(PATH, windows.content, windows.caret);
    const taken = takeTemplateCaret(PATH, "preview");
    expect(taken!.offset).not.toBe(windows.caret);
    expect(editorTextOf(windows.content).slice(taken!.offset)).toBe(BEHIND);
  });

  it("leaves the caret parked when an editor that is neither asks — a second pane the person is not working in", () => {
    parkTemplateCaret(PATH, entry.content, entry.caret);
    expect(takeTemplateCaret(PATH, null)).toBeNull();
    expect(takeTemplateCaret(PATH, "pane")).toEqual({ path: PATH, offset: entry.caret, focus: true });
  });

  it("takes only the caret of the note the surface shows: a preview of another note leaves it for its own", () => {
    parkTemplateCaret(PATH, entry.content, entry.caret);
    expect(takeTemplateCaret("Notes/B.md", "preview")).toBeNull();
    expect(takeTemplateCaret(null, "preview")).toBeNull();
    expect(takeTemplateCaret(PATH, "preview")).toEqual({ path: PATH, offset: entry.caret, focus: false });
  });

  it("has nothing to hand over for an entry without a template or without a cursor marker", () => {
    expect(takeTemplateCaret(PATH, "preview")).toBeNull();
    const plain = templateAsNewNote(resolved("# Eintrag\n\nZiel:\n"), "Note");
    expect(plain.caret).toBeNull();
    parkTemplateCaret(PATH, plain.content, plain.caret);
    expect(takeTemplateCaret(PATH, "preview")).toBeNull();
    expect(takeTemplateCaret(PATH, "pane")).toBeNull();
  });
});

/**
 * The peek window took the caret, so a tab opened from it found none — where it
 * used to find the place parked when the note was written. Opened as a tab or in
 * the split, a note made in this session takes along the place the window's editor
 * holds by then (`handTemplateCaretOver`, called by the window — base.spec.ts
 * drives it).
 */
describe("handTemplateCaretOver: a window hands its note on with the caret it holds", () => {
  beforeEach(() => {
    clearPendingTemplateCaret();
    resetFreshNotesForTests();
  });

  /** The note as the window's editor holds it: the properties block, then the text. */
  const DOC = "---\ntype: Note\nzweck: Angebot\n---\n# Eintrag für den Kunden\n\nZiel: Angebot schreiben (bis Freitag)\n";

  it("parks the place for a note made in this session, and the pane it opens in takes it with the keyboard", () => {
    markFreshNote(PATH);
    const at = DOC.indexOf(" (bis Freitag)");
    handTemplateCaretOver(PATH, DOC, { head: at });
    expect(takeTemplateCaret(PATH, "pane")).toEqual({ path: PATH, offset: at, focus: true });
  });

  it("is the place the window holds by then, not the one parked when the note was written", () => {
    const entry = templateAsNewNote(resolved("---\nzweck: Angebot\n---\n# Eintrag\n\nZiel: | (bis Freitag)\n"), "Note");
    parkTemplateCaret(PATH, entry.content, entry.caret);
    const taken = takeTemplateCaret(PATH, "preview");
    expect(taken).not.toBeNull();
    // The heading grows in the window, and the caret is where the writing stopped.
    const doc = editorTextOf(entry.content).replace("# Eintrag\n", "# Eintrag für den Kunden\n");
    const head = doc.indexOf("# Eintrag für den Kunden") + "# Eintrag für den Kunden".length;
    handTemplateCaretOver(PATH, doc, { head });
    const handed = takeTemplateCaret(PATH, "pane");
    expect(doc.slice(handed!.offset)).toBe("\n\nZiel:  (bis Freitag)\n");
    // Counted when the note was written, the place now stands in the heading.
    expect(doc.slice(taken!.offset)).toMatch(/^ Kunden\n/);
  });

  it("hands nothing on for a note that was there before: it opens in a tab as it always has", () => {
    handTemplateCaretOver(PATH, DOC, { head: DOC.indexOf(" (bis Freitag)") });
    expect(takeTemplateCaret(PATH, "pane")).toBeNull();
  });

  it("hands nothing on while the caret is still in the properties block, where nobody has placed one", () => {
    markFreshNote(PATH);
    handTemplateCaretOver(PATH, DOC, { head: 0 });
    handTemplateCaretOver(PATH, DOC, { head: DOC.indexOf("zweck") });
    expect(takeTemplateCaret(PATH, "pane")).toBeNull();
    handTemplateCaretOver(PATH, DOC, { head: DOC.indexOf("# Eintrag") });
    expect(takeTemplateCaret(PATH, "pane")?.offset).toBe(DOC.indexOf("# Eintrag"));
  });
});
