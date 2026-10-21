// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { readFrontmatterPath } from "@plainva/core";
import { parseBaseConfig, toast, toastStore } from "@plainva/ui";

/**
 * A property renamed or removed from the phone's property sheet (finding
 * 2026-10-09).
 *
 * The sheet called the service and waited for nothing: the service swallowed
 * every note it could not write, and an error of the database itself left as
 * an unhandled rejection. A note that could not follow a rename kept the old
 * key under a column that no longer existed, and the sheet closed as if all
 * was done.
 *
 * Now a rename asks every note first and does not start where one refuses;
 * a removal counts what it could not write. The vault is a map of files: the
 * sheet, the phone's service, the shared loops and the toast store run for
 * real — only the dialogs answer what the person would.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const files = new Map<string, string>();
const writes: string[] = [];
const flushed: string[] = [];
const refusedWrites = new Set<string>();
const dialogs = vi.hoisted(() => ({ name: "priority", mode: "notes" as string | null, asked: "" }));

const write = async (path: string, text: string) => {
  if (refusedWrites.has(path)) throw new Error("Operation not permitted (os error 1)");
  writes.push(path);
  files.set(path, text);
};

vi.mock("../../services/vaultService", () => ({
  noteSaver: { flush: async (path: string) => { flushed.push(path); } },
  vaultOps: {
    read: async (_vault: unknown, path: string) => {
      const text = files.get(path);
      if (text === undefined) throw new Error(`no such file: ${path}`);
      return text;
    },
    save: async (_vault: unknown, path: string, text: string) => write(path, text),
    // The chain's entry for a change of a note where it lies: the editor's
    // pending text lands first, then the note is read, changed and written in
    // one step — as `vaultOps.update` does.
    update: async (_vault: unknown, path: string, change: (text: string) => string | null) => {
      flushed.push(path);
      const before = files.get(path);
      if (before === undefined) throw new Error(`no such file: ${path}`);
      const next = change(before);
      if (next === null || next === before) return { before, text: before, changed: false, conflict: null };
      await write(path, next);
      return { before, text: next, changed: true, conflict: null };
    },
  },
}));
vi.mock("../../services/syncService", () => ({ syncSoon: () => {} }));
vi.mock("../../services/mobileDialogs", () => ({
  mPrompt: async () => ({ value: dialogs.name, cancelled: false }),
  mActions: async (opts: { options: Array<{ label: string }> }) => {
    dialogs.asked = opts.options.map((o) => o.label).join(" | ");
    return dialogs.mode;
  },
  mConfirm: async () => true,
  mSelect: async () => null,
}));
vi.mock("../../components/SheetGrip", () => ({ SheetGrip: () => null }));

import { PropertyEditSheet } from "./PropertyEditSheet";

const BASE = "Tasks.base";
const BASE_TEXT = 'filters:\n  and:\n    - file.folder == "Tasks"\nproperties:\n  note.prio:\n    plainva:\n      input: text\nviews:\n  - type: table\n    name: Table\n    order:\n      - file.name\n      - note.prio\n';
const PLAIN = "---\ntype: task\nprio: 2\n---\nAlpha\n";
const LIST = "---\n- a\n- list\n---\nBeta\n";
const BOTH = "---\nprio: 1\npriority: high\n---\nGamma\n";

/** What the index lists for the database's sources (`queryDatabaseFiles`); set by `mount`. */
let indexRows: Record<string, unknown>[] = [];
const vault = {
  vaultId: "vault-phone",
  files: { exists: async (path: string) => files.has(path), writeTextFile: write },
  indexer: null,
  queryService: { queryDatabaseFiles: async () => indexRows },
  reindexPaths: async () => {},
} as never;

/** A note as the index lists it: the property where the note's block can be read as a map holding it. */
const indexed = (path: string, text: string): Record<string, unknown> => {
  const prio = readFrontmatterPath(text, ["prio"]);
  return prio === undefined ? { "file.path": path } : { "file.path": path, prio };
};

