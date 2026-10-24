// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { loadPropertyTypes, toast, toastStore } from "@plainva/ui";

/**
 * A property the note refuses (finding 2026-10-09).
 *
 * The panel set its own state first and wrote afterwards; a refused write — a
 * block at the top of the note that is no YAML map — went to the console and
 * the panel kept showing the new property, the new status, even "Marked as
 * reviewed". Now nothing is shown that the note does not hold, and a message
 * says why.
 *
 * A third kind of block used to be WRITTEN, and was refused from 2026-10-11 to
 * 2026-10-22: a proper YAML map with a value the reader's schema rejected (an
 * empty `tags:`). The panel read no properties from it, so the set it handed
 * over held only the one being changed — and the rewrite removed every other
 * property of the note. The reader takes every value now (ADR 0009, addendum
 * 2026-10-22): such a note shows its properties and takes a write of one.
 *
 * The shell is mocked (vault context, settings store); the panel, its rows and
 * the toast store run for real. The editor is a bridge that records what it is
 * handed.
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

const LIST = "---\n- a\n- list\n---\n\n# Note\n";
const UNPARSEABLE = "---\ntitle: [unclosed\nowner: Anna\n---\n\n# Note\n";
const PROSE = "---\nA line between two rules\n---\n\n# Note\n";
const EMPTY_TAGS = "---\ntags:\nowner: Anna\n---\n\n# Note\n";
const READABLE = "---\nowner: Anna\n---\n\n# Note\n";

let container: HTMLDivElement;
let root: Root;

const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
};

/** The panel on a note, with an editor that records the documents it is handed. */
async function open(content: string) {
  const channel = createDocChannel();
  const handed: string[] = [];
  channel.registerApplyFrontmatter((next) => { handed.push(next); });
  channel.set({ path: "Note.md", content, kind: "markdown" });
  await act(async () => { root.render(<PropertiesSection channel={channel} />); });
  await flush();
  return { channel, handed };
}

const button = (text: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
const click = async (el: Element | null | undefined) => {
  expect(el, "the control to press is not there").toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await flush();
};
const messages = () => toastStore.get().map((item) => `${item.kind}: ${item.message}`);
const propertyRows = () => [...container.querySelectorAll(".pv-props .pv-prow[data-prop]")].map((el) => el.getAttribute("data-prop"));
const statusRow = () => container.querySelector('.pv-prow[data-prop="status"]')!;

/** "Add property", then the first type the popover offers. */
async function addProperty() {
  await click(button("Add property"));
  await click(container.querySelector(".pv-add-types .pv-popover-row"));
}
/** A row's name field: a new name typed into it, then the field left. */
async function rename(from: string, to: string) {
  const field = container.querySelector(`.pv-key[data-key="${from}"]`) as HTMLTextAreaElement | null;
  expect(field, `no name field for ${from}`).toBeTruthy();
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(field, to);
    field!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { field!.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
  await flush();
}
/** The pinned status row: open its list and pick "Draft". */
async function pickDraft() {
  await click(statusRow().querySelector(".pv-select-btn"));
  await click([...statusRow().querySelectorAll(".pv-popover-row")].find((b) => b.textContent?.trim() === "Draft"));
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

describe("PropertiesSection — a write the note refuses", () => {
  it.each([
    ["a YAML list", LIST, /cannot be read as properties/],
    ["YAML that cannot be parsed", UNPARSEABLE, /cannot be read as properties/],
    ["text between two rules", PROSE, /cannot be read as properties/],
  ])("a new property is not shown, the reason is said and the note stays as it is: %s", async (_label, note, reason) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { channel, handed } = await open(note);
    const before = propertyRows();

    await addProperty();

    expect(propertyRows()).toEqual(before);
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toMatch(/^error: Property could not be saved: /);
    expect(messages()[0]).toMatch(reason);
    expect(messages()[0]).not.toContain("unclosed");
    // The editor was handed nothing: the note is what it was, byte for byte.
    expect(handed).toEqual([]);
    expect(channel.get().content).toBe(note);
    // And the type picked for a property that never was is not remembered.
    expect(loadPropertyTypes("/vault")).toEqual({});
  });

  it.each([
    ["a YAML list", LIST],
    ["YAML that cannot be parsed", UNPARSEABLE],
  ])("a status picked in the pinned row goes back to what the note says: %s", async (_label, note) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { handed } = await open(note);
    expect(statusRow().querySelector(".pv-placeholder")).not.toBeNull();

    await pickDraft();

    expect(statusRow().querySelector(".pv-chip-text")).toBeNull();
    expect(statusRow().querySelector(".pv-placeholder")).not.toBeNull();
    expect(messages()).toHaveLength(1);
    expect(handed).toEqual([]);
  });

  it("does not report a review that was not written", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { handed } = await open(LIST);

    await click(container.querySelector('[data-testid="okf-mark-verified"]'));

    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toMatch(/^error: Property could not be saved: /);
    expect(container.querySelector('[data-testid="okf-trust-level"]')?.getAttribute("data-level")).not.toBe("human-reviewed");
    expect(handed).toEqual([]);
  });

  it("says a block it cannot read as such, not as no properties", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sentence = i18n.t("properties.unreadableBlock");
    expect(sentence).toMatch(/cannot be read as properties/);
    // A line of prose and a number the reader reads as a block without
    // properties; the writers refuse them, and so the panel says it.
    for (const note of [LIST, UNPARSEABLE, PROSE, "---\n42\n---\n\n# Note\n"]) {
      await open(note);
      expect(container.textContent).toContain(sentence);
      expect(container.textContent).not.toContain(i18n.t("properties.noProperties"));
    }
    await open("# Note\n");
    expect(container.textContent).toContain(i18n.t("properties.noProperties"));
    expect(container.textContent).not.toContain(sentence);
  });
});

