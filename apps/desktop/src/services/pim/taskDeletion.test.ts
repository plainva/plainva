// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * The window between a confirmed deletion and the provider call (E4c).
 *
 * Every assertion here is built around the ABSENCE of a call — the same shape
 * the mail undo test uses, and for the same reason: "nothing happened yet" is
 * the whole promise the window makes.
 */

/**
 * The toast is observed through the REAL store rather than a mock. The module
 * moved into `packages/ui` and now reaches the store through a
 * package-internal relative path, which a mock on the `@plainva/ui` specifier
 * no longer intercepts — and observing the store is the stronger assertion
 * anyway: it checks what the reader actually gets, including that the toast is
 * persistent (the window owns its length, not the toast's own timer).
 */
import { toast, toastStore } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";

import {
  requestTaskDeletion,
  pendingTaskDeletions,
  taskDeletionsInFlight,
  resolveTaskDeletion,
  initTaskDeletion,
  collectTaskAnchors,
  __resetTaskDeletionsForTest,
  cancelInFlightTaskDeletion,
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
    toast.clearAll();
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
    const shown = toastStore.get();
    expect(shown).toHaveLength(1);
    // Persistent: the window owns its length, not the toast's auto-dismiss.
    expect(shown[0].persistent).toBe(true);
    expect(shown[0].action?.label).toBe(i18n.t("common.undo"));
  });

  it("the order is armed when the window closes, and the toast goes with it", () => {
    requestTaskDeletion(anchoredOf("Aufgaben/Steuern einreichen.md", ANCHORED));
    vi.advanceTimersByTime(UNDO_SEND_MS);
    expect(pendingTaskDeletions()).toEqual([
      { notePath: "Aufgaben/Steuern einreichen.md", uid: "u1", list: "l1", provider: "caldav" },
    ]);
    // A visible "undo" that no longer works would be worse than no button.
    expect(toastStore.get()).toEqual([]);
    expect(synced).toBe(1);
  });

  it("undo brings the note back WITH its body and orders nothing", async () => {
    requestTaskDeletion(anchoredOf("Aufgaben/Steuern einreichen.md", ANCHORED));
    toastStore.get()[0].action!.run();
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
    expect(toastStore.get()).toEqual([]);
    expect(pendingTaskDeletions()).toEqual([]);
  });

  it("going away cancels the window rather than carrying it out", () => {
    // The shell-side half of decision 2: the desktop calls this from
    // `beforeunload`, the phone from `appStateChange`. Mail does the opposite
    // on the very same mobile event — a message asked to be sent must not
    // vanish — while here the safe outcome is that the task survives.
    requestTaskDeletion(anchoredOf("Aufgaben/Steuern einreichen.md", ANCHORED));
    cancelInFlightTaskDeletion();
    vi.advanceTimersByTime(UNDO_SEND_MS * 2);
    expect(pendingTaskDeletions()).toEqual([]);
    expect(synced).toBe(0);
  });

  it("cancelling on the way out leaves the note alone", async () => {
    // Cancel, not undo: the note is already deleted and stays deleted. Only the
    // PROVIDER task survives. Restoring here would resurrect a file the reader
    // deliberately removed.
    requestTaskDeletion(anchoredOf("Aufgaben/Steuern einreichen.md", ANCHORED));
    cancelInFlightTaskDeletion();
    await vi.runOnlyPendingTimersAsync();
    expect(written).toEqual([]);
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