let host: HTMLDivElement;
let root: Root;
const onReload = vi.fn();
const onClose = vi.fn();

const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const messages = () => toastStore.get().map((item) => `${item.kind}: ${item.message}`);
const press = async (label: RegExp) => {
  const button = [...host.querySelectorAll("button")].find((b) => label.test(b.textContent ?? ""));
  if (!button) throw new Error(`no button ${label}`);
  await act(async () => { button.click(); });
  await settle();
};
const columnsOf = (text: string) => Object.keys((parseBaseConfig(text) as { columns?: Record<string, unknown> }).columns ?? {});

/**
 * The sheet over a database of `notes`. `index` is what the index lists for
 * its sources (by default: each note as its block reads), `shown` the rows of
 * the view on screen (by default: all of them).
 */
async function mount(notes: Record<string, string>, opts: { index?: Record<string, unknown>[]; shown?: Record<string, unknown>[] } = {}) {
  files.set(BASE, BASE_TEXT);
  for (const [path, text] of Object.entries(notes)) files.set(path, text);
  indexRows = opts.index ?? Object.entries(notes).map(([path, text]) => indexed(path, text));
  await act(async () => {
    root.render(
      <PropertyEditSheet
        vault={vault}
        basePath={BASE}
        config={parseBaseConfig(BASE_TEXT)}
        column="prio"
        rows={opts.shown ?? indexRows}
        columnLabel={(col) => col}
        onMutate={() => {}}
        onReload={onReload}
        onClose={onClose}
      />,
    );
  });
  await settle();
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  files.clear();
  writes.length = 0;
  flushed.length = 0;
  refusedWrites.clear();
  dialogs.name = "priority";
  dialogs.mode = "notes";
  dialogs.asked = "";
  onReload.mockClear();
  onClose.mockClear();
  toast.clearAll();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("renaming a property on the phone", () => {
  it.each([
    // The index read this note while its block was a map holding the property.
    ["a properties block that has become a YAML list", LIST, /cannot be read as properties/, true],
    ["a property of the new name", BOTH, /already has a property with the new name/, false],
  ])("does not start where a note cannot take the new name: %s", async (_label, note, reason, indexBehind) => {
    const notes = { "Tasks/Alpha.md": PLAIN, "Tasks/Refusing.md": note };
    const index = [indexed("Tasks/Alpha.md", PLAIN), indexBehind ? { "file.path": "Tasks/Refusing.md", prio: 3 } : indexed("Tasks/Refusing.md", note)];
    await mount(notes, { index });
    await press(/^\s*Rename$/);

    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toMatch(/^error: “prio” was not renamed and nothing was changed\. Notes that cannot take the new name: 1 \(Refusing\)\. /);
    expect(messages()[0]).toMatch(reason);
    // Nothing was written: not the database, not the note that could have followed.
    expect(writes).toEqual([]);
    expect(files.get(BASE)).toBe(BASE_TEXT);
    for (const [path, text] of Object.entries(notes)) expect(files.get(path)).toBe(text);
    // The sheet stays on the property as it is.
    expect(onReload).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renames the database and its notes, lands pending keystrokes first, and says nothing", async () => {
    await mount({ "Tasks/Alpha.md": PLAIN, "Tasks/Omega.md": "---\nprio: 9\n---\nOmega\n" });
    await press(/^\s*Rename$/);

    expect(messages()).toEqual([]);
    expect(columnsOf(files.get(BASE)!)).toEqual(["priority"]);
    expect(files.get("Tasks/Alpha.md")).toBe("---\ntype: task\npriority: 2\n---\nAlpha\n");
    expect(files.get("Tasks/Omega.md")).toBe("---\npriority: 9\n---\nOmega\n");
    // Each note is read from the live text: the editor's pending keystrokes land before the check and before the write.
    expect(flushed).toEqual(["Tasks/Alpha.md", "Tasks/Omega.md", "Tasks/Alpha.md", "Tasks/Omega.md"]);
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("asks only the notes that carry the property: one whose block is a YAML list does not stop the rename", async () => {
    // The view's rows stood here, and every one of them was asked: a note of
    // the folder that holds no property at all refused a rename it had
    // nothing to do with (finding 2026-10-21). The desktop never asked it.
    await mount({ "Tasks/Alpha.md": PLAIN, "Tasks/Beta.md": LIST });
    await press(/^\s*Rename$/);

    expect(messages()).toEqual([]);
    expect(columnsOf(files.get(BASE)!)).toEqual(["priority"]);
    expect(files.get("Tasks/Alpha.md")).toBe("---\ntype: task\npriority: 2\n---\nAlpha\n");
    expect(files.get("Tasks/Beta.md")).toBe(LIST);
    expect(writes).not.toContain("Tasks/Beta.md");
  });

  it("renames the notes a view's filter hides as well", async () => {
    // The view on screen shows Alpha alone; Omega belongs to the database all
    // the same and would keep "prio" under a column that no longer exists.
    await mount(
      { "Tasks/Alpha.md": PLAIN, "Tasks/Omega.md": "---\nprio: 9\n---\nOmega\n" },
      { shown: [indexed("Tasks/Alpha.md", PLAIN)] },
    );
    await press(/^\s*Rename$/);

    expect(messages()).toEqual([]);
    expect(files.get("Tasks/Omega.md")).toBe("---\npriority: 9\n---\nOmega\n");
  });

  it("counts a note whose write fails during the run", async () => {
    await mount({ "Tasks/Alpha.md": PLAIN, "Tasks/Omega.md": "---\nprio: 9\n---\nOmega\n" });
    refusedWrites.add("Tasks/Omega.md");
    await press(/^\s*Rename$/);

    expect(messages()).toEqual(["error: 1 changed, 1 failed."]);
    expect(files.get("Tasks/Omega.md")).toBe("---\nprio: 9\n---\nOmega\n");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("says so when the database itself cannot be saved, and leaves the notes alone", async () => {
    await mount({ "Tasks/Alpha.md": PLAIN });
    refusedWrites.add(BASE);
    await press(/^\s*Rename$/);

    expect(messages()).toEqual(["error: Property could not be saved: Operation not permitted (os error 1)"]);
    expect(files.get("Tasks/Alpha.md")).toBe(PLAIN);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("removing a property on the phone", () => {
  it("counts the notes that could not be cleaned, cleans the rest and closes on the column that is gone", async () => {
    const OMEGA = "---\nprio: 9\n---\nOmega\n";
    await mount({ "Tasks/Alpha.md": PLAIN, "Tasks/Omega.md": OMEGA, "Tasks/Beta.md": LIST });
    refusedWrites.add("Tasks/Omega.md");
    await press(/Delete property/);

    // The question names the notes that carry the property — not the note that holds none.
    expect(dialogs.asked).toContain("(2 files)");
    expect(messages()).toEqual(["error: 1 changed, 1 failed."]);
    expect(columnsOf(files.get(BASE)!)).toEqual([]);
    expect(files.get("Tasks/Alpha.md")).toBe("---\ntype: task\n---\nAlpha\n");
    expect(files.get("Tasks/Omega.md")).toBe(OMEGA);
    expect(files.get("Tasks/Beta.md")).toBe(LIST);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves the notes as they are when only the column is to go", async () => {
    dialogs.mode = "config";
    await mount({ "Tasks/Alpha.md": PLAIN, "Tasks/Refusing.md": LIST });
    await press(/Delete property/);

    expect(messages()).toEqual([]);
    expect(columnsOf(files.get(BASE)!)).toEqual([]);
    expect(files.get("Tasks/Alpha.md")).toBe(PLAIN);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
