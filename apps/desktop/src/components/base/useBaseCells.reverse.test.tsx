// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { toast, toastStore } from "@plainva/ui";

/**
 * A reverse relation edited in its cell (finding 2026-10-09).
 *
 * The cell of a computed reverse column shows links that live in OTHER notes:
 * adding one writes the owning property of that note, removing one takes it
 * out there. The writes stood in a `try … finally` without a catch. A note
 * that refused — a properties block that is no YAML map, an error of the vault
 * — left the editor as an unhandled rejection: nothing was said, and the notes
 * behind it in the same edit were never tried.
 *
 * Now each counterpart note is a write of its own; one that fails is said, and
 * the cell shows what the notes hold. The vault is a map of files; the hook,
 * the relation writers and the toast store run for real.
 */

const files = new Map<string, string>();
const writes: string[] = [];
let writeFails: Map<string, unknown> = new Map();

const vaultAdapter = {
  async readTextFile(path: string): Promise<string> {
    const text = files.get(path);
    if (text === undefined) throw new Error(`no such file: ${path}`);
    return text;
  },
  async writeTextFile(path: string, content: string): Promise<void> {
    if (writeFails.has(path)) throw writeFails.get(path);
    writes.push(path);
    files.set(path, content);
  },
};

const notes = () => [...files.keys()].filter((path) => path.endsWith(".md"));
const titleOf = (path: string) => path.split("/").pop()!.replace(/\.md$/, "");
/** The index, as far as a reverse edit asks it. Anything else answers an empty list. */
const queryService = new Proxy(
  {
    listNotes: async () => notes().map((path) => ({ path, title: titleOf(path) })),
    linkTargets: async () => notes().map((path) => ({ path, title: titleOf(path), mode: "obsidian" })),
    resolveNotePath: async (target: string) => notes().find((path) => titleOf(path) === target) ?? null,
  } as Record<string, unknown>,
  { get: (known, name: string) => known[name] ?? (async () => []) },
);

vi.mock("../../contexts/VaultContext", () => ({
  useVault: () => ({ vaultAdapter, queryService, vaultPath: "/vault", indexer: null, fileTreeVersion: 0, triggerFileTreeUpdate: () => {} }),
}));
vi.mock("../../hooks/useWikiResolver", () => ({ useWikiResolver: () => null }));
vi.mock("../../services/newNote", () => ({
  buildNewNoteContent: () => "",
  getConfiguredNoteType: async () => "Note",
}));

import { useBaseCells, type BaseCells } from "./useBaseCells";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Row = Record<string, unknown>;

/** The projects' database: `tasks` lists the tasks whose `project` points here. */
const CONFIG = { columns: { tasks: { reverseOf: { base: "Tasks.base", property: "project" } } } };
const PROJECT = "Projects/P.md";
const LIST = "---\n- a\n- list\n---\nTask two\n";
const LINKED = '---\nproject: "[[P]]"\n---\nTask one\n';
const UNLINKED = "---\nstatus: open\n---\nTask three\n";

let container: HTMLDivElement;
let root: Root;
const view = {} as { cells: BaseCells; rows: Row[] };

function Table({ rows }: { rows: Row[] }) {
  const [dbData, setDbData] = useState<any[]>(rows);
  const cells = useBaseCells({ dbConfig: CONFIG, dbData, setDbData });
  useEffect(() => {
    view.cells = cells;
    view.rows = dbData;
  });
  return <div />;
}

const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
};
const messages = () => toastStore.get().map((item) => `${item.kind}: ${item.message}`);
const project = () => view.rows.find((r) => r["file.path"] === PROJECT)!;
/** What the cell editor does on every change: hand over the whole new list. */
const commit = async (next: string[]) => {
  let outcome: unknown = "pending";
  await act(async () => {
    outcome = await view.cells.commitReverseCellValue(project(), "tasks", next).then(() => "settled", (e: unknown) => e);
  });
  await flush();
  return outcome;
};

beforeEach(async () => {
  await i18n.changeLanguage("en");
  files.clear();
  writes.length = 0;
  writeFails = new Map();
  toast.clearAll();
  files.set(PROJECT, "# P\n");
  files.set("Tasks/T1.md", LINKED);
  files.set("Tasks/T2.md", LIST);
  files.set("Tasks/T3.md", UNLINKED);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(console, "error").mockImplementation(() => {});
  await act(async () => { root.render(<Table rows={[{ "file.path": PROJECT, "file.name": "P", tasks: ["[[T1]]"] }]} />); });
  await flush();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("a reverse relation whose counterpart note refuses the link", () => {
  it("says so, does not show the link and leaves the note alone", async () => {
    expect(await commit(["[[T1]]", "[[T2]]"])).toBe("settled");

    expect(messages()).toEqual([
      "error: Property could not be saved: The block at the top of the note cannot be read as properties. Correct it in the note's text and try again.",
    ]);
    // The cell shows what the notes hold: T2 was not given the link.
    expect(project().tasks).toEqual(["[[T1]]"]);
    expect(writes).toEqual([]);
    expect(files.get("Tasks/T2.md")).toBe(LIST);
  });

  it("goes on to the notes behind it: what can be linked is linked and shown", async () => {
    expect(await commit(["[[T1]]", "[[T2]]", "[[T3]]"])).toBe("settled");

    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toMatch(/^error: Property could not be saved: /);
    expect(project().tasks).toEqual(["[[T1]]", "[[T3]]"]);
    expect(writes).toEqual(["Tasks/T3.md"]);
    expect(files.get("Tasks/T3.md")).toBe('---\nstatus: open\nproject:\n  - "[[P]]"\n---\nTask three\n');
    expect(files.get("Tasks/T2.md")).toBe(LIST);
  });

  it("keeps showing a link the note could not be relieved of, with the vault's reason", async () => {
    // What a Tauri command rejects with: a string, not an Error.
    writeFails.set("Tasks/T1.md", "Operation not permitted (os error 1)");
    expect(await commit([])).toBe("settled");

    expect(messages()).toEqual(["error: Property could not be saved: Operation not permitted (os error 1)"]);
    expect(project().tasks).toEqual(["[[T1]]"]);
    expect(files.get("Tasks/T1.md")).toBe(LINKED);
  });

  it("says one count where several notes of one edit fail", async () => {
    files.set("Tasks/T4.md", LIST);
    expect(await commit(["[[T1]]", "[[T2]]", "[[T3]]", "[[T4]]"])).toBe("settled");

    expect(messages()).toEqual(["error: 1 changed, 2 failed."]);
    expect(project().tasks).toEqual(["[[T1]]", "[[T3]]"]);
  });
});

describe("a reverse relation whose counterpart notes take the edit", () => {
  it("writes the owning property there, shows the new list and says nothing", async () => {
    expect(await commit(["[[T3]]"])).toBe("settled");

    expect(messages()).toEqual([]);
    expect(project().tasks).toEqual(["[[T3]]"]);
    expect(files.get("Tasks/T3.md")).toBe('---\nstatus: open\nproject:\n  - "[[P]]"\n---\nTask three\n');
    // The last link is gone, and with it the key.
    expect(files.get("Tasks/T1.md")).toBe("Task one\n");
    expect(files.get(PROJECT)).toBe("# P\n");
  });
});
