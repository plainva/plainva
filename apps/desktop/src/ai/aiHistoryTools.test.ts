import { describe, expect, it } from "vitest";
import { effectivePolicy, notePolicyFrom, parsePolicyFile, toolByName, type EgressRecipient } from "@plainva/core";
import { createVaultToolExecutor, furtherToolNames, noteHistorySource, SKILL_TOOL_NAMES, type VaultToolDeps } from "@plainva/ui";

/**
 * How notes developed (plan KI-Harness P9-1): the two tools a look back is
 * made of. `get_changes` lists the notes created or changed in a period with
 * the lines each gained by its end; `get_note_history` tells one note day by
 * day. Both read the index and the version history this device keeps, wired
 * as both shells wire them (`noteHistorySource`), behind the same gate as
 * every read: a note the rules keep from the recipient is not there, a line
 * somebody deleted is a number and never a text, and what a note's
 * properties say — the mood of a day, the app's own settings — is no line
 * of it.
 */

/** October 2026: the 5th is a Monday, the 9th a Friday. Built from calendar parts, so a test says the same in every time zone. */
const at = (day: number, hours = 12, minutes = 0) => new Date(2026, 9, day, hours, minutes).getTime();

const PLAN_0 = "# Plan\n\nKick-off on Monday.\nBudget: open.\n";
const PLAN_1 = "# Plan\n\nKick-off on Monday.\nBudget: 12,000 € agreed with Tom.\n";
const PLAN_2 = `${PLAN_1}Decision: hosting at the studio.\nAsk [[Salary]] first.\n`;
const PODCAST_0 = "---\ntype: Idea\nmood: 2\n---\n# Podcast\n\nA podcast about the studio.\n";
const PODCAST_1 = `${PODCAST_0}Guests: Anna and Tom.\n`;
const DAY_0 = "---\nmood: 4\nplainva:\n  tasks: false\n---\n# Week 41\n\nCalled the studio.\n";
const DAY_1 = DAY_0.replace("mood: 4", "mood: 1");
const SALARY = "# Salary\n\nsalary review: 93k\n";

interface Note {
  text: string;
  /** When the index first saw it. */
  created: number;
  /** When it last changed on disk. */
  mtime: number;
  /** Its kept states, each the text before the write it was taken for. */
  kept: { at: number; text: string }[];
}

/**
 * The vault of these tests: a plan edited twice in the week, an idea made in
 * it and edited a day later, a daily note whose mood was all that changed,
 * a note the rules keep from every provider, and one changed without any
 * version kept of it.
 */
function vault(): Record<string, Note> {
  return {
    "Projects/Plan.md": { text: PLAN_2, created: at(1), mtime: at(8, 15), kept: [{ at: at(6, 10), text: PLAN_0 }, { at: at(8, 15), text: PLAN_1 }] },
    "Projects/Podcast.md": { text: PODCAST_1, created: at(7, 9), mtime: at(8, 11), kept: [{ at: at(8, 11), text: PODCAST_0 }] },
    "Journal/Week 41.md": { text: DAY_1, created: at(2), mtime: at(6, 20), kept: [{ at: at(6, 20), text: DAY_0 }] },
    "Private/Salary.md": { text: SALARY, created: at(2), mtime: at(7, 16), kept: [{ at: at(7, 16), text: "# Salary\n" }] },
    "Projects/Old.md": { text: "# Old\n\nNothing new, said nobody.\n", created: at(1), mtime: at(8, 9), kept: [] },
  };
}

const rules = parsePolicyFile("folders:\n  Private/:\n    cloud: deny\n").rules;
const cloud: EgressRecipient = { kind: "cloud", provider: "anthropic", model: "m" };
const local: EgressRecipient = { kind: "local", provider: "ollama", model: "m" };
const titleOf = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");

