// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { installRevealPathListener, requestRevealInTree } from "./revealRouting";
import { setWindowBusForTest, type WindowBus } from "./windowBus";

/**
 * The client side of "reveal in tree" across windows (finding 2026-09-07):
 * what the auxiliary window asks, and what a full window does when the owner
 * picks it. The routing decision itself is pinned in ownerBus.test.ts.
 */

function fakeBus(opts: { answer?: { where: "owner" | "window" | "none" }; fail?: boolean; broadcasts?: Array<(p: unknown) => void> }): WindowBus {
  return {
    label: "aux-1",
    async broadcast() {},
    async onBroadcast(_channel, handler) {
      opts.broadcasts?.push(handler as (p: unknown) => void);
      return () => {};
    },
    async request(kind) {
      if (opts.fail) throw new Error("no owner");
      if (kind !== "reveal-in-tree") throw new Error("unexpected " + kind);
      return (opts.answer ?? { where: "owner" }) as never;
    },
    async handle() {
      return () => {};
    },
    async dispose() {},
  };
}

afterEach(() => setWindowBusForTest(null));

describe("asking for a tree", () => {
  it("passes the owner's answer through", async () => {
    setWindowBusForTest(fakeBus({ answer: { where: "window" } }));
    expect(await requestRevealInTree("Notes/A.md")).toBe("window");
  });

  it("reports an owner that does not answer instead of throwing", async () => {
    // The finding was a click that did nothing; an exception here would be
    // the same thing with a stack trace.
    setWindowBusForTest(fakeBus({ fail: true }));
    expect(await requestRevealInTree("Notes/A.md")).toBe("unreachable");
  });
});

describe("a full window that was picked", () => {
  it("reacts to its own label and ignores another window's", async () => {
    const handlers: Array<(p: unknown) => void> = [];
    setWindowBusForTest(fakeBus({ broadcasts: handlers }));
    const revealed: string[] = [];
    await installRevealPathListener("full-1", (path) => revealed.push(path));

    handlers[0]({ label: "full-2", path: "Other.md" });
    handlers[0]({ label: "full-1", path: "Mine.md" });

    expect(revealed).toEqual(["Mine.md"]);
  });
});
