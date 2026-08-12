import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * One gesture, one meaning — actually (S22).
 *
 * "Holding starts multi-select" was the stated rule, and inside ONE list it was
 * broken: holding a note began a selection while holding a folder or a database
 * opened that row's sheet. Which of the two you got depended on what happened
 * to be under the finger. Holding now opens what the row can do, everywhere,
 * and selecting several is the first NAMED entry of that sheet.
 *
 * Read from the source on purpose: this is about which handler a row is wired
 * to. A test with mocked rows would assert against its own wiring.
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));
const LOCALES = join(SRC, "..", "..", "..", "packages", "ui", "src", "locales");
const read = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("holding a row means the same on every kind of row", () => {
  const browse = strip(read("screens", "BrowseScreen.tsx"));

  it("a note row opens its sheet, like a folder and a database already did", () => {
    expect(browse, "the note press must open the sheet").toMatch(
      /const press = useLongPress<[^>]*>\(\(x\) => setSheet\(x\)\)/,
    );
    expect(browse, "holding must not silently begin a selection any more").not.toMatch(
      /useLongPress<[^>]*>\(\(x\) => \{\s*setSelected/,
    );
  });

  it("selecting several is the sheet's first entry, and it is named", () => {
    const sheet = browse.slice(browse.indexOf('<p className="m-sheet-title">'));
    const first = sheet.indexOf("sheet-select-many");
    const open = sheet.indexOf("mobile.sheetOpen");
    expect(first, "the entry must exist").toBeGreaterThan(-1);
    expect(first, "and it must come before opening the row").toBeLessThan(open);
    expect(sheet).toMatch(/mobile\.selectMany/);
    expect(sheet, "it must actually start the selection").toMatch(
      /sheet-select-many[\s\S]{0,400}?setSelected\(/,
    );
  });

  it("is named in every language", () => {
    for (const lang of ["en", "de", "fr", "es", "it", "nl", "pl", "pt-BR", "ja", "zh-CN"]) {
      const d = JSON.parse(readFileSync(join(LOCALES, `${lang}.json`), "utf8")) as {
        mobile?: Record<string, string>;
      };
      expect(d.mobile?.selectMany, `${lang} lacks mobile.selectMany`).toBeTruthy();
    }
  });
});

describe("a task row can be held too", () => {
  const tasks = strip(read("screens", "TasksScreen.tsx"));

  it("both kinds of task row open the same sheet", () => {
    // The row's actions sat visibly ON it, so it deliberately had no sheet —
    // which left one list where holding did nothing.
    expect(tasks).toMatch(/const \[taskSheet, setTaskSheet\]/);
    expect(
      [...tasks.matchAll(/onPointerDown=\{\(e: ReactPointerEvent\) =>\s*startRowPress\(/g)].length,
      "the note-derived rows and the database rows",
    ).toBe(2);
    expect(tasks).toMatch(/<RowActionSheet/);
  });

  it("a press that starts on the row's own controls is left alone", () => {
    // Same test the row itself uses to decide whether a tap was meant for it —
    // otherwise holding the promote chip would open the sheet behind it.
    expect(tasks).toMatch(/closest\("button,a,input,select,textarea,label"\)\) return;/);
  });

  it("a tap still opens, and is not swallowed by the hold", () => {
    expect(
      [...tasks.matchAll(/if \(rowPress\.clicked\(\)\)/g)].length,
      "both rows must check whether the hold already consumed the gesture",
    ).toBe(2);
  });
});

describe("the written rule matches the code", () => {
  it("the swipe component no longer claims that holding selects", () => {
    const swipe = read("components", "SwipeRow.tsx");
    expect(swipe).toMatch(/holding opens the row's sheet/);
    expect(swipe, "the old rule must not stand unqualified").not.toMatch(
      /opens, swiping performs the row action, holding starts multi-select/,
    );
  });

  it("the design language says a sheet comes before a swipe", () => {
    // The doc used to state that a row carrying its own controls gets NO swipe
    // at all. That was the conclusion drawn from having no sheet — which is a
    // reason to build one, not to forgo the gesture.
    const dl = readFileSync(join(SRC, "..", "..", "..", "docs", "engineering", "Design_Language.md"), "utf8");
    expect(dl).toMatch(/needs its SHEET first/);
  });
});
