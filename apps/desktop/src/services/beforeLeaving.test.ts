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
      await expect(settleBeforeLeaving()).resolves.toBe("settled");
    } finally {
      off();
    }
  });

  it("does not wait past its limit for writes that keep coming, as during a sync pull — and calls that no cut", async () => {
    // A pull writes through the lowest link only; nothing of the person's is on its way.
    const disk = countWrites({ writeTextFile: () => later(40, null) }, "background");
    let going = true;
    const pull = () => {
      if (!going) return;
      void disk.writeTextFile();
      setTimeout(pull, 25);
    };
    pull();
    const started = Date.now();
    try {
      await expect(settleBeforeLeaving(300)).resolves.toBe("settled");
      expect(Date.now() - started).toBeGreaterThanOrEqual(280);
    } finally {
      going = false;
    }
  });

  it("calls a write of the person that is still on its way at the limit a cut, under a sync pull too", async () => {
    const lowest = countWrites({ writeTextFile: () => later(40, null) }, "background");
    const top = countWrites({ writeTextFile: () => new Promise<never>(() => {}) }, "person");
    let going = true;
    const pull = () => {
      if (!going) return;
      void lowest.writeTextFile();
      setTimeout(pull, 25);
    };
    pull();
    void top.writeTextFile();
    try {
      await expect(settleBeforeLeaving(300)).resolves.toBe("cut");
    } finally {
      going = false;
    }
  });

  it("does not wait past its limit for a write that never returns", async () => {
    const disk = countWrites({ writeTextFile: () => new Promise<never>(() => {}) });
    void disk.writeTextFile();
    await expect(settleBeforeLeaving(200)).resolves.toBe("cut");
  });

  it("does not wait past its limit for a surface whose part never ends", async () => {
    const off = onBeforeLeaving(() => new Promise<never>(() => {}));
    try {
      await expect(settleBeforeLeaving(200)).resolves.toBe("cut");
    } finally {
      off();
    }
  });
});
