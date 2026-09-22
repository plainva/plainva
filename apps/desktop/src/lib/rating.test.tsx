// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  baseInputToType,
  clampRating,
  clampRatingMax,
  coerceForType,
  defaultValueForType,
  journalDayOf,
  Rating,
} from "@plainva/ui";

/**
 * The `rating` input type (plan Journal-Erweiterungen, X6/E5).
 *
 * The file holds a plain NUMBER — `mood: 4` — because that is what Obsidian, a
 * spreadsheet and a future reader can all make sense of; the marks are how
 * Plainva draws it. These pin that split, the edges of the scale, and that
 * pressing the current value clears it.
 */

const mounted: { root: Root; host: HTMLElement }[] = [];
const render = async (element: React.ReactElement) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => { root.render(element); });
  return host;
};

afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) {
    await act(async () => { root.unmount(); });
    host.remove();
  }
});

describe("a rating is a number", () => {
  it("is carried by the model like one, and starts at nothing", () => {
    expect(baseInputToType("rating")).toBe("rating");
    expect(defaultValueForType("rating")).toBe(0);
    // Turning a text column into a rating keeps what can be read as a number.
    expect(coerceForType("4", "rating")).toBe(4);
    expect(coerceForType("3.6", "rating")).toBe(4);
    expect(coerceForType("gut", "rating")).toBe(0);
    // A stray 900 never reaches the file.
    expect(coerceForType(900, "rating")).toBe(10);
    expect(coerceForType(-3, "rating")).toBe(0);
  });

  it("keeps its scale between one and ten marks", () => {
    expect(clampRatingMax(undefined)).toBe(5);
    expect(clampRatingMax(0)).toBe(1);
    expect(clampRatingMax(99)).toBe(10);
    expect(clampRating(7, 5)).toBe(5);
    expect(clampRating("2", 5)).toBe(2);
    expect(clampRating(null, 5)).toBe(0);
  });
});

describe("the marks", () => {
  it("say how many of how many, without a row of buttons, when nothing can be set", async () => {
    const host = await render(<Rating value={3} />);
    expect(host.querySelectorAll("button")).toHaveLength(0);
    expect(host.querySelectorAll(".pv-rating-mark--on")).toHaveLength(3);
    expect(host.querySelector(".pv-rating")?.getAttribute("aria-label")).toContain("3");
  });

  it("are the editor where one may edit", async () => {
    const written: number[] = [];
    const host = await render(<Rating onChange={(v) => written.push(v)} value={2} />);
    const marks = [...host.querySelectorAll<HTMLButtonElement>("button")];
    expect(marks).toHaveLength(5);
    await act(async () => { marks[3].click(); });
    expect(written).toEqual([4]);
  });

  it("clear the value when the current mark is pressed again", async () => {
    const written: number[] = [];
    const host = await render(<Rating onChange={(v) => written.push(v)} value={4} />);
    const marks = [...host.querySelectorAll<HTMLButtonElement>("button")];
    await act(async () => { marks[3].click(); });
    // A four must be able to become nothing without a second control beside it.
    expect(written).toEqual([0]);
  });

  it("follows the column's own scale and glyph", async () => {
    const host = await render(<Rating glyph="★" max={3} value={2} />);
    expect(host.querySelectorAll(".pv-rating-mark")).toHaveLength(3);
    expect(host.textContent).toBe("★★★");
  });
});

describe("the day's rating", () => {
  const NOTE = "---\nmood: 4\n---\n\n## Journal\n\n- 08:00 Fog over the canal\n";
  const candidate = { key: "2026-09-21", date: new Date(2026, 8, 21), path: "2026-09-21.md" };

  it("travels with the day when the vault names a property", () => {
    const day = journalDayOf(candidate, NOTE, "Journal", undefined, "mood");
    expect(day?.mood).toBe(4);
  });

  it("is null for a day the note does not rate, and absent when the vault rates nothing", () => {
    const unrated = "## Journal\n\n- 08:00 Fog over the canal\n";
    expect(journalDayOf(candidate, unrated, "Journal", undefined, "mood")?.mood).toBeNull();
    // No property named: the head draws no marks at all, rather than five empty ones.
    expect(journalDayOf(candidate, NOTE, "Journal")?.mood).toBeUndefined();
  });

  it("ignores a value that is not a number, instead of drawing nonsense", () => {
    const worded = "---\nmood: gut\n---\n\n## Journal\n\n- 08:00 Fog\n";
    expect(journalDayOf(candidate, worded, "Journal", undefined, "mood")?.mood).toBeNull();
  });
});
