import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { toggleTaskDone, writeTaskNote, type TaskToggleDeps } from "./taskCompletion";
import type { TaskCompletionModel } from "@plainva/ui";
import { readFrontmatterPath } from "@plainva/core";

/**
 * The tick-off path shared by the Tasks overview and the calendar surfaces
 * (issue #34, wave 4). What matters here is not the frontmatter arithmetic —
 * `applyTaskCompletion` owns and tests that — but the SEQUENCE around it: write,
 * re-index, refresh, nudge the provider, and spawn the next occurrence only when
 * one is earned. A surface that reimplemented this could drift, and for a task
 * mirrored from a provider a drift can un-complete a remote task.
 */

/**
 * The clock is frozen because the fixtures below carry a fixed due date
 * (`faellig: 2026-08-10`) and a weekly rule. `from: due` is a fixed cadence that
 * skips to the next due date IN THE FUTURE when a task is long overdue — correct
 * behaviour, but it turns a fixed fixture date into a time bomb: these two cases
 * were green until 2026-08-17 and failed on the 18th, when the expected
 * 2026-08-17 had slipped into the past and the code rightly produced 2026-08-24.
 * Only `Date` is faked, so `await` still resolves on real microtasks.
 */
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-10T12:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

const CHECKBOX_MODEL: TaskCompletionModel = { kind: "checkbox", key: "erledigt", status: null };

function makeDeps(files: Record<string, string>, overrides: Partial<TaskToggleDeps> = {}) {
  const written: Record<string, string> = {};
  const triggerFileTreeUpdate = vi.fn();
  const triggerImmediate = vi.fn().mockResolvedValue(undefined);
  const onChanged = vi.fn();
  const deps: TaskToggleDeps = {
    vaultAdapter: {
      readTextFile: async (p: string) => {
        if (!(p in files)) throw new Error(`missing ${p}`);
        return files[p]!;
      },
      writeTextFile: async (p: string, c: string) => {
        written[p] = c;
        files[p] = c;
      },
      exists: async (p: string) => p in files,
    },
    indexer: null,
    triggerFileTreeUpdate,
    pimRuntime: { worker: { triggerImmediate } },
    onChanged,
    completion: CHECKBOX_MODEL,
    dueKey: "faellig",
    ...overrides,
  };
  return { deps, written, triggerFileTreeUpdate, triggerImmediate, onChanged };
}

const PLAIN_TASK = `---
type: task
erledigt: false
faellig: 2026-08-10
---

# Steuer sortieren
`;

const REPEATING_TASK = `---
type: task
erledigt: false
faellig: 2026-08-10
plainva:
  repeat:
    freq: weekly
    interval: 1
    from: due
---

# Müll rausbringen
`;

describe("writeTaskNote", () => {
  it("writes, refreshes the tree and nudges the provider", async () => {
    const { deps, written, triggerFileTreeUpdate, triggerImmediate, onChanged } = makeDeps({ "T/a.md": PLAIN_TASK });
    const { changed } = await writeTaskNote(deps, "T/a.md", (raw) => raw + "\nx\n");
    expect(changed).toBe(true);
    expect(written["T/a.md"]).toContain("\nx\n");
    expect(triggerFileTreeUpdate).toHaveBeenCalledWith(["T/a.md"]);
    expect(triggerImmediate).toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
  });

  it("writes nothing when the mutation changes nothing, but still re-queries", async () => {
    const { deps, written, triggerFileTreeUpdate, onChanged } = makeDeps({ "T/a.md": PLAIN_TASK });
    const { changed } = await writeTaskNote(deps, "T/a.md", (raw) => raw);
    expect(changed).toBe(false);
    expect(written["T/a.md"]).toBeUndefined();
    expect(triggerFileTreeUpdate).not.toHaveBeenCalled();
    // The surface may still hold a stale optimistic value — it must re-read.
    expect(onChanged).toHaveBeenCalled();
  });
});

