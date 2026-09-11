import { describe, expect, it } from "vitest";
import { availableTaskNotePath, classifyTaskNotes, preserveDisplacedTask, readTaskNoteIdentity, taskNotePath, taskNotesEquivalent } from "../src/pim/taskNoteIdentity.js";
import { mergeText } from "../src/conflict-resolver.js";

const note = (uid = "day-a", account = "device-a", extra = "") => `---\nplainva:\n  pim:\n    kind: task\n    provider: google\n    identity: google:subject-a\n    list: list-a\n    uid: ${uid}\n    account: ${account}\ngenerated:\n  by: plainva-task-sync/1.0\n  at: 2026-09-11\ncustom: preserved\n---\n# Daily task\n${extra}`;

function vault() {
  const files = new Map<string, string>();
  return { files, exists: async (p: string) => files.has(p), readTextFile: async (p: string) => {
    if (!files.has(p)) throw new Error("missing");
    return files.get(p)!;
  }, writeTextFile: async (p: string, c: string) => { files.set(p, c); } };
}

describe("provider task files", () => {
  it("uses the complete stable identity, never the title or local account id", () => {
    expect(classifyTaskNotes(note(), note("day-b"))).toBe("different");
    expect(classifyTaskNotes(note(), note("day-a", "another-device"))).toBe("same");
    const key = readTaskNoteIdentity(note())!;
    expect(taskNotePath("Tasks", "Daily task", key)).toBe(taskNotePath("Tasks", "Daily task", readTaskNoteIdentity(note("day-a", "other"))!));
    expect(taskNotePath("Tasks", "Daily task", key)).not.toBe(taskNotePath("Tasks", "Daily task", { ...key, uid: "day-b" }));
    expect(taskNotePath("Tasks", "Daily task", key)).not.toBe(taskNotePath("Tasks", "Daily task", { ...key, identity: "google:subject-b" }));
  });

  it("keeps incomplete legacy identity conservative", () => {
    expect(classifyTaskNotes(note().replace("    identity: google:subject-a\n", ""), note("day-b"))).toBe("unknown");
    expect(classifyTaskNotes("---\nplainva: [invalid\n---\n", note())).toBe("unknown");
  });

  it("does not merge different tasks even if their changes do not overlap", () => {
    expect(mergeText(note(), note("day-b"), note("day-a", "device-a", "New text")).hasConflicts).toBe(true);
  });

  it("ignores only known technical fields for the same identity", () => {
    const b = note("day-a", "device-b").replace("plainva-task-sync/1.0", "plainva-task-sync/2.0").replace("2026-09-11", "2026-09-12");
    expect(taskNotesEquivalent(note(), b)).toBe(true);
    expect(taskNotesEquivalent(note(), b.replace("custom: preserved", "custom: user edit"))).toBe(false);
    const merged = mergeText(note(), note("day-a", "device-a", "My text"), b);
    expect(merged.hasConflicts).toBe(false);
    expect(merged.mergedText).toContain("My text");
    expect(merged.mergedText).toContain("custom: preserved");
  });

  it("checks shortened-hash collisions and never overwrites a foreign file", async () => {
    const v = vault(), key = readTaskNoteIdentity(note())!;
    v.files.set(taskNotePath("Tasks", "Daily task", key), "A foreign note");
    expect(await availableTaskNotePath(v, "Tasks", "Daily task", key)).toBe(taskNotePath("Tasks", "Daily task", key, true));
    expect([...v.files.values()]).toEqual(["A foreign note"]);
  });

  it("resumes after copying, preserves exact bytes and blocks a changed destination", async () => {
    const v = vault(), source = note("day-a", "device-a", "User text\n");
    v.files.set("Tasks/Daily task.md", source);
    const path = await preserveDisplacedTask(v, "Tasks/Daily task.md", source);
    expect(await preserveDisplacedTask(v, "Tasks/Daily task.md", source)).toBe(path);
    expect(v.files.get(path)).toBe(source);
    expect(v.files.size).toBe(2);
    v.files.set(path, source + "Another edit\n");
    await expect(preserveDisplacedTask(v, "Tasks/Daily task.md", source)).rejects.toThrow("task_destination_changed");
    expect(v.files.get("Tasks/Daily task.md")).toBe(source);
    expect(v.files.get(path)).toContain("Another edit");
  });
});