function depsOf(notes: Record<string, Note>, over: { noVersions?: boolean; noHistory?: boolean } = {}): VaultToolDeps {
  const index = {
    async getNotesChangedIn(folder: string, since: number, limit = 100) {
      return Object.entries(notes)
        .filter(([path, note]) => note.mtime > since && (!folder || path.startsWith(`${folder}/`)))
        .sort((a, b) => b[1].mtime - a[1].mtime)
        .slice(0, limit)
        .map(([path, note]) => ({ path, title: titleOf(path), mtime: note.mtime, created: note.created }));
    },
    getNoteCreated: async (path: string) => notes[path]?.created ?? null,
  };
  const versions = {
    // Newest first, as the version history lists them.
    list: async (path: string) => [...(notes[path]?.kept ?? [])].reverse().map((state) => ({ id: `${path}\n${state.at}`, at: state.at, size: state.text.length })),
    read: async (id: string) => {
      const cut = id.lastIndexOf("\n");
      return notes[id.slice(0, cut)]?.kept.find((state) => state.at === Number(id.slice(cut + 1)))?.text ?? null;
    },
  };
  return {
    search: async () => [],
    readNote: async (path) => notes[path]?.text ?? null,
    resolveLink: async (target) => Object.keys(notes).find((path) => titleOf(path) === target) ?? null,
    policyOf: async (path) => effectivePolicy(path, notePolicyFrom({}), rules),
    taskRows: async () => [],
    todayKey: () => "2026-10-09",
    commands: () => [],
    ...(over.noHistory ? {} : { history: noteHistorySource({ index, versions: over.noVersions ? null : versions }) }),
  };
}

const run = (deps: VaultToolDeps, name: string, args: Record<string, unknown>, recipient: EgressRecipient = cloud) =>
  createVaultToolExecutor(deps, { recipient, webTools: false }).execute(toolByName(name)!, args, { type: "tool_call", id: "c1", name, args });

/** Everything a model or a script is given of a call: its sentence and its values. */
const everything = (outcome: { content: string; data?: unknown }) => `${outcome.content}\n${JSON.stringify(outcome.data ?? null)}`;

