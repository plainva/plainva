// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { toast, toastStore } from "@plainva/ui";

/**
 * A database cell whose value did not reach the note (finding 2026-10-09).
 *
 * The cell shows the new value at once and writes it afterwards. When the
 * write failed — a properties block the writer refuses, an error of the vault
 * — the failure went to the console and the cell kept the value: the table
 * showed something no note held. Now the cell takes the note's value back and
 * a message says why.
 *
 * The vault is a map of files; the hook, the cell it renders, the shared
 * property writer and the toast store run for real. Reads wait at a gate the
 * test opens, so "shown, not yet written" lasts as long as a test needs it to.
 */

const files = new Map<string, string>();
const writes: string[] = [];
let writeFails: unknown = null;
let gates: (() => void)[] = [];
let gated = false;

const vaultAdapter = {
  async readTextFile(path: string): Promise<string> {
    if (gated) await new Promise<void>((open) => { gates.push(open); });
    const text = files.get(path);
    if (text === undefined) throw new Error(`no such file: ${path}`);
    return text;
  },
  async writeTextFile(path: string, content: string): Promise<void> {
    if (writeFails !== null) throw writeFails;
    writes.push(path);
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

type Row = Record<string, unknown>;

const CONFIG = { columns: { done: { input: "checkbox" }, status: { input: "text" }, labels: { input: "multiselect" } } };
const LIST = "---\n- a\n- list\n---\nText\n";
const UNPARSEABLE = "---\ntitle: [unclosed\nowner: Anna\n---\nText\n";
const EMPTY_TAGS = "---\ntags:\nstatus: open\nowner: Anna\n---\nText\n";
const READABLE = "---\nstatus: open\nowner: Anna\n---\nText\n";

let container: HTMLDivElement;
let root: Root;
/** What the table last rendered: the hook's functions and the rows it shows. */
const view = {} as { cells: BaseCells; rows: Row[] };

function Table({ rows }: { rows: Row[] }) {
  const [dbData, setDbData] = useState<any[]>(rows);
  const cells = useBaseCells({ dbConfig: CONFIG, dbData, setDbData });
  useEffect(() => {
    view.cells = cells;
    view.rows = dbData;
  });
  return (
    <div>
      {dbData.map((row) => (
        <div key={String(row["file.path"])} data-cell={String(row["file.path"])}>
          {cells.renderEditableCell(row, "done", row.done, cells.formatValueForDisplay(row.done, "done").displayVal)}
        </div>
      ))}
    </div>
  );
}

const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
};
const openGate = async () => {
  await act(async () => { gates.shift()?.(); });
  await flush();
};
const render = async (rows: Row[]) => {
  await act(async () => { root.render(<Table rows={rows} />); });
  await flush();
};
const cell = (path: string) => container.querySelector(`[data-cell="${path}"]`)!;
const click = async (path: string) => {
  await act(async () => { (cell(path).firstElementChild as HTMLElement).click(); });
};
const messages = () => toastStore.get().map((item) => `${item.kind}: ${item.message}`);
const row = (path: string) => view.rows.find((r) => r["file.path"] === path)!;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  files.clear();
  writes.length = 0;
  writeFails = null;
  gates = [];
  gated = false;
  toast.clearAll();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("a database cell whose write is refused", () => {
  it.each([
    ["a YAML list", LIST, /cannot be read as properties/],
    ["YAML that cannot be parsed", UNPARSEABLE, /cannot be read as properties/],
    ["a block the reader cannot take", EMPTY_TAGS, /"tags" holds a value that cannot be read/],
  ])("says so, shows the note's value again and leaves the note alone: %s", async (_label, note, reason) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    files.set("n.md", note);
    gated = true;
    await render([{ "file.path": "n.md", "file.name": "n" }]);
    // The index read nothing from this block: the cell is empty.
    expect(cell("n.md").textContent).toBe("-");

    await click("n.md");
    // Shown at once, while the note is still being read …
    expect(row("n.md").done).toBe(true);
    expect(cell("n.md").textContent).toBe("");
    expect(messages()).toEqual([]);

    await openGate();
    // … and taken back when it could not be written: the row has no such
    // property again, as before, not a `false` the note never held.
    expect("done" in row("n.md")).toBe(false);
    expect(cell("n.md").textContent).toBe("-");
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toMatch(/^error: Property could not be saved: /);
    expect(messages()[0]).toMatch(reason);
    // Nothing of the note's text in the message.
    expect(messages()[0]).not.toContain("unclosed");
    expect(writes).toEqual([]);
    expect(files.get("n.md")).toBe(note);
  });

  it("an error of the vault is said with its reason, and the value the row had comes back", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    files.set("n.md", READABLE);
    // What a Tauri command rejects with: a string, not an Error.
    writeFails = "Operation not permitted (os error 1)";
    await render([{ "file.path": "n.md", "file.name": "n", status: "open" }]);

    let written: boolean | undefined;
    await act(async () => { written = await view.cells.handleCellSave("n.md", "status", "done"); });
    await flush();

    expect(written).toBe(false);
    expect(row("n.md").status).toBe("open");
    expect(messages()).toEqual(["error: Property could not be saved: Operation not permitted (os error 1)"]);
    expect(files.get("n.md")).toBe(READABLE);
  });

  it("two writes of one cell that both fail end at the note's value, not at the first one's", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    files.set("n.md", LIST);
    gated = true;
    await render([{ "file.path": "n.md", "file.name": "n", labels: ["a"] }]);

    // A multi-value editor stays open and commits on every change.
    const first = ["a", "b"];
    const second = ["a", "b", "c"];
    await act(async () => { void view.cells.commitCellValue("n.md", "labels", first); });
    await act(async () => { void view.cells.commitCellValue("n.md", "labels", second); });
    expect(row("n.md").labels).toBe(second);

    await openGate();
    // The first write failed while the second is still under way: the cell
    // keeps showing what is being written.
    expect(row("n.md").labels).toBe(second);
    await openGate();
    expect(row("n.md").labels).toEqual(["a"]);
    expect(messages()).toHaveLength(2);
    expect(files.get("n.md")).toBe(LIST);
  });
});

describe("a database cell whose write lands", () => {
  it("keeps the value, writes the note and says nothing", async () => {
    files.set("n.md", READABLE);
    await render([{ "file.path": "n.md", "file.name": "n", status: "open" }]);

    await click("n.md");
    await flush();

    expect(row("n.md").done).toBe(true);
    expect(messages()).toEqual([]);
    expect(files.get("n.md")).toBe("---\nstatus: open\nowner: Anna\ndone: true\n---\nText\n");
  });

  it("a later write that fails falls back to the value that did land", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    files.set("n.md", READABLE);
    await render([{ "file.path": "n.md", "file.name": "n", status: "open" }]);

    await act(async () => { await view.cells.handleCellSave("n.md", "status", "waiting"); });
    await flush();
    writeFails = new Error("disk is full");
    let written: boolean | undefined;
    await act(async () => { written = await view.cells.handleCellSave("n.md", "status", "done"); });
    await flush();

    expect(written).toBe(false);
    expect(row("n.md").status).toBe("waiting");
    expect(files.get("n.md")).toBe("---\nstatus: waiting\nowner: Anna\n---\nText\n");
  });
});
