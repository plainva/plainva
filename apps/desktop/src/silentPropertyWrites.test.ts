import { describe, expect, it } from "vitest";
import { shippedSources } from "./test-sourceTree";

/**
 * A property that did not reach its note through the shared property writers
 * is never silent (finding 2026-10-09).
 *
 * A database cell and the properties panel of the desktop showed the new value
 * and wrote it afterwards; when the write failed, the failure went to the
 * console and the value stayed on screen. Three loops over many notes logged
 * each note they could not write and then showed every row as changed. On the
 * phone a ticked checkbox, a carried card and a dragged bar had no `.catch`.
 * All of them had the same shape: a call of `writeNoteProperty` or of what it
 * is built on, and nothing that tells the user when it throws.
 *
 * So every such call is listed here, with what stands behind it. A new caller
 * turns this red until it is entered with its way of saying so — the phone's
 * `silentFailures.test.ts` holds the same line for its own screens.
 *
 * NOT covered: the surgical helpers (`setFrontmatterPath` and its siblings).
 * They have many more callers — tasks, the pinboard, a note's icon and colour,
 * the calendar anchors — and those have not been read for this.
 *
 * The assertions read the source on purpose (see there): what is checked is
 * that a branch exists, and a mock would assert against itself.
 */

const SHELLS = ["apps/desktop/src", "apps/mobile/src", "packages/ui/src"];

/** The functions a property reaches a note through, and where a call of each is looked for. */
const WRITERS: Record<string, string[]> = {
  writeNoteProperty: SHELLS,
  updateFrontmatterString: SHELLS,
  bulkSetProperty: SHELLS,
  rewriteNoteProperties: SHELLS,
  // The phone's wrapper around `writeNoteProperty`. The desktop's cell hook has
  // a function of the same name; that one answers a boolean and never throws.
  commitCellValue: ["apps/mobile/src"],
};

interface Site {
  file: string;
  writer: string;
  calls: number;
  /** How a failure of this call reaches the user. */
  how: string;
  /** What must stand behind each call … */
  says: RegExp[];
  /** … and what must not … */
  never?: RegExp[];
  /** … within this many characters of it. */
  within: number;
}

