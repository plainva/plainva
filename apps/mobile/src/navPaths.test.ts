import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { SCREEN_ENTRY, calendarEntry } from "./navigation";
import { PUSHED_ROUTES, type RouteContext } from "./routes";
import type { CalendarFocus } from "./services/calendarFocus";

/**
 * No surface spells a nav path itself.
 *
 * Three kinds of entry carry more than a name in their path — a mail draft, a
 * message, the appointment a reminder points at (and the pinboard's new entry,
 * which had its writer from the start). Each used to be written as an object
 * literal handed to `JSON.stringify` at the place that pushes it, and read by
 * a parser somewhere else. Two of the three came apart that way without a type
 * or a test noticing (screens/mail/mailNavRefs.ts tells how). The codecs' own
 * tests hold each writer to its reader; this holds the SHELL to the codecs —
 * every source file, so the next entry of this kind cannot start the old way
 * in a place no test reads.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/** Prose about markup is not markup: a comment may quote the old shape. */
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("nav paths are written by their codec", () => {
  it("finds the entries it is meant to read", () => {
    // The guard below is only worth something while its pattern matches how an
    // entry is written here at all.
    const routes = withoutComments(readFileSync(join(SRC, "routes.tsx"), "utf8"));
    expect([...routes.matchAll(/\bkind:\s*"[a-zA-Z]+"\s*,\s*path:\s*([^}]*)\}/g)].length).toBeGreaterThan(20);
  });

  it("no entry anywhere carries a path spelled as JSON on the spot", () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      const source = withoutComments(readFileSync(file, "utf8"));
      for (const entry of source.matchAll(/\bkind:\s*"([a-zA-Z]+)"\s*,\s*path:\s*([^}]*)\}/g)) {
        if (/JSON\.stringify/.test(entry[2])) offenders.push(`${file.slice(SRC.length + 1)} (${entry[1]})`);
      }
    }
    expect(
      offenders,
      "a nav path written as an object literal is checked against nothing: give its reader a writer that takes the type " +
        "(services/calendarFocus.ts, screens/mail/mailNavRefs.ts, screens/base/pinboardEntryRef.ts) and call that",
    ).toEqual([]);
  });
});

describe("a tapped reminder reaches the calendar as the appointment it named", () => {
  const focus: CalendarFocus = { uid: "evt-7", accountId: "pim-1", calendarId: 'Arbeit/"Nord"', startTs: 1791532800000 };
  const ctx = { pop: () => {}, push: () => {}, openNote: () => {}, openDaily: () => {}, bump: 0 } as unknown as RouteContext;
  const focusOf = (entry: Parameters<typeof PUSHED_ROUTES.pimcalendar>[0]) =>
    (PUSHED_ROUTES.pimcalendar(entry, ctx) as ReactElement<{ focus?: CalendarFocus }>).props.focus;

  it("through the real route table", () => {
    const entry = calendarEntry(focus);
    expect(entry.kind).toBe("pimcalendar");
    expect(focusOf(entry)).toEqual(focus);
  });

  it("and without one it is the calendar as the areas sheet opens it", () => {
    expect(calendarEntry()).toEqual(SCREEN_ENTRY.calendar);
    expect(focusOf(calendarEntry())).toBeUndefined();
  });
});
