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
 * The third kind of block is the one that used to be WRITTEN: a proper YAML
 * map with a value the reader's schema rejects. The panel reads no properties
 * from it, so the set it hands over holds only the one being changed — and the
 * rewrite removed every other property of the note.
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
    ["a block the reader cannot take", EMPTY_TAGS, /"tags" holds a value that cannot be read/],
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
    ["a block the reader cannot take", EMPTY_TAGS],
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

  it("a block the reader cannot take keeps its other properties", async () => {
    // Before the panel asked: the set it handed over was `{ status }` alone,
    // and the editor was given a note without `tags` and without `owner`.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { handed } = await open(EMPTY_TAGS);

    await pickDraft();

    expect(handed).toEqual([]);
  });
});

describe("PropertiesSection — a write the note takes", () => {
  it("hands the editor the note with the new property and shows its row", async () => {
    const { handed } = await open(READABLE);
    expect(propertyRows()).toContain("owner");

    await pickDraft();

    expect(handed).toEqual(["---\nowner: Anna\nstatus: draft\n---\n\n# Note\n"]);
    expect(statusRow().querySelector(".pv-chip-text")?.textContent).toBe("Draft");
    expect(messages()).toEqual([]);
  });

  it("says that the note was marked as reviewed", async () => {
    const { handed } = await open(READABLE);

    await click(container.querySelector('[data-testid="okf-mark-verified"]'));

    expect(handed).toHaveLength(1);
    expect(handed[0]).toContain("human:Anna");
    expect(messages()).toEqual(["success: Marked as reviewed by Anna."]);
  });
});