const SAID = /toast\.error\(t\("mobile\.propertyWriteFailed", \{ message: errorText\(/;
const COUNTED = /database\.bulkSetPartial/;

const SITES: Site[] = [
  // ── Desktop ──────────────────────────────────────────────────────────────
  {
    file: "apps/desktop/src/components/base/useBaseCells.tsx", writer: "writeNoteProperty", calls: 1,
    how: "a message, the cell takes the note's value back, and the caller is told",
    says: [SAID, /settled\.had\) back\[col\] = settled\.value/, /return false;/], within: 900,
  },
  {
    file: "apps/desktop/src/components/PropertiesSection.tsx", writer: "updateFrontmatterString", calls: 1,
    how: "a message, the panel keeps what the note says, and the handler is told",
    says: [SAID, /setRefusals\(/, /return false;/], within: 500,
  },
  {
    file: "apps/desktop/src/components/BaseViewer.tsx", writer: "bulkSetProperty", calls: 1,
    how: "one message that counts the notes written and the notes that failed",
    says: [COUNTED], within: 1500,
  },
  {
    file: "apps/desktop/src/components/BaseViewer.tsx", writer: "rewriteNoteProperties", calls: 2,
    how: "one message that counts the notes written and the notes that failed",
    says: [/reportRewrite\(result, /], within: 700,
  },
  {
    file: "apps/desktop/src/components/journal/JournalView.tsx", writer: "writeNoteProperty", calls: 1,
    how: "a message; the rating is drawn from the note and never shown ahead of it",
    says: [SAID], within: 300,
  },
  {
    file: "apps/desktop/src/components/pimcal/CalendarView.tsx", writer: "writeNoteProperty", calls: 1,
    how: "a message, and the entry goes back to its day",
    says: [SAID, /day: entry\.day/], within: 600,
  },
  {
    file: "apps/desktop/src/services/pim/entryEventSync.ts", writer: "writeNoteProperty", calls: 1,
    // Decided, not forgotten: this runs after every calendar cycle without
    // anyone asking for it, and a note that cannot follow its appointment
    // fails again on the next one — a message per cycle would never stop. The
    // anchor is kept, so the move is tried again once the note can be written.
    how: "no message — a background reconcile: collected in errors for the caller, tried again every cycle",
    says: [/result\.errors\.push\(/], within: 600,
  },
  // ── Phone ────────────────────────────────────────────────────────────────
  {
    file: "apps/mobile/src/services/baseOps.ts", writer: "writeNoteProperty", calls: 1,
    how: "thrown on to the caller of commitCellValue, which is listed below",
    says: [/syncSoon\(\);\s*\}/], never: [/catch/], within: 260,
  },
  {
    file: "apps/mobile/src/screens/base/BaseScreen.tsx", writer: "commitCellValue", calls: 1,
    how: "a message, and the caller is told; the rows are queried anew only after a write that landed",
    says: [SAID, /return false;/], within: 300,
  },
  {
    file: "apps/mobile/src/components/NoteContextSheet.tsx", writer: "commitCellValue", calls: 3,
    how: "a message; the sheet reads the note again only after a write that landed",
    says: [SAID], within: 600,
  },
  {
    file: "apps/mobile/src/screens/base/BaseScreen.tsx", writer: "bulkSetProperty", calls: 1,
    how: "one message that counts the notes written and the notes that failed",
    says: [COUNTED], within: 800,
  },
  {
    file: "apps/mobile/src/screens/JournalScreen.tsx", writer: "writeNoteProperty", calls: 1,
    how: "a message; the rating is drawn from the note and never shown ahead of it",
    says: [SAID], within: 600,
  },
  // ── Shared ───────────────────────────────────────────────────────────────
  {
    file: "packages/ui/src/base/bulkSetProperty.ts", writer: "writeNoteProperty", calls: 1,
    how: "collected per note in failed, which every caller above counts",
    says: [/failed\.push\(\{ path, message: /], within: 300,
  },
  {
    file: "packages/ui/src/base/bulkSetProperty.ts", writer: "updateFrontmatterString", calls: 1,
    how: "collected per note in failed, which every caller above counts",
    says: [/failed\.push\(\{ path, message: /], within: 300,
  },
  {
    file: "packages/ui/src/base/writeProperty.ts", writer: "updateFrontmatterString", calls: 1,
    how: "thrown on to the caller of writeNoteProperty, which is listed above",
    says: [/^text, next\)\);\s*\}/], within: 60,
  },
];

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The shipped code of both shells and the shared layer, without its comments. */
let code: { rel: string; text: string }[] | null = null;
const shipped = () => (code ??= shippedSources(SHELLS).map(({ rel, text }) => ({ rel, text: strip(text) })));

/** Where a writer is called, by file — its definition and its imports are no calls. */
function callsOf(writer: string): Map<string, { text: string; at: number[] }> {
  const found = new Map<string, { text: string; at: number[] }>();
  const call = new RegExp(`(?<!function )\\b${writer}\\(`, "g");
  for (const { rel, text } of shipped()) {
    if (!WRITERS[writer].some((root) => rel.startsWith(`${root}/`))) continue;
    const at = [...text.matchAll(call)].map((m) => m.index!);
    if (at.length > 0) found.set(rel, { text, at });
  }
  return found;
}

describe("a property write through the shared writers is never silent", () => {
  it("knows every call of a property writer in both shells", () => {
    const seen: string[] = [];
    for (const writer of Object.keys(WRITERS)) {
      for (const [file, { at }] of callsOf(writer)) seen.push(`${file} — ${writer} ×${at.length}`);
    }
    const listed = SITES.map((site) => `${site.file} — ${site.writer} ×${site.calls}`);
    expect(
      seen.sort(),
      "A property writer is called somewhere this guard does not know (or no longer where it says). " +
        "Enter the call in SITES with how its failure reaches the user: a message through the toast store " +
        "and the value shown taken back to the note's, a count for a loop over many notes — or the reason " +
        "why it stays quiet.",
    ).toEqual(listed.sort());
  });

  it.each(SITES)("$file — $writer: $how", (site) => {
    const { text, at } = callsOf(site.writer).get(site.file) ?? { text: "", at: [] };
    expect(at.length, "the call is gone — see the first test").toBe(site.calls);
    for (const start of at) {
      const behind = text.slice(text.indexOf("(", start) + 1, start + site.within);
      for (const said of site.says) expect(behind, `nothing behind ${site.writer}( says ${said}`).toMatch(said);
      for (const quiet of site.never ?? []) expect(behind, `${quiet} stands behind ${site.writer}(`).not.toMatch(quiet);
    }
  });

  it("the loops of the desktop's database count what they could not write", () => {
    const viewer = shipped().find((s) => s.rel === "apps/desktop/src/components/BaseViewer.tsx")!.text;
    const report = viewer.slice(viewer.indexOf("const reportRewrite"), viewer.indexOf("const reportRewrite") + 500);
    expect(report).toMatch(/if \(result\.failed\.length > 0\) toast\.error\(t\("database\.bulkSetPartial"/);
  });

  it("could not read is not has none: a whole set of properties starts from writableProperties", () => {
    // `updateFrontmatterString` removes what the set it is handed does not
    // name. A set built from a reader that failed is empty, and a note with an
    // empty `tags:` lost every other property that way.
    for (const [file, { text, at }] of callsOf("updateFrontmatterString")) {
      for (const start of at) {
        expect(
          text.slice(Math.max(0, start - 400), start),
          `${file} hands updateFrontmatterString a set without asking writableProperties first`,
        ).toMatch(/\bwritableProperties\(/);
      }
    }
  });
});