describe("toggleTaskDone", () => {
  it("flips the checkbox property to done", async () => {
    const { deps, written } = makeDeps({ "T/a.md": PLAIN_TASK });
    const result = await toggleTaskDone(deps, "T/a.md", true);
    expect(written["T/a.md"]).toContain("erledigt: true");
    expect(result.spawnedDue).toBeNull();
    expect(result.spawnFailed).toBe(false);
  });

  it("flips it back to open and spawns nothing", async () => {
    const files = { "T/a.md": PLAIN_TASK.replace("erledigt: false", "erledigt: true") };
    const { deps, written } = makeDeps(files);
    const result = await toggleTaskDone(deps, "T/a.md", false);
    expect(written["T/a.md"]).toContain("erledigt: false");
    expect(result.spawnedDue).toBeNull();
  });

  it("ticking a repeating task off creates the next occurrence, open and re-dated", async () => {
    const files: Record<string, string> = { "T/muell.md": REPEATING_TASK };
    const { deps, written } = makeDeps(files);
    const result = await toggleTaskDone(deps, "T/muell.md", true);

    // The completed note stays as the record of what was done.
    expect(written["T/muell.md"]).toContain("erledigt: true");

    expect(result.spawnedDue).toBe("2026-08-17");
    const created = Object.keys(written).find((p) => p !== "T/muell.md");
    expect(created).toBeTruthy();
    const copy = written[created!]!;
    expect(copy).toContain("erledigt: false");
    expect(copy).toContain("faellig: 2026-08-17");
    // The rule travels with the copy, or the chain would end after one step.
    expect(copy).toContain("freq: weekly");
  });

  it("un-ticking a repeating task creates nothing", async () => {
    const files: Record<string, string> = { "T/muell.md": REPEATING_TASK.replace("erledigt: false", "erledigt: true") };
    const { deps, written } = makeDeps(files);
    const result = await toggleTaskDone(deps, "T/muell.md", false);
    expect(result.spawnedDue).toBeNull();
    expect(Object.keys(written)).toEqual(["T/muell.md"]);
  });

  it("reports a failed spawn instead of losing the completion", async () => {
    const files: Record<string, string> = { "T/muell.md": REPEATING_TASK };
    const { deps, written } = makeDeps(files);
    let calls = 0;
    const realWrite = deps.vaultAdapter.writeTextFile;
    deps.vaultAdapter.writeTextFile = async (p: string, c: string) => {
      calls += 1;
      // The completion write succeeds; writing the successor fails.
      if (calls > 1) throw new Error("disk full");
      await realWrite(p, c);
    };
    const result = await toggleTaskDone(deps, "T/muell.md", true);
    expect(written["T/muell.md"]).toContain("erledigt: true");
    expect(result.spawnFailed).toBe(true);
    expect(result.spawnedDue).toBeNull();
  });

  it("propagates a failed completion write so the surface can revert", async () => {
    const { deps } = makeDeps({ "T/a.md": PLAIN_TASK });
    deps.vaultAdapter.writeTextFile = async () => {
      throw new Error("read-only volume");
    };
    await expect(toggleTaskDone(deps, "T/a.md", true)).rejects.toThrow("read-only volume");
  });
});

const BLOCKED_REPEATING_TASK = `---
type: task
erledigt: false
faellig: 2026-08-10
blockedBy:
  - uid: "[[Vorbereitung]]"
    reltype: FINISHTOSTART
plainva:
  repeat:
    freq: weekly
    interval: 1
    from: due
---

# Müll rausbringen
`;

