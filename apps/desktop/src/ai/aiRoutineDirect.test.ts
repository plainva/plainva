// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { WRITE_REFUSALS } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import { LOCAL, chat } from "./mcpSessionHarness";
import { at, ownSkill, routineSession, routineVault, toolNames } from "./routineSessionHarness";

/**
 * Routines and "Change without asking" (plan "KI direkt schreiben", W4, E3): a
 * routine may change and create notes in the folders whose rule lets it — the
 * rule is the yes nobody is there to give —, writes nothing anywhere else, and
 * leaves no suggestion and no draft for nobody. What its run changed stands in
 * its row, with Undo.
 */

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterEach(() => {
  vi.useRealTimers();
});

const SKILL = ".agent/skills/tidy";
const JOURNAL_RULE = 'folders:\n  "Journal/":\n    write: direct\n';
const NOTES = { "Journal/Today.md": "# Today\n\nWrote the offer.\n", "Projects/Plan.md": "# Plan\n\nStep one.\n" };
const TIDY = ownSkill("tidy", "read_note propose_edit", "Tidy the notes.");

async function setUp(policy: string | undefined, script: ReturnType<typeof chat>[]) {
  const vault = routineVault({ ...NOTES, [`${SKILL}/SKILL.md`]: TIDY }, { ...(policy ? { policy } : {}), direct: true });
  const h = await routineSession(script, vault, { model: LOCAL });
  const files = Object.fromEntries((await h.s.refreshSkills()).find((entry) => entry.source.id === SKILL)!.source.files.map((file) => [file.path, file.sha256]));
  expect(await h.s.approveInstruction(SKILL, files)).toBe(true);
  return { vault, h };
}

describe("a routine in a vault with a folder that lets changes go without asking", () => {
  it("changes notes there, refuses everywhere else, and keeps what it changed for Undo", async () => {
    const { vault, h } = await setUp(JOURNAL_RULE, [
      chat({
        calls: [
          { id: "c1", name: "propose_edit", args: { path: "Journal/Today.md", append: "Tidied." } },
          { id: "c2", name: "propose_edit", args: { path: "Projects/Plan.md", append: "Not here." } },
        ],
      }),
      chat({ text: "Tidied the journal." }),
    ]);
    const { preview } = await h.setUp({ name: "Tidy", skill: SKILL });
    expect(preview.direct).toBe(true);
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    // The writing tools went along in its own list, and nothing that renames, moves or deletes.
    const offered = toolNames(h.sent[0]);
    expect(offered).toContain("propose_edit");
    expect(offered.filter((name) => ["rename_note", "move_note", "delete_note", "find_tools", "call_tool"].includes(name))).toEqual([]);
    expect(vault.file("Journal/Today.md")).toBe("# Today\n\nWrote the offer.\n\nTidied.\n");
    expect(vault.file("Projects/Plan.md")).toBe("# Plan\n\nStep one.\n");
    const routine = h.s.getState().routines.list.find((candidate) => candidate.name === "Tidy")!;
    expect(routine.last?.applied).toEqual([expect.objectContaining({ path: "Journal/Today.md", by: "folder" })]);
    // The model heard why the other note stayed as it was.
    expect(JSON.stringify(h.sent[1]?.body)).toContain(WRITE_REFUSALS["not-direct"].slice(0, 60));

    // Undo in its row puts the version back, and the row says it was taken back.
    expect(await h.s.undoRoutineDirect(routine.id)).toEqual({ undone: ["Journal/Today.md"], changed: [], failed: [] });
    expect(vault.file("Journal/Today.md")).toBe("# Today\n\nWrote the offer.\n");
    expect(h.s.getState().routines.list.find((candidate) => candidate.id === routine.id)!.last?.applied?.[0]?.undone).toBe(true);
  });

  it("without such a folder, a skill that changes notes is no routine, and a routine only reads", async () => {
    const { h } = await setUp(undefined, []);
    expect(await h.s.hasDirectFolders()).toBe(false);
    const outcome = await h.s.routinePreview({ name: "Tidy", skill: SKILL, request: "", days: [1, 2, 3, 4, 5], time: "07:00", missed: "catch-up", onlyWhenChanged: false, choice: LOCAL });
    expect(outcome).toEqual({ kind: "refused", reason: "skill" });
  });
});
