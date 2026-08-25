import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PARITY_FEATURES,
  findGuardContradictions,
  findParityViolations,
  type ParityFeatureDef,
  type ParityGuardMarker,
} from "@plainva/ui";

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

/**
 * Reads the `@parity-mobile <id>` markers out of the mobile source guards.
 *
 * The marker sits on the line above an assertion and says which catalog entry
 * that assertion speaks for. Kept to a literal scan rather than a parser: the
 * guards are test files, and a regex over "marker line, then it(" is exactly as
 * much structure as the convention has.
 */
function readMobileGuardMarkers(): ParityGuardMarker[] {
  const file = fileURLToPath(new URL("../../mobile/src/mobileLint.test.ts", import.meta.url));
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const out: ParityGuardMarker[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const m = /^\s*\/\/\s*@parity-mobile\s+([a-z0-9-]+)\s*$/.exec(lines[i]);
    if (!m) continue;
    // A marker that does not sit above an assertion guards nothing — most
    // likely it was left behind when the assertion moved or was deleted.
    expect(lines[i + 1] ?? "", `@parity-mobile ${m[1]} must sit above an it(...)`).toMatch(
      /^\s*it(\.\w+)?\(/,
    );
    out.push({ id: m[1], where: `mobileLint.test.ts:${i + 2}` });
  }
  return out;
}

describe("the catalog and the mobile guards agree", () => {
  /*
   * Why this exists (2026-08-20): the catalog claimed the phone had no path
   * from an open note into mail, while mobileLint pinned the two paths it does
   * have. Two guards in the same repo said opposite things and both stayed
   * green, because neither could see the other. The marker is the seam.
   */
  it("carries a marker for every entry that could contradict one", () => {
    /*
     * This used to demand at least one marker, so that deleting them all could
     * not silently turn the check into a no-op. On 2026-08-24 the last two
     * `gap` entries turned out to be describing work that was long done, and
     * removing them left nothing for a marker to contradict: a `decision` says
     * the phone deliberately does NOT have something, so pinning it as required
     * would be the opposite claim.
     *
     * So the demand follows the catalog instead of a fixed number. With no gaps
     * the mechanism is dormant, not dead — the fixtures below still prove its
     * teeth on every run, and the moment someone writes a gap back in, this
     * asks for the marker again.
     */
    /*
     * Narrowed on 2026-08-25: a marker says "the phone HAS this", so it can only
     * ever contradict an entry whose mobile side is empty on the DESKTOP's
     * behalf — a gap the phone could close. A gap the other way round (the
     * desktop has it, the phone does not) has nothing on the mobile side to pin;
     * demanding a marker for it forced a choice between writing a marker that
     * the contradiction check then rejects, or relabelling an honest gap as a
     * decision to quieten the guard. Both are worse than saying which gaps this
     * mechanism can speak for.
     */
    const gaps = PARITY_FEATURES.filter((f) => f.kind === "gap" && f.desktop === null);
    if (gaps.length > 0) {
      expect(
        readMobileGuardMarkers().length,
        `the catalog carries ${gaps.length} gap(s) — pin them with @parity-mobile`,
      ).toBeGreaterThan(0);
    }
  });

  it("has no contradiction", () => {
    expect(findGuardContradictions(PARITY_FEATURES, readMobileGuardMarkers())).toEqual([]);
  });
});

describe("the contradiction guard itself catches", () => {
  const entry: ParityFeatureDef = {
    id: "a-thing",
    title: "A thing",
    area: "editor",
    kind: "gap",
    desktop: "yes",
    mobile: null,
    mobileReason: "Not wired on the phone yet; the shared helper is already there.",
    verified: "2026-08-20",
  };

  it("a mobile guard requiring what the catalog calls absent", () => {
    const found = findGuardContradictions([entry], [{ id: "a-thing", where: "x.test.ts:1" }]);
    expect(found.join(" | ")).toMatch(/one of the two is out of date/);
  });

  it("a marker pointing at no entry", () => {
    const found = findGuardContradictions([entry], [{ id: "ghost", where: "x.test.ts:1" }]);
    expect(found.join(" | ")).toMatch(/names no catalog entry/);
  });

  it("stays quiet when the entry admits the capability", () => {
    const partial: ParityFeatureDef = { ...entry, mobile: "partial" };
    expect(findGuardContradictions([partial], [{ id: "a-thing", where: "x.test.ts:1" }])).toEqual(
      [],
    );
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
