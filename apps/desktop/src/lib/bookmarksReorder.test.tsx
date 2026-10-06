// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  bookmarkKey, bookmarkStepTarget, moveBookmark, moveBookmarkOnDisk, parseBookmarksFile, reorderTarget, serializeBookmarksFile, toggleBookmarkOnDisk,
  usePointerReorder, type BookmarkEntry, type BookmarksIO,
} from "@plainva/ui";

/**
 * Arranging the bookmarks (plan Befunde 2026-10-06, W6). A tester asked where
 * the order is changed; it could not be, on either device. The order is the
 * file's — one list, both shells — and a move is named by keys, so a view that
 * shows a filtered or a stale list cannot put an entry in the wrong place.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const file = (path: string): BookmarkEntry => ({ type: "file", path });
const folder = (path: string): BookmarkEntry => ({ type: "folder", path });
const LIST = [file("A.md"), folder("Projects"), file("B.md"), file("C.md")];
const k = bookmarkKey;
const paths = (entries: readonly BookmarkEntry[]) => entries.map((entry) => entry.path);

describe("moveBookmark", () => {
  it("puts an entry in front of another, in either direction", () => {
    expect(paths(moveBookmark(LIST, k(file("C.md")), k(file("A.md"))))).toEqual(["C.md", "A.md", "Projects", "B.md"]);
    expect(paths(moveBookmark(LIST, k(file("A.md")), k(file("C.md"))))).toEqual(["Projects", "B.md", "A.md", "C.md"]);
  });

  it("puts an entry at the end with no target", () => {
    expect(paths(moveBookmark(LIST, k(folder("Projects")), null))).toEqual(["A.md", "B.md", "C.md", "Projects"]);
  });

  it("tells a file and a folder of the same path apart", () => {
    const twins = [file("Projects"), folder("Projects"), file("Z.md")];
    expect(moveBookmark(twins, k(folder("Projects")), k(file("Projects")))).toEqual([folder("Projects"), file("Projects"), file("Z.md")]);
  });

  it("leaves the order alone when the entry or its target is gone", () => {
    expect(moveBookmark(LIST, k(file("Gone.md")), null)).toEqual(LIST);
    expect(moveBookmark(LIST, k(file("A.md")), k(file("Gone.md")))).toEqual(LIST);
    expect(moveBookmark(LIST, k(file("A.md")), k(file("A.md")))).toEqual(LIST);
  });
});

describe("one step with the keyboard", () => {
  it("names the neighbour to land in front of, and stops at both ends", () => {
    expect(bookmarkStepTarget(LIST, k(file("B.md")), -1)).toEqual({ beforeKey: k(folder("Projects")) });
    expect(bookmarkStepTarget(LIST, k(file("B.md")), 1)).toEqual({ beforeKey: null });
    expect(bookmarkStepTarget(LIST, k(file("A.md")), 1)).toEqual({ beforeKey: k(file("B.md")) });
    expect(bookmarkStepTarget(LIST, k(file("A.md")), -1)).toBeNull();
    expect(bookmarkStepTarget(LIST, k(file("C.md")), 1)).toBeNull();
  });

  it("a step up and a step down are each other's undo", () => {
    const up = bookmarkStepTarget(LIST, k(file("B.md")), -1)!;
    const moved = moveBookmark(LIST, k(file("B.md")), up.beforeKey);
    expect(paths(moved)).toEqual(["A.md", "B.md", "Projects", "C.md"]);
    const down = bookmarkStepTarget(moved, k(file("B.md")), 1)!;
    expect(moveBookmark(moved, k(file("B.md")), down.beforeKey)).toEqual(LIST);
  });
});

describe("moveBookmarkOnDisk", () => {
  function disk(initial: BookmarkEntry[]) {
    let text = serializeBookmarksFile(initial);
    let writes = 0;
    const io: BookmarksIO = { readTextFile: async () => text, writeTextFile: async (_path, content) => { writes += 1; text = content; } };
    return { io, read: () => parseBookmarksFile(text).entries, writes: () => writes };
  }

  it("writes the new order and keeps files and folders as they are", async () => {
    const d = disk(LIST);
    const after = await moveBookmarkOnDisk(d.io, k(file("C.md")), k(folder("Projects")));
    expect(after).toEqual([file("A.md"), file("C.md"), folder("Projects"), file("B.md")]);
    expect(d.read()).toEqual(after);
  });

  it("moves in the list as it is on disk, not as a window last saw it", async () => {
    const d = disk(LIST);
    // Another window stars D and unstars A while this one still shows the old list.
    await toggleBookmarkOnDisk(d.io, "D.md");
    await toggleBookmarkOnDisk(d.io, "A.md");
    const after = await moveBookmarkOnDisk(d.io, k(file("C.md")), k(file("B.md")));
    expect(paths(after)).toEqual(["Projects", "C.md", "B.md", "D.md"]);
  });

  it("writes nothing when nothing moves", async () => {
    const d = disk(LIST);
    await moveBookmarkOnDisk(d.io, k(file("A.md")), k(folder("Projects")));
    await moveBookmarkOnDisk(d.io, k(file("Gone.md")), null);
    expect(d.writes()).toBe(0);
  });
});

describe("where a drop lands", () => {
  const keys = ["a", "b", "c", "d"];

  it("turns an insertion slot into the entry to land in front of", () => {
    expect(reorderTarget(keys, "d", 0)).toEqual({ beforeKey: "a" });
    expect(reorderTarget(keys, "a", 2)).toEqual({ beforeKey: "c" });
    expect(reorderTarget(keys, "a", 4)).toEqual({ beforeKey: null });
  });

  it("treats the two slots around an entry as its own place", () => {
    expect(reorderTarget(keys, "b", 1)).toBeUndefined();
    expect(reorderTarget(keys, "b", 2)).toBeUndefined();
    expect(reorderTarget(keys, "x", 0)).toBeUndefined();
  });
});

/**
 * The gesture itself, against rows with real boxes: jsdom lays nothing out, so
 * each row answers `getBoundingClientRect` with the 40-px slot it would have.
 */