describe("durable recurrence", () => {
  it("keeps the planned due date when a failed copy is retried on another day", async () => {
    const files: Record<string, string> = { "T/a.md": REPEATING_TASK };
    const { deps } = makeDeps(files), write = deps.vaultAdapter.writeTextFile;
    deps.vaultAdapter.writeTextFile = async (p, c) => { if (p !== "T/a.md") throw new Error("full"); await write(p, c); };
    expect((await toggleTaskDone(deps, "T/a.md", true)).spawnFailed).toBe(true);
    deps.vaultAdapter.writeTextFile = write;
    try {
      vi.setSystemTime(new Date("2026-09-10T12:00:00Z"));
      expect((await toggleTaskDone(deps, "T/a.md", true)).spawnedDue).toBe("2026-08-17");
      expect(Object.keys(files)).toEqual(["T/a.md", "T/a 2.md"]);
    } finally { vi.setSystemTime(new Date("2026-08-10T12:00:00Z")); }
  });
  it("serializes concurrent completion and never repeats the predecessor twice", async () => {
    const files: Record<string, string> = { "T/a.md": REPEATING_TASK };
    const { deps } = makeDeps(files);
    const results = await Promise.all([toggleTaskDone(deps, "T/a.md", true), toggleTaskDone(deps, "T/a.md", true)]);
    expect(results.filter(r => r.spawnedDue)).toHaveLength(1);
    await toggleTaskDone(deps, "T/a.md", false);
    await toggleTaskDone(deps, "T/a.md", true);
    expect(Object.keys(files)).toEqual(["T/a.md", "T/a 2.md"]);
    expect(readFrontmatterPath(files["T/a.md"]!, ["plainva", "repeatNext", "complete"])).toBe(true);
    // A deliberate deletion must not be undone by replaying its predecessor.
    delete files["T/a 2.md"];
    await toggleTaskDone(deps, "T/a.md", true);
    expect(Object.keys(files)).toEqual(["T/a.md"]);
  });

  it.each(["copy", "receipt"])("recovers a crash after writing the %s without another child", async phase => {
    const files: Record<string, string> = { "T/a.md": REPEATING_TASK };
    const { deps } = makeDeps(files);
    const realWrite = deps.vaultAdapter.writeTextFile;
    let fail = true;
    deps.vaultAdapter.writeTextFile = async (p, c) => {
      const crash = fail && (phase === "copy" ? p === "T/a 2.md" : p === "T/a.md" && readFrontmatterPath(c, ["plainva", "repeatNext", "complete"]) === true);
      if (phase === "receipt" && crash) { fail = false; throw new Error("interrupted before receipt"); }
      await realWrite(p, c);
      if (crash) { fail = false; throw new Error("interrupted after copy"); }
    };
    expect((await toggleTaskDone(deps, "T/a.md", true)).spawnFailed).toBe(true);
    files["T/a 2.md"] += "\nA later edit of the successor\n";
    expect((await toggleTaskDone(deps, "T/a.md", true)).spawnFailed).toBe(false);
    expect(Object.keys(files)).toEqual(["T/a.md", "T/a 2.md"]);
    expect(files["T/a 2.md"]).toContain("A later edit");
    expect(readFrontmatterPath(files["T/a.md"]!, ["plainva", "repeatNext", "complete"])).toBe(true);
  });

  it("keeps a destination created after the plan and reports the conflict", async () => {
    const files: Record<string, string> = { "T/a.md": REPEATING_TASK };
    const { deps } = makeDeps(files);
    const realWrite = deps.vaultAdapter.writeTextFile;
    deps.vaultAdapter.writeTextFile = async (p, c) => {
      await realWrite(p, c);
      if (p === "T/a.md" && readFrontmatterPath(c, ["plainva", "repeatNext"])) files["T/a 2.md"] = "Someone else's new note";
    };
    expect((await toggleTaskDone(deps, "T/a.md", true)).spawnFailed).toBe(true);
    expect(files["T/a 2.md"]).toBe("Someone else's new note");
    expect(Object.keys(files)).toHaveLength(2);
  });

  it("does not guess new copy contents after a source edit during an interrupted copy", async () => {
    const files: Record<string, string> = { "T/a.md": REPEATING_TASK };
    const { deps } = makeDeps(files);
    const realWrite = deps.vaultAdapter.writeTextFile;
    deps.vaultAdapter.writeTextFile = async (p, c) => {
      if (p !== "T/a.md") throw new Error("full");
      await realWrite(p, c);
    };
    expect((await toggleTaskDone(deps, "T/a.md", true)).spawnFailed).toBe(true);
    files["T/a.md"] += "\nChanged after completion\n";
    deps.vaultAdapter.writeTextFile = realWrite;
    expect((await toggleTaskDone(deps, "T/a.md", true)).spawnFailed).toBe(true);
    expect(Object.keys(files)).toEqual(["T/a.md"]);
    expect(files["T/a.md"]).toContain("Changed after completion");
  });

  it("gives the child its own recurrence receipt", async () => {
    const files: Record<string, string> = { "T/a.md": REPEATING_TASK };
    const { deps } = makeDeps(files);
    await toggleTaskDone(deps, "T/a.md", true);
    expect(readFrontmatterPath(files["T/a 2.md"]!, ["plainva", "repeatNext"])).toBeUndefined();
    await toggleTaskDone(deps, "T/a 2.md", true);
    await toggleTaskDone(deps, "T/a 2.md", true);
    expect(Object.keys(files)).toEqual(["T/a.md", "T/a 2.md", "T/a 3.md"]);
    expect(readFrontmatterPath(files["T/a 3.md"]!, ["faellig"])).toBe("2026-08-24");
  });
});

describe("recurring tasks and dependencies", () => {
  // The failure this guards against is documented in Obsidian Tasks: a
  // recurring task copies its blockedBy along, so every occurrence names a
  // predecessor that was finished long ago and stays blocked forever.
  it("does not hand the dependency list to the next occurrence", async () => {
    const files: Record<string, string> = { "Aufgaben/Muell.md": BLOCKED_REPEATING_TASK };
    const { deps, written } = makeDeps(files);
    const res = await toggleTaskDone(deps, "Aufgaben/Muell.md", true);
    expect(res.spawnedDue).toBe("2026-08-17");

    const spawnedPath = Object.keys(written).find((p) => p !== "Aufgaben/Muell.md");
    expect(spawnedPath).toBeTruthy();
    const spawned = written[spawnedPath!]!;
    expect(spawned).not.toContain("blockedBy");
    expect(spawned).not.toContain("Vorbereitung");
    // Everything else does carry over — the rule, the type, the new due date.
    expect(spawned).toContain("faellig: 2026-08-17");
    expect(spawned).toContain("freq: weekly");

    // The completed task keeps its own dependency: it is history, not a copy.
    expect(files["Aufgaben/Muell.md"]).toContain("blockedBy");
  });
});
