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
const flushed: string[] = [];
const synced = vi.fn();

vi.mock("./vaultService", () => ({
  noteSaver: {
    flush: vi.fn(async (path: string) => {
      flushed.push(path);
    }),
  },
  vaultOps: {
    read: vi.fn(async (_v: unknown, path: string) => files.get(path) ?? ""),
    save: vi.fn(async (_v: unknown, path: string, text: string) => {
      files.set(path, text);
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
  flushed.length = 0;
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

describe("commitCellValue: the surrounding contract", () => {
  it("lands the editor's pending keystrokes before rewriting the frontmatter", async () => {
    files.set(NOTE, `---\ntype: task\n---\n\n# Bericht\n`);

    await commitCellValue(vault, NOTE, "status", "Offen");

    // Rewriting from stale text would drop whatever was typed since the last
    // autosave — the flush is why the rewrite starts from the live note.
    expect(flushed).toEqual([NOTE]);
    expect(synced).toHaveBeenCalledTimes(1);
  });

  it("leaves the body untouched", async () => {
    files.set(NOTE, `---\ntype: task\n---\n\n# Bericht\n\nEin Absatz mit --- Strichen.\n`);

    await commitCellValue(vault, NOTE, "status", "Offen");

    expect(files.get(NOTE)).toContain("Ein Absatz mit --- Strichen.");
  });
});
