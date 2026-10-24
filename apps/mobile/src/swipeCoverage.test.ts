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
      ["folder", "shown.folders.map(", "shown.bases.map("],
      ["database", "shown.bases.map(", "shown.notes.map("],
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
      // The swipe takes the `swipe` part of the sheet's list. Until 24.10. it
      // took the whole list — six slots, wider than the row, which pushed the
      // row off the screen with nothing left to swipe back (TestFlight, build 139).
      expect(
        src.slice(start, end),
        `the ${name} row must swipe the swipe part of its sheet's list`,
      ).toContain("swipeActions(acts)");
      expect(src.slice(start, end), `the ${name} row swipes its whole sheet`).not.toContain(
        "<SwipeRow actions={rowActions(",
      );
    }
    // One definition: both lists come from `taskRowActions`, the swipe keeps
    // what is marked `swipe`, the sheet is the whole list plus "open".
    const swipeDef = src.slice(src.indexOf("const swipeActions"), src.indexOf("const swipeActions") + 300);
    expect(swipeDef).toContain("taskRowActions(t, a)");
    expect(swipeDef).toMatch(/\.filter\(\(s\) => s\.swipe\)/);
    expect(src).toMatch(/\.\.\.rowActions\(taskSheet\)\.map/);
  });

  it("hands every swipe row a swipe list, never a whole sheet", () => {
    // A row's sheet may grow; its swipe strip may not. Every caller passes a
    // list that is filtered for `swipe`, picked by name, or built for the swipe.
    // The conversation row builds its list for the swipe alone: the only
    // capability it hands over is deleting the whole conversation.
    const allowed = /^(swipeActions|swipeFor)\(|\.filter\(\(a\) => a\.swipe\)|pickRowActions\(|^mailRowActions\(t, \{ delete: [^,}]*\}\)/;
    let seen = 0;
    for (const file of ["screens/TasksScreen.tsx", "screens/BrowseScreen.tsx", "screens/JournalScreen.tsx", "screens/MailListScreen.tsx"]) {
      const src = read(file);
      for (let at = src.indexOf("<SwipeRow"); at >= 0; at = src.indexOf("<SwipeRow", at + 1)) {
        const open = src.indexOf("actions={", at) + "actions={".length;
        // The expression runs to the brace that closes `actions={`.
        let depth = 1;
        let i = open;
        while (depth > 0 && i < src.length) {
          if (src[i] === "{") depth++;
          else if (src[i] === "}") depth--;
          i++;
        }
        const expr = src.slice(open, i - 1).trim();
        seen++;
        expect(expr, `${file}: a swipe row takes an unfiltered list: ${expr.slice(0, 80)}`).toMatch(allowed);
      }
    }
    expect(seen, "the swipe rows were not found").toBeGreaterThanOrEqual(10);
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
