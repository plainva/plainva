// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, useEffect } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The star in another window (review 2026-11-17, R1): it turns at once, and
 * the central window's answer replaces it. A request the central window
 * refused, or that never reached it, leaves the window showing what the file
 * says — only one that may still land keeps its star until the answer or the
 * next broadcast.
 */

vi.mock("@plainva/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plainva/ui")>();
  return { ...actual, toast: { info: () => {}, error: () => {}, success: () => {}, warning: () => {} } };
});

/** What `.plainva/bookmarks.json` holds, as the central window lists it. */
let file: Array<{ path: string; type: "file" }> = [];
let refusal: Error | null = null;
vi.mock("../services/windowBus", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/windowBus")>();
  return {
    mayStillLand: actual.mayStillLand,
    getWindowBus: async () => ({
      onBroadcast: async () => () => {},
      request: async (kind: string) => {
        if (kind === "bookmarks-list") return file;
        if (kind === "toggle-bookmark" && refusal) throw refusal;
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
  container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root.render(<Probe />));
  await flush();
});
afterEach(() => act(() => root.unmount()));

describe("the star in another window after a failed request", () => {
  it("stands as in the file once the central window refused", async () => {
    refusal = new Error("Permission denied (os error 13)");
    hook.toggleBookmark("A.md");
    await flush();
    expect(file).toEqual([]);
    expect(starred()).toEqual([]);
  });

  it("stands as in the file when taking it off was refused", async () => {
    file = [{ path: "A.md", type: "file" }];
    window.dispatchEvent(new CustomEvent("plainva-bookmarks-changed"));
    await flush();
    expect(starred()).toEqual(["A.md"]);
    refusal = new Error("window RPC \"toggle-bookmark\" got no answer from the main window");
    hook.toggleBookmark("A.md");
    await flush();
    expect(starred()).toEqual(["A.md"]);
  });

  it("keeps the star a request that may still land asked for", async () => {
    refusal = new Error("window RPC \"toggle-bookmark\" got no answer after the owner took it; it may still land");
    hook.toggleBookmark("A.md");
    await flush();
    expect(starred()).toEqual(["A.md"]);
  });
});
