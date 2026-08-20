import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The deletion order is read while the note still EXISTS.
 *
 * An anchor lives in the note's frontmatter, so there is exactly one moment it
 * can be read: before the file goes. Get the order wrong and nothing fails
 * loudly — the deletes succeed, the window simply never starts, and the task
 * stays at the provider until the next cycle imports it back as a fresh note.
 * That is the duplicate this package exists to remove, arriving by a second
 * road.
 *
 * So this deletes for real against a fake vault whose reads FAIL once the file
 * is gone. A test that mocked the read away could not tell the two orders apart.
 */

const started: string[][] = [];
const removed: string[] = [];

vi.mock("@plainva/ui", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestTaskDeletion: (anchored: ReadonlyArray<{ path: string }>) => {
    started.push(anchored.map((a) => a.path));
  },
}));

vi.mock("./services/syncService", () => ({
  notifyUserInitiatedDeletion: () => {},
}));

const files = new Map<string, string>();
vi.mock("./services/vaultService", () => ({
  noteSaver: { flushAll: async () => {} },
  vaultOps: {
    remove: async (_v: unknown, path: string) => {
      if (!files.has(path)) throw new Error(`already gone: ${path}`);
      files.delete(path);
      removed.push(path);
    },
  },
}));

import { executeMobileCascade } from "./services/cascadeDelete";
import type { CascadeSelection, DeletionPlan } from "@plainva/ui";
import type { MobileVault } from "./services/vaultService";

const ANCHORED = `---
type: Task
plainva:
  pim:
    kind: task
    uid: u1
    list: l1
    provider: caldav
---

# Steuern einreichen
`;

const PLAIN = `---
type: Note
---

# Just a note
`;

function vault(): MobileVault {
  return {
    files: {
      readTextFile: async (p: string) => {
        const c = files.get(p);
        // The whole point: after the delete there is nothing left to read.
        if (c === undefined) throw new Error(`no such file: ${p}`);
        return c;
      },
      writeTextFile: async () => {},
    },
    queryService: null,
    indexer: null,
  } as unknown as MobileVault;
}

/** A real plan with only primaries — the shape a plain note delete produces. */
function planFor(paths: string[]): DeletionPlan {
  return {
    primary: paths.map((path) => ({ path, title: path, kind: "note" as const })),
    groups: [],
    incomingEdges: [],
    affectedBases: [],
  };
}
const selection: CascadeSelection = { groups: {}, excluded: new Set(), cleanupRefs: false };

describe("mobile cascade starts the provider deletion", () => {
  beforeEach(() => {
    started.length = 0;
    removed.length = 0;
    files.clear();
  });

  it("reads the anchor before the file is gone", async () => {
    files.set("Aufgaben/Steuern einreichen.md", ANCHORED);
    const res = await executeMobileCascade(vault(), planFor(["Aufgaben/Steuern einreichen.md"]), selection);
    expect(res.deleted).toEqual(["Aufgaben/Steuern einreichen.md"]);
    expect(started).toEqual([["Aufgaben/Steuern einreichen.md"]]);
  });

  it("a note without an anchor orders nothing", async () => {
    files.set("Notes/Plain.md", PLAIN);
    await executeMobileCascade(vault(), planFor(["Notes/Plain.md"]), selection);
    // The ORDER is what matters, not whether the call happened: an empty batch
    // is turned away by requestTaskDeletion itself (pinned in taskDeletion.test).
    expect(started.flat()).toEqual([]);
  });

  it("a delete that FAILED orders nothing — the note is still there", async () => {
    files.set("Aufgaben/A.md", ANCHORED);
    // Not in the map: the remove throws, so the note survives...
    const res = await executeMobileCascade(vault(), planFor(["Aufgaben/A.md", "Aufgaben/Gone.md"]), selection);
    expect(res.deleted).toEqual(["Aufgaben/A.md"]);
    // ...and only what really went away starts a window.
    expect(started).toEqual([["Aufgaben/A.md"]]);
  });
});
