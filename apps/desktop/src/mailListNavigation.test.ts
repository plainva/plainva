import { describe, expect, it } from "vitest";
import { flatMailRows, mailListKeyAction, stepMailRow, threadNavId, threadedMailRows } from "@plainva/ui/mail";

/**
 * Arrow keys through the message list (2026-09-04). The list had no keyboard
 * path at all; these pin the pure half — which rows exist on screen and where
 * a key lands — so the shell's handler is wiring, not logic.
 */

const msg = (id: string, mailbox = "INBOX") => ({ id, mailbox });
const single = (id: string) => ({ thread: { key: `t-${id}`, messages: [msg(id)] }, latest: msg(id), count: 1 });
const thread = (key: string, ids: string[]) => ({
  thread: { key, messages: ids.map((id, i) => msg(id, i === 1 ? "Sent" : "INBOX")) },
  latest: msg(ids[ids.length - 1]),
  count: ids.length,
});

describe("mail list rows", () => {
  it("flattens a folded conversation to one row and an unfolded one to header plus messages, in screen order", () => {
    const rows = [single("a"), thread("k", ["b", "c"]), single("d")];
    expect(threadedMailRows(rows, new Set()).map((r) => r.id)).toEqual(["a", threadNavId("k"), "d"]);
    const open = threadedMailRows(rows, new Set(["k"]));
    expect(open.map((r) => r.id)).toEqual(["a", threadNavId("k"), "b", "c", "d"]);
    // A message inside a conversation keeps its own folder: opening it must
    // fetch from Sent, not from the folder on screen.
    expect(open[3]).toMatchObject({ kind: "message", mailbox: "Sent", threadKey: "k" });
    expect(open[1]).toMatchObject({ kind: "thread", open: true });
  });

  it("keeps the flat list flat", () => {
    expect(flatMailRows([{ id: "x" }, { id: "y" }]).map((r) => r.id)).toEqual(["x", "y"]);
  });
});

describe("stepping", () => {
  const rows = flatMailRows([{ id: "a" }, { id: "b" }, { id: "c" }]);

  it("moves one row and stops at both ends instead of wrapping", () => {
    expect(stepMailRow(rows, "a", "next")?.id).toBe("b");
    expect(stepMailRow(rows, "c", "next")?.id).toBe("c");
    expect(stepMailRow(rows, "b", "prev")?.id).toBe("a");
    expect(stepMailRow(rows, "a", "prev")?.id).toBe("a");
  });

  it("enters at the top with Down and at the bottom with Up when nothing is current", () => {
    expect(stepMailRow(rows, null, "next")?.id).toBe("a");
    expect(stepMailRow(rows, null, "prev")?.id).toBe("c");
    // A current id that left the list (filter, refresh) behaves like none.
    expect(stepMailRow(rows, "gone", "next")?.id).toBe("a");
  });

  it("jumps to the first and last row, and yields nothing on an empty list", () => {
    expect(stepMailRow(rows, "b", "first")?.id).toBe("a");
    expect(stepMailRow(rows, "b", "last")?.id).toBe("c");
    expect(stepMailRow([], null, "next")).toBeNull();
  });
});

describe("keys", () => {
  it("maps the six bindings and leaves everything else to the browser", () => {
    expect(mailListKeyAction("ArrowDown", false)).toEqual({ type: "move", move: "next", extend: false });
    expect(mailListKeyAction("ArrowUp", true)).toEqual({ type: "move", move: "prev", extend: true });
    expect(mailListKeyAction("Home", false)).toEqual({ type: "move", move: "first", extend: false });
    expect(mailListKeyAction("End", false)).toEqual({ type: "move", move: "last", extend: false });
    expect(mailListKeyAction("ArrowRight", false)).toEqual({ type: "thread", open: true });
    expect(mailListKeyAction("ArrowLeft", false)).toEqual({ type: "thread", open: false });
    expect(mailListKeyAction("Enter", false)).toEqual({ type: "open" });
    expect(mailListKeyAction("Delete", false)).toEqual({ type: "trash" });
    expect(mailListKeyAction("Backspace", false)).toBeNull();
    expect(mailListKeyAction("a", false)).toBeNull();
  });
});
