// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { i18n as I18nInstance } from "i18next";
import { planCommentRound, type CommentOperation } from "@plainva/core";

// The session pulls in NoteEmbedPlugin -> VaultContext -> CredentialManager, whose module-level `Store.load` needs the
// Tauri bridge (absent in jsdom).
vi.mock("../services/CredentialManager", () => ({ credentialManager: {} }));

/**
 * Sending a suggestion and ending its round on a real editor session, while the word diff is still on its way (review
 * of L5, rounds 2 and 3, 2026-11-25). The diff is a chunk of its own; here its load (`loadSuggestionDiff`, given the
 * loader before the mode starts) waits on a gate the test opens.
 *
 * - Nothing is handed out to be written before the diff is there, and then exactly the diff's chunks — both shells
 *   send through `suggestionToSend`, which asks `session.suggestion()`.
 * - A round that ends while the person types on does not end the mode: ending it puts the base back over what was
 *   typed — `suggestionRoundEnds` reads the copy again after the wait (both shells end rounds through it).
 */
/** The word diff's load, held until the test opens it. */
let openGate: () => void = () => undefined;
const BASE = "The contract runs until the end of the year.\nThe electrician is a separate firm.\nReserve 10 %.\n";
const HEADER_TEXTS = { addIcon: "a", addColor: "b", changeIcon: "c", changeColor: "d" };
const fakeI18n = { t: (k: string) => k, language: "en" } as unknown as I18nInstance;

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const w = window as unknown as { requestAnimationFrame?: (cb: (t: number) => void) => number; cancelAnimationFrame?: (id: number) => void };
  if (!w.requestAnimationFrame) {
    w.requestAnimationFrame = (cb) => window.setTimeout(() => cb(Date.now()), 0);
    w.cancelAnimationFrame = (id) => window.clearTimeout(id);
  }
  const zero = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() { return this; } } as DOMRect;
  Range.prototype.getBoundingClientRect = () => zero;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
});

/** A fresh copy of the package (the diff not loaded), a real session in the mode, and an edit in two places. */
async function editedSession() {
  vi.resetModules();
  const ui = await import("@plainva/ui");
  const mode = await import("../../../../packages/ui/src/components/suggestMode");
  const merge = await import("@codemirror/merge");
  const gate = new Promise<void>((resolve) => { openGate = resolve; });
  void mode.loadSuggestionDiff(async () => { await gate; return merge; });
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const deps = {
    current: {
      queryService: null, vaultContext: null, onOpenPath: undefined, openWikiTarget: vi.fn(), openExternalUrl: vi.fn(),
      handlePaste: () => false, handleDrop: () => false, onDocChanged: vi.fn(), onSelectionToolbar: vi.fn(), onSelectionStats: vi.fn(),
      onPickIcon: vi.fn(), onPickColor: vi.fn(), readBinaryFile: async () => new Uint8Array(), buildNoteEmbedExtension: () => [],
    },
  } as unknown as Parameters<typeof ui.createEditorSession>[0]["deps"];
  const session = ui.createEditorSession({ parent, doc: BASE, mode: "source", vaultPath: "", i18n: fakeI18n, headerTexts: HEADER_TEXTS, deps });
  session.setSuggesting(true);
  const first = BASE.indexOf("contract");
  const last = BASE.indexOf("10 %");
  session.view.dispatch({ changes: [{ from: first, to: first + 8, insert: "lease" }, { from: last, to: last + 2, insert: "15" }] });
  open.push(session);
  return { ui, session };
}

const open: Array<{ destroy(): void }> = [];
afterEach(() => {
  while (open.length) open.pop()!.destroy();
  document.body.innerHTML = "";
  openGate();
});

const settledAfter = async <T,>(promise: Promise<T>, ms: number) => {
  let settled = false;
  void promise.then(() => { settled = true; }, () => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, ms));
  return settled;
};

describe("sending a suggestion while its word diff loads", () => {
  it("hands nothing out before the diff is there, then exactly its chunks", async () => {
    expect.hasAssertions();
    const { ui, session } = await editedSession();
    const planned = ui.suggestionToSend(session, 4096);
    expect(await settledAfter(planned, 50), "nothing to write before the diff is there").toBe(false);
    openGate();
    const result = await planned;
    expect(result.kind).toBe("send");
    if (result.kind !== "send") return;
    expect(result.chunks.map((c) => [c.fromA, c.toA])).toEqual([[4, 12], [90, 91]]);
    expect(result.copy).toBe(session.view.state.doc.toString());
  }, 30_000);

  it("ends the round's mode only for the copy the round was made of — not after typing during the wait", async () => {
    expect.hasAssertions();
    const { ui, session } = await editedSession();
    const merge = await import("@codemirror/merge");
    const copy = session.view.state.doc.toString();
    const chunks = merge.presentableDiff(BASE, copy).map((c) => ({ fromA: c.fromA, toA: c.toA, replacement: copy.slice(c.fromB, c.toB) }));
    const operation = planCommentRound("n.md", BASE, chunks, "") as unknown as CommentOperation;
    const ask = () => ui.suggestionRoundEnds({ session, operation, notePath: "n.md", note: () => "", current: () => true });

    // Typed while the diff loads: the round is of the copy before.
    const typedDuringWait = ask();
    const end = session.view.state.doc.length;
    session.view.dispatch({ changes: { from: end, to: end, insert: "Typed during the wait.\n" } });
    openGate();
    expect(await typedDuringWait).toBe(false);

    // The same round on an unchanged copy ends the mode.
    session.view.dispatch({ changes: { from: end, to: session.view.state.doc.length, insert: "" } });
    expect(await ask()).toBe(true);
    // And the shell's own checks are asked after the wait.
    expect(await ui.suggestionRoundEnds({ session, operation, notePath: "n.md", note: () => "", current: () => false })).toBe(false);
  }, 30_000);
});
