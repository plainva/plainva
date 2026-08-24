// @vitest-environment jsdom
import { forceFullParse } from "../test-parse";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { i18n as I18nInstance } from "i18next";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The widget/caret contract is the test target — not mermaid's jsdom
// behavior. The real renderer pulls the mermaid bundle, which expects a
// browser (and trips over the missing Tauri bridge) in jsdom.
vi.mock("../services/mermaidRender", () => ({
  currentMermaidTheme: () => "neutral",
  renderMermaidDiagram: () => Promise.resolve({ svg: "<svg data-testid='mmd'></svg>" }),
}));

import { createEditorSession, type EditorSession, type EditorSessionDeps } from "@plainva/ui";

// Live-preview math + mermaid widgets (Nachfass 2026-07-06). The session host
// wires mathInlinePlugin/mathMermaidBlockField in LIVE mode only; these tests
// pin the caret contract (raw source under the caret, widget elsewhere) and
// the code-region exclusions.

const HEADER_TEXTS = { addIcon: "a", addColor: "b", changeIcon: "c", changeColor: "d" };
const fakeI18n = { t: (k: string) => k, language: "de" } as unknown as I18nInstance;

function deps(): EditorSessionDeps {
  return {
    queryService: null,
    vaultContext: null,
    onOpenPath: undefined,
    openWikiTarget: () => {},
    openExternalUrl: () => {},
    handlePaste: () => false,
    handleDrop: () => false,
    onDocChanged: () => {},
    onSelectionToolbar: () => {},
    onSelectionStats: () => {},
    onPickIcon: () => {},
    onPickColor: () => {},
    readBinaryFile: async () => new Uint8Array(),
    buildNoteEmbedExtension: () => [],
  };
}

const DOC = [
  "# Kopf",
  "",
  "Inline $E=mc^2$ Formel.",
  "",
  "`$code$` bleibt roh.",
  "",
  "$$",
  "x^2 + y^2",
  "$$",
  "",
  "```mermaid",
  "graph TD; A-->B;",
  "```",
  "",
  "Ende.",
].join("\n");

const open: EditorSession[] = [];
function makeSession(doc = DOC, mode: "live" | "source" = "live") {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const session = createEditorSession({
    parent,
    doc,
    mode,
    vaultPath: "",
    i18n: fakeI18n,
    headerTexts: HEADER_TEXTS,
    deps: { current: deps() },
  });
  open.push(session);
  // lezer parses asynchronously: only a first slice is done synchronously and the
  // rest follows on idle callbacks. Every widget here hangs off the syntax tree,
  // so under load (a full parallel suite on a busy machine) the mermaid fence had
  // not been parsed yet when the assertions ran and the test failed with no code
  // change -- the flake class documented on 2026-08-20. Force the parse the way
  // blockModel/listIndent/editorSession already do, then let the plugins rebuild.
  forceFullParse(session.view);
  session.view.dispatch({});
  return session;
}

afterEach(() => {
  while (open.length) open.pop()!.destroy();
  document.body.innerHTML = "";
});

const mathWidgets = (s: EditorSession) => s.view.dom.querySelectorAll(".pv-math-widget").length;
const mermaidWidgets = (s: EditorSession) => s.view.dom.querySelectorAll(".pv-mermaid-live").length;

describe("mathMermaidLive", () => {
  it("renders inline math, a $$ block and a mermaid fence as widgets in live mode", () => {
    const s = makeSession();
    // Inline $E=mc^2$ + the multi-line $$ block; the `$code$` inline-code
    // dollar must NOT count.
    expect(mathWidgets(s)).toBe(2);
    expect(mermaidWidgets(s)).toBe(1);
  });

  it("keeps everything raw in source mode", () => {
    const s = makeSession(DOC, "source");
    expect(mathWidgets(s)).toBe(0);
    expect(mermaidWidgets(s)).toBe(0);
  });

  it("shows raw source when the caret enters the expression, and re-renders on leave", () => {
    const s = makeSession();
    const pos = s.view.state.doc.toString().indexOf("E=mc");
    s.view.dispatch({ selection: { anchor: pos } });
    expect(mathWidgets(s)).toBe(1); // only the $$ block remains rendered
    s.view.dispatch({ selection: { anchor: 0 } });
    expect(mathWidgets(s)).toBe(2);
  });

  it("shows the fence source while the caret is inside the mermaid block", () => {
    const s = makeSession();
    const pos = s.view.state.doc.toString().indexOf("A-->B");
    s.view.dispatch({ selection: { anchor: pos } });
    expect(mermaidWidgets(s)).toBe(0);
    s.view.dispatch({ selection: { anchor: 0 } });
    expect(mermaidWidgets(s)).toBe(1);
  });

  it("never replaces an unterminated mermaid fence", () => {
    const s = makeSession("# T\n\n```mermaid\ngraph TD; A-->B;\n\nText danach.");
    expect(mermaidWidgets(s)).toBe(0);
  });

  it("ignores dollar signs inside fenced code blocks", () => {
    const s = makeSession("# T\n\n```\nkosten $5 und $10\n```\n\nEnde.");
    expect(mathWidgets(s)).toBe(0);
  });
});

