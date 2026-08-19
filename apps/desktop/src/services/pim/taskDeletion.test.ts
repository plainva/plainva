// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * The window between a confirmed deletion and the provider call (E4c).
 *
 * Every assertion here is built around the ABSENCE of a call — the same shape
 * the mail undo test uses, and for the same reason: "nothing happened yet" is
 * the whole promise the window makes.
 */

const toastCalls: Array<{ kind: string; message: string; action?: { label: string; run: () => void } }> = [];
let nextToastId = 1;
const dismissed: number[] = [];

vi.mock("@plainva/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    toast: {
      progress: (message: string, action?: { label: string; run: () => void }) => {
        toastCalls.push({ kind: "progress", message, action });
        return nextToastId++;
      },
      info: (message: string) => {
        toastCalls.push({ kind: "info", message });
        return nextToastId++;
      },
      error: (message: string) => {
        toastCalls.push({ kind: "error", message });
        return nextToastId++;
      },
      dismiss: (id: number) => dismissed.push(id),
    },
  };
});

vi.mock("@plainva/ui/i18n", () => ({
  default: { t: (key: string) => key },
}));

import {
  requestTaskDeletion,
  pendingTaskDeletions,
  taskDeletionsInFlight,
  resolveTaskDeletion,
  initTaskDeletion,
  collectTaskAnchors,
  __resetTaskDeletionsForTest,
  UNDO_SEND_MS,
} from "./taskDeletion";

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

Belege sortieren.
`;

const PLAIN = `---
type: Note
---

# Just a note
`;

function anchoredOf(path: string, content: string) {
  return collectTaskAnchors([{ path, content }]);
}

describe("task deletion window", () => {
  let written: Array<[string, string]>;
  let synced: number;
  let restored: string[][];

  beforeEach(() => {
    vi.useFakeTimers();
    toastCalls.length = 0;
    dismissed.length = 0;
    nextToastId = 1;
    written = [];
    synced = 0;
    restored = [];
    __resetTaskDeletionsForTest();
    initTaskDeletion({
      writeTextFile: async (p, c) => {
        written.push([p, c]);
      },
      runTaskSync: () => {
        synced++;
      },
      onRestored: (paths) => restored.push(paths),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("nothing is ordered while the window runs", () => {
    requestTaskDeletion(anchoredOf("Aufgaben/Steuern einreichen.md", ANCHORED));
    vi.advanceTimersByTime(UNDO_SEND_MS - 1);
    expect(pendingTaskDeletions()).toEqual([]);
    expect(synced).toBe(0);
    // ...and the reader can see that it can still stop it.
    expect(toastCalls[0].kind).toBe("progress");
    expect(toastCalls[0].action?.label).toBe("common.undo");
  });

  it("the order is armed when the window closes, and the toast goes with it", () => {
    requestTaskDeletion(anchoredOf("Aufgaben/Steuern einreichen.md", ANCHORED));
    vi.advanceTimersByTime(UNDO_SEND_MS);
    expect(pendingTaskDeletions()).toEqual([
      { notePath: "Aufgaben/Steuern einreichen.md", uid: "u1", list: "l1", provider: "caldav" },
    ]);
    // A visible "undo" that no longer works would be worse than no button.
    expect(dismissed).toEqual([1]);
    expect(synced).toBe(1);
  });

  it("undo brings the note back WITH its body and orders nothing", async () => {
    requestTaskDeletion(anchoredOf("Aufgaben/Steuern einreichen.md", ANCHORED));
    toastCalls[0].action!.run();
    await vi.runOnlyPendingTimersAsync();
    vi.advanceTimersByTime(UNDO_SEND_MS * 2);

    expect(pendingTaskDeletions()).toEqual([]);
    expect(written).toHaveLength(1);
    // The body, not just the file: restoring an empty note would be
    // indistinguishable from a re-import, which is what this whole change
    // exists to avoid.
    expect(written[0][0]).toBe("Aufgaben/Steuern einreichen.md");
    expect(written[0][1]).toContain("Belege sortieren.");
    expect(restored).toEqual([["Aufgaben/Steuern einreichen.md"]]);
  });

  it("a note without an anchor never starts a window", () => {
    requestTaskDeletion(anchoredOf("Notes/Plain.md", PLAIN));
    vi.advanceTimersByTime(UNDO_SEND_MS * 2);
    expect(toastCalls).toEqual([]);
    expect(pendingTaskDeletions()).toEqual([]);
  });

  it("a second deletion carries out the first immediately", () => {
    requestTaskDeletion(anchoredOf("Aufgaben/A.md", ANCHORED));
    vi.advanceTimersByTime(1000);
    requestTaskDeletion(anchoredOf("Aufgaben/B.md", ANCHORED.replace("uid: u1", "uid: u2")));
    // The first is no longer what is being reconsidered.
    expect(pendingTaskDeletions().map((o) => o.uid)).toEqual(["u1"]);
    vi.advanceTimersByTime(UNDO_SEND_MS);
    expect(pendingTaskDeletions().map((o) => o.uid).sort()).toEqual(["u1", "u2"]);
  });

  it("in-flight is only reported while the window runs", () => {
    requestTaskDeletion(anchoredOf("Aufgaben/A.md", ANCHORED));
    expect(taskDeletionsInFlight().map((o) => o.uid)).toEqual(["u1"]);
    vi.advanceTimersByTime(UNDO_SEND_MS);
    // Once armed it is an order, not a candidate for protection.
    expect(taskDeletionsInFlight()).toEqual([]);
    expect(pendingTaskDeletions().map((o) => o.uid)).toEqual(["u1"]);
  });

  it("a retry keeps the order, a done or a conflict drops it", () => {
    requestTaskDeletion(anchoredOf("Aufgaben/A.md", ANCHORED));
    vi.advanceTimersByTime(UNDO_SEND_MS);
    const order = pendingTaskDeletions()[0];

    resolveTaskDeletion(order, "retry");
    expect(pendingTaskDeletions()).toHaveLength(1);
    resolveTaskDeletion(order, "conflict");
    expect(pendingTaskDeletions()).toEqual([]);
  });

  it("the session ending cancels instead of flushing", () => {
    requestTaskDeletion(anchoredOf("Aufgaben/A.md", ANCHORED));
    window.dispatchEvent(new Event("beforeunload"));
    vi.advanceTimersByTime(UNDO_SEND_MS * 2);
    // Mail flushes here because a message must not vanish. A deletion is the
    // other way round: the safe end of an interrupted one is that the task
    // still exists.
    expect(pendingTaskDeletions()).toEqual([]);
    expect(synced).toBe(0);
  });
});