const ROW = 40;
function Rows({ keys, threshold, onMove, onOpen }: { keys: string[]; threshold: number; onMove: (key: string, beforeKey: string | null) => void; onOpen: (key: string) => void }) {
  const reorder = usePointerReorder<string>({
    keys,
    rows: () => [...document.querySelectorAll<HTMLElement>("[data-row]")],
    onMove,
    threshold,
  });
  return (
    <div>
      {keys.map((key, index) => (
        <button
          key={key}
          data-row={key}
          data-dragging={reorder.dragKey === key ? "1" : undefined}
          data-drop={reorder.dropIndex === index ? "1" : undefined}
          {...reorder.bind(key)}
          onClick={() => { if (!reorder.wasDrag()) onOpen(key); }}
        >
          {key}
        </button>
      ))}
    </div>
  );
}

const mounted: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) { await act(async () => root.unmount()); host.remove(); }
});

async function mountRows(threshold: number) {
  const onMove = vi.fn();
  const onOpen = vi.fn();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => { root.render(<Rows keys={["a", "b", "c"]} threshold={threshold} onMove={onMove} onOpen={onOpen} />); });
  const rows = [...host.querySelectorAll<HTMLElement>("[data-row]")];
  rows.forEach((row, index) => {
    row.getBoundingClientRect = () => ({ top: index * ROW, bottom: (index + 1) * ROW, height: ROW, left: 0, right: 200, width: 200, x: 0, y: index * ROW, toJSON: () => ({}) });
  });
  const pointer = async (row: HTMLElement, type: string, y: number) => {
    await act(async () => {
      // jsdom has no PointerEvent; React reads the pointer fields off a MouseEvent of that name.
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: y, button: 0 });
      Object.defineProperty(event, "pointerId", { value: 1 });
      Object.defineProperty(event, "pointerType", { value: "mouse" });
      row.dispatchEvent(event);
    });
  };
  return { rows, onMove, onOpen, pointer };
}

describe("usePointerReorder", () => {
  it("a press that does not travel stays a click", async () => {
    const { rows, onMove, onOpen, pointer } = await mountRows(5);
    await pointer(rows[0], "pointerdown", 10);
    await pointer(rows[0], "pointermove", 12);
    await pointer(rows[0], "pointerup", 12);
    await act(async () => rows[0].click());
    expect(onMove).not.toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledWith("a");
  });

  it("a press that travels is a drag: it marks the slot, moves on release and swallows the click", async () => {
    const { rows, onMove, onOpen, pointer } = await mountRows(5);
    await pointer(rows[0], "pointerdown", 10);
    await pointer(rows[0], "pointermove", 95); // past the middle of the third row
    expect(rows[0].dataset.dragging).toBe("1");
    await pointer(rows[0], "pointermove", 70); // between the second and the third
    expect(rows[2].dataset.drop).toBe("1");
    await pointer(rows[0], "pointerup", 70);
    expect(onMove).toHaveBeenCalledWith("a", "c");
    await act(async () => rows[0].click());
    expect(onOpen).not.toHaveBeenCalled();
    // The next click is an ordinary one again.
    await act(async () => rows[0].click());
    expect(onOpen).toHaveBeenCalledWith("a");
  });

  it("a drop behind the last row goes to the end", async () => {
    const { rows, onMove, pointer } = await mountRows(5);
    await pointer(rows[0], "pointerdown", 10);
    await pointer(rows[0], "pointermove", 119);
    await pointer(rows[0], "pointerup", 119);
    expect(onMove).toHaveBeenCalledWith("a", null);
  });

  it("a drop on its own place, or a cancelled drag, moves nothing", async () => {
    const { rows, onMove, pointer } = await mountRows(5);
    await pointer(rows[1], "pointerdown", 50);
    await pointer(rows[1], "pointermove", 70);
    await pointer(rows[1], "pointerup", 70);
    await pointer(rows[1], "pointerdown", 50);
    await pointer(rows[1], "pointermove", 5);
    await pointer(rows[1], "pointercancel", 5);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("a grip (no threshold) drags from the first touch", async () => {
    const { rows, onMove, pointer } = await mountRows(0);
    await pointer(rows[2], "pointerdown", 100);
    expect(rows[2].dataset.dragging).toBe("1");
    await pointer(rows[2], "pointermove", 5);
    await pointer(rows[2], "pointerup", 5);
    expect(onMove).toHaveBeenCalledWith("c", "a");
  });
});
