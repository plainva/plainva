import { describe, expect, it, vi } from "vitest";
import { dailyTemplatePath, ensureDailyNote, noteStamp, type DailyNoteCreateConfig, type DailyNoteFiles } from "@plainva/ui";

/**
 * Plan Journal, J2: resolve-or-create for the daily note, shared by both
 * shells. The desktop's wrapper keeps its own tests (services/dailyNotes.test.ts);
 * these pin what the phone gained when it moved onto the same rule.
 */

const CONFIG: DailyNoteCreateConfig = { folder: "Tagebuch", format: "YY.MM.DD", templateFolder: "Vorlagen/", template: "Tag.md", noteType: "Journal Entry" };

function memoryFiles(seed: Record<string, string> = {}): DailyNoteFiles & { files: Map<string, string> } {
  const files = new Map(Object.entries(seed));
  return {
    files,
    exists: async (path) => files.has(path),
    readTextFile: async (path) => {
      const text = files.get(path);
      if (text === undefined) throw new Error(`missing ${path}`);
      return text;
    },
    createNote: async (path, content) => { files.set(path, content); },
  };
}

describe("ensureDailyNote", () => {
  it("returns the existing note untouched", async () => {
    const files = memoryFiles({ "Tagebuch/26.09.20.md": "mine" });
    const createNote = vi.spyOn(files, "createNote");
    expect(await ensureDailyNote(new Date(2026, 8, 20), CONFIG, files)).toEqual({ path: "Tagebuch/26.09.20.md", title: "26.09.20", created: false, content: null, cursor: null });
    expect(createNote).not.toHaveBeenCalled();
  });

  it("reads the template against the day the note is FOR, with the time of creation", async () => {
    const files = memoryFiles({ "Vorlagen/Tag.md": "# {{title}}\n{{date}} {{time}}\n" });
    const lastTuesday = new Date(2026, 8, 15);
    const result = await ensureDailyNote(lastTuesday, CONFIG, files, { now: new Date(2026, 8, 20, 7, 45) });
    expect(result?.created).toBe(true);
    expect(files.files.get("Tagebuch/26.09.15.md")).toContain("# 26.09.15\n2026-09-15 07:45\n");
  });

  it("applies the template headless without a resolver: questions resolve to nothing, the cursor token goes", async () => {
    const files = memoryFiles({ "Vorlagen/Tag.md": "Mood: {{prompt:Mood}}\n{{cursor}}## Journal\n" });
    const result = await ensureDailyNote(new Date(2026, 8, 20), CONFIG, files);
    expect(result?.content).toContain("Mood: \n## Journal\n");
    expect(result?.cursor).toBeNull();
  });

  it("asks through the resolver when a person opens the note, and creates nothing when they cancel", async () => {
    const files = memoryFiles({ "Vorlagen/Tag.md": "Mood: {{prompt:Mood}}" });
    const cancelled = await ensureDailyNote(new Date(2026, 8, 20), CONFIG, files, { resolveTemplate: async () => null });
    expect(cancelled).toBeNull();
    expect(files.files.has("Tagebuch/26.09.20.md")).toBe(false);

    const resolveTemplate = vi.fn(async () => ({ text: "Mood: fine\nhere", cursor: 11 }));
    const answered = await ensureDailyNote(new Date(2026, 8, 20), CONFIG, files, { resolveTemplate });
    expect(resolveTemplate).toHaveBeenCalledWith("Mood: {{prompt:Mood}}", expect.objectContaining({ title: "26.09.20", folder: "Tagebuch" }));
    // The caret was measured in the template body; the file carries frontmatter in front of it.
    const content = answered!.content!;
    expect(content.slice(answered!.cursor!)).toBe("here");
  });

  it("gives a blank note the configured type and an H1 with the date", async () => {
    const files = memoryFiles();
    const result = await ensureDailyNote(new Date(2026, 8, 20), { ...CONFIG, template: "" }, files);
    expect(result?.content).toMatch(/^---\n[\s\S]*type: Journal Entry[\s\S]*---\n/);
    expect(result?.content?.endsWith("# 26.09.20\n")).toBe(true);
  });

  it("falls back to the blank note when the named template is missing, and lets a template's own type win", async () => {
    const blank = await ensureDailyNote(new Date(2026, 8, 20), CONFIG, memoryFiles());
    expect(blank?.content).toContain("# 26.09.20");
    const typed = await ensureDailyNote(new Date(2026, 8, 20), CONFIG, memoryFiles({ "Vorlagen/Tag.md": "---\ntype: Log\n---\nbody\n" }));
    expect(typed?.content).toContain("type: Log");
    expect(typed?.content).not.toContain("Journal Entry");
  });

  it("asks before creating when the caller wants that", async () => {
    const files = memoryFiles();
    expect(await ensureDailyNote(new Date(2026, 8, 20), CONFIG, files, { confirmCreate: async () => false })).toBeNull();
    expect(files.files.size).toBe(0);
  });
});

describe("helpers", () => {
  it("joins template folder and name whatever slashes the setting carries", () => {
    expect(dailyTemplatePath(CONFIG)).toBe("Vorlagen/Tag.md");
    expect(dailyTemplatePath({ templateFolder: "", template: "Tag.md" })).toBe("Tag.md");
    expect(dailyTemplatePath({ templateFolder: "Vorlagen", template: " " })).toBe("");
  });

  it("stamps the note's day with the current wall-clock time", () => {
    const stamp = noteStamp(new Date(2026, 6, 29), new Date(2026, 8, 20, 9, 30, 15));
    expect([stamp.getFullYear(), stamp.getMonth(), stamp.getDate(), stamp.getHours(), stamp.getMinutes()]).toEqual([2026, 6, 29, 9, 30]);
  });
});
