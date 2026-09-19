import { tagRoot } from "@plainva/core";
import { CHIP_COLOR_COUNT, chipHash } from "../base/propertyModel";

/**
 * Tags: one look, and one colour rule (finding 2026-09-19).
 *
 * A tag was plain text in the note, a grey chip in the properties and neutral
 * on purpose in a table cell and on a pinboard card. Now every surface draws it
 * the same way and carries the same attribute, and ONE device switch ("Colour
 * tags", off by default) decides whether that attribute means a colour.
 *
 * Nothing is stored: the colour follows from the NAME - from its root, so
 * `project/website` and `project/print` stand together - through the same hash
 * and the same theme-able slots the option chips use. Lower-cased, because
 * `#Project` and `#project` are one tag to the index.
 */

/**
 * Palette slot (1..7) of a tag; maps onto the `--chip-N-*` tokens. Slot 0 is the
 * grey one and is never dealt: with colours switched on, a tag that stays grey
 * reads as a bug, not as a colour.
 */
export function tagColorIndex(tag: string): number {
  return 1 + (chipHash(tagRoot(tag).toLowerCase()) % (CHIP_COLOR_COUNT - 1));
}

/** The attribute every tag surface carries. It paints nothing until the switch is on. */
export function tagColorAttrs(tag: string): { "data-tag-color": string } {
  return { "data-tag-color": String(tagColorIndex(tag)) };
}

/** Writes the device switch onto <html>; the colour rules in ui.css apply only under it. No-op without a DOM. */
export function applyTagColors(on: boolean): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (on) root.setAttribute("data-tag-colors", "on");
  else root.removeAttribute("data-tag-colors");
}
