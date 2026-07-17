import { describe, it, expect } from "vitest";
import { scanTasks } from "@plainva/core";
import { toggleTaskAtIndex } from "@plainva/ui";
import { taskTextToTitle, taskFileStem, replaceCheckboxWithLink, promoteTask, type PromoteTaskOptions } from "./taskPromotion";
import { buildTaskDbFile } from "./taskDatabase";

const DB_LABELS = { viewTable: "Tabelle", viewBoard: "Board", dueKey: "frist", statusOptions: ["Offen", "In Arbeit", "Erledigt"] as [string, string, string] };

function memoryAdapter(seed: Record<string, string>) {
  const files = new Map<string, string>(Object.entries(seed));
  return {
    files,
    adapter: {
      readTextFile: async (p: string) => {
        const c = files.get(p);
        if (c === undefined) throw new Error("not found: " + p);
        return c;
      },
      writeTextFile: async (p: string, c: string) => { files.set(p, c); },
      exists: async (p: string) => files.has(p),
    },
  };
}

function promoteOpts(overrides: Partial<PromoteTaskOptions>): PromoteTaskOptions {
  return {
    adapter: undefined as unknown as PromoteTaskOptions["adapter"],
    sourcePath: "Notes/Plan.md",
    task: { ordinal: 0, text: "", tags: [], due: null, done: false },
    dbPath: "Aufgaben.base",
    noteType: "Task",
    allNotePaths: [],
    fallbackTitle: "Aufgabe",
    ...overrides,
  };
}

describe("taskTextToTitle", () => {
  it("strips #tags and 📅 due markers and collapses whitespace", () => {
    expect(taskTextToTitle("Call **client** #work #urgent 📅 2026-08-01")).toBe("Call **client**");
    expect(taskTextToTitle("#only #tags 📅 2026-01-01")).toBe("");
    // Mid-word # survives (same char-class rule as the task scanner).
    expect(taskTextToTitle("Fix C# build")).toBe("Fix C# build");
  });
});

describe("taskFileStem", () => {
  it("caps long titles at a word boundary", () => {
    const long = "This is a very long task sentence that keeps going on and on far beyond sixty characters";
    const stem = taskFileStem(long)!;
    expect(stem.length).toBeLessThanOrEqual(60);
    expect(stem.endsWith(" ")).toBe(false);
    expect(long.startsWith(stem)).toBe(true);
  });

  it("returns null for names without usable characters", () => {
    expect(taskFileStem("///")).toBeNull();
  });
});

describe("replaceCheckboxWithLink", () => {
  it("replaces the nth checkbox and keeps indentation, bullet and blockquote markers", () => {
    const content = "- [ ] first\n> * [x] quoted\n  1. [ ] nested\n";
    const r = replaceCheckboxWithLink(content, 1, "Aufgaben/Quoted", "Quoted");
    expect(r.changed).toBe(true);
    expect(r.content.split("\n")[1]).toBe("> * [[Aufgaben/Quoted|Quoted]]");
    // The untouched neighbours keep their ordinals for the shared toggle.
    expect(scanTasks(r.content).map((t) => t.text)).toEqual(["first", "nested"]);
  });

  it("skips checkboxes inside fenced code and emits no alias when it equals the target", () => {
    const content = "```\n- [ ] in fence\n```\n- [ ] real\n";
    const r = replaceCheckboxWithLink(content, 0, "real task", "real task");
    expect(r.changed).toBe(true);
    expect(r.content).toContain("- [[real task]]");
    expect(r.content).toContain("- [ ] in fence");
  });

  it("counts exactly like toggleTaskAtIndex", () => {
    const content = "- [ ] a\n```\n- [ ] fenced\n```\n> - [x] b\n- [ ] c\n";
    const toggled = toggleTaskAtIndex(content, 2, true).content;
    const replaced = replaceCheckboxWithLink(content, 2, "X").content;
    // Both operate on the same physical line (the "c" line).
    const changedToggle = toggled.split("\n").findIndex((l, i) => l !== content.split("\n")[i]);
    const changedReplace = replaced.split("\n").findIndex((l, i) => l !== content.split("\n")[i]);
    expect(changedToggle).toBe(changedReplace);
  });

  it("reports changed=false for an out-of-range ordinal", () => {
    expect(replaceCheckboxWithLink("- [ ] a\n", 5, "X").changed).toBe(false);
  });
});