describe("what changed in a period", () => {
  it("lists the notes made or changed in it, newest first, each with the lines it gained — a deleted line only counted", async () => {
    const out = await run(depsOf(vault()), "get_changes", { since: "2026-10-05" });
    expect(out.isError).toBeUndefined();
    expect(out.content).toBe(
      [
        "Notes created or changed from 2026-10-05 to 2026-10-09:",
        "- [[Plan]] (Projects/Plan.md) — changed, last on 2026-10-08: 3 lines gained, 1 line lost",
        "  > Budget: 12,000 € agreed with Tom.",
        "  > Decision: hosting at the studio.",
        "  > Ask ⟦withheld note⟧ first.",
        "- [[Podcast]] (Projects/Podcast.md) — new on 2026-10-07, last changed on 2026-10-08",
        "  > # Podcast",
        "  > A podcast about the studio.",
        "  > Guests: Anna and Tom.",
        "- [[Old]] (Projects/Old.md) — changed, last on 2026-10-08; no earlier state is kept on this device, its beginning:",
        "  > # Old",
        "  > Nothing new, said nobody.",
        "",
        "A line that was deleted is counted, never shown.",
      ].join("\n"),
    );
    const told = everything(out);
    // What was deleted, what the properties say and a note the rules keep from the provider: in no word.
    for (const word of ["Budget: open.", "mood", "type: Idea", "plainva", "Salary", "salary", "93k", "Week 41"]) expect(told, word).not.toContain(word);
    expect(out.data).toMatchObject({
      since: "2026-10-05",
      until: "2026-10-09",
      notes: [
        { path: "Projects/Plan.md", kind: "changed", made: null, last: "2026-10-08", added: 3, removed: 1 },
        { path: "Projects/Podcast.md", kind: "new", made: "2026-10-07", last: "2026-10-08" },
        { path: "Projects/Old.md", kind: "changed", last: "2026-10-08", added: null, removed: null },
      ],
    });
  });

  it("tells a period that ended before today by the states kept after it — a change after it is not one in it", async () => {
    const out = await run(depsOf(vault()), "get_changes", { since: "2026-10-05", until: "2026-10-07" });
    // The plan as it stood at the end of the 7th; the idea as it was made; a note without a kept state that changed later is left out.
    expect(out.content).toContain("- [[Plan]] (Projects/Plan.md) — changed, last on 2026-10-06: 1 line gained, 1 line lost\n  > Budget: 12,000 € agreed with Tom.\n");
    expect(out.content).toContain("- [[Podcast]] (Projects/Podcast.md) — new on 2026-10-07\n  > # Podcast\n  > A podcast about the studio.\n");
    expect(out.content).not.toContain("Decision: hosting");
    expect(out.content).not.toContain("Guests:");
    expect(out.content).not.toContain("Projects/Old.md");
  });

  it("gives a model on this device what the rules keep from a provider — and still no deleted line, no property", async () => {
    const out = await run(depsOf(vault()), "get_changes", { since: "2026-10-05" }, local);
    expect(out.content).toContain("- [[Salary]] (Private/Salary.md) — changed, last on 2026-10-07: 1 line gained, 0 lines lost\n  > salary review: 93k");
    expect(out.content).toContain("  > Ask [[Salary]] first.");
    expect(out.content).not.toContain("Budget: open.");
    expect(out.content).not.toContain("mood");
  });

  it("keeps to a folder, to a limit — and says that there may be more", async () => {
    const inJournal = await run(depsOf(vault()), "get_changes", { since: "2026-10-05", folder: "Journal/" });
    // The daily note's mood was all that changed: nothing to tell.
    expect(inJournal.content).toBe("No note was created or changed from 2026-10-05 to 2026-10-09 in Journal.");
    const one = await run(depsOf(vault()), "get_changes", { since: "2026-10-05", folder: "Projects", limit: 1 });
    expect(one.content.startsWith("Notes created or changed from 2026-10-05 to 2026-10-09 in Projects:\n- [[Plan]]")).toBe(true);
    expect(one.content).not.toContain("[[Podcast]]");
    expect(one.content.endsWith("More may have changed: ask for a shorter period or a folder.")).toBe(true);
  });

  it("asks for days and a place it can read, and is no tool where the shell keeps no index", async () => {
    const deps = depsOf(vault());
    for (const args of [{}, { since: "last week" }, { since: "2026-10-31", until: "2026-10-01" }, { since: "2026-02-30" }]) {
      expect((await run(deps, "get_changes", args)).isError, JSON.stringify(args)).toBe(true);
    }
    expect(await run(deps, "get_changes", { since: "2026-10-05", folder: "../Elsewhere" })).toMatchObject({ isError: true, content: "No folder is available at this path." });
    const none = depsOf(vault(), { noHistory: true });
    expect((await run(none, "get_changes", { since: "2026-10-05" })).isError).toBe(true);
    // Found through the tool search only where the shell has a history to read; a skill may name them.
    expect(furtherToolNames(none)).not.toContain("get_changes");
    expect(furtherToolNames(deps)).toEqual(expect.arrayContaining(["get_changes", "get_note_history"]));
    expect(SKILL_TOOL_NAMES).toEqual(expect.arrayContaining(["get_changes", "get_note_history"]));
  });

  it("shows a changed note by its beginning where the vault keeps no version history", async () => {
    const out = await run(depsOf(vault(), { noVersions: true }), "get_changes", { since: "2026-10-05" });
    expect(out.content).toContain("- [[Plan]] (Projects/Plan.md) — changed, last on 2026-10-08; no earlier state is kept on this device, its beginning:\n  > # Plan\n  > Kick-off on Monday.");
    expect(out.content).not.toContain("Budget: open.");
  });
});

