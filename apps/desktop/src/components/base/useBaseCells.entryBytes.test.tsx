// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { toast, toastStore } from "@plainva/ui";
import { BLOCK, LAST_ENTRY, SHAPES, noteOf, withLine, withLinesBehind, withoutLines } from "../../../../../packages/core/test/helpers/propertyBlock";

/**
 * A database cell changes ONE entry of its note's block, and no other byte
 * (finding 2026-10-11).
 *
 * A cell hands the shared writer the whole set of the note's properties with
 * its one change, and that set was written as a whole through the YAML
 * library: whichever cell was edited, the block of
 * `packages/core/test/helpers/propertyBlock.ts` came back with `plz: 01067`
 * as `1067`, a phone number without its plus, its long line folded and its
 * lists re-indented — in a note nobody had opened.
 *
 * The vault is a map of files; the hook, the shared property writer and the
 * toast store run for real, over that block in each shape a note lies on disk
 * in. The phone's cell runs over the same block in
 * `apps/mobile/src/services/propertyEntryBytes.test.ts`.
 */

const files = new Map<string, string>();

const vaultAdapter = {
  async readTextFile(path: string): Promise<string> {
    const text = files.get(path);
    if (text === undefined) throw new Error(`no such file: ${path}`);
    return text;
  },
  async writeTextFile(path: string, content: string): Promise<void> {
    files.set(path, content);
  },
};

vi.mock("../../contexts/VaultContext", () => ({
  useVault: () => ({ vaultAdapter, queryService: null, vaultPath: "/vault", indexer: null, fileTreeVersion: 0, triggerFileTreeUpdate: () => {} }),
}));
vi.mock("../../services/newNote", () => ({
  buildNewNoteContent: () => "",
  getConfiguredNoteType: async () => "Note",
}));

import { useBaseCells, type BaseCells } from "./useBaseCells";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CONFIG = { columns: { status: { input: "text" }, owner: { input: "text" }, anchored: { input: "text" }, tags: { input: "multiselect" }, "2024": { input: "text" } } };
const PATH = "Projects/Note.md";

let container: HTMLDivElement;
let root: Root;
const view = {} as { cells: BaseCells };

function Table() {
  const [dbData, setDbData] = useState<any[]>([{ "file.path": PATH, "file.name": "Note", status: "open", tags: ["a", "b"], "2024": "goals" }]);
  const cells = useBaseCells({ dbConfig: CONFIG, dbData, setDbData });
  useEffect(() => {
    view.cells = cells;
  });
  return <div />;
}

const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
};
const messages = () => toastStore.get().map((item) => `${item.kind}: ${item.message}`);
/** What the table does when a cell is left with a new value. */
async function save(column: string, value: unknown): Promise<void> {
  let written: boolean | undefined;
  await act(async () => { written = await view.cells.commitCellValue(PATH, column, value); });
  await flush();
  expect(written, messages().join(" | ")).toBe(true);
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  files.clear();
  toast.clearAll();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<Table />); });
  await flush();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe.each(SHAPES)("a database cell changes one entry of the block — a note with %s", (_name, shape) => {
  const note = noteOf(BLOCK, shape);
  const after = (block: readonly string[]) => noteOf(block, shape);
  beforeEach(() => {
    files.set(PATH, note);
  });

  it("a value: its characters, and the comment behind it stays", async () => {
    await save("status", "done");
    expect(files.get(PATH)).toBe(after(withLine(BLOCK, "status: open   # the state", "status: done   # the state")));
    expect(messages()).toEqual([]);
  });

  it("a cell that is emptied: the line of its entry", async () => {
    await save("status", "");
    expect(files.get(PATH)).toBe(after(withoutLines(BLOCK, "status: open   # the state")));
  });

  it("a column the note does not have yet: a line behind the last entry", async () => {
    await save("owner", "Anna");
    expect(files.get(PATH)).toBe(after(withLinesBehind(BLOCK, LAST_ENTRY, "owner: Anna")));
  });

  it("one more value in a list: between its brackets", async () => {
    await save("tags", ["a", "b", "c"]);
    expect(files.get(PATH)).toBe(after(withLine(BLOCK, "tags: [a, b]", "tags: [a, b, c]")));
  });

  it("a column the index names by its text: the entry that is there, not a second one beside it", async () => {
    await save("2024", "plans");
    expect(files.get(PATH)).toBe(after(withLine(BLOCK, "2024: goals", "2024: plans")));
  });

  it("the value the note already holds: the note is not changed", async () => {
    await save("status", "open");
    expect(files.get(PATH)).toBe(note);
  });

  it("a value another entry refers to is not changed for both: the cell says so, and the note stays as it is", async () => {
    // `alias: *anchor` reads the value of `anchored`. Changed where it stands, the new value would be `alias`'s too.
    vi.spyOn(console, "error").mockImplementation(() => {});
    let written: boolean | undefined;
    await act(async () => { written = await view.cells.commitCellValue(PATH, "anchored", "other"); });
    await flush();

    expect(written).toBe(false);
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toMatch(/^error: Property could not be saved: .*cannot be read as properties/);
    // The name of the entry may be said; nothing of the note's text is.
    expect(messages()[0]).not.toMatch(/kept|goals|4915112345678/);
    expect(files.get(PATH)).toBe(note);
  });

  it("several cells one after the other leave the note with exactly their changes", async () => {
    await save("status", "done");
    await save("owner", "Anna");
    await save("tags", ["b"]);
    await save("owner", "");
    expect(files.get(PATH)).toBe(after(withLine(withLine(BLOCK, "status: open   # the state", "status: done   # the state"), "tags: [a, b]", "tags: [b]")));
  });
});
