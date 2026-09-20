// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  forgetTaskViewState, readSeenTaskDuplicates, removeTaskCopies, summarizeDuplicateTasks, taskDuplicatesSeenKey, useTaskDuplicates, writeSeenTaskDuplicates,
  findDuplicateTaskNotes, type TaskDuplicatesDeps, type TaskDuplicatesState,
} from "@plainva/ui";
import type { TaskAnchorRecord } from "@plainva/core";

/**
 * Finding 2026-09-20: the clean-up of task notes that exist more than once —
 * what is removed, when the notice shows, and what "put away" means. Both
 * shells run on this one hook, so this is the behaviour of both.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DB = { dueKey: "Fällig", completion: { kind: "status" as const, status: { key: "Status", open: "Offen", done: "Erledigt", options: ["Offen", "Erledigt"] } } };

function note(title: string, status: string, body = ""): string {
  return ["---", "plainva:", "  pim:", "    kind: task", "    provider: google", "    list: L1", "    uid: u1", `Status: ${status}`, "---", `# ${title}`, ...(body ? ["", body] : []), ""].join("\n");
}

function anchors(paths: string[], uid = "u1"): Map<string, TaskAnchorRecord[]> {
  return new Map([[uid, paths.map((path, i) => ({ path, uid, list: "L1", provider: "google", ctime: 1000 + i }))]]);
}

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("removeTaskCopies", () => {
  it("judges again right before deleting: a copy that gained text since the review stays", async () => {
    const files: Record<string, string> = {
      "T/Blumen.md": note("Blumen", "Offen"),
      "T/Blumen 2.md": note("Blumen", "Erledigt"),
      "T/Blumen 3.md": note("Blumen", "Offen"),
    };
    const opts = { anchorsByUid: anchors(Object.keys(files)), boundPath: () => "T/Blumen.md", readTextFile: async (p: string) => files[p], db: DB };
    const shown = await findDuplicateTaskNotes(opts);
    // Between the review and the click somebody writes into one of the copies.
    files["T/Blumen 3.md"] = note("Blumen", "Offen", "Nur freitags, sonst ertrinkt der Farn.");

    const deleted: string[] = [];
    const result = await removeTaskCopies(shown, opts, async (p) => void deleted.push(p));
    expect(deleted).toEqual(["T/Blumen 2.md"]);
    expect(result).toEqual({ removed: ["T/Blumen 2.md"], skipped: ["T/Blumen 3.md"] });
  });

  it("never offers the kept note, and a failing delete is skipped without stopping the rest", async () => {
    const files: Record<string, string> = { "a.md": note("A", "Offen"), "a 2.md": note("A", "Offen"), "a 3.md": note("A", "Offen") };
    const opts = { anchorsByUid: anchors(Object.keys(files)), boundPath: () => "a.md", readTextFile: async (p: string) => files[p], db: DB };
    const shown = await findDuplicateTaskNotes(opts);
    const result = await removeTaskCopies(shown, opts, async (p) => {
      if (p === "a 2.md") throw new Error("locked");
    });
    expect(result.removed).toEqual(["a 3.md"]);
    expect(result.skipped).toEqual(["a 2.md"]);
  });
});

describe("summarizeDuplicateTasks + the put-away notice", () => {
  it("has a signature that ignores order and changes with the set", () => {
    const one = summarizeDuplicateTasks(anchors(["a.md", "a 2.md"]));
    expect(one.count).toBe(1);
    expect(summarizeDuplicateTasks(anchors(["a 2.md", "a.md"])).signature).toBe(one.signature);
    expect(summarizeDuplicateTasks(anchors(["a.md", "a 2.md", "a 3.md"])).signature).not.toBe(one.signature);
    expect(summarizeDuplicateTasks(anchors(["a.md"]))).toEqual({ count: 0, signature: "" });
  });

  it("remembers per vault, and forgetting a vault forgets the notice too", () => {
    const storage = memoryStorage();
    writeSeenTaskDuplicates("vault-a", "abc", storage);
    expect(readSeenTaskDuplicates("vault-a", storage)).toBe("abc");
    expect(readSeenTaskDuplicates("vault-b", storage)).toBeNull();
    forgetTaskViewState("vault-a", storage);
    expect(storage.data.has(taskDuplicatesSeenKey("vault-a"))).toBe(false);
  });
});

describe("useTaskDuplicates", () => {
  let container: HTMLDivElement;
  let root: Root;
  let current: TaskDuplicatesState;

  function Harness({ deps }: { deps: TaskDuplicatesDeps }) {
    current = useTaskDuplicates(deps);
    return null;
  }
  /** Renders and lets the anchor query settle. */
  async function render(deps: TaskDuplicatesDeps) {
    await act(async () => {
      root.render(<Harness deps={deps} />);
      await Promise.resolve();
    });
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function setup(files: Record<string, string>) {
    const state = { paths: Object.keys(files) };
    const queryService = { getTaskAnchors: async () => anchors(state.paths) };
    const deleteNote = vi.fn(async (p: string) => {
      delete files[p];
      state.paths = state.paths.filter((x) => x !== p);
    });
    const base: TaskDuplicatesDeps = {
      vault: `vault-${Math.random()}`,
      db: DB,
      reloadKey: 0,
      queryService,
      listBoundTaskNotes: async () => [{ listId: "L1", uid: "u1", notePath: "T/Blumen.md" }],
      readTextFile: async (p) => {
        if (!(p in files)) throw new Error("gone");
        return files[p];
      },
      deleteNote,
      onError: (e) => { throw e; },
    };
    return { state, deleteNote, base };
  }

  it("shows the notice, removes only what the review offered, and hides once nothing is left", async () => {
    const files: Record<string, string> = { "T/Blumen.md": note("Blumen", "Offen"), "T/Blumen 2.md": note("Blumen", "Erledigt") };
    const { deleteNote, base } = setup(files);
    const removedSeen: string[][] = [];
    const deps = { ...base, onRemoved: (r: string[]) => void removedSeen.push(r) };
    await render(deps);
    expect(current.visible).toBe(true);
    expect(current.count).toBe(1);

    await act(() => current.review());
    expect(current.removable).toBe(1);
    let removed = 0;
    await act(async () => { removed = await current.remove(); });
    expect(removed).toBe(1);
    expect(deleteNote).toHaveBeenCalledTimes(1);
    expect(deleteNote).toHaveBeenCalledWith("T/Blumen 2.md");
    expect(removedSeen).toEqual([["T/Blumen 2.md"]]);
    expect(current.groups).toBeNull();

    await render({ ...deps, reloadKey: 1 });
    expect(current.visible).toBe(false);
  });

  it("can be put away when every copy stays - and comes back when the set changes", async () => {
    const files: Record<string, string> = {
      "T/Blumen.md": note("Blumen", "Offen"),
      "T/Blumen 2.md": note("Blumen", "Offen", "Eigene Notiz: Duenger ist im Keller."),
    };
    const { state, deleteNote, base } = setup(files);
    await render(base);
    expect(current.visible).toBe(true);
    await act(() => current.review());
    expect(current.removable).toBe(0);

    act(() => current.putAway());
    expect(current.visible).toBe(false);
    expect(current.count).toBe(1); // still true, just no longer announced
    expect(deleteNote).not.toHaveBeenCalled();

    files["T/Blumen 3.md"] = note("Blumen", "Offen");
    state.paths = Object.keys(files);
    await render({ ...base, reloadKey: 1 });
    expect(current.visible).toBe(true);
  });

  it("stays silent without a task database", async () => {
    const { base } = setup({ "a.md": note("A", "Offen"), "a 2.md": note("A", "Offen") });
    await render({ ...base, db: null });
    expect(current.visible).toBe(false);
    expect(current.count).toBe(0);
  });
});
