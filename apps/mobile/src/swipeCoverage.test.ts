import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL(".", import.meta.url));
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

/**
 * Every list row that has a row action can be swiped (round 3, R1.2).
 *
 * `SwipeRow` was built complete in S12 — axis detection, dead zone, haptics,
 * destructive action last — and then wired to exactly TWO places: note rows and
 * the FLAT mail branch. The conversation branch rendered bare buttons, so a
 * reader who uses conversations had no swipeable row in the entire mailbox;
 * folders, databases and tasks never got one at all. The maintainer reported
 * the whole feature as missing, and he was right to.
 *
 * These pin the coverage so it cannot quietly shrink again. Actions come from
 * the row's action sheet (E3) — one definition, two ways to reach it.
 */
describe("a row with an action can be swiped", () => {
  it("covers all three branches of the conversation view", () => {
    const src = read("screens/MailListScreen.tsx");
    // The three shapes a mail row takes when conversations are on. Each is
    // identified by the anchor that is unique to it.
    const branches: Array<[string, string]> = [
      ["one-message conversation", 'aria-selected={!!selection?.has(sid)}'],
      ["conversation row", 'data-testid="mail-thread-row"'],
      ["message inside a conversation", 'data-testid="mail-thread-message"'],
    ];
    for (const [name, anchor] of branches) {
      const at = src.indexOf(anchor);
      expect(at, `${name}: anchor gone`).toBeGreaterThan(-1);
      // The gesture container must be the nearest wrapper above the row. The
      // window has to hold the whole action list, which grows with every action
      // a row gains — S22 added snoozing and pushed the longest branch past
      // 900 characters. What is pinned is that `<SwipeRow` is the LAST wrapper
      // before the row, not how far away it sits.
      const before = src.slice(Math.max(0, at - 1600), at);
      expect(
        before.lastIndexOf("<SwipeRow"),
        `${name} is not swipeable — the branch renders a bare row`,
      ).toBeGreaterThan(before.lastIndexOf("</SwipeRow>"));
    }
  });

  it("means the WHOLE conversation on a conversation row (E3b)", () => {
    const src = read("screens/MailListScreen.tsx");
    const at = src.indexOf('data-testid="mail-thread-row"');
    const block = src.slice(Math.max(0, at - 900), at);
    expect(block, "a swipe on a conversation acts on one message").toContain("swipeDeleteThread");
    // And it goes through the single-message path per message rather than
    // restating the trash rules a second time.
    expect(src.slice(src.indexOf("const swipeDeleteThread"), src.indexOf("const swipeDeleteThread") + 700)).toContain(
      "await swipeDelete(",
    );
  });

  it("covers folder and database rows in the file list", () => {
    const src = read("screens/BrowseScreen.tsx");
    // Per LIST, not per row: a row may be built into a variable first and
    // wrapped afterwards (that is how the note rows are written), so "is there
    // a SwipeRow directly above the row" would ask the wrong question.
    const lists: Array<[string, string, string]> = [
      ["folder", "listing.folders.map(", "listing.bases.map("],
      ["database", "listing.bases.map(", "listing.notes.map("],
    ];
    for (const [name, from, to] of lists) {
      const start = src.indexOf(from);
      const end = src.indexOf(to, start);
      expect(start, `${name}: list gone`).toBeGreaterThan(-1);
      expect(end, `${name}: list end gone`).toBeGreaterThan(start);
      expect(src.slice(start, end), `the ${name} row is not swipeable`).toContain("<SwipeRow");
    }
  });

  it("covers both kinds of task row (S23)", () => {
    // Held back on purpose until S22 gave the row a sheet: a swipe without one
    // would have been a second definition of what the row can do rather than a
    // second route to the first. Now both come from `rowActions`.
    const src = read("screens/TasksScreen.tsx");
    for (const [name, from, to] of [
      ["database task", "dbVisible.map((row)", "</RowList>"],
      ["note task", "group.items.map((task)", "</RowList>"],
    ] as const) {
      const start = src.indexOf(from);
      const end = src.indexOf(to, start);
      expect(start, `${name}: list gone`).toBeGreaterThan(-1);
      expect(src.slice(start, end), `the ${name} row is not swipeable`).toContain("<SwipeRow");
      expect(
        src.slice(start, end),
        `the ${name} row must swipe what its sheet offers, not its own list`,
      ).toContain("rowActions(acts)");
    }
    // One definition: the sheet is the same list plus "open", which the tap
    // already does and therefore has no slot.
    expect(src).toMatch(/\.\.\.rowActions\(taskSheet\)\.map/);
  });

  it("keeps the destructive action last and within three slots", () => {
    // The slot metric is 66px; four of them leave nothing of the row to read.
    for (const file of ["screens/MailListScreen.tsx", "screens/BrowseScreen.tsx"]) {
      const src = read(file);
      for (const m of src.matchAll(/<SwipeRow[\s\S]*?actions=\{\[([\s\S]*?)\]\}/g)) {
        const actions = m[1].split(/\{\s*icon:/).slice(1);
        expect(actions.length, `${file}: more than three swipe slots`).toBeLessThanOrEqual(3);
        const dangerAt = actions.findIndex((a) => /danger:\s*true/.test(a));
        if (dangerAt >= 0) {
          expect(dangerAt, `${file}: the destructive action is not last`).toBe(actions.length - 1);
        }
      }
    }
  });
});
