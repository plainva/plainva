import { describe, expect, it } from "vitest";
import {
  availableTaskNotePath, classifyTaskNotes, displacedTaskPath, isOwnLegacyTaskNoteName, parseLegacyTaskNoteName, preserveDisplacedTask,
  readTaskNoteIdentity, taskNoteKey, taskNotePath, taskNoteStem, taskNotesEquivalent,
} from "../src/pim/taskNoteIdentity.js";
import { mergeText } from "../src/conflict-resolver.js";
import { sha256Hex, utf8Encode } from "../src/workspace/encoding.js";

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
  });

  it("names a mirrored task by its title alone, numbered like any other note (E11)", () => {
    expect(taskNotePath("Tasks", "Daily task")).toBe("Tasks/Daily task.md");
    expect(taskNotePath("Tasks/", "Daily task", 2)).toBe("Tasks/Daily task 2.md");
    expect(taskNotePath("", "Daily task", 3)).toBe("Daily task 3.md");
    // Reserved characters, control characters, trailing dots and spaces, length.
    expect(taskNoteStem('A/B: "C"?\tD. . ')).toBe("A B C D");
    expect(taskNoteStem("")).toBe("Task");
    expect(taskNoteStem(" ... ")).toBe("Task");
    expect([...taskNoteStem("x".repeat(79) + " yyy")].length).toBe(79);
    expect(taskNoteStem("😀".repeat(100))).toBe("😀".repeat(80));
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

  it("decides by the anchor whether a name is free, and never overwrites a foreign file", async () => {
    const v = vault(), key = readTaskNoteIdentity(note())!;
    expect(await availableTaskNotePath(v, "Tasks", "Daily task", key)).toBe("Tasks/Daily task.md");
    // A person's own note of that name: the task takes the next number.
    v.files.set("Tasks/Daily task.md", "A foreign note");
    expect(await availableTaskNotePath(v, "Tasks", "Daily task", key)).toBe("Tasks/Daily task 2.md");
    // Another task there as well: one further.
    v.files.set("Tasks/Daily task 2.md", note("day-b"));
    expect(await availableTaskNotePath(v, "Tasks", "Daily task", key)).toBe("Tasks/Daily task 3.md");
    // The same task, written by an earlier run on this or another device: reused.
    v.files.set("Tasks/Daily task 3.md", note("day-a", "device-b"));
    expect(await availableTaskNotePath(v, "Tasks", "Daily task", key)).toBe("Tasks/Daily task 3.md");
    expect(v.files.get("Tasks/Daily task.md")).toBe("A foreign note");
    expect(v.files.get("Tasks/Daily task 2.md")).toBe(note("day-b"));
  });

  it("counts a name that differs only in case or Unicode spelling as taken", async () => {
    const v = vault(), key = readTaskNoteIdentity(note())!;
    v.files.set("Tasks/daily TASK.md", note("day-b"));
    expect(await availableTaskNotePath(v, "Tasks", "Daily task", key, { known: v.files.keys() })).toBe("Tasks/Daily task 2.md");
    // The same task under its twin's spelling is the note to reuse.
    v.files.set("Tasks/daily TASK.md", note());
    expect(await availableTaskNotePath(v, "Tasks", "Daily task", key, { known: v.files.keys() })).toBe("Tasks/daily TASK.md");
    const u = vault();
    u.files.set("Tasks/Bücher.md", note("day-b"));
    expect(await availableTaskNotePath(u, "Tasks", "Bücher", key, { known: u.files.keys() })).toBe("Tasks/Bücher 2.md");
  });

  it("gives a displaced task the next number of its title, never the place it leaves", async () => {
    const v = vault(), source = note("day-a", "device-a", "User text\n");
    v.files.set("Tasks/Daily task.md", source);
    expect(await displacedTaskPath(v, "Tasks/Daily task.md", source)).toBe("Tasks/Daily task 2.md");
    // Displaced from "… 2" while the plain name is free: it takes the plain name.
    v.files.delete("Tasks/Daily task.md");
    v.files.set("Tasks/Daily task 2.md", source);
    expect(await displacedTaskPath(v, "Tasks/Daily task 2.md", source)).toBe("Tasks/Daily task.md");
  });

  it("recognises only the names it gave itself", () => {
    const key = readTaskNoteIdentity(note())!;
    const hash = sha256Hex(utf8Encode(taskNoteKey(key)));
    expect(parseLegacyTaskNoteName(`Tasks/Daily task — ${hash.slice(0, 16)}.md`)).toEqual({ folder: "Tasks", stem: "Daily task", hex: hash.slice(0, 16) });
    expect(parseLegacyTaskNoteName(`Daily — part — ${hash}.md`)).toEqual({ folder: "", stem: "Daily — part", hex: hash });
    expect(parseLegacyTaskNoteName("Tasks/Daily task — 0123.md")).toBeNull();
    expect(parseLegacyTaskNoteName(`Tasks/Daily task — ${hash.slice(0, 16).toUpperCase()}.md`)).toBeNull();
    expect(parseLegacyTaskNoteName(`Tasks/Daily task - ${hash.slice(0, 16)}.md`)).toBeNull();
    expect(parseLegacyTaskNoteName(`Tasks/— ${hash.slice(0, 16)}.md`)).toBeNull();
    expect(isOwnLegacyTaskNoteName(`Tasks/Daily task — ${hash.slice(0, 16)}.md`, note())).toBe(true);
    expect(isOwnLegacyTaskNoteName(`Tasks/Daily task — ${hash}.md`, note())).toBe(true);
    // The anchor of ANOTHER task: a copied or hand-made name, not ours.
    expect(isOwnLegacyTaskNoteName(`Tasks/Daily task — ${hash.slice(0, 16)}.md`, note("day-b"))).toBe(false);
    // A person's note with an id-like suffix and no anchor.
    expect(isOwnLegacyTaskNoteName(`Plan — ${hash.slice(0, 16)}.md`, "# Plan\n")).toBe(false);
    expect(isOwnLegacyTaskNoteName("Tasks/Daily task.md", note())).toBe(false);
  });

  it("resumes after copying, preserves exact bytes and blocks a changed destination", async () => {
    const v = vault(), source = note("day-a", "device-a", "User text\n");
    v.files.set("Tasks/Daily task.md", source);
    const path = await preserveDisplacedTask(v, "Tasks/Daily task.md", source);
    expect(path).toBe("Tasks/Daily task 2.md");
    expect(await preserveDisplacedTask(v, "Tasks/Daily task.md", source)).toBe(path);
    expect(v.files.get(path)).toBe(source);
    expect(v.files.size).toBe(2);
    v.files.set(path, source + "Another edit\n");
    await expect(preserveDisplacedTask(v, "Tasks/Daily task.md", source)).rejects.toThrow("task_destination_changed");
    expect(v.files.get("Tasks/Daily task.md")).toBe(source);
    expect(v.files.get(path)).toContain("Another edit");
  });
});
