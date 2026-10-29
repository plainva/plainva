// @vitest-environment jsdom
import { forceFullParse } from "../test-parse";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.setConfig({ testTimeout: 20_000 });
import type { i18n as I18nInstance } from "i18next";

vi.mock("../services/mermaidRender", () => ({
  currentMermaidTheme: () => "neutral",
  renderMermaidDiagram: () => Promise.resolve({ svg: "<svg data-testid='mmd'></svg>" }),
}));

import { changeEditorNote, createEditorSession, minimalTextChange, type EditorSession, type EditorSessionDeps, type TasksQueryHost, type TasksQueryWidgetContext } from "@plainva/ui";
import { EditorView } from "@codemirror/view";

/**
 * The ```tasks block in the live editor (plan Tasks-Abfragen, T4): found at
 * the top level and in a quote or callout (the detection Mermaid shares),
 * the query's text under the caret, the result elsewhere; "Edit query" puts
 * the caret into the query, and a tick on a task of the same note goes
 * through the editor.
 */

const HEADER_TEXTS = { addIcon: "a", addColor: "b", changeIcon: "c", changeColor: "d" };
const fakeI18n = { t: (k: string) => k, language: "de" } as unknown as I18nInstance;

const rendered: TasksQueryWidgetContext[] = [];
const unmounted: string[] = [];
const host: TasksQueryHost = {
  render(container, context) {
    rendered.push(context);
    container.textContent = `QUERY[${context.source}]`;
    return () => unmounted.push(context.source);
  },
};

function deps(withHost = true): EditorSessionDeps {
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
    ...(withHost ? { tasksQueryHost: host } : {}),
  };
}

const open: EditorSession[] = [];
function makeSession(doc: string, opts: { mode?: "live" | "source"; editable?: boolean; withHost?: boolean } = {}) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const session = createEditorSession({
    parent,
    doc,
    mode: opts.mode ?? "live",
    vaultPath: "",
    i18n: fakeI18n,
    headerTexts: HEADER_TEXTS,
    deps: { current: deps(opts.withHost ?? true) },
    ...(opts.editable === false ? { editable: false } : {}),
  });
  open.push(session);
  forceFullParse(session.view);
  session.view.dispatch({});
  return session;
}

afterEach(() => {
  while (open.length) open.pop()!.destroy();
  document.body.innerHTML = "";
  rendered.length = 0;
  unmounted.length = 0;
});

const blocks = (s: EditorSession) => [...s.view.dom.querySelectorAll<HTMLElement>(".pv-tasksquery-live")];

const TESTER = [
  "# Bahnhof Nord",
  "",
  "> [!todo] Offene Todos",
  "> ```tasks",
  "> not done",
  "> tags include #rettediebahn",
  "> show tree",
  "> sort by filename reverse",
  "> ```",
  "",
  "- [ ] Offene Todos sammeln #rettediebahn",
  "",
  "```tasks",
  "due today",
  "```",
  "",
  "Ende.",
].join("\n");

describe("the tasks block in the editor", () => {
  it("draws a block at the top level and in a callout, from the query as the Tasks plugin reads it", () => {
    const s = makeSession(TESTER);
    const found = blocks(s);
    expect(found).toHaveLength(2);
    expect(rendered.map((c) => c.source)).toEqual(["not done\ntags include #rettediebahn\nshow tree\nsort by filename reverse", "due today"]);
    // The block replaces the callout's last lines, so it carries the card.
    expect(found[0].classList.contains("cm-callout")).toBe(true);
    expect(found[0].classList.contains("cm-callout--last")).toBe(true);
    expect(found[1].classList.contains("cm-callout")).toBe(false);
  });

  it("shows the query's text while the caret is in it, and the result again outside", () => {
    const s = makeSession(TESTER);
    s.view.dispatch({ selection: { anchor: s.view.state.doc.toString().indexOf("show tree") } });
    expect(blocks(s)).toHaveLength(1);
    expect(unmounted).toContain("not done\ntags include #rettediebahn\nshow tree\nsort by filename reverse");
    s.view.dispatch({ selection: { anchor: 0 } });
    expect(blocks(s)).toHaveLength(2);
  });

  it("in a read-only editor (the phone's reading) the caret shows nothing: the block stays drawn", () => {
    const s = makeSession(TESTER, { editable: false });
    s.view.dispatch({ selection: { anchor: s.view.state.doc.toString().indexOf("show tree") } });
    expect(blocks(s)).toHaveLength(2);
  });

  it("stays text in the source mode, without a host, and when the fence is never closed", () => {
    expect(blocks(makeSession(TESTER, { mode: "source" }))).toHaveLength(0);
    expect(blocks(makeSession(TESTER, { withHost: false }))).toHaveLength(0);
    expect(blocks(makeSession("# T\n\n```tasks\nnot done\n\nText."))).toHaveLength(0);
  });

  it("reads ~~~ fences, any case, an empty block, and leaves other languages alone", () => {
    const s = makeSession("# T\n\n~~~Tasks\n~~~\n\n```task\nnot done\n```\n\n```tasks2\nx\n```\n");
    expect(rendered.map((c) => c.source)).toEqual([""]);
    expect(blocks(s)).toHaveLength(1);
  });

  it("'Edit query' puts the caret at the end of that line of the query", () => {
    const s = makeSession(TESTER);
    const ctx = rendered[0];
    const doc = s.view.state.doc;
    expect(ctx.positionOf(null)).toBe(doc.line(5).to);
    ctx.editQuery(2);
    expect(doc.lineAt(s.view.state.selection.main.head).text).toBe("> tags include #rettediebahn");
    expect(s.view.state.selection.main.head).toBe(doc.line(6).to);
  });

  it("a change to the same note goes through the editor as one minimal change", () => {
    const s = makeSession(TESTER);
    const changed = rendered[0].changeNote((text) => text.replace("- [ ] Offene Todos", "- [x] Offene Todos"));
    expect(changed).toBe(true);
    expect(s.view.state.doc.toString()).toContain("- [x] Offene Todos sammeln");
    expect(rendered[0].changeNote(() => null)).toBe(false);
  });
});

describe("minimal text changes", () => {
  it("touches only what differs", () => {
    expect(minimalTextChange("abc", "abc")).toBeNull();
    expect(minimalTextChange("- [ ] a\n- [ ] b", "- [ ] a\n- [x] b")).toEqual({ from: 11, to: 12, insert: "x" });
    expect(minimalTextChange("one", "one two")).toEqual({ from: 3, to: 3, insert: " two" });
    expect(minimalTextChange("aXa", "aa")).toEqual({ from: 1, to: 2, insert: "" });
  });

  it("changeEditorNote dispatches nothing when nothing changes", () => {
    const s = makeSession("plain");
    const spy = vi.spyOn(s.view, "dispatch");
    expect(changeEditorNote(s.view, (text) => text)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

void EditorView;
