// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { tags as t } from "@lezer/highlight";
import { markdownHighlightStyle } from "@plainva/ui";

// The session pulls in NoteEmbedPlugin -> VaultContext -> CredentialManager,
// whose module-level `Store.load` needs the Tauri bridge (absent in jsdom).
vi.mock("../services/CredentialManager", () => ({ credentialManager: {} }));

import { syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { undoDepth } from "@codemirror/commands";
import type { i18n as I18nInstance } from "i18next";
import { createEditorSession, type EditorSession, type EditorSessionDeps } from "@plainva/ui";
import { tableLinkHandlers } from "@plainva/ui";
import { setWikiResolver, buildWikiTargetSet } from "@plainva/ui";
import { forceFullParse } from "../test-parse";

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
    readBinaryFile: async () => new Uint8Array(),
    buildNoteEmbedExtension: () => [],
  };
}

const open: EditorSession[] = [];
function makeSession(
  mode: "live" | "source" = "live",
  doc = DOC,
  editable?: boolean,
  touchInput?: boolean,
  plainTextFile?: string
) {
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
    editable,
    touchInput,
    plainTextFile,
  });
  open.push(session);
  return { session, deps };
}

afterEach(() => {
  while (open.length) open.pop()!.destroy();
  document.body.innerHTML = "";
});

