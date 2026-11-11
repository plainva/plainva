import { describe, expect, it } from "vitest";
import { conflictCopyLabel, conflictCopyTime } from "@plainva/ui";

// Finding X10 (review 2026-11-10): the conflict notices printed the raw file
// name `….CONFLICT-2026-08-02T09-05-12-345Z.md`. They now name the note and
// when the copy was made.
describe("conflictCopyLabel", () => {
  it("reads the time of a sync worker's copy and of an editor's copy", () => {
    expect(conflictCopyTime("Inbox/Notiz 1.CONFLICT-2026-08-02T09-05-12-345Z.md")?.toISOString()).toBe("2026-08-02T09:05:12.345Z");
    expect(conflictCopyTime("Inbox/Notiz 1.CONFLICT-2026-08-02T09-05-12-345Z-1a2b3c4d.md")?.toISOString()).toBe("2026-08-02T09:05:12.345Z");
    expect(conflictCopyTime("Inbox/Notiz 1.md")).toBeNull();
  });

  it("names the note and the moment, never the raw stamp", () => {
    const label = conflictCopyLabel("Inbox/Notiz 1.CONFLICT-2026-08-02T09-05-12-345Z.md", "en", { hourCycle: "h23" });
    expect(label.startsWith("Notiz 1 · ")).toBe(true);
    expect(label).toContain("2026");
    expect(label).not.toContain("CONFLICT");
    expect(label).not.toContain(".md");
    expect(label).toMatch(/\d{2}:\d{2}:\d{2}$/);
  });

  it("tells two copies of one note in the same minute apart", () => {
    const a = conflictCopyLabel("Start.CONFLICT-2026-11-11T09-30-02-825Z-e759cc6e.md", "en", { hourCycle: "h23", timeZone: "UTC" });
    const b = conflictCopyLabel("Start.CONFLICT-2026-11-11T09-30-41-696Z-7b7457a8.md", "en", { hourCycle: "h23", timeZone: "UTC" });
    expect(a).not.toBe(b);
    expect(a).toMatch(/09:30:02$/);
  });

  it("keeps a database's extension, which says what the copy is", () => {
    expect(conflictCopyLabel("Tasks.CONFLICT-2026-07-05T12-30-00-000Z.base", "de", { hourCycle: "h23" })).toMatch(/^Tasks\.base · /);
  });

  it("leaves a path alone that is no conflict copy", () => {
    expect(conflictCopyLabel("Notes/a.md", "de")).toBe("Notes/a.md");
  });

  it("falls back to the name for a copy without a readable stamp", () => {
    expect(conflictCopyLabel("Notes/a.CONFLICT-old.md", "de")).toBe("a");
  });
});
