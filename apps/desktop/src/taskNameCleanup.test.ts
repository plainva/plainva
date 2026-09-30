// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { taskNoteKey, type TaskAnchorRecord } from "@plainva/core";
import {
  __resetTaskSyncPauseForTest,
  afterTaskSyncResume,
  planTaskNameCleanup,
  resumeTaskNameCleanup,
  runTaskNameCleanup,
  taskNameCleanupSignature,
  taskNameJournalStore,
  withTaskSyncPaused,
  type LinkUpdatePlan,
  type TaskNameCleanupRunner,
} from "@plainva/ui";

/**
 * Task notes that still carry an id in their name (plan Befunde 2026-09-24,
 * E12): what is offered, how it runs, and what an interruption leaves behind.
 */

const hashOf = (uid: string, list = "L1") => createHash("sha256").update(taskNoteKey({ provider: "google", identity: "google:me", list, uid })).digest("hex");
const note = (uid: string, title: string, list = "L1", body = "") =>
  ["---", "plainva:", "  pim:", "    kind: task", "    provider: google", "    identity: google:me", `    list: ${list}`, `    uid: ${uid}`, "---", `# ${title}`, body, ""].join("\n");
const legacy = (folder: string, title: string, uid: string, full = false) => `${folder}/${title} — ${hashOf(uid).slice(0, full ? 64 : 16)}.md`;

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

function vault(files: Record<string, string>) {
  const map = new Map(Object.entries(files));
  return {
    files: map,
    exists: async (p: string) => map.has(p),
    readTextFile: async (p: string) => {
      if (!map.has(p)) throw new Error(`missing ${p}`);
      return map.get(p)!;
    },
    writeTextFile: async (p: string, c: string) => void map.set(p, c),
  };
}

function anchorsOf(files: Map<string, string>): Map<string, TaskAnchorRecord[]> {
  const out = new Map<string, TaskAnchorRecord[]>();
  let ctime = 1;
  for (const [path, content] of files) {
    const uid = /uid: (\S+)/.exec(content)?.[1];
    const list = /list: (\S+)/.exec(content)?.[1];
    if (!uid || !list) continue;
    out.set(uid, [...(out.get(uid) ?? []), { path, uid, list, ctime: ctime++ } as TaskAnchorRecord]);
  }
  return out;
}

function scanOf(v: ReturnType<typeof vault>, links: Record<string, number> = {}) {
  return {
    anchorsByUid: anchorsOf(v.files),
    readTextFile: v.readTextFile,
    exists: v.exists,
    knownPaths: [...v.files.keys()],
    countLinks: async (p: string) => links[p] ?? 0,
  };
}

/** A runner over the in-memory vault; `renameNote` does what the shells' ordinary rename does to the file. */
function runnerOf(v: ReturnType<typeof vault>, storage = memoryStorage(), notePaths = new Map<string, string>()) {
  const calls: string[] = [];
  const run: TaskNameCleanupRunner & { calls: string[]; notePaths: Map<string, string> } = {
    calls,
    notePaths,
    exists: v.exists,
    readTextFile: v.readTextFile,
    writeTextFile: v.writeTextFile,
    journal: taskNameJournalStore("vault-a", storage),
    planLinks: async (from, to): Promise<LinkUpdatePlan> => ({
      oldPath: from,
      newPath: to,
      sources: [...v.files].filter(([, c]) => c.includes(`[[${from.replace(/\.md$/, "").split("/").pop()}]]`)).map(([path]) => ({
        path,
        body: [{ raw: from.replace(/\.md$/, "").split("/").pop()!, target: to.replace(/\.md$/, "").split("/").pop()! }],
        frontmatter: [],
      })),
    }),
    renameNote: vi.fn(async (from: string, to: string) => {
      calls.push(`rename ${from} -> ${to}`);
      const content = v.files.get(from)!;
      v.files.delete(from);
      v.files.set(to, content);
      return { newPath: to, linkUpdateFailed: false };
    }),
    moveTaskNotePath: vi.fn(async (from: string, to: string) => {
      calls.push(`path ${from} -> ${to}`);
      for (const [key, path] of notePaths) if (path === from) notePaths.set(key, to);
    }),
    reindex: vi.fn(async () => {}),
  };
  return run;
}

describe("what is offered", () => {
  it("offers only the names Plainva gave itself: the shape AND the hash of the note's own anchor", async () => {
    const own = legacy("Aufgaben", "Zahnarzt anrufen", "u1");
    const full = legacy("Aufgaben", "Steuern", "u2", true);
    const copied = `Aufgaben/Fremd — ${hashOf("u1").slice(0, 16)}.md`; // the digits of ANOTHER task
    const person = "Aufgaben/Plan — 0123456789abcdef.md"; // no anchor at all
    const v = vault({
      [own]: note("u1", "Zahnarzt anrufen"),
      [full]: note("u2", "Steuern"),
      [copied]: note("u3", "Fremd"),
      [person]: "# Plan\n",
      "Aufgaben/Normal.md": note("u4", "Normal"),
    });
    const items = await planTaskNameCleanup(scanOf(v, { [own]: 2 }));
    // Ordered by the tasks' identities (u1 before u2), not by name.
    expect(items).toEqual([
      { from: own, to: "Aufgaben/Zahnarzt anrufen.md", links: 2 },
      { from: full, to: "Aufgaben/Steuern.md", links: 0 },
    ]);
  });

  it("numbers like every other note, in the order of the tasks' identities", async () => {
    const a = legacy("Aufgaben", "Einkaufen", "u-a");
    const b = legacy("Aufgaben", "Einkaufen", "u-b");
    const v = vault({ [a]: note("u-a", "Einkaufen"), [b]: note("u-b", "Einkaufen"), "Aufgaben/einkaufen 2.md": "# mine\n" });
    const items = await planTaskNameCleanup(scanOf(v));
    // "Einkaufen 2" differs from a person's note only in case: taken.
    expect(items.map((i) => [i.from, i.to])).toEqual([
      [a, "Aufgaben/Einkaufen.md"],
      [b, "Aufgaben/Einkaufen 3.md"],
    ]);
  });

  it("has a signature that changes with the set of names", async () => {
    const one = [{ from: "a — 1.md", to: "a.md", links: 0 }];
    expect(taskNameCleanupSignature([])).toBe("");
    expect(taskNameCleanupSignature(one)).toBe(taskNameCleanupSignature([{ ...one[0]!, to: "other.md" }]));
    expect(taskNameCleanupSignature([...one, { from: "b — 2.md", to: "b.md", links: 0 }])).not.toBe(taskNameCleanupSignature(one));
  });
});

