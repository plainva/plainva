// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";

/**
 * "tags" flickered between two colours (finding 2026-10-06).
 *
 * A `tags` value is drawn as tag pills on its own, and as option chips once
 * the database that governs the note declares the column a multi-select — two
 * renderers with two colour sources. Which one applies is looked up
 * asynchronously, and the panel used to FORGET the answer at the start of
 * every lookup. A lookup starts with every index update, that is with every
 * save and every sync cycle; until it came back the row fell to the other
 * renderer.
 *
 * The shell is mocked (vault context, the index); the panel, the row and the
 * kept resolution run for real. Twenty index updates are fired, and after
 * every single render the row is asked which renderer it is.
 */

type Deferred = { resolve: () => void };
const pending: Deferred[] = [];
let lookups = 0;
/** Whether the note is (still) a row of the database. */
let member = true;

const baseYaml = [
  "filters:",
  "  and:",
  '    - file.folder == "Tagebuch"',
  "properties:",
  "  note.tags:",
  "    plainva:",
  "      input: multiselect",
  "      options:",
  "        - value: typ/tagebuch",
  "views:",
  "  - type: table",
  "    name: Liste",
  "    order:",
  "      - file.name",
  "      - note.tags",
  "",
].join("\n");

const queryService = {
  db: { query: async () => [{ path: "Tagebuch/Tagebuch_Liste.base" }] },
  // The membership query: held back until the test lets it answer, so the
  // moment "a lookup is running" lasts as long as the test needs it to.
  queryDatabaseFiles: () => {
    lookups += 1;
    const rows = member ? [{ "file.path": "Tagebuch/2026-09-24.md" }] : [];
    return new Promise<unknown[]>((resolve) => { pending.push({ resolve: () => resolve(rows) }); });
  },
  getAllTags: async () => [],
  getDistinctPropertyValues: async () => [],
};
const vaultAdapter = { readTextFile: async () => baseYaml };
const vaultContext = { fileTreeVersion: 0, vaultPath: "/vault", queryService, vaultAdapter };
vi.mock("../contexts/VaultContext", () => ({
  useVault: () => ({ ...vaultContext }),
  verifierNameKey: (vault: string) => `verifierName_${vault}`,
}));
vi.mock("../services/newNote", () => ({
  getConfiguredNoteType: async () => "Note",
  getConfiguredDailyNoteType: async () => "Daily Note",
}));

import { PropertiesSection } from "./PropertiesSection";
import { createDocChannel } from "../services/activeDocument";
import { forgetGoverningBases } from "../services/baseSchema";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const note = ["---", "type: Daily Note", "tags:", "  - typ/tagebuch", "---", "", "# Donnerstag", ""].join("\n");

const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
};
const answerAll = async () => {
  while (pending.length > 0) {
    pending.shift()!.resolve();
    await flush();
  }
};
/** "tags" (tag pills), "multi" (option chips), or what else the row shows. */
const renderer = (): string => {
  const row = container.querySelector('.pv-prow[data-prop="tags"]');
  if (!row) return "no row";
  if (row.querySelector(".pv-chip-tag")) return "tags";
  if (row.querySelector(".pv-select .pv-chips")) return "multi";
  return "other";
};

