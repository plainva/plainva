// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";

// The session pulls in NoteEmbedPlugin -> VaultContext -> CredentialManager,
// whose module-level `Store.load` needs the Tauri bridge (absent in jsdom).
vi.mock("../services/CredentialManager", () => ({ credentialManager: {} }));

import { EditorView } from "@codemirror/view";
import type { i18n as I18nInstance } from "i18next";
import { createEditorSession, lineDirectionField, type EditorSession, type EditorSessionDeps } from "@plainva/ui";
import { forceFullParse } from "../test-parse";

/**
 * Right-to-left lines in the note editor (issue #111, plan Teil R, R2).
 *
 * The session is the one both shells build (desktop Editor.tsx, phone
 * EditorHost.tsx, and the phone's read mode as the same session read-only),
 * so these run the real thing. jsdom has no layout: what is checked is the
 * direction each line is GIVEN - the caret, arrow keys and selection that
 * follow from it run in the WebKit editor regression.
 */

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const w = window as unknown as {
    requestAnimationFrame?: (cb: (t: number) => void) => number;
    cancelAnimationFrame?: (id: number) => void;
  };
  if (!w.requestAnimationFrame) {
    w.requestAnimationFrame = (cb) => window.setTimeout(() => cb(Date.now()), 0);
    w.cancelAnimationFrame = (id) => window.clearTimeout(id);
  }
  const zeroRect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() { return this; } } as DOMRect;
  Range.prototype.getBoundingClientRect = () => zeroRect;
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
});

const fakeI18n = { t: (k: string) => k, language: "en" } as unknown as I18nInstance;

function baseDeps(): EditorSessionDeps {
  return {
    queryService: null,
    vaultContext: null,
    onOpenPath: undefined,
    openWikiTarget: vi.fn(),
    openExternalUrl: vi.fn(),
    handlePaste: () => false,
    handleDrop: () => false,
    onDocChanged: vi.fn(),
    onSelectionToolbar: vi.fn(),
    onSelectionStats: vi.fn(),
    onPickIcon: vi.fn(),
    onPickColor: vi.fn(),
    readBinaryFile: async () => new Uint8Array(),
    buildNoteEmbedExtension: () => [],
  };
}

const open: EditorSession[] = [];
function makeSession(doc: string, mode: "live" | "source" = "live", editable = true) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const session = createEditorSession({
    parent,
    doc,
    mode,
    vaultPath: "",
    i18n: fakeI18n,
    headerTexts: { addIcon: "a", addColor: "b", changeIcon: "c", changeColor: "d" },
    deps: { current: baseDeps() },
    editable,
  });
  forceFullParse(session.view, doc.length);
  open.push(session);
  return session;
}

afterEach(() => {
  while (open.length) open.pop()!.destroy();
  document.body.innerHTML = "";
});

/** The `dir` of each rendered text line, by document line number. */
function lineDirs(view: EditorView): Record<number, string | null> {
  const out: Record<number, string | null> = {};
  for (const el of view.contentDOM.querySelectorAll<HTMLElement>(".cm-line")) {
    const pos = view.posAtDOM(el);
    out[view.state.doc.lineAt(pos).number] = el.getAttribute("dir");
  }
  return out;
}

const RTL_NOTE = [
  "# ملاحظات القراءة", // 1
  "", // 2
  "بدأت اليوم قراءة كتاب جديد عن تاريخ الأندلس.", // 3
  "- الفصل الأول: قرطبة", // 4
  "- [x] شراء الكتاب", // 5
  "> العلم في الصغر كالنقش على الحجر.", // 6
  "", // 7
  "Plainva يحفظ ملاحظاتي كملفات Markdown.", // 8
  "", // 9
  "```", // 10
  'grep -n "الأندلس" notes.md', // 11
  "```", // 12
].join("\n");

describe("right-to-left lines in the editor", () => {
  it("switches on CodeMirror's per-line direction", () => {
    const session = makeSession("Hello");
    expect(session.view.state.facet(EditorView.perLineTextDirection)).toBe(true);
  });

  it.each(["live", "source"] as const)("gives each line of an Arabic note its direction (%s mode)", (mode) => {
    const session = makeSession(RTL_NOTE, mode);
    const dirs = lineDirs(session.view);
    for (const n of [1, 2, 3, 4, 5, 6, 7]) expect(dirs[n], `line ${n}`).toBe("rtl");
    // A line that starts with a Latin word, and code, stay left to right: no attribute.
    for (const n of [8, 11]) expect(dirs[n], `line ${n}`).toBeNull();
  });

  it("keeps a finished task right to left while the caret shows its `[x]`", () => {
    const session = makeSession(RTL_NOTE);
    const line5 = session.view.state.doc.line(5);
    session.view.dispatch({ selection: { anchor: line5.to } });
    expect(lineDirs(session.view)[5]).toBe("rtl");
  });

  it("the read-only session (the phone's read mode) turns the same lines", () => {
    const session = makeSession(RTL_NOTE, "live", false);
    expect(lineDirs(session.view)[4]).toBe("rtl");
  });

  it("a new empty list item after Enter stays on the right", () => {
    const session = makeSession("- الفصل الأول");
    const end = session.view.state.doc.length;
    session.view.dispatch({ changes: { from: end, insert: "\n- " }, selection: { anchor: end + 3 } });
    expect(lineDirs(session.view)[2]).toBe("rtl");
  });

  it("typing Arabic into a Latin note turns exactly that paragraph", () => {
    const session = makeSession("Erste Zeile\n\n");
    expect(session.view.state.field(lineDirectionField)).toBeNull();
    const end = session.view.state.doc.length;
    session.view.dispatch({ changes: { from: end, insert: "שלום עולם" } });
    const dirs = lineDirs(session.view);
    expect(dirs[1]).toBeNull();
    expect(dirs[3]).toBe("rtl");
  });

  it("leaves a note without right-to-left text exactly as it was: no scan, no attribute", () => {
    const session = makeSession("# Heading\n\n- [x] done\n> quote\n\nText 42");
    expect(session.view.state.field(lineDirectionField)).toBeNull();
    expect(session.view.contentDOM.querySelectorAll(".cm-line[dir]")).toHaveLength(0);
  });

  it("draws a table with its direction and each cell with its own", () => {
    const session = makeSession(["قبل", "", "| الاسم | Wert |", "| --- | --- |", "| ٣ | Plainva |", "", "بعد"].join("\n"));
    const wrap = session.view.contentDOM.querySelector<HTMLElement>(".cm-md-table-wrap");
    expect(wrap?.getAttribute("dir")).toBe("rtl");
    const cells = [...session.view.contentDOM.querySelectorAll<HTMLElement>(".cm-md-table th, .cm-md-table td")];
    expect(cells.map((c) => c.getAttribute("dir"))).toEqual(["rtl", "ltr", "rtl", "ltr"]);
    // No alignment written: the cell starts where its text starts.
    expect(cells.map((c) => c.style.textAlign)).toEqual(["start", "start", "start", "start"]);
  });
});
