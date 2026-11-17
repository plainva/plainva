// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./windowBus", () => ({ getWindowBus: async () => { throw new Error("no bus here"); } }));

import { onBeforeLeaving, settleBeforeLeaving } from "./beforeLeaving";
import { countWrites, resetInflightWritesForTest } from "./inflightWrites";

/**
 * What a window does before it goes (A3, O3): a field in progress takes its
 * value its usual way, a surface with a write still to come does it now, and
 * the window says "done" only once its writes on their way have landed.
 */

const later = <T>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

afterEach(() => {
  document.body.innerHTML = "";
  resetInflightWritesForTest();
});

describe("before a window goes", () => {
  it("leaves the field in progress, and waits for the write its leaving starts", async () => {
    const written: string[] = [];
    const disk = countWrites({
      async readTextFile() {
        return "old";
      },
      async writeTextFile(_path: string, text: string) {
        await later(30, null);
        written.push(text);
      },
    });
    // A table cell: it takes its value when it is left, through a read first.
    const cell = document.createElement("input");
    cell.value = "Anna";
    cell.addEventListener("blur", () => {
      void disk.readTextFile().then(() => disk.writeTextFile("N.md", cell.value));
    });
    document.body.appendChild(cell);
    cell.focus();

    await settleBeforeLeaving();

    expect(document.activeElement).not.toBe(cell);
    expect(written).toEqual(["Anna"]);
  });

  it("has a surface with a write still to come do it now, and waits for it", async () => {
    const done: string[] = [];
    const off = onBeforeLeaving(async () => {
      await later(20, null);
      done.push("parked copy");
    });
    try {
      await settleBeforeLeaving();
    } finally {
      off();
    }
    expect(done).toEqual(["parked copy"]);
  });

  it("goes on when a surface's part fails", async () => {
    const off = onBeforeLeaving(() => {
      throw new Error("the database is gone");
    });
    try {
      await expect(settleBeforeLeaving()).resolves.toBeUndefined();
    } finally {
      off();
    }
  });
});
