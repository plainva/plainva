import { describe, it, expect, vi } from "vitest";
import { toggleTaskDone, writeTaskNote, type TaskToggleDeps } from "./taskCompletion";
import type { TaskCompletionModel } from "@plainva/ui";

/**
 * The tick-off path shared by the Tasks overview and the calendar surfaces
 * (issue #34, wave 4). What matters here is not the frontmatter arithmetic —
 * `applyTaskCompletion` owns and tests that — but the SEQUENCE around it: write,
 * re-index, refresh, nudge the provider, and spawn the next occurrence only when
 * one is earned. A surface that reimplemented this could drift, and for a task
 * mirrored from a provider a drift can un-complete a remote task.
 */

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
    const changed = await writeTaskNote(deps, "T/a.md", (raw) => raw + "\nx\n");
    expect(changed).toBe(true);
    expect(written["T/a.md"]).toContain("\nx\n");
    expect(triggerFileTreeUpdate).toHaveBeenCalledWith(["T/a.md"]);
    expect(triggerImmediate).toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
  });

  it("writes nothing when the mutation changes nothing, but still re-queries", async () => {
    const { deps, written, triggerFileTreeUpdate, onChanged } = makeDeps({ "T/a.md": PLAIN_TASK });
    const changed = await writeTaskNote(deps, "T/a.md", (raw) => raw);
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
