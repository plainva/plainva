import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Editing a cell must CHANGE the note's property, never add a second one (S1).
 *
 * The trap is casing: the properties panel capitalizes bare frontmatter keys
 * for display, so a note written by hand or by another tool carries `Frist:`
 * while the database column is `frist`. The read side maps the two onto each
 * other case-insensitively, so both spellings show up as one column — the write
 * has to resolve them back to the note's own spelling. Writing `props[col]`
 * directly produced a second key, and clearing the cell deleted a key that was
 * never there, leaving the old value on screen.
 *
 * Only the file store is faked here. The frontmatter parse, the casing
 * resolution and the rewrite all run for real, so this asserts the behaviour
 * rather than the mock.
 */

const files = new Map<string, string>();
const updated: string[] = [];
const synced = vi.fn();

vi.mock("./vaultService", () => ({
  noteSaver: { flush: vi.fn(async () => {}) },
  vaultOps: {
    read: vi.fn(async (_v: unknown, path: string) => files.get(path) ?? ""),
    save: vi.fn(async (_v: unknown, path: string, text: string) => {
      files.set(path, text);
    }),
    // The phone's one way for a change of a file where it lies, over this
    // test's store: read, change, save.
    update: vi.fn(async (_v: unknown, path: string, change: (text: string) => string | null) => {
      updated.push(path);
      const before = files.get(path) ?? "";
      const next = change(before);
      if (next === null || next === before) return { before, text: before, changed: false, conflict: null };
      files.set(path, next);
      return { before, text: next, changed: true, conflict: null };
    }),
  },
}));

vi.mock("./syncService", () => ({ syncSoon: () => synced() }));

const { commitCellValue } = await import("./baseOps");

const vault = {} as never;
const NOTE = "Aufgaben/Bericht.md";

const frontmatter = (text: string) => text.split("---")[1] ?? "";

beforeEach(() => {
  files.clear();
  updated.length = 0;
  synced.mockClear();
});

describe("commitCellValue: a differently-cased key", () => {
  it("changes the note's own key instead of adding a second one", async () => {
    files.set(NOTE, `---\ntype: task\nFrist: 2026-08-01\n---\n\n# Bericht\n`);

    await commitCellValue(vault, NOTE, "frist", "2026-09-01");

    const fm = frontmatter(files.get(NOTE)!);
    expect(fm).toContain("Frist: 2026-09-01");
    // Without the shared write this line is what fails: the note ends up with
    // BOTH `Frist:` and `frist:`, and which one wins depends on the reader.
    expect(fm).not.toMatch(/^frist:/m);
    expect(fm.match(/frist:/gi)).toHaveLength(1);
  });

  it("clears the note's own key when the cell is emptied", async () => {
    files.set(NOTE, `---\ntype: task\nFrist: 2026-08-01\n---\n\n# Bericht\n`);

    await commitCellValue(vault, NOTE, "frist", "");

    // Deleting the COLUMN key would have missed `Frist:` entirely — the cell
    // would look cleared and the old date would come straight back.
    expect(frontmatter(files.get(NOTE)!)).not.toMatch(/frist:/i);
  });

  it("uses the column key when the note has no such property yet", async () => {
    files.set(NOTE, `---\ntype: task\n---\n\n# Bericht\n`);

    await commitCellValue(vault, NOTE, "status", "Offen");

    expect(frontmatter(files.get(NOTE)!)).toContain("status: Offen");
  });
});

describe("commitCellValue: what counts as empty", () => {
  it.each([
    ["an empty string", ""],
    ["whitespace only", "   "],
    ["null", null],
    ["undefined", undefined],
    ["an empty list", []],
  ])("removes the property for %s", async (_label, value) => {
    files.set(NOTE, `---\ntype: task\nstatus: Offen\n---\n\n# Bericht\n`);

    await commitCellValue(vault, NOTE, "status", value);

    expect(frontmatter(files.get(NOTE)!)).not.toContain("status:");
  });

  it("keeps a false checkbox — that is a value, not an empty cell", async () => {
    files.set(NOTE, `---\ntype: task\nerledigt: true\n---\n\n# Bericht\n`);

    await commitCellValue(vault, NOTE, "erledigt", false);

    expect(frontmatter(files.get(NOTE)!)).toContain("erledigt: false");
  });
});

describe("commitCellValue: a block that cannot be written to", () => {
  /**
   * The error goes to the caller (who says so, see `silentFailures.test.ts`)
   * and the note stays as it is.
   */
  it.each([
    ["a YAML list", `---\n- a\n- list\n---\nText\n`],
    ["YAML that cannot be parsed", `---\ntitle: [unclosed\nowner: Anna\n---\nText\n`],
  ])("refuses %s and leaves the note byte for byte", async (_label, note) => {
    files.set(NOTE, note);

    await expect(commitCellValue(vault, NOTE, "status", "Erledigt")).rejects.toThrow(/^Frontmatter /);

    expect(files.get(NOTE)).toBe(note);
    expect(synced).not.toHaveBeenCalled();
  });
});

describe("commitCellValue: a value the reader's schema refused the whole block over", () => {
  /**
   * These used to be written as "no properties" — the rewrite removed every
   * key but the one being set — and were refused from 2026-10-11 to
   * 2026-10-22. The reader takes every value now (ADR 0009, addendum
   * 2026-10-22): the one property changes, and not another byte of the note.
   */
  it.each([
    ["an empty tags key", `---\ntags:\nstatus: Offen\nowner: Anna\n---\nText\n`],
    ["a year among the tags", `---\ntags:\n  - 2024\n  - journal\nstatus: Offen\nowner: Anna\n---\nText\n`],
    ["a timestamp that is a date", `---\ntype: Referenz\ntimestamp: 2026-06-22\nstatus: Offen\n---\nText\n`],
    ["a text with commas, a bracket list and a number with a leading zero", `---\ntags: a, b\naliases: [x, y] # two names\nplz: 01067\nstatus: Offen\n---\nText\n`],
  ])("writes %s: the one property changes, and not another byte", async (_label, note) => {
    files.set(NOTE, note);

    await commitCellValue(vault, NOTE, "status", "Erledigt");

    expect(files.get(NOTE)).toBe(note.replace("status: Offen\n", "status: Erledigt\n"));
    expect(synced).toHaveBeenCalledTimes(1);
  });
});

describe("commitCellValue: the surrounding contract", () => {
  it("goes through the phone's one way for a change of a note, which lands the editor's pending keystrokes first", async () => {
    files.set(NOTE, `---\ntype: task\n---\n\n# Bericht\n`);

    await commitCellValue(vault, NOTE, "status", "Offen");

    // Rewriting from a text the cell read itself would drop whatever was typed
    // since the last autosave, and hand the vault's chain a whole text it
    // judges like an editor's. `vaultOps.update` flushes the note's pending
    // save and lets the chain read the note (its order is held in
    // readChangeWrite.test.ts and run over real files in vaultChainWrites.test.ts).
    expect(updated).toEqual([NOTE]);
    expect(synced).toHaveBeenCalledTimes(1);
  });

  it("leaves the body untouched", async () => {
    files.set(NOTE, `---\ntype: task\n---\n\n# Bericht\n\nEin Absatz mit --- Strichen.\n`);

    await commitCellValue(vault, NOTE, "status", "Offen");

    expect(files.get(NOTE)).toContain("Ein Absatz mit --- Strichen.");
  });
});
