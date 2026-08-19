import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Three display and operation findings (S21).
 *
 * What they have in common is that each one looked finished: a button that is
 * visibly a delete but is announced as nothing, a `danger` field that colours
 * without separating, a filter whose result stays on screen after the question
 * it answered stopped applying, a count that is honestly computed and wrong.
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));
const LOCALES = join(SRC, "..", "..", "..", "packages", "ui", "src", "locales");
const read = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const LANGS = ["en", "de", "fr", "es", "it", "nl", "pl", "pt-BR", "ja", "zh-CN"] as const;

describe("no unnamed button does something destructive", () => {
  it("the cleanup rows use IconButton, which requires the label", () => {
    // Both were `<Button>` with nothing but an icon inside: a screen reader
    // announces an unnamed button, and one of them deletes a note.
    const text = strip(read("screens", "CleanupScreen.tsx"));
    expect(text).toMatch(/<IconButton label=\{t\("common\.delete"\)\}/);
    expect(text).toMatch(/<IconButton label=\{t\("graph\.createTarget"/);
    expect(text, "no icon-only Button may remain in this file").not.toMatch(
      /<Button[^>]*>\s*<(Trash2|Plus) size/s,
    );
  });

  it("names the second action in every language", () => {
    for (const lang of LANGS) {
      expect(dict(lang).graph?.createTarget, `${lang} lacks graph.createTarget`).toBeTruthy();
    }
  });
});

describe("destructive entries in a sheet are separated, not only coloured", () => {
  it("the shared row sheet puts them last and behind a hairline", () => {
    // Colour tells you what a row is once you have read it; the gap is what
    // stops the thumb on the way there. Structural, so a caller cannot place a
    // destructive entry in the middle by accident.
    const text = strip(read("components", "RowActionSheet.tsx"));
    expect(text).toMatch(/actions\.filter\(\(a\) => !a\.danger\)/);
    expect(text).toMatch(/data-sheet-sep=/);
  });

  it("the table sheet no longer interleaves its three deletions", () => {
    // "Delete row" used to sit between "row below" and "column left".
    const rows = strip(read("components", "TableMenuSheet.tsx"));
    const list = rows.slice(rows.indexOf("{ action:"), rows.indexOf("];"));
    const actions = [...list.matchAll(/action: "([a-z-]+)"/g)].map((m) => m[1]);
    const firstDanger = actions.findIndex((a) => a.endsWith("-delete"));
    expect(firstDanger, "the table sheet must still offer its deletions").toBeGreaterThan(-1);
    expect(
      actions.slice(firstDanger).every((a) => a.endsWith("-delete")),
      `deletions must be one group at the end, got ${actions.join(", ")}`,
    ).toBe(true);
    expect(rows).toMatch(/data-sheet-sep=/);
  });

  it("a selection list can mark a destructive option at all", () => {
    // `mSelect` had no notion of danger, so the pinboard's "Delete" read
    // exactly like its "Colour".
    expect(strip(read("services", "mobileDialogs.ts"))).toMatch(/danger\?: boolean/);
    expect(strip(read("components", "MobileDialogHost.tsx"))).toMatch(/opt\.danger \? "m-danger"/);
    expect(strip(read("screens", "base", "PinboardView.tsx"))).toMatch(
      /value: "delete",[\s\S]{0,120}?danger: true/,
    );
  });

  it("the separator is defined once, from tokens", () => {
    const css = read("mobile.css");
    const block = css.slice(css.indexOf("[data-sheet-sep] {"), css.indexOf("}", css.indexOf("[data-sheet-sep] {")));
    expect(block).toMatch(/border-top: 1px solid var\(--border-color\)/);
  });
});

describe("the flagged filter does not outlive its question", () => {
  it("falls away on every switch of folder, account and mode", () => {
    // The filter is a SERVER answer about one mailbox. Left standing across a
    // switch it showed the previous folder's starred mail under the new
    // folder's name — and "all inboxes", by the code's own reasoning, has no
    // mailbox for it to be true of.
    const text = strip(read("screens", "MailListScreen.tsx"));
    expect(
      [...text.matchAll(/setFlaggedRows\(null\)/g)].length,
      "toggle plus three switches",
    ).toBeGreaterThanOrEqual(4);
    for (const [what, anchor] of [
      ["folder", /setMailbox\(name\);[\s\S]{0,200}?setFlaggedRows\(null\)/],
      ["account", /setAccountId\(a\.id\);[\s\S]{0,200}?setFlaggedRows\(null\)/],
      ["all inboxes", /setUnified\(true\);[\s\S]{0,200}?setFlaggedRows\(null\)/],
    ] as const) {
      expect(text, `switching ${what} must drop the filter`).toMatch(anchor);
    }
  });
});

describe("a folder row counts what the chevron leads to", () => {
  it("asks the index instead of listing one level", () => {
    const text = strip(read("services", "vaultService.ts"));
    expect(text).toMatch(/countNotesPerSubfolder\(folder\)/);
    // Before the first scan there is no index; a shallow count still beats
    // showing nothing.
    expect(text).toMatch(/v\.queryService \?[\s\S]{0,80}?: null/);
    expect(text).toMatch(/deep \? \(deep\.get\(name\) \?\? 0\) : await shallowCount/);
  });
});

function dict(lang: string): { graph?: Record<string, string> } {
  return JSON.parse(readFileSync(join(LOCALES, `${lang}.json`), "utf8")) as never;
}

describe("a failed version snapshot is not just a console line (finding 2026-08-19)", () => {
  it("reports it on screen, throttled", () => {
    const text = strip(read("services", "vaultService.ts"));
    // The file is saved either way — but the safety net silently is not there,
    // and on a phone a console line is nobody.
    expect(text).toContain("onBackupError: reportSnapshotFailure");
    expect(text).toContain('toast.warning(i18n.t("backup.snapshotFailed"');
    // Throttled, or a full disk turns every keystroke into a toast.
    expect(text).toContain("SNAPSHOT_ERROR_TOAST_INTERVAL_MS");
  });

  it("the message exists in every language", () => {
    for (const lang of LANGS) {
      const locale = JSON.parse(readFileSync(join(LOCALES, `${lang}.json`), "utf8"));
      expect(locale.backup?.snapshotFailed, lang).toBeTruthy();
      expect(locale.backup.snapshotFailed, lang).toContain("{{path}}");
    }
  });
});