describe("how one note developed", () => {
  it("tells it day by day from the version history: what each day added, what it lost as a number", async () => {
    const out = await run(depsOf(vault()), "get_note_history", { path: "Projects/Plan.md", since: "2026-10-05" });
    expect(out.isError).toBeUndefined();
    expect(out.content).toBe(
      [
        "Projects/Plan.md",
        "",
        "How it developed from 2026-10-05 to 2026-10-09, from the version history on this device:",
        "- 2026-10-06: 1 line gained, 1 line lost",
        "  > Budget: 12,000 € agreed with Tom.",
        "- 2026-10-08: 2 lines gained, 0 lines lost",
        "  > Decision: hosting at the studio.",
        "  > Ask ⟦withheld note⟧ first.",
        "",
        "A line that was deleted is counted, never shown.",
      ].join("\n"),
    );
    expect(everything(out)).not.toContain("Budget: open.");
    expect(everything(out)).not.toContain("Salary");
    expect(out.data).toMatchObject({ path: "Projects/Plan.md", since: "2026-10-05", until: "2026-10-09", made: "2026-10-01", days: [{ day: "2026-10-06", added: 1, removed: 1 }, { day: "2026-10-08", added: 2, removed: 0 }] });
  });

  it("begins a note made in the period on the day it was made — before it, it had no text", async () => {
    const out = await run(depsOf(vault()), "get_note_history", { path: "Projects/Podcast.md", since: "2026-10-05" });
    expect(out.content).toBe(
      [
        "Projects/Podcast.md",
        "",
        "How it developed from 2026-10-05 to 2026-10-09 (made on 2026-10-07), from the version history on this device:",
        "- 2026-10-07: 2 lines gained, 0 lines lost",
        "  > # Podcast",
        "  > A podcast about the studio.",
        "- 2026-10-08: 1 line gained, 0 lines lost",
        "  > Guests: Anna and Tom.",
        "",
        "A line that was deleted is counted, never shown.",
      ].join("\n"),
    );
  });

  it("trusts a kept state over the index where the index first saw the note later than it was there", async () => {
    const notes = vault();
    // A vault the index met on the 7th: the plan's history goes back further.
    notes["Projects/Plan.md"]!.created = at(7);
    const out = await run(depsOf(notes), "get_note_history", { path: "Projects/Plan.md", since: "2026-10-05" });
    expect(out.content).not.toContain("made on");
    expect(out.content).toContain("- 2026-10-06: 1 line gained, 1 line lost\n");
    const changes = await run(depsOf(notes), "get_changes", { since: "2026-10-05" });
    expect(changes.content).toContain("- [[Plan]] (Projects/Plan.md) — changed, last on 2026-10-08: 3 lines gained, 1 line lost");
  });

  it("says a day on which only its properties changed is no change, and that a note without kept versions has no history here", async () => {
    const day = await run(depsOf(vault()), "get_note_history", { path: "Journal/Week 41.md", since: "2026-10-05" });
    expect(day.content).toBe("Journal/Week 41.md\n\nNo change from 2026-10-05 to 2026-10-09.");
    expect(everything(day)).not.toContain("mood");
    const old = await run(depsOf(vault()), "get_note_history", { path: "Projects/Old.md" });
    expect(old.content).toBe("Projects/Old.md\n\nThis device keeps no earlier versions of this note; read_note has it as it is now. It was made on 2026-10-01.");
  });

  it("answers a note the rules keep from the recipient like one that is not there, and keeps to a month", async () => {
    const deps = depsOf(vault());
    const kept = await run(deps, "get_note_history", { path: "Private/Salary.md" });
    const missing = await run(deps, "get_note_history", { path: "Private/Nothing.md" });
    expect(kept).toEqual(missing);
    expect(kept.isError).toBe(true);
    expect((await run(deps, "get_note_history", { path: "Private/Salary.md" }, local)).content).toContain("salary review: 93k");
    // Without a start: the 31 days up to the end.
    expect((await run(deps, "get_note_history", { path: "Projects/Plan.md" })).data).toMatchObject({ since: "2026-09-09", until: "2026-10-09" });
    expect(await run(deps, "get_note_history", { path: "Projects/Plan.md", since: "2026-09-01" })).toMatchObject({ isError: true, content: "At most 31 days per call: give a later since." });
    expect((await run(deps, "get_note_history", { path: "Projects/Plan.md", since: "2026-10-09", until: "2026-10-05" })).isError).toBe(true);
  });
});
