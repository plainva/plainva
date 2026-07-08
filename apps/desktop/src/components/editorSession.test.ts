// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";

// The session pulls in NoteEmbedPlugin -> VaultContext -> CredentialManager,
// whose module-level `Store.load` needs the Tauri bridge (absent in jsdom).
vi.mock("../services/CredentialManager", () => ({ credentialManager: {} }));

import { syntaxTree, ensureSyntaxTree } from "@codemirror/language";
import { undoDepth } from "@codemirror/commands";
import type { i18n as I18nInstance } from "i18next";
import { createEditorSession, type EditorSession, type EditorSessionDeps } from "./editorSession";
import { tableLinkHandlers } from "./LivePreviewPlugin";

/**
 * Session-level regression tests for the editor-stability plan (2026-07-05).
 * They run a REAL EditorView in jsdom (transaction/state level only — visual
 * behavior is covered by the editor-stability E2E spec in a real browser).
 *
 * The core guarantees under test:
 *  - the live/source switch swaps one compartment, so the parsed syntax tree
 *    survives (the old @uiw host reset the language, which re-parses only the
 *    first 3000 characters synchronously — the root cause of the jitter),
 *  - external text adoption is a minimal, non-undoable, non-dirtying change
 *    and a complete no-op for identical text,
 *  - host callbacks flow through the deps ref, so extensions stay instance-
 *    stable while the host swaps its closures every React render.
 */

// --- jsdom shims CodeMirror needs (no layout engine, no RO/rAF) -------------
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
  const zeroRect = {
    top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0,
    toJSON() { return this; },
  } as DOMRect;
  Range.prototype.getBoundingClientRect = () => zeroRect;
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
});

// > 3000 chars of prose so the doc crosses CodeMirror's synchronous
// init-parse window (Work.InitViewport), plus a nested list and a table.
const FILLER = Array.from(
  { length: 60 },
  (_, i) => `Zeile ${i} mit genug Text, um die Notiz weit über die 3000-Zeichen-Grenze des Init-Parsers zu schieben.`
).join("\n");
const DOC = `# Kopf\n\n${FILLER}\n\n- eins\n  - zwei\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nEnde.\n`;

const HEADER_TEXTS = { addIcon: "a", addColor: "b", changeIcon: "c", changeColor: "d" };
const fakeI18n = { t: (k: string) => k, language: "de" } as unknown as I18nInstance;

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
  };
}

const open: EditorSession[] = [];
function makeSession(mode: "live" | "source" = "live", doc = DOC) {
  const deps = { current: baseDeps() };
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const session = createEditorSession({
    parent,
    doc,
    mode,
    vaultPath: "",
    i18n: fakeI18n,
    headerTexts: HEADER_TEXTS,
    deps,
  });
  open.push(session);
  return { session, deps };
}

afterEach(() => {
  while (open.length) open.pop()!.destroy();
  document.body.innerHTML = "";
});

describe("editorSession", () => {
  it("keeps the parsed syntax tree across a live→source→live switch", () => {
    const { session } = makeSession("live");
    const len = session.view.state.doc.length;
    expect(len).toBeGreaterThan(3000);
    ensureSyntaxTree(session.view.state, len, 5000);
    // The state field's snapshot may trail the parse by a fragment boundary;
    // what matters is that it covers far more than the ~3000-char window a
    // language RESET would re-parse synchronously (Work.InitViewport).
    const before = syntaxTree(session.view.state).length;
    expect(before).toBeGreaterThan(3000);

    // The tree may only ever GROW across a mode switch (apply() continues the
    // background parse); a language reset would shrink it to the init window.
    session.setMode("source");
    expect(syntaxTree(session.view.state).length).toBeGreaterThanOrEqual(before);

    session.setMode("live");
    expect(syntaxTree(session.view.state).length).toBeGreaterThanOrEqual(before);
  });

  it("treats identical external text as a complete no-op", () => {
    const { session, deps } = makeSession();
    const before = session.view.state.doc.toString();
    expect(session.applyExternalText(before)).toBe(false);
    expect(session.view.state.doc.toString()).toBe(before);
    expect(deps.current.onDocChanged).not.toHaveBeenCalled();
  });

  it("adopts an external diff without dirtying and without an undo entry (E4)", () => {
    const { session, deps } = makeSession();
    const next = DOC.replace("Ende.", "Ende!");
    expect(session.applyExternalText(next)).toBe(true);
    expect(session.view.state.doc.toString()).toBe(next);
    expect(deps.current.onDocChanged).not.toHaveBeenCalled();
    expect(undoDepth(session.view.state)).toBe(0);
  });

  it("maps the caret through an external change instead of resetting it", () => {
    const { session } = makeSession();
    session.view.dispatch({ selection: { anchor: session.view.state.doc.length } });
    const next = "NEU\n" + session.view.state.doc.toString();
    session.applyExternalText(next);
    expect(session.view.state.selection.main.head).toBe(session.view.state.doc.length);
  });

  it("reports real edits via onDocChanged and records them in the undo history", () => {
    const { session, deps } = makeSession();
    session.view.dispatch({ changes: { from: 0, insert: "x" }, userEvent: "input" });
    expect(deps.current.onDocChanged).toHaveBeenCalledTimes(1);
    expect(undoDepth(session.view.state)).toBe(1);
  });

  it("publishes selection word/char stats and null when the selection collapses (P3.9)", () => {
    const { session, deps } = makeSession();
    // "# Kopf" — select the first 6 characters. The heading marker is
    // Markdown structure, not a word (maintainer report 2026-07-07).
    session.view.dispatch({ selection: { anchor: 0, head: 6 } });
    expect(deps.current.onSelectionStats).toHaveBeenLastCalledWith({ chars: 6, words: 1 });
    session.view.dispatch({ selection: { anchor: 6 } });
    expect(deps.current.onSelectionStats).toHaveBeenLastCalledWith(null);
  });

  it("routes host callbacks through the deps ref (late rebinding works)", () => {
    const { session, deps } = makeSession();
    const late = vi.fn();
    deps.current = { ...baseDeps(), openWikiTarget: late };
    session.view.state.facet(tableLinkHandlers).onOpenNote?.("Ziel", true);
    expect(late).toHaveBeenCalledWith("Ziel", true);
  });

  it("shows line numbers only in source mode and toggles via setMode", () => {
    const { session } = makeSession("live");
    expect(session.view.dom.querySelector(".cm-lineNumbers")).toBeNull();
    session.setMode("source");
    expect(session.view.dom.querySelector(".cm-lineNumbers")).not.toBeNull();
    session.setMode("live");
    expect(session.view.dom.querySelector(".cm-lineNumbers")).toBeNull();
  });

  it("makes setMode a no-op when the mode is unchanged", () => {
    const { session } = makeSession("live");
    const spy = vi.spyOn(session.view, "dispatch");
    session.setMode("live");
    expect(spy).not.toHaveBeenCalled();
  });
});

