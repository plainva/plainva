import { describe, expect, it } from "vitest";
import { PARITY_FEATURES, findParityViolations, type ParityFeatureDef } from "@plainva/ui";

/**
 * Guard for the desktop/mobile parity catalog.
 *
 * It enforces that every asymmetry IN the catalog is complete, dated and
 * justified — it cannot know about one that was never entered (the catalog's
 * header says so plainly). What it does buy: a session that deliberately ships
 * one shell has to write down why, in the same commit, or the commit is red.
 *
 * The second half runs the same rules against deliberately broken fixtures, so
 * the guard proves its own teeth on every run. A check that only ever sees
 * valid input says nothing about what it would catch.
 *
 * Deliberately NOT checked: whether `verified` lies in the past. A test that
 * compares a fixture date against the wall clock is a time bomb — this repo has
 * had two fall on their own (2026-08-18, 2026-08-19), both times blocking every
 * commit without a single line of code having changed.
 */

const VALID: ParityFeatureDef = {
  id: "a-thing",
  title: "A thing",
  area: "editor",
  kind: "gap",
  desktop: "yes",
  mobile: null,
  mobileReason: "Not wired on the phone yet; the shared helper is already there.",
  verified: "2026-08-19",
};

describe("feature parity catalog", () => {
  it("is complete, dated and justified", () => {
    expect(findParityViolations(PARITY_FEATURES)).toEqual([]);
  });

  it("keeps every entry a real asymmetry", () => {
    // Not a rule of its own — a readable statement of what the catalog is for.
    for (const f of PARITY_FEATURES) {
      expect(f.desktop === "yes" && f.mobile === "yes", `${f.id} is served on both`).toBe(false);
    }
  });
});

describe("the guard itself catches", () => {
  const cases: Array<[string, ParityFeatureDef[], RegExp]> = [
    ["a duplicate id", [VALID, { ...VALID, title: "Another" }], /duplicate id/],
    ["a non-kebab id", [{ ...VALID, id: "A_Thing" }], /kebab-case/],
    ["a missing title", [{ ...VALID, title: "  " }], /needs a title/],
    ["a malformed date", [{ ...VALID, verified: "19.08.2026" }], /YYYY-MM-DD/],
    [
      "an entry served on both shells",
      [{ ...VALID, mobile: "yes", mobileReason: undefined }],
      /delete the entry/,
    ],
    [
      "an entry present on neither shell",
      [{ ...VALID, desktop: null, desktopReason: VALID.mobileReason }],
      /belongs in planning/,
    ],
    ["an absent shell without a reason", [{ ...VALID, mobileReason: undefined }], /needs a reason/],
    ["a reason too short to mean anything", [{ ...VALID, mobileReason: "later" }], /needs a reason/],
    [
      "a placeholder instead of a reason",
      [{ ...VALID, mobileReason: "TODO: work out what to do here" }],
      /placeholder is not a reason/,
    ],
    [
      "a stale reason next to a served shell",
      [{ ...VALID, desktopReason: "Left over from an earlier state of things." }],
      /drop the stale reason/,
    ],
    [
      "an unsorted catalog",
      [
        { ...VALID, id: "z-thing", area: "graph" },
        { ...VALID, id: "a-thing", area: "editor" },
      ],
      /sorted by \(area, id\)/,
    ],
  ];

  it.each(cases)("%s", (_name, features, expected) => {
    const found = findParityViolations(features);
    expect(found.join(" | ")).toMatch(expected);
  });

  it("passes a valid entry", () => {
    expect(findParityViolations([VALID])).toEqual([]);
  });
});