describe("editorSession", () => {
  it("touchInput profile re-enables keyboard smartness and drops the drawn selection (2026-07-16)", () => {
    const { session } = makeSession("live", DOC, undefined, true);
    const content = session.view.contentDOM;
    // CM6 hard-disables these on the contentDOM; the touch profile overrides
    // them so auto-capitalization/autocorrect/suggestions work on device.
    expect(content.getAttribute("autocapitalize")).toBe("sentences");
    expect(content.getAttribute("autocorrect")).toBe("on");
    expect(content.getAttribute("writingsuggestions")).toBe("true");
    // Spellcheck stays off by decision (no squiggles under markdown syntax).
    expect(content.getAttribute("spellcheck")).toBe("false");
    // drawSelection's layers are gone -> the platform renders the NATIVE
    // selection (with its handles) instead of CM's drawn one.
    expect(session.view.dom.querySelector(".cm-selectionLayer")).toBeNull();
  });

  it("the desktop default keeps CM6's input defaults and the drawn selection", () => {
    const { session } = makeSession("live");
    const content = session.view.contentDOM;
    expect(content.getAttribute("autocorrect")).toBe("off");
    expect(content.getAttribute("autocapitalize")).toBe("off");
    expect(session.view.dom.querySelector(".cm-selectionLayer")).not.toBeNull();
  });

  it("touch read mode is NOT an editable region, so Android offers Copy (2026-07-26)", () => {
    const { session } = makeSession("live", DOC, false, true);
    const content = session.view.contentDOM;
    // Android treats a contenteditable as an input field: its autofill service
    // then claims the selection toolbar and replaces Copy with "Autofill" —
    // text you can select but not copy (device report). Read mode is therefore
    // plain, non-editable text on touch too; drawSelection is already off, so
    // the platform paints its own selection with handles.
    expect(session.view.state.facet(EditorView.editable)).toBe(false);
    expect(session.view.state.readOnly).toBe(true);
    expect(content.getAttribute("contenteditable")).toBe("false");
    // Edit restores input: editable, writable, keyboard back.
    session.setEditable(true);
    expect(session.view.state.facet(EditorView.editable)).toBe(true);
    expect(session.view.state.readOnly).toBe(false);
    expect(content.getAttribute("contenteditable")).toBe("true");
  });

  it("off-touch read mode flips the editable facet directly (desktop unchanged)", () => {
    const { session } = makeSession("live", DOC, false, false);
    expect(session.view.state.facet(EditorView.editable)).toBe(false);
    expect(session.view.state.readOnly).toBe(true);
    expect(session.view.contentDOM.getAttribute("inputmode")).not.toBe("none");
  });

  /**
   * C15 (S14). A `.py` is not a note: it opens in Plainva now, and everything
   * the note machinery would do to it is either meaningless (a document header
   * on a config file) or actively wrong (frontmatter hiding on a `.yaml` whose
   * first line is `---`, which is data, not a note header).
   */
  describe("plain text files are not notes", () => {
    it("drops the note machinery and keeps what text needs", () => {
      const { session } = makeSession("live", "id,name\n1,Ada\n", undefined, undefined, "Data/rows.csv");
      const dom = session.view.dom;
      // Gone: the document header widget, the block grips, the markdown live
      // preview marker, and the table widget.
      expect(dom.querySelector(".cm-doc-header")).toBeNull();
      expect(dom.querySelector(".cm-block-handle")).toBeNull();
      expect(session.view.contentDOM.getAttribute("data-pv-live-preview")).toBeNull();
      // …and it says what it is, for anyone reading the accessibility tree.
      expect(session.view.contentDOM.getAttribute("aria-label")).toBe("Text Editor");
      // Still there: line numbers (a text file is read by line) and editing.
      expect(dom.querySelector(".cm-lineNumbers")).not.toBeNull();
      expect(session.view.state.doc.toString()).toBe("id,name\n1,Ada\n");
    });

    it("does not hide a leading --- , which is data in a text file", () => {
      // A `.yaml` document separator is not frontmatter. The note profile hides
      // everything up to the closing fence; doing that here would make the
      // first lines of the file invisible.
      const yaml = "---\nname: Ada\nrole: Editor\n---\n";
      const { session } = makeSession("live", yaml, undefined, undefined, "config.yaml");
      expect(session.view.dom.textContent).toContain("name: Ada");
      // The note profile is what hides it, and it still does — the counter-check
      // that this test is about the profile and not about the plugin's absence.
      const note = makeSession("live", yaml).session;
      expect(note.view.dom.textContent).not.toContain("name: Ada");
    });

    it("resolves the grammar from the file name, not from a fence word", async () => {
      // The existing highlight chain answers "what language is ```py?"; a file
      // carries no fence, so the same chain is asked with the NAME instead.
      // Without this the profile above would be a plain grey box — correct, and
      // useless.
      const { session } = makeSession("live", "def greet(name):\n    return name\n", undefined, undefined, "scripts/hello.py");
      // The class is generated by the style, so ASK the style rather than
      // hard-coding a name that CodeMirror is free to change.
      const keywordClass = markdownHighlightStyle.style([t.keyword]);
      expect(keywordClass, "the app style no longer covers keywords").toBeTruthy();
      await vi.waitFor(() => {
        expect(session.view.dom.querySelector(`span.${keywordClass!.split(" ").join(".")}`)).not.toBeNull();
      });
    });

    it("leaves a file it has no grammar for readable", async () => {
      // No grammar is a normal outcome, not an error: the text still opens.
      const { session } = makeSession("live", "just words\n", undefined, undefined, "notes.fountain");
      await new Promise((r) => setTimeout(r, 0));
      expect(session.view.dom.textContent).toContain("just words");
    });
  });

  it("keeps the parsed syntax tree across a live→source→live switch", () => {
    const { session } = makeSession("live");
    const len = session.view.state.doc.length;
    expect(len).toBeGreaterThan(3000);
    forceFullParse(session.view, len);
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

  it("drives editability through CM's own facet, not the raw attribute (R1.1)", async () => {
    const { EditorView } = await import("@codemirror/view");
    const { session } = makeSession("live", DOC, false);
    // Read-only session: facet false, readOnly true, attribute managed by CM.
    expect(session.view.state.facet(EditorView.editable)).toBe(false);
    expect(session.view.state.readOnly).toBe(true);
    expect(session.view.contentDOM.getAttribute("contenteditable")).toBe("false");
    // A view update must NOT flip the attribute back (the old raw-attribute
    // approach lost to CM's next DOM sync — the mobile keyboard bug).
    session.view.dispatch({ selection: { anchor: 1 } });
    expect(session.view.contentDOM.getAttribute("contenteditable")).toBe("false");
    // Toggling on restores normal editing; default sessions stay editable.
    session.setEditable(true);
    expect(session.view.state.facet(EditorView.editable)).toBe(true);
    expect(session.view.state.readOnly).toBe(false);
    expect(session.view.contentDOM.getAttribute("contenteditable")).toBe("true");
    const { session: defaultSession } = makeSession();
    expect(defaultSession.view.state.facet(EditorView.editable)).toBe(true);
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

  it("styles an unresolved wiki link in live preview and clears it once the target exists (2026-07-18)", () => {
    const { session } = makeSession("live", "See [[Ghost]] here.\n");
    const dom = session.view.contentDOM;
    const ghost = () =>
      [...dom.querySelectorAll<HTMLElement>(".cm-wiki-link")].find((s) => s.getAttribute("data-link-target") === "Ghost");
    // No resolver set yet -> nothing is flagged (index not loaded).
    expect(ghost()).toBeTruthy();
    expect(ghost()!.classList.contains("cm-wiki-link--unresolved")).toBe(false);
    // Resolver set WITHOUT "Ghost" -> the link renders unresolved in LIVE preview,
    // the same muted class the reading view applies (maintainer: live == read).
    session.view.dispatch({ effects: setWikiResolver.of(buildWikiTargetSet([{ title: "Other", path: "Other.md" }])) });
    expect(ghost()!.classList.contains("cm-wiki-link--unresolved")).toBe(true);
    expect(ghost()!.getAttribute("title")).toBeTruthy();
    // Once "Ghost" exists, the unresolved style clears again.
    session.view.dispatch({ effects: setWikiResolver.of(buildWikiTargetSet([{ title: "Ghost", path: "Ghost.md" }])) });
    expect(ghost()!.classList.contains("cm-wiki-link--unresolved")).toBe(false);
  });
});

// Link taps resolve from the HIT ELEMENT, not from coordinates (maintainer,
// Android + iOS, 2026-07-15): posAtCoords() + re-parsing the raw line
// mis-resolved most links on touch WebViews, so only the odd one opened while
// structurally identical links did not. The target now lives on the
// .cm-wiki-link element. jsdom has no layout/coordinates — which is exactly why
// the OLD coordinate path could not open a link here at all — so this exercises
// the element path directly.
describe("wiki link taps (read mode)", () => {
  const clickLink = (session: EditorSession, display: string) => {
    const span = [...session.view.contentDOM.querySelectorAll<HTMLElement>(".cm-wiki-link")]
      .find((s) => (s.textContent ?? "") === display);
    expect(span, `no rendered .cm-wiki-link for "${display}"`).toBeTruthy();
    span!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  };

  it("tags each link span with its target and opens whichever was tapped", () => {
    const { session, deps } = makeSession("live", "- [[Alpha]]\n- [[Beta]]\n- [[Gamma]]\n", false);
    const spans = [...session.view.contentDOM.querySelectorAll<HTMLElement>(".cm-wiki-link")];
    expect(spans.map((s) => s.getAttribute("data-link-target"))).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(spans.every((s) => s.getAttribute("data-link-type") === "wiki")).toBe(true);

    // Every identical link opens its OWN target — the "one of many works" bug
    // cannot recur once the target is carried by the element that was hit.
    clickLink(session, "Beta");
    expect(deps.current.openWikiTarget).toHaveBeenLastCalledWith("Beta", false, "wiki");
    clickLink(session, "Gamma");
    expect(deps.current.openWikiTarget).toHaveBeenLastCalledWith("Gamma", false, "wiki");
    clickLink(session, "Alpha");
    expect(deps.current.openWikiTarget).toHaveBeenLastCalledWith("Alpha", false, "wiki");
    expect(deps.current.openWikiTarget).toHaveBeenCalledTimes(3);
  });

  // Issue #61: the shell must be able to tell a wiki target (a NAME) from a
  // relative markdown target (a PATH). Without the kind, `Editor.openWikiTarget`
  // ran BOTH through the index lookup, and the miss branch of that lookup
  // creates a note — which is how `../_resources/x.mp3` gained a `.md` and hit
  // the vault path guard. The kind is the whole fix; assert it explicitly.
  it("tells a relative markdown link apart from a wiki link", () => {
    const { session, deps } = makeSession(
      "live",
      "- [[Alpha]]\n- [attachment](../_resources/6%20de%20mar.%2015.10.mp3)\n",
      false,
    );
    const spans = [...session.view.contentDOM.querySelectorAll<HTMLElement>(".cm-wiki-link")];
    const kinds = spans.map((s) => s.getAttribute("data-link-type"));
    expect(kinds).toContain("wiki");
    expect(kinds).toContain("markdown");

    clickLink(session, "Alpha");
    expect(deps.current.openWikiTarget).toHaveBeenLastCalledWith("Alpha", false, "wiki");

    clickLink(session, "attachment");
    expect(deps.current.openWikiTarget).toHaveBeenLastCalledWith(
      "../_resources/6%20de%20mar.%2015.10.mp3",
      false,
      "markdown",
    );
  });

  it("does not navigate from a link tap while the note is editable", () => {
    const { session, deps } = makeSession("live", "- [[Alpha]]\n", true);
    session.view.contentDOM
      .querySelector<HTMLElement>(".cm-wiki-link")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(deps.current.openWikiTarget).not.toHaveBeenCalled();
  });

  // OKF 0.2 lifecycle badge in the live header widget (plan P3a). The widget
  // is the ONLY place the live editor shows the status; the read view and the
  // phone derive from the same shared `trustBadgeOf`.
  describe("OKF 0.2 lifecycle badge (plan P3a)", () => {
    const badge = (s: EditorSession) => s.view.dom.querySelector<HTMLElement>('[data-testid="okf-status-badge"]');

    it("renders the pill for `status: draft` and re-derives it when the frontmatter changes", () => {
      const { session } = makeSession("live", "---\ntype: Note\nstatus: draft\n---\n\n# A\n");
      const pill = badge(session);
      expect(pill).not.toBeNull();
      expect(pill!.dataset.status).toBe("draft");
      expect(pill!.classList.contains("pv-chip--danger")).toBe(false);

      // The header field rebuilds only on a frontmatter change — and then it must.
      const doc = session.view.state.doc.toString();
      const from = doc.indexOf("status: draft");
      session.view.dispatch({ changes: { from, to: from + "status: draft".length, insert: "status: deprecated" } });
      const after = badge(session);
      expect(after?.dataset.status).toBe("deprecated");
      // `deprecated` is the one danger-toned chip (Design_Language "Chips").
      expect(after?.classList.contains("pv-chip--danger")).toBe(true);
    });

    it("stays silent for stable, for an absent status and for a task database's foreign status", () => {
      // Red counter-proof for the form check: `Offen` is a task column, not a
      // lifecycle — a badge here would mislabel every task note in the vault.
      for (const fm of ["status: stable", "", "status: Offen"]) {
        const { session } = makeSession("live", `---\ntype: Note\n${fm}\n---\n\n# A\n`);
        expect(badge(session), `frontmatter line: ${JSON.stringify(fm)}`).toBeNull();
      }
    });
  });
});
