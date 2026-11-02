// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from "vitest";

// The session pulls in NoteEmbedPlugin -> VaultContext -> CredentialManager,
// whose module-level `Store.load` needs the Tauri bridge (absent in jsdom).
vi.mock("../services/CredentialManager", () => ({ credentialManager: {} }));

import type { i18n as I18nInstance } from "i18next";
import { createEditorSession, type EditorSessionDeps } from "@plainva/ui";
import { forceFullParse } from "../test-parse";
// The bubble and the corner carry their labels from the real catalogue.
import "@plainva/ui/i18n";

/** The editor session both shells build, run for real in jsdom (no layout). */

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

/**
 * A table cell with a comment, opened and closed without a change (open-items
 * plan 3.131 no. 3): the corner triangle and the speech bubble stay. Emptied
 * with the cell's content, they were gone until the table was built again —
 * and nothing builds it again when nothing changed. One widget for both shells
 * (`LivePreviewPlugin.ts`).
 */
const DOC = "Intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nAfter";

describe("a commented table cell opened and closed unchanged", () => {
  it("keeps its corner triangle and the bubble of every cell", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const session = createEditorSession({
      parent,
      doc: DOC,
      mode: "live",
      vaultPath: "",
      i18n: fakeI18n,
      headerTexts: { addIcon: "a", addColor: "b", changeIcon: "c", changeColor: "d" },
      // Comments on: every cell offers its bubble.
      deps: { current: { ...baseDeps(), commentAnchorsEnabled: () => true, onCommentAnchorRequest: vi.fn() } },
      editable: true,
    });
    try {
      forceFullParse(session.view, DOC.length);
      const from = DOC.indexOf("| a |");
      const to = DOC.indexOf("\n\nAfter");
      session.setAnchorHighlights([{ commentId: "c1", from, to, frame: { kind: "tableCell", row: 1, column: 0 } }]);
      const cell = () => session.view.dom.querySelectorAll<HTMLTableCellElement>(".cm-md-table tbody td")[0];
      expect(cell()?.querySelector(".cm-anchor-corner"), "the corner before").toBeTruthy();
      const bubbles = () => session.view.dom.querySelectorAll(".cm-md-table .cm-anchor-bubble").length;
      const bubblesBefore = bubbles();
      expect(bubblesBefore).toBeGreaterThan(0);

      for (const close of ["Escape", "Enter"]) {
        cell().dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
        const field = cell().querySelector("textarea");
        expect(field, "the field opens").toBeTruthy();
        field!.dispatchEvent(new KeyboardEvent("keydown", { key: close, bubbles: true }));
        expect(cell().querySelector("textarea"), close).toBeNull();
        expect(cell().textContent, close).toContain("1");
        expect(cell().querySelector(".cm-anchor-corner"), `the corner after ${close}`).toBeTruthy();
        expect(bubbles(), `the bubbles after ${close}`).toBe(bubblesBefore);
      }
      expect(session.view.state.doc.toString()).toBe(DOC);
    } finally {
      session.destroy();
      document.body.innerHTML = "";
    }
  });
});
