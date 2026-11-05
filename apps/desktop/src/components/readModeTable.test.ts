// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from "vitest";

// The session pulls in NoteEmbedPlugin -> VaultContext -> CredentialManager,
// whose module-level `Store.load` needs the Tauri bridge (absent in jsdom).
vi.mock("../services/CredentialManager", () => ({ credentialManager: {} }));

import type { i18n as I18nInstance } from "i18next";
import { buildNoteEmbedCoreExtension, createEditorSession, type EditorSessionDeps } from "@plainva/ui";
import { forceFullParse } from "../test-parse";
import "@plainva/ui/i18n";

/**
 * Tables in read mode (GitHub issue 118, plan Rückmeldungen 05.11., P5). On
 * Android a long press in a cell of a note in read mode opened "Edit table"
 * instead of selecting text, and after Back the table stood there as raw
 * Markdown: the press had put the selection into the table, and the table
 * showed its source wherever the selection was — read mode or not. In read
 * mode a press now stays with the system, and nothing the selection does
 * turns a table, an embed or a diagram back into its source. One widget for
 * both shells (`LivePreviewPlugin.ts`).
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

function deps(): EditorSessionDeps {
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
    buildNoteEmbedExtension: (_ctx, isLive) => buildNoteEmbedCoreExtension({ render: (container) => { container.textContent = "embedded"; return () => {}; } }, isLive),
  };
}

const DOC = "Intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n![[Other]]\n\nAfter";

function session(editable: boolean) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const s = createEditorSession({
    parent,
    doc: DOC,
    mode: "live",
    vaultPath: "",
    i18n: fakeI18n,
    headerTexts: { addIcon: "a", addColor: "b", changeIcon: "c", changeColor: "d" },
    deps: { current: deps() },
    editable,
  });
  forceFullParse(s.view, DOC.length);
  return s;
}

const cell = (s: ReturnType<typeof session>) => s.view.dom.querySelector<HTMLTableCellElement>(".cm-md-table tbody td");

function pressAndHold(target: HTMLElement): { menus: number; prevented: boolean } {
  let menus = 0;
  const count = () => { menus++; };
  window.addEventListener("plainva-open-table-menu", count);
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
  target.dispatchEvent(event);
  window.removeEventListener("plainva-open-table-menu", count);
  return { menus, prevented: event.defaultPrevented };
}

describe("a table in read mode", () => {
  it("leaves a long press in a cell to the system: no table menu, the text can be selected", () => {
    const s = session(false);
    try {
      expect(cell(s)).toBeTruthy();
      expect(pressAndHold(cell(s)!)).toEqual({ menus: 0, prevented: false });
      // Nor does a tap open the cell's field.
      cell(s)!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
      expect(cell(s)!.querySelector("textarea")).toBeNull();
    } finally {
      s.destroy();
      document.body.innerHTML = "";
    }
  });

  it("stays rendered, and the embed with it, wherever the selection goes", () => {
    const s = session(false);
    try {
      const tableAt = DOC.indexOf("| 1 |") + 2;
      const embedAt = DOC.indexOf("![[Other]]") + 3;
      // What a long press and the Back after it leave: a selection inside the table.
      s.view.dispatch({ selection: { anchor: tableAt, head: tableAt + 1 } });
      expect(s.view.dom.querySelector(".cm-md-table"), "the table").toBeTruthy();
      expect(s.view.dom.textContent).not.toContain("| 1 |");
      s.view.dispatch({ selection: { anchor: embedAt } });
      expect(s.view.dom.textContent).not.toContain("![[Other]]");
      expect(s.view.dom.textContent).toContain("embedded");
    } finally {
      s.destroy();
      document.body.innerHTML = "";
    }
  });

  it("shows its source again once the note is being edited, where the caret is", () => {
    const s = session(false);
    try {
      const tableAt = DOC.indexOf("| 1 |") + 2;
      s.view.dispatch({ selection: { anchor: tableAt } });
      expect(s.view.dom.querySelector(".cm-md-table")).toBeTruthy();
      s.setEditable(true);
      expect(s.view.dom.querySelector(".cm-md-table"), "the caret in the table reveals it").toBeNull();
      expect(s.view.dom.textContent).toContain("| 1 |");
      s.setEditable(false);
      expect(s.view.dom.querySelector(".cm-md-table"), "back to read mode").toBeTruthy();
    } finally {
      s.destroy();
      document.body.innerHTML = "";
    }
  });
});

describe("a table being edited", () => {
  it("keeps its table menu on a long press or right-click", () => {
    const s = session(true);
    try {
      expect(pressAndHold(cell(s)!)).toEqual({ menus: 1, prevented: true });
    } finally {
      s.destroy();
      document.body.innerHTML = "";
    }
  });
});
