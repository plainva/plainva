// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NoteCardBody, parseNoteCard } from "@plainva/ui";

/**
 * The shared card body (both shells' pinboard) hands its tick on with the
 * box's place AND its line's text (Sammelplan § 3.87 Nr. 4). With the place
 * alone, a card drawn from an older state of the note ticked whatever line
 * stood at that place now.
 */
let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("NoteCardBody", () => {
  it("names the ticked box by its place and its line's text", () => {
    const onToggleTask = vi.fn();
    const { blocks } = parseNoteCard("- [ ] Milch\n- [ ] Brot\n");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<NoteCardBody blocks={blocks} onToggleTask={onToggleTask} labels={{ table: "t", math: "m", embed: "e" }} />));
    const boxes = host.querySelectorAll<HTMLInputElement>("input[type=checkbox]");
    act(() => boxes[1]!.click());
    expect(onToggleTask).toHaveBeenCalledWith({ ordinal: 1, text: "Brot" }, true);
  });
});