describe("PropertiesSection — a write the note takes", () => {
  it("a block the reader used to refuse — an empty tags key — shows its properties and changes one, and not another byte", async () => {
    // Before 2026-10-11 the panel read no properties from this block and
    // handed over `{ status }` alone: the editor got a note without `tags`
    // and without `owner`. Until 2026-10-22 the write was refused.
    const { handed } = await open(EMPTY_TAGS);
    // Its two properties, then the two pinned lifecycle rows every note has.
    expect(propertyRows()).toEqual(["tags", "owner", "status", "stale_after"]);

    await pickDraft();

    expect(handed).toEqual(["---\ntags:\nowner: Anna\nstatus: draft\n---\n\n# Note\n"]);
    expect(messages()).toEqual([]);
  });

  it("hands the editor the note with the new property and shows its row", async () => {
    const { handed } = await open(READABLE);
    expect(propertyRows()).toContain("owner");

    await pickDraft();

    expect(handed).toEqual(["---\nowner: Anna\nstatus: draft\n---\n\n# Note\n"]);
    expect(statusRow().querySelector(".pv-chip-text")?.textContent).toBe("Draft");
    expect(messages()).toEqual([]);
  });

  it("a rename changes the name of an entry and not a character of its value", async () => {
    // Handed over as a set until 2026-10-22, the old key's READING went under
    // the new name: `title: 2024` became `heading: "2024"`, a list under
    // `description` one line of text, `tags: a, b` a list of two lines.
    const NOTE = "---\ntitle: 2024\ndescription:\n  - one\n  - 2\ntags: a, b # kept\n---\n\n# Note\n";
    for (const [from, to, text] of [
      ["title", "heading", "title: 2024"],
      ["description", "notes", "description:"],
      ["tags", "labels", "tags: a, b"],
    ]) {
      // A panel of its own for each rename: the one before shows the note renamed.
      act(() => root.unmount());
      root = createRoot(container);
      const { handed } = await open(NOTE);
      await rename(from, to);
      expect(handed, `${from} renamed to ${to}`).toEqual([NOTE.replace(text, text.replace(from, to))]);
    }
    expect(messages()).toEqual([]);
  });

  it("a rename that finds no entry of the name is refused and said, and not shown as done", async () => {
    // A key that is an alias: the reader names it after what it stands for, the entry has no name of its own.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const NOTE = "---\nx: &k owner\n*k : Anna\n---\n\n# Note\n";
    const { handed } = await open(NOTE);
    expect(propertyRows()).toContain("owner");

    await rename("owner", "person");

    expect(handed).toEqual([]);
    expect(propertyRows()).toContain("owner");
    expect(propertyRows()).not.toContain("person");
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toMatch(/^error: Property could not be saved: .*cannot be read as properties/);
  });

  it("says that the note was marked as reviewed", async () => {
    const { handed } = await open(READABLE);

    await click(container.querySelector('[data-testid="okf-mark-verified"]'));

    expect(handed).toHaveLength(1);
    expect(handed[0]).toContain("human:Anna");
    expect(messages()).toEqual(["success: Marked as reviewed by Anna."]);
  });
});
