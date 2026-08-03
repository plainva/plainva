import { describe, it, expect } from "vitest";
import { setNoteTaskExclusion } from "@plainva/ui";
import { setFrontmatterPath, deleteFrontmatterPath } from "@plainva/core";

const ops = { setFrontmatterPath, deleteFrontmatterPath };

/**
 * Hiding a note from the task overview (S31).
 *
 * The asymmetry is the point: hiding WRITES `plainva.tasks: false`, unhiding
 * DELETES the key rather than writing `true`. A note that was never hidden and
 * a note that was unhidden must end up byte-identical — otherwise every note
 * the user ever glanced at carries a marker forever, and the file diff in a
 * synced vault shows work that did not happen.
 */
describe("setNoteTaskExclusion", () => {
  it("writes the marker into the plainva namespace", () => {
    const out = setNoteTaskExclusion("---\ntype: note\n---\n\n- [ ] a\n", true, ops);
    expect(out).toContain("tasks: false");
    expect(out).toContain("- [ ] a");
  });

  it("removes the marker again instead of writing true", () => {
    const hidden = setNoteTaskExclusion("---\ntype: note\n---\n\nbody\n", true, ops);
    const back = setNoteTaskExclusion(hidden, false, ops);
    expect(back).not.toContain("tasks:");
    // Round trip is lossless: what was never hidden and what was unhidden match.
    expect(back).toBe("---\ntype: note\n---\n\nbody\n");
  });

  it("leaves a note without frontmatter alone when unhiding", () => {
    const raw = "# Plain\n\n- [ ] a\n";
    expect(setNoteTaskExclusion(raw, false, ops)).toBe(raw);
  });

  it("keeps the rest of the plainva namespace when unhiding", () => {
    const raw = "---\nplainva:\n  tasks: false\n  icon: 📌\n---\n\nbody\n";
    const out = setNoteTaskExclusion(raw, false, ops);
    expect(out).not.toContain("tasks:");
    expect(out).toContain("icon:");
  });
});
