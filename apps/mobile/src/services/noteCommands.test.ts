// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeNoteCommands, requestNoteCommand, takeNoteCommand } from "./noteCommands";

afterEach(() => {
  vi.useRealTimers();
  // Nothing may wait into the next case.
  takeNoteCommand("A.md");
  takeNoteCommand("B.md");
});

describe("a command for the open note", () => {
  it("waits for a note screen that is not mounted yet", () => {
    // The palette covers the note: the request is made first, the screen
    // comes back a render later. A bare event was lost exactly here.
    requestNoteCommand("A.md", "rename");
    const seen: string[] = [];
    const stop = consumeNoteCommands("A.md", (c) => seen.push(c), true);
    expect(seen).toEqual(["rename"]);
    stop();
  });

  it("reaches a note screen that is mounted, and only once", () => {
    const seen: string[] = [];
    const stop = consumeNoteCommands("A.md", (c) => seen.push(c), true);
    requestNoteCommand("A.md", "history");
    expect(seen).toEqual(["history"]);
    expect(takeNoteCommand("A.md")).toBeNull();
    stop();
    requestNoteCommand("A.md", "export");
    expect(seen).toEqual(["history"]);
  });

  it("stays parked until the note can serve it", () => {
    requestNoteCommand("A.md", "toggle-source");
    const seen: string[] = [];
    consumeNoteCommands("A.md", (c) => seen.push(c), false)();
    expect(seen).toEqual([]);
    const stop = consumeNoteCommands("A.md", (c) => seen.push(c), true);
    expect(seen).toEqual(["toggle-source"]);
    stop();
  });

  it("is for one note, not for whichever opens next", () => {
    requestNoteCommand("A.md", "mailto");
    const seen: string[] = [];
    const stop = consumeNoteCommands("B.md", (c) => seen.push(c), true);
    expect(seen).toEqual([]);
    stop();
    expect(takeNoteCommand("A.md")).toBe("mailto");
  });

  it("does not fire at a later visit when the note never came back", () => {
    vi.useFakeTimers();
    requestNoteCommand("A.md", "save-as-template");
    vi.advanceTimersByTime(11_000);
    expect(takeNoteCommand("A.md")).toBeNull();
  });

  it("asks nothing when no note is open", () => {
    requestNoteCommand(null, "rename");
    expect(takeNoteCommand("A.md")).toBeNull();
  });
});
