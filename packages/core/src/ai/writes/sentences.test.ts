import { describe, expect, it } from "vitest";
import { EFFECT_DECLINED } from "../orchestrator.js";
import { PLAN_TOOL_NAMES, PROPOSAL_TOOL_NAMES, toolByName } from "../tools.js";
import { applyNoteEdits, appendToNote } from "./edits.js";
import { WRITE_REFUSALS, WRITE_RESULTS, editProblemSentence } from "./sentences.js";

describe("what a writing tool answers a model with", () => {
  it("has a sentence for every way an edit can fail, and names the edit where one of them is the reason", () => {
    const base = "# Plan\n\nOne line.\n\nOne line.\n";
    const ambiguous = applyNoteEdits(base, [
      { find: "# Plan", replace: "# The plan" },
      { find: "One line.", replace: "Another." },
    ]);
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) expect(editProblemSentence(ambiguous.problem, ambiguous.edit)).toBe(`Edit 2: ${WRITE_REFUSALS.ambiguous}`);
    const missing = applyNoteEdits(base, [{ find: "Nowhere", replace: "x" }]);
    if (!missing.ok) expect(editProblemSentence(missing.problem, missing.edit)).toBe(`Edit 1: ${WRITE_REFUSALS["not-found"]}`);
    // What is about the whole proposal names no edit.
    expect(editProblemSentence("unchanged", 0)).toBe(WRITE_REFUSALS.unchanged);
    expect(editProblemSentence("too-many", 3)).toBe(WRITE_REFUSALS["too-many"]);
    const noSection = appendToNote(base, "More.", "Costs");
    expect(noSection.ok).toBe(false);
    if (!noSection.ok) expect(editProblemSentence(noSection.problem, noSection.edit)).toBe(WRITE_REFUSALS["no-section"]);
  });

  it("answers a note the rules keep away in the words of a note that is not there", () => {
    // One sentence for both: nothing in it tells them apart.
    expect(WRITE_REFUSALS["no-note"]).toBe("No note is available at this path.");
    expect(WRITE_REFUSALS["no-folder"]).toBe("There is no such folder in the vault.");
  });

  it("says after every write that nothing has changed yet, and how many — never what", () => {
    expect(WRITE_RESULTS.proposed("Projects/Offer.md", 1, 0)).toBe("Proposed on Projects/Offer.md: 1 change. Nothing in the vault has changed. The user accepts or declines each change in Plainva.");
    expect(WRITE_RESULTS.proposed("Projects/Offer.md", 3, 2)).toBe(
      "Proposed on Projects/Offer.md: 3 changes. Nothing in the vault has changed. The user accepts or declines each change in Plainva. Web addresses you added were made inert: the user sees them as text.",
    );
    expect(WRITE_RESULTS.drafted('a note "Kick-off"', 0)).toBe('Drafted: a note "Kick-off". Nothing in the vault has changed. It exists once the user creates it from the draft in Plainva.');
    expect(WRITE_RESULTS.drafted("a journal entry", 1)).toContain("made inert");
    expect(WRITE_RESULTS.renamed("Projects/Offer 2027.md")).toBe("Renamed. The note is now Projects/Offer 2027.md.");
    expect(WRITE_RESULTS.moved("Archive/Offer.md")).toBe("Moved. The note is now Archive/Offer.md.");
    expect(WRITE_RESULTS.deleted).toBe("The user deleted the note.");
  });

  it("never claims a deletion, a rename or a move for the assistant: those are plans, and plans are critical", () => {
    for (const name of PLAN_TOOL_NAMES) expect(toolByName(name)?.risk, name).toBe("critical");
    for (const name of PROPOSAL_TOOL_NAMES) expect(toolByName(name)?.risk, name).toBe("write");
    // The words a model reads for a no and for nobody being there are two: it must not take silence for a refusal of the user.
    expect(WRITE_REFUSALS.declined).not.toBe(WRITE_REFUSALS.nobody);
    // A no to a plan is the run's own "declined": the step shows it as one.
    expect(WRITE_REFUSALS.declined).toBe(EFFECT_DECLINED);
  });
});
