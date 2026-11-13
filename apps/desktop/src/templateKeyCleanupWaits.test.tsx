// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IndexNotWholeError, untilWholeIndex, type IndexWholenessState } from "@plainva/core";
import { useTemplateKeyCleanup, type TemplateKeyCleanupState } from "@plainva/ui";

/**
 * "Keys taken over from templates" offers notes to rewrite, planned from the
 * index (performance plan L3). While the first index is built the reader
 * refuses: the notice waits for the whole index and comes then, instead of
 * reporting the refusal as an error (found by the E2E that opens every area
 * while the build is held). Both shells drive the notice from this one hook.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

/** A reader whose index is built until `finish`, refusing meanwhile as the real one does. */
function buildingReader() {
  let state: IndexWholenessState = { kind: "building", done: 1, total: 3 };
  const listeners: Array<(s: IndexWholenessState) => void> = [];
  const wholeness = { state: () => state, changed: () => new Promise<IndexWholenessState>((resolve) => listeners.push(resolve)) };
  const reader = {
    listTemplateKeyNotes: vi.fn(async () => {
      if (state.kind !== "whole") throw new IndexNotWholeError(state);
      return [{ path: "Projects/Plan.md", title: "Plan", hidesTasks: true, templateFor: false }];
    }),
    untilWholeIndex: () => untilWholeIndex(wholeness),
  };
  const finish = (next: IndexWholenessState) => {
    state = next;
    for (const listener of listeners.splice(0)) listener(next);
  };
  return { reader, finish };
}

async function mount(reader: unknown, onError: (e: unknown) => void): Promise<{ current: TemplateKeyCleanupState | null }> {
  const seen: { current: TemplateKeyCleanupState | null } = { current: null };
  function Probe() {
    seen.current = useTemplateKeyCleanup({
      vault: "/v",
      reloadKey: 0,
      queryService: reader as never,
      templateFolder: "Templates",
      updateTextFile: async () => undefined,
      onError,
    });
    return null;
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Probe />));
  return seen;
}

const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });

describe("keys taken over from templates, while the first index is built", () => {
  it("waits for the whole index, says no error, and offers the notes then", async () => {
    const { reader, finish } = buildingReader();
    const onError = vi.fn();
    const seen = await mount(reader, onError);
    await settle();
    expect(reader.listTemplateKeyNotes).not.toHaveBeenCalled();
    expect(seen.current!.items).toEqual([]);

    finish({ kind: "whole" });
    await settle();
    expect(onError).not.toHaveBeenCalled();
    expect(seen.current!.items.map((item) => item.path)).toEqual(["Projects/Plan.md"]);
  });

  it("a vault closed before its index was whole ends the wait without a word", async () => {
    const { reader, finish } = buildingReader();
    const onError = vi.fn();
    const seen = await mount(reader, onError);
    finish({ kind: "closed" });
    await settle();
    expect(onError).not.toHaveBeenCalled();
    expect(reader.listTemplateKeyNotes).not.toHaveBeenCalled();
    expect(seen.current!.items).toEqual([]);
  });
});