describe("promoteTask", () => {
  const db = buildTaskDbFile("Aufgaben", DB_LABELS);

  it("creates the note in the database folder and rewrites the source line", async () => {
    const { adapter, files } = memoryAdapter({
      "Aufgaben.base": db.content,
      "Notes/Plan.md": "# Plan\n\n- [ ] Call client #work 📅 2026-08-01\n- [ ] other\n",
    });
    const res = await promoteTask(promoteOpts({
      adapter,
      task: { ordinal: 0, text: "Call client #work 📅 2026-08-01", tags: ["work"], due: "2026-08-01", done: false },
      allNotePaths: ["Notes/Plan.md"],
    }));
    expect(res).toMatchObject({ ok: true, notePath: "Aufgaben/Call client.md", title: "Call client" });

    const note = files.get("Aufgaben/Call client.md")!;
    expect(note).toContain("type: Task");
    expect(note).toContain("frist: 2026-08-01");
    expect(note).toContain("status: Offen");
    expect(note).toContain('source: "[[Plan]]"');
    expect(note).toContain("- work");
    expect(note).toContain("# Call client");

    const source = files.get("Notes/Plan.md")!;
    expect(source).toContain("- [[Call client]]");
    expect(source).not.toContain("- [ ] Call client");
    // The remaining checkbox keeps working through the shared toggle.
    expect(scanTasks(source).map((t) => t.text)).toEqual(["other"]);
  });

  it("does not guess a status for a done checkbox and dedupes colliding names", async () => {
    const { adapter, files } = memoryAdapter({
      "Aufgaben.base": db.content,
      "Aufgaben/Ship it.md": "existing",
      "Notes/Plan.md": "- [x] Ship it\n",
    });
    const res = await promoteTask(promoteOpts({
      adapter,
      task: { ordinal: 0, text: "Ship it", tags: [], due: null, done: true },
    }));
    expect(res).toMatchObject({ ok: true, notePath: "Aufgaben/Ship it 2.md" });
    const note = files.get("Aufgaben/Ship it 2.md")!;
    expect(note).not.toContain("status:");
    expect(files.get("Aufgaben/Ship it.md")).toBe("existing");
  });

  it("refuses on a stale ordinal without touching any file", async () => {
    const { adapter, files } = memoryAdapter({
      "Aufgaben.base": db.content,
      "Notes/Plan.md": "- [ ] changed meanwhile\n",
    });
    const before = new Map(files);
    const res = await promoteTask(promoteOpts({ adapter, task: { ordinal: 0, text: "original text", tags: [], due: null, done: false } }));
    expect(res).toEqual({ ok: false, reason: "stale" });
    expect(files).toEqual(before);
  });

  it("reports a database without a resolvable storage folder", async () => {
    const { adapter } = memoryAdapter({
      // Two folder sources and no persisted newItemFolder -> pending choice.
      "Aufgaben.base": db.content.replace('- file.folder == "Aufgaben"', '- file.folder == "A"\n    - file.folder == "B"'),
      "Notes/Plan.md": "- [ ] task\n",
    });
    const res = await promoteTask(promoteOpts({ adapter, task: { ordinal: 0, text: "task", tags: [], due: null, done: false } }));
    expect(res).toEqual({ ok: false, reason: "noFolder" });
  });

  it("uses a qualified link with alias when the basename collides", async () => {
    const { adapter, files } = memoryAdapter({
      "Aufgaben.base": db.content,
      "Notes/Plan.md": "- [ ] Review\n",
      "Elsewhere/Review.md": "collision",
    });
    const res = await promoteTask(promoteOpts({
      adapter,
      task: { ordinal: 0, text: "Review", tags: [], due: null, done: false },
      allNotePaths: ["Notes/Plan.md", "Elsewhere/Review.md"],
    }));
    expect(res).toMatchObject({ ok: true, notePath: "Aufgaben/Review.md" });
    expect(files.get("Notes/Plan.md")).toContain("- [[Aufgaben/Review|Review]]");
  });
});