// Live-preview decoration fixes (maintainer report 2026-07-06): headings/quotes
// hide the space after their mark (no phantom indent), and links unfold under
// the keyboard caret even when it moves WITHIN the line.
describe("live preview decorations", () => {
  const lineWith = (session: EditorSession, needle: string) => {
    const lines = [...session.view.contentDOM.querySelectorAll(".cm-line")];
    const el = lines.find((l) => (l.textContent ?? "").includes(needle));
    expect(el, `no rendered line contains "${needle}"`).toBeTruthy();
    return el!.textContent ?? "";
  };

  it("hides the space after # so inactive headings align with body text", () => {
    const { session } = makeSession("live", "Intro\n\n# Kopf\n\nEnde");
    // Caret sits on "Intro" — the heading line is inactive.
    expect(lineWith(session, "Kopf")).toBe("Kopf");
  });

  it("reveals the full heading mark on the active line", () => {
    const { session } = makeSession("live", "Intro\n\n# Kopf\n\nEnde");
    session.view.dispatch({ selection: { anchor: "Intro\n\n# K".length } });
    expect(lineWith(session, "Kopf")).toBe("# Kopf");
  });

  it("hides the space after > in inactive quote lines", () => {
    const { session } = makeSession("live", "Intro\n\n> Zitat\n\nEnde");
    expect(lineWith(session, "Zitat")).toBe("Zitat");
  });

  it("hides the bullet plus its space before a task checkbox", () => {
    const { session } = makeSession("live", "Intro\n\n- [ ] Aufgabe\n\nEnde");
    // The checkbox widget carries no text; the space BETWEEN checkbox and
    // label stays (mirrors "• eins"), but the one after the hidden bullet is
    // gone — the old code rendered two spaces here.
    expect(lineWith(session, "Aufgabe")).toBe(" Aufgabe");
  });

  it("unfolds a wiki link when the caret moves into it within the same line", () => {
    const doc = "Alpha [[Ziel]] Omega";
    const { session } = makeSession("live", doc);
    // Caret at 0 (same line as the link): syntax is folded away.
    expect(lineWith(session, "Ziel")).toBe("Alpha Ziel Omega");
    // Arrow-key movement within the line = selection change without a line
    // change — this must now rebuild and reveal the raw syntax.
    session.view.dispatch({ selection: { anchor: doc.indexOf("Ziel") + 1 } });
    expect(lineWith(session, "Ziel")).toBe("Alpha [[Ziel]] Omega");
  });

  it("unfolds a markdown link under the caret and folds it again when leaving", () => {
    const doc = "Alpha [Text](https://example.com) Omega";
    const { session } = makeSession("live", doc);
    expect(lineWith(session, "Text")).toBe("Alpha Text Omega");
    session.view.dispatch({ selection: { anchor: doc.indexOf("Text") + 1 } });
    expect(lineWith(session, "Text")).toBe(doc);
    session.view.dispatch({ selection: { anchor: 0 } });
    expect(lineWith(session, "Text")).toBe("Alpha Text Omega");
  });
});
