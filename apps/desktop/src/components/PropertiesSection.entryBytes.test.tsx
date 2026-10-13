// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { toast, toastStore } from "@plainva/ui";
import { BLOCK, LAST_ENTRY, noteOf, withLine, withLinesBehind, withoutLines } from "../../../../packages/core/test/helpers/propertyBlock";

/**
 * The properties panel changes ONE entry of a note's block, and no other byte
 * (finding 2026-10-11).
 *
 * The panel hands the editor the whole set: what the reader read, with its one
 * change. That set was written as a whole, through the YAML library — the
 * block of `packages/core/test/helpers/propertyBlock.ts` came back with
 * `plz: 01067` as `1067`, its long line folded, its bracket list padded and
 * its lists indented, whatever row had been touched; a renamed property moved
 * to the end of the block.
 *
 * The shell is mocked (vault context, settings store); the panel, its rows and
 * the shared writer run for real, over that block. The editor is a bridge that
 * records the document it is handed. It holds a note with `\n` and without a
 * byte order mark, so that is the shape here; the other shapes run through the
 * cell (`base/useBaseCells.entryBytes.test.tsx`) and the core.
 */

vi.mock("../contexts/VaultContext", () => ({
  useVault: () => ({ fileTreeVersion: 0, vaultPath: "/vault", queryService: null, vaultAdapter: null }),
  verifierNameKey: (vault: string) => `verifierName_${vault}`,
}));
vi.mock("../services/newNote", () => ({
  getConfiguredNoteType: async () => "Note",
  getConfiguredDailyNoteType: async () => "Daily Note",
}));
vi.mock("../services/settingsStore", () => ({
  getSettingsStore: async () => ({
    get: async (key: string) => (key === "verifierName_/vault" ? "Anna" : null),
    set: async () => {},
    save: async () => {},
  }),
}));

import { PropertiesSection } from "./PropertiesSection";
import { createDocChannel } from "../services/activeDocument";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The block, with a checkbox as its last entry: a row that changes with one press. */
const LAST = "done: false";
const PANEL = withLinesBehind(BLOCK, LAST_ENTRY, LAST);
const NOTE = noteOf(PANEL);

let container: HTMLDivElement;
let root: Root;

const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
};

/** The panel on the note, with an editor that records the documents it is handed. */
async function open() {
  const channel = createDocChannel();
  const handed: string[] = [];
  channel.registerApplyFrontmatter((next) => { handed.push(next); });
  channel.set({ path: "Note.md", content: NOTE, kind: "markdown" });
  await act(async () => { root.render(<PropertiesSection channel={channel} />); });
  await flush();
  return handed;
}

const row = (key: string) => container.querySelector(`.pv-prow[data-prop="${key}"]`);
const click = async (el: Element | null | undefined) => {
  expect(el, "the control to press is not there").toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await flush();
};
const messages = () => toastStore.get().map((item) => `${item.kind}: ${item.message}`);

/** The lines a write added behind `behind` — and the proof that it added nothing else and moved nothing. */
function addedBehind(written: string, behind: string): string[] {
  const lines = written.split("\n");
  const at = lines.indexOf(behind) + 1;
  const added = lines.slice(at, at + lines.length - NOTE.split("\n").length);
  expect(written).toBe(noteOf(withLinesBehind(PANEL, behind, ...added)));
  return added;
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  localStorage.clear();
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

describe("PropertiesSection — one row changes one entry of the block", () => {
  it("shows the note's properties: the reader takes the block", async () => {
    await open();
    for (const key of ["plz", "tags", "title", "status", "2024", "done"]) expect(row(key), key).not.toBeNull();
  });

  it("a value changed in its row: the characters of that value", async () => {
    const handed = await open();

    await click(row("done")?.querySelector('button[role="switch"]'));

    expect(handed).toEqual([noteOf(withLine(PANEL, LAST, "done: true"))]);
    expect(messages()).toEqual([]);
  });

  it("a property removed: its line", async () => {
    const handed = await open();

    await click(row("title")?.querySelector(".pv-del"));

    expect(handed).toEqual([noteOf(withoutLines(PANEL, "title:    Spaced"))]);
    expect(row("title")).toBeNull();
  });

  it("a property renamed: the characters of its key, and it stays where it is", async () => {
    const handed = await open();
    const name = container.querySelector('.pv-key[data-key="title"]') as HTMLInputElement | HTMLTextAreaElement | null;
    expect(name, "the name of the row is not there").not.toBeNull();
    const field = name!;
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;

    await act(async () => {
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, "heading");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // React maps onBlur onto the native `focusout` (blur does not bubble).
    await act(async () => { field.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    await flush();

    // It used to be removed and put at the end of the block.
    expect(handed).toEqual([noteOf(withLine(PANEL, "title:    Spaced", "heading:    Spaced"))]);
  });

  it("a property added: a line behind the last entry", async () => {
    const handed = await open();

    await click([...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Add property"));
    await click(container.querySelector(".pv-add-types .pv-popover-row"));

    expect(handed).toHaveLength(1);
    expect(addedBehind(handed[0], LAST)).toEqual(['Property: ""']);
  });

  it("marked as reviewed: the lines of the new entry, behind the last one", async () => {
    const handed = await open();

    await click(container.querySelector('[data-testid="okf-mark-verified"]'));

    expect(handed).toHaveLength(1);
    const added = addedBehind(handed[0], LAST);
    expect(added.slice(0, 2)).toEqual(["verified:", "  - by: human:Anna"]);
    expect(added).toHaveLength(3);
    expect(added[2]).toMatch(/^ {4}at: "?\d{4}-\d{2}-\d{2}T[\d:.]+Z"?$/);
    expect(messages()).toEqual(["success: Marked as reviewed by Anna."]);
  });
});