describe("running it", () => {
  beforeEach(() => __resetTaskSyncPauseForTest());

  it("moves the stored note path before the file, and a second run finds nothing left", async () => {
    const from = legacy("Aufgaben", "Einkaufen", "u1");
    const v = vault({ [from]: note("u1", "Einkaufen") });
    const storage = memoryStorage();
    const run = runnerOf(v, storage, new Map([["u1", from]]));
    const items = await planTaskNameCleanup(scanOf(v));

    const result = await runTaskNameCleanup(items, run);

    expect(result.renamed).toEqual([{ from, to: "Aufgaben/Einkaufen.md" }]);
    expect(run.calls).toEqual([`path ${from} -> Aufgaben/Einkaufen.md`, `rename ${from} -> Aufgaben/Einkaufen.md`]);
    expect(run.notePaths.get("u1")).toBe("Aufgaben/Einkaufen.md");
    expect(storage.data.size).toBe(0); // journal gone
    expect(await planTaskNameCleanup(scanOf(v))).toEqual([]);
    const again = await runTaskNameCleanup(items, run);
    expect(again.renamed).toEqual([]);
    expect(again.skipped).toEqual([from]);
    expect([...v.files.keys()]).toEqual(["Aufgaben/Einkaufen.md"]);
  });

  it("leaves a note alone that changed hands or whose new name got taken meanwhile", async () => {
    const a = legacy("Aufgaben", "A", "u1");
    const b = legacy("Aufgaben", "B", "u2");
    const v = vault({ [a]: note("u1", "A"), [b]: note("u2", "B") });
    const items = await planTaskNameCleanup(scanOf(v));
    v.files.set("Aufgaben/A.md", "# someone was faster\n");
    v.files.set(b, note("u9", "B")); // now another task's anchor
    const run = runnerOf(v);
    const result = await runTaskNameCleanup(items, run);
    expect(result.renamed).toEqual([]);
    expect(result.skipped.sort()).toEqual([a, b].sort());
    expect(run.renameNote).not.toHaveBeenCalled();
    expect(run.moveTaskNotePath).not.toHaveBeenCalled();
  });

  it("finishes an interrupted run: the moved note gets its links and stored path, the unmoved one is renamed", async () => {
    const a = legacy("Aufgaben", "A", "u1");
    const b = legacy("Aufgaben", "B", "u2");
    const refs = "Siehe [[" + a.replace(/\.md$/, "").split("/").pop() + "]]\n";
    const v = vault({ [a]: note("u1", "A"), [b]: note("u2", "B"), "Projekt.md": refs });
    const storage = memoryStorage();
    const items = await planTaskNameCleanup(scanOf(v));
    // The first rename moves the file and then the app dies — links untouched.
    const dying = runnerOf(v, storage);
    dying.renameNote = vi.fn(async (from: string, to: string) => {
      const content = v.files.get(from)!;
      v.files.delete(from);
      v.files.set(to, content);
      throw new Error("process ended");
    });
    const first = await runTaskNameCleanup(items, dying);
    expect(first.renamed).toEqual([]);
    expect(storage.data.size).toBe(1); // the journal survives

    const next = runnerOf(v, storage);
    const resumed = await resumeTaskNameCleanup(next);
    expect(resumed.renamed.map((r) => r.to).sort()).toEqual(["Aufgaben/A.md", "Aufgaben/B.md"]);
    expect(v.files.get("Projekt.md")).toBe("Siehe [[A]]\n");
    expect(next.reindex).toHaveBeenCalledWith([a], ["Aufgaben/A.md", "Projekt.md"]);
    expect(storage.data.size).toBe(0);
    // Resuming twice changes nothing.
    expect((await resumeTaskNameCleanup(next)).renamed).toEqual([]);
    expect(v.files.get("Projekt.md")).toBe("Siehe [[A]]\n");
  });

  it("holds the task reconciler for the whole run and lets a turned-away runner in afterwards", async () => {
    const from = legacy("Aufgaben", "A", "u1");
    const v = vault({ [from]: note("u1", "A") });
    const run = runnerOf(v);
    const items = await planTaskNameCleanup(scanOf(v));
    const again = vi.fn();
    run.renameNote = vi.fn(async (f: string, t: string) => {
      afterTaskSyncResume(again); // a cycle ended mid-run and met the pause
      expect(again).not.toHaveBeenCalled();
      const content = v.files.get(f)!;
      v.files.delete(f);
      v.files.set(t, content);
      return { newPath: t, linkUpdateFailed: false };
    });
    await withTaskSyncPaused(() => runTaskNameCleanup(items, run));
    expect(again).toHaveBeenCalledTimes(1);
  });
});
