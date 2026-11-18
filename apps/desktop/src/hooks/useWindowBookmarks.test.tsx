// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, useEffect } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The star in another window (review 2026-11-18): it shows what the file
 * says. A click asks the central window for a state; the star turns with its
 * answer or its broadcast, never ahead of them — so a refusal, a late one, or
 * a central window that went leaves nothing wrong on screen.
 */

vi.mock("@plainva/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plainva/ui")>();
  return { ...actual, toast: { info: () => {}, error: () => {}, success: () => {}, warning: () => {} } };
});

/** What `.plainva/bookmarks.json` holds, as the central window lists it. */
let file: Array<{ path: string; type: "file" }> = [];
let refusal: Error | null = null;
/** What the central window answers a star with: the list after it. */
let answer: Array<{ path: string; type: "file" }> | null = null;
vi.mock("../services/windowBus", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/windowBus")>();
  return {
    mayStillLand: actual.mayStillLand,
    getWindowBus: async () => ({
      onBroadcast: async () => () => {},
      request: async (kind: string) => {
        if (kind === "bookmarks-list") return file;
        if (kind === "toggle-bookmark" && refusal) throw refusal;
        if (kind === "toggle-bookmark" && answer) return answer;
        return file;
      },
    }),
  };
});
vi.mock("../services/windowContext", () => ({ isOwnerWindow: () => false }));
vi.mock("../services/bookmarks", () => ({ loadDesktopBookmarks: async () => file, publishBookmarks: () => {} }));

const { useWindowBookmarks } = await import("./useWindowBookmarks");

let root: Root, container: HTMLDivElement;
/** One adapter for every render, as the app hands it: a new one each time would read the list anew each time. */
const IO = {} as never;
/** What the hook gave on its last render, handed out after it (no write during render). */
const probe: { current: ReturnType<typeof useWindowBookmarks> | null } = { current: null };
function Probe() {
  const result = useWindowBookmarks(IO, "/vault");
  useEffect(() => {
    probe.current = result;
  });
  return null;
}
const hook = { toggleBookmark: (path: string) => probe.current!.toggleBookmark(path), get bookmarks() { return probe.current!.bookmarks; } };
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const starred = () => hook.bookmarks.map((entry) => entry.path);

beforeEach(async () => {
  file = [];
  refusal = null;
  answer = null;
  container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root.render(<Probe />));
  await flush();
});
afterEach(() => act(() => root.unmount()));

describe("the star in another window", () => {
  it("stands as in the file once the central window refused", async () => {
    refusal = new Error("Permission denied (os error 13)");
    hook.toggleBookmark("A.md");
    await flush();
    expect(starred()).toEqual([]);
  });

  it("stands as in the file after \"it may still land\", also when the refusal comes late", async () => {
    refusal = new Error("window RPC \"toggle-bookmark\" got no answer after the owner took it; it may still land");
    hook.toggleBookmark("A.md");
    await flush();
    expect(starred()).toEqual([]);
    // The central window turns it down later, or goes: the file has no star, nor has the window.
    expect(file).toEqual([]);
  });

  it("turns with the central window's answer", async () => {
    answer = [{ path: "A.md", type: "file" }];
    hook.toggleBookmark("A.md");
    await flush();
    expect(starred()).toEqual(["A.md"]);
  });
});