beforeEach(async () => {
  await i18n.changeLanguage("en");
  localStorage.clear();
  forgetGoverningBases();
  pending.length = 0;
  lookups = 0;
  member = true;
  vaultContext.fileTreeVersion = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PropertiesSection — the governing database is kept while it is looked up again", () => {
  it("twenty index updates never change the renderer of the tags row", async () => {
    const channel = createDocChannel();
    channel.set({ path: "Tagebuch/2026-09-24.md", content: note, kind: "markdown" });
    await act(async () => { root.render(<PropertiesSection channel={channel} />); });
    await flush();
    // Before the first answer there is nothing to keep: the value is drawn on
    // its own. That is the one switch a note ever shows — when it is first met.
    expect(renderer()).toBe("tags");
    await answerAll();
    expect(renderer()).toBe("multi");

    const seen = new Set<string>();
    for (let version = 1; version <= 20; version++) {
      vaultContext.fileTreeVersion = version;
      // The render that starts the lookup, and every render until it answers.
      await act(async () => { root.render(<PropertiesSection channel={channel} />); });
      seen.add(renderer());
      await flush();
      seen.add(renderer());
      expect(pending.length, `update ${version} started a lookup`).toBeGreaterThan(0);
      await answerAll();
      seen.add(renderer());
    }
    expect([...seen], "the row changed its renderer during an index update").toEqual(["multi"]);
    // Every update did look the answer up again — keeping it is not the same
    // as never asking.
    expect(lookups).toBeGreaterThanOrEqual(21);
  });

  it("an equal answer hands the rows the SAME schema object: nothing downstream re-renders for it", async () => {
    const channel = createDocChannel();
    channel.set({ path: "Tagebuch/2026-09-24.md", content: note, kind: "markdown" });
    await act(async () => { root.render(<PropertiesSection channel={channel} />); });
    await flush();
    await answerAll();
    const chipBefore = container.querySelector('.pv-prow[data-prop="tags"] .pv-chip');
    vaultContext.fileTreeVersion = 1;
    await act(async () => { root.render(<PropertiesSection channel={channel} />); });
    await flush();
    await answerAll();
    // Same DOM node: React kept the element, it did not swap one renderer's
    // chip for another's and back.
    expect(container.querySelector('.pv-prow[data-prop="tags"] .pv-chip')).toBe(chipBefore);
  });

  it("a DIFFERENT answer does arrive: a note that left its database is drawn on its own again", async () => {
    const channel = createDocChannel();
    channel.set({ path: "Tagebuch/2026-09-24.md", content: note, kind: "markdown" });
    await act(async () => { root.render(<PropertiesSection channel={channel} />); });
    await flush();
    await answerAll();
    expect(renderer()).toBe("multi");

    member = false;
    vaultContext.fileTreeVersion = 1;
    await act(async () => { root.render(<PropertiesSection channel={channel} />); });
    await flush();
    // Still the old rendering while the lookup runs ...
    expect(renderer()).toBe("multi");
    await answerAll();
    // ... and the new one once it has answered.
    expect(renderer()).toBe("tags");
  });

  it("a note met again is drawn right on its first frame", async () => {
    const channel = createDocChannel();
    channel.set({ path: "Tagebuch/2026-09-24.md", content: note, kind: "markdown" });
    await act(async () => { root.render(<PropertiesSection channel={channel} />); });
    await flush();
    await answerAll();
    act(() => root.unmount());

    root = createRoot(container);
    await act(async () => { root.render(<PropertiesSection channel={channel} />); });
    // No flush, no answer: the remembered one applies at once.
    expect(renderer()).toBe("multi");
    await answerAll();
  });
});

describe("PropertiesSection — the section counts what it shows", () => {
  it("reports the rows it draws, not the keys of the file", async () => {
    const counts: number[] = [];
    const channel = createDocChannel();
    // Six keys in the file. `plainva` is hidden, `generated` is the trust
    // group; `type`, `tags` and `status: draft` are rows, and the pinned
    // "stale after" row is drawn although the file has no such key.
    const content = [
      "---", "type: Note", "tags:", "  - a", "status: draft", "plainva:", "  icon: x",
      "generated:", "  by: plainva-import/1", "  at: 2026-08-01T10:00:00Z", "---", "", "# T", "",
    ].join("\n");
    channel.set({ path: "Notiz.md", content, kind: "markdown" });
    await act(async () => { root.render(<PropertiesSection channel={channel} onCountChange={(n) => counts.push(n)} />); });
    await flush();
    await answerAll();
    expect(counts.slice(-1)[0]).toBe(4);
    expect(container.querySelectorAll(".pv-props .pv-prow[data-prop]").length).toBe(4);
  });
});
