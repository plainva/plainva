import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOLD_MOVE_SLOP_PX, holdGestureEnd, holdMoved } from "./lib/holdGesture";
import { folderNameOf } from "./components/CloudFolderPickerSheet";

/**
 * One gesture, one meaning (TestFlight 2026-09-25: on the board "menu and
 * moving collide"). A hold on a card ends as the menu OR as a move, and which
 * one is decided by movement alone - never by where the finger happens to be
 * when it lifts.
 */
const SRC = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

describe("what a hold on a card means when the finger lifts", () => {
  it("is nothing of this gesture's business before the hold has armed", () => {
    expect(holdGestureEnd({ armed: false, moved: false, cancelled: false })).toBe("tap");
    expect(holdGestureEnd({ armed: false, moved: true, cancelled: false })).toBe("tap");
  });

  it("is the menu when the finger rested, and a move when it did not", () => {
    expect(holdGestureEnd({ armed: true, moved: false, cancelled: false })).toBe("menu");
    expect(holdGestureEnd({ armed: true, moved: true, cancelled: false })).toBe("move");
  });

  it("is neither when the system took the gesture back", () => {
    expect(holdGestureEnd({ armed: true, moved: false, cancelled: true })).toBe("none");
    expect(holdGestureEnd({ armed: true, moved: true, cancelled: true })).toBe("none");
  });

  it("lets a finger tremble inside the slop circle", () => {
    expect(holdMoved(100, 100, 100 + HOLD_MOVE_SLOP_PX, 100)).toBe(false);
    expect(holdMoved(100, 100, 100 + HOLD_MOVE_SLOP_PX + 1, 100)).toBe(true);
    expect(holdMoved(100, 100, 106, 106)).toBe(true);
  });
});

describe("the two card surfaces decide through the one rule", () => {
  const board = read("screens/base/BaseScreen.tsx");
  const pinboard = read("screens/base/PinboardView.tsx");

  it("the board no longer reads the meaning from where the card was dropped", () => {
    expect(board).toContain("holdGestureEnd({ armed: d.armed, moved: d.moved, cancelled })");
    // The old rule: "armed and over no column" opened the menu - which is also
    // what a card carried into a gap or past the edge was.
    expect(board).not.toMatch(/d\.armed && drag && !drag\.overKey/);
    // A cancelled gesture has its own ending instead of sharing pointerup's.
    expect(board).toMatch(/addEventListener\("pointercancel", onCancel\)/);
  });

  it("the row listener of the other views leaves a board card to the board", () => {
    // Two timers on one hold were the collision: the rows' opened the menu
    // under the finger while the board's armed the move.
    expect(board).toMatch(/ref=\{boardRef\} data-hold-owner="board"/);
    expect(board).toContain('if (row!.closest("[data-hold-owner]")) return;');
  });

  it("the pinboard records movement before asking whether the board can be reordered", () => {
    expect(pinboard).toContain("holdGestureEnd({ armed: d.armed, moved: d.moved, cancelled: false })");
    const moved = pinboard.indexOf("d.moved = true;");
    const gate = pinboard.indexOf("if (!canDrag) return;", moved);
    expect(moved).toBeGreaterThan(0);
    expect(gate, "a sorted board must still see that the finger moved").toBeGreaterThan(moved);
  });

  it("the ghost belongs to the move, not to the hold", () => {
    expect(board).toMatch(/\{boardDrag\?\.moved && \(\s*<div aria-hidden className="m-board-ghost"/);
    expect(pinboard).toMatch(/\{drag\?\.moved && \(\s*<div aria-hidden className="m-board-ghost"/);
  });
});

describe("the name of a new cloud folder", () => {
  it("drops slashes when the name is used, not while it is typed", () => {
    expect(folderNameOf("  Notes/2026\\draft ")).toBe("Notes2026draft");
    expect(folderNameOf(" / ")).toBe("");
    const sheet = read("components/CloudFolderPickerSheet.tsx");
    // Rewriting the value on every key press is what loses a composition.
    expect(sheet).toContain("setNewName(e.target.value);");
    expect(sheet).not.toMatch(/setNewName\(e\.target\.value\.replace/);
  });
});
