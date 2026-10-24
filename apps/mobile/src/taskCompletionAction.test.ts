import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ticking a task off, from either caller.
 *
 * The point of the shared path: for a repeating task, checking the box is what
 * CREATES the next one. Two callers doing that in two places would drift into
 * two different answers, so this pins the whole chain — write, spawn, due date.
 */

/**
 * The clock is frozen, because the fixtures carry a FIXED due date while
 * `from: due` deliberately skips an overdue task forward to the next date in
 * the FUTURE. Without this the suite passes until the calendar reaches that
 * date and then fails every day after — which is what happened on 2026-08-19,
 * with nothing in the diff. The desktop twin froze its clock on 2026-08-18;
 * this is the same fix on the mobile side.
 *
 * Only `Date` is faked, so `await` still resolves on real microtasks.
 */
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-13T12:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

const { files, settings, adapter, saveFault } = vi.hoisted(() => ({
  files: new Map<string, string>(),
  settings: { taskDatabase: "Tasks.base" },
  adapter: {},
  saveFault: { after: null as null | ((path: string, content: string) => void) },
}));

vi.mock("./services/mobileSettings", () => ({ getMobileSettings: () => settings }));
vi.mock("./services/vaultService", () => {
  const read = async (_v: unknown, p: string) => {
    const c = files.get(p);
    if (c === undefined) throw new Error(`missing ${p}`);
    return c;
  };
  const save = async (_v: unknown, p: string, c: string) => {
    files.set(p, c);
    saveFault.after?.(p, c);
  };
  // The phone's one way for a change of a file where it lies, over this test's
  // store: read, change, save — what it comes to where no chain is in play.
  const update = async (v: unknown, p: string, change: (text: string) => string | null) => {
    const before = await read(v, p);
    const next = change(before);
    if (next === null || next === before) return { before, text: before, changed: false, conflict: null };
    await save(v, p, next);
    return { before, text: next, changed: true, conflict: null };
  };
  return {
    getMobileVault: async () => ({ files: Object.assign(adapter, { exists: async (p: string) => files.has(p) }) }),
    vaultOps: { read, save, update },
    vaultTextFiles: (v: unknown) => ({
      readTextFile: (p: string) => read(v, p),
      writeTextFile: (p: string, c: string) => save(v, p, c),
      updateTextFile: (p: string, change: (text: string) => string | null) => update(v, p, change),
      exists: async (p: string) => files.has(p),
    }),
  };
});

import { setTaskDone } from "./services/taskCompletionAction";

const BASE = JSON.stringify({
  columns: {
    done: { input: "checkbox" },
    due: { input: "date" },
  },
  views: [{ name: "Alle", type: "table", plainva: { dateField: "due" } }],
});

const note = (front: string) => `---\n${front}\n---\n\n# Müll rausbringen\n`;

beforeEach(() => {
  files.clear();
  files.set("Tasks.base", BASE);
  settings.taskDatabase = "Tasks.base";
  saveFault.after = null;
});

describe("setTaskDone", () => {
  it("writes the completion into the note", async () => {
    files.set("Tasks/a.md", note("done: false\ndue: 2026-08-12"));
    const result = await setTaskDone("Tasks/a.md", true);
    expect(result.changed).toBe(true);
    expect(files.get("Tasks/a.md")).toContain("done: true");
  });

  it("creates the next occurrence of a repeating task, dated from its due date", async () => {
    files.set(
      "Tasks/a.md",
      note("done: false\ndue: 2026-08-12\nplainva:\n  repeat:\n    freq: weekly\n    interval: 1\n    from: due")
    );
    const result = await setTaskDone("Tasks/a.md", true);
    expect(result.spawnedDue).toBe("2026-08-19");
    const spawned = [...files.entries()].find(([p]) => p.startsWith("Tasks/") && p !== "Tasks/a.md");
    expect(spawned).toBeTruthy();
    // The new one starts open with the next due date; the completed one stays
    // as the record of what was actually done.
    expect(spawned?.[1]).toContain("done: false");
    expect(spawned?.[1]).toContain("due: 2026-08-19");
    expect(files.get("Tasks/a.md")).toContain("done: true");
  });

  it("creates nothing when the task does not repeat", async () => {
    files.set("Tasks/a.md", note("done: false\ndue: 2026-08-12"));
    const result = await setTaskDone("Tasks/a.md", true);
    expect(result.spawnedDue).toBeUndefined();
    expect(files.size).toBe(2);
  });

  it("creates nothing when un-ticking a repeating task", async () => {
    files.set(
      "Tasks/a.md",
      note("done: true\ndue: 2026-08-12\nplainva:\n  repeat:\n    freq: weekly\n    interval: 1\n    from: due")
    );
    const result = await setTaskDone("Tasks/a.md", false);
    expect(result.spawnedDue).toBeUndefined();
    expect(files.size).toBe(2);
  });

  it("refuses to write when the database cannot express 'done' at all", async () => {
    // Without a completion column the write would set a field nothing reads
    // back — the task would look done here and open everywhere else.
    files.set("Tasks.base", JSON.stringify({ columns: { due: { input: "date" } }, views: [{ name: "Alle", type: "table" }] }));
    files.set("Tasks/a.md", note("due: 2026-08-12"));
    const result = await setTaskDone("Tasks/a.md", true);
    expect(result.changed).toBe(false);
    expect(files.get("Tasks/a.md")).not.toContain("done");
  });

  it("serializes notification and screen completion and retries a saved copy once", async () => {
    files.set("Tasks/a.md", note("done: false\ndue: 2026-08-12\nblockedBy: old-task\nplainva:\n  repeat:\n    freq: weekly"));
    let interrupted = false;
    saveFault.after = p => {
      if (!interrupted && p === "Tasks/a 2.md") { interrupted = true; throw new Error("interrupted"); }
    };
    const results = await Promise.all([setTaskDone("Tasks/a.md", true), setTaskDone("Tasks/a.md", true)]);
    expect(results[0]?.spawnFailed).toBe(true);
    expect(results[1]?.spawnFailed).toBeUndefined();
    expect(files.size).toBe(3);
    expect(files.get("Tasks/a 2.md")).not.toContain("blockedBy");
    expect(files.get("Tasks/a.md")).toContain("blockedBy");
    await setTaskDone("Tasks/a.md", false);
    await setTaskDone("Tasks/a.md", true);
    expect(files.size).toBe(3);
  });

  it("does nothing when no task database is configured", async () => {
    settings.taskDatabase = "";
    files.set("Tasks/a.md", note("done: false"));
    await expect(setTaskDone("Tasks/a.md", true)).resolves.toEqual({ changed: false });
  });
});
