/**
 * The colour of a note's card, in every view that draws one (finding
 * 2026-09-19: "colour the whole board card, like on the pinboard").
 *
 * A note's colour is `plainva.header_color` (ADR 0009). The handbook says it
 * "applies everywhere the note appears" — and the pinboard was the only view
 * that kept that promise, with its tint formula written out once per shell.
 * The board drew every card on the plain ground. This is the one place the
 * colour is read, mixed and written, so the two views — and the next one —
 * cannot drift apart.
 */
import { DATABASE_METADATA, databaseFilterValue, deleteFrontmatterPath, setFrontmatterPath } from "@plainva/core";
import { optionSwatch, type CuratedOption } from "../base/propertyModel";

const HEX_COLOR = /^#[0-9a-f]{6}([0-9a-f]{2})?$/;

/** The note's own colour as the index carries it on a database row, or null. */
export function noteColorOfRow(row: Record<string, unknown>): string | null {
  const value = databaseFilterValue(row, DATABASE_METADATA.color);
  return typeof value === "string" && HEX_COLOR.test(value) ? value : null;
}

/**
 * The tint of a card: the colour mixed into the ground the card stands on, at
 * the share the `--pinboard-tint` token names (16 by default; themes may move
 * it). The pinboard stands on the page and mixes into `--bg-secondary`; a board
 * card stands on its column and mixes into `--bg-primary`.
 */
export function noteCardTint(color: string, ground = "var(--bg-secondary)"): string {
  return `color-mix(in srgb, ${color} calc(var(--pinboard-tint, 16) * 1%), ${ground})`;
}

/** The note's text with its colour set or removed — the one write both views make. */
export function withNoteColor(content: string, hex: string | null): string {
  return hex ? setFrontmatterPath(content, ["plainva", "header_color"], hex) : deleteFrontmatterPath(content, ["plainva", "header_color"]);
}

/** A view's "colour cards by" property: its key and the options that carry the colours. */
export interface CardColorProperty {
  key: string;
  options?: readonly CuratedOption[];
}

/**
 * The colour a board card takes. The note's OWN colour wins — somebody chose
 * it for this note — and only a note without one falls back to the option
 * colour of the view's "colour by" property (the key the timeline already
 * writes, `colorBy`). No colour at all is a plain card.
 */
export function cardColorOf(row: Record<string, unknown>, colorBy: CardColorProperty | null): string | null {
  const own = noteColorOfRow(row);
  if (own) return own;
  if (!colorBy) return null;
  let raw = row[colorBy.key];
  if (raw === undefined && colorBy.key.startsWith("note.")) raw = row[colorBy.key.slice(5)];
  const first = Array.isArray(raw) ? raw[0] : raw;
  const value = first == null ? "" : String(first).trim();
  if (!value) return null;
  return optionSwatch(value, colorBy.options?.find((option) => option.value === value)?.color);
}