// Height sync (cursor-offset fix 2026-07-06): KaTeX/mermaid settle their size
// AFTER toDOM, so each block widget must keep a ResizeObserver that re-measures
// CM whenever its content reflows — otherwise the per-widget height error
// accumulates and clicks/arrows land progressively below the target. jsdom has
// no ResizeObserver (the guard skips it in the other tests), so we install a
// recording stub to pin the wiring.
describe("mathMermaidLive height sync", () => {
  class MockResizeObserver {
    static instances: MockResizeObserver[] = [];
    observed: Element[] = [];
    disconnected = false;
    constructor(readonly cb: ResizeObserverCallback) { MockResizeObserver.instances.push(this); }
    observe(el: Element) { this.observed.push(el); }
    unobserve() {}
    disconnect() { this.disconnected = true; }
  }
  const isWidget = (el: Element) =>
    el.classList.contains("pv-math-widget") || el.classList.contains("pv-mermaid-live");
  const widgetObservers = () =>
    MockResizeObserver.instances.filter((ro) => ro.observed.some(isWidget));

  const original = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  beforeEach(() => {
    MockResizeObserver.instances = [];
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = MockResizeObserver;
  });
  afterEach(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = original;
  });

  it("observes every rendered math/mermaid widget exactly once (2 math + 1 mermaid)", () => {
    makeSession();
    const mine = widgetObservers();
    expect(mine.length).toBe(3);
    // Each watches its own single widget element and is live.
    expect(mine.every((ro) => ro.observed.length === 1 && !ro.disconnected)).toBe(true);
  });

  it("disconnects the widget observers when the session is destroyed", () => {
    const s = makeSession();
    const mine = widgetObservers();
    expect(mine.length).toBe(3);
    s.destroy();
    open.splice(open.indexOf(s), 1); // destroyed here; keep the afterEach from re-destroying
    expect(mine.every((ro) => ro.disconnected)).toBe(true);
  });
});

/**
 * The inline plugin must rebuild on PARSE PROGRESS (S8, 2026-08-12).
 *
 * Lezer parses asynchronously and time-budgeted: only a window is ready when
 * the editor is created. The block field below has always guarded for that;
 * the inline plugin did not, so a formula the first parse had not reached
 * stayed raw until something else happened — a keystroke, a scroll. It
 * surfaced when the full suite ran on a loaded machine and the initial parse
 * lost its budget, which is exactly the production case on a large note.
 *
 * This is a source guard on purpose. The condition is only observable when
 * the parse is starved, and a test cannot starve it on demand: in jsdom the
 * viewport is 768 characters wide and everything inside it parses eagerly. A
 * behavioural test here would either pass for the wrong reason or be a race.
 */
describe("mathMermaidLive — the inline plugin rebuilds on parse progress", () => {
  const src = readFileSync(
    join(__dirname, "../../../../packages/ui/src/components/mathMermaidLive.ts"),
    "utf8",
  );

  it("checks the syntax tree in its update, like listIndent and the block field", () => {
    const update = src.slice(src.indexOf("update(update: ViewUpdate)"));
    const condition = update.slice(0, update.indexOf("this.decorations"));
    expect(condition).toContain("syntaxTree(update.startState) !== syntaxTree(update.state)");
  });

  it("still rebuilds on the three ordinary triggers", () => {
    const update = src.slice(src.indexOf("update(update: ViewUpdate)"));
    const condition = update.slice(0, update.indexOf("this.decorations"));
    for (const trigger of ["update.docChanged", "update.viewportChanged", "update.selectionSet"]) {
      expect(condition).toContain(trigger);
    }
  });
});
