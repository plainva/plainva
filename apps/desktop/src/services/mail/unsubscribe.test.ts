import { describe, expect, it } from "vitest";
import { parseUnsubscribe, preferredRoute, UndoSendQueue, secondsLeft } from "@plainva/ui/mail";

describe("parseUnsubscribe", () => {
  it("reads both routes a newsletter usually offers", () => {
    const offer = parseUnsubscribe({
      listUnsubscribe: "<mailto:bye@list.example?subject=unsubscribe>, <https://list.example/out?u=7>",
      listUnsubscribePost: null,
    });
    expect(offer.available).toBe(true);
    expect(offer.routes.map((r) => r.kind)).toEqual(["mailto", "http"]);
    expect(offer.routes[0]!.target).toBe("bye@list.example");
    expect(offer.routes[0]!.subject).toBe("unsubscribe");
  });

  it("only calls a route one-click when the SENDER promised it", () => {
    const without = parseUnsubscribe({ listUnsubscribe: "<https://x.example/out>" });
    expect(without.routes[0]!.oneClick).toBe(false);
    const with_ = parseUnsubscribe({
      listUnsubscribe: "<https://x.example/out>",
      listUnsubscribePost: "List-Unsubscribe=One-Click",
    });
    expect(with_.routes[0]!.oneClick).toBe(true);
  });

  it("drops plain http — unsubscribing over an open line names the reader", () => {
    const offer = parseUnsubscribe({ listUnsubscribe: "<http://x.example/out>" });
    expect(offer.available).toBe(false);
  });

  it("drops schemes it does not know instead of handing them to the opener", () => {
    const offer = parseUnsubscribe({ listUnsubscribe: "<javascript:alert(1)>, <file:///etc/passwd>" });
    expect(offer.routes).toEqual([]);
  });

  it("says nothing is on offer when the header is absent or empty", () => {
    expect(parseUnsubscribe({}).available).toBe(false);
    expect(parseUnsubscribe({ listUnsubscribe: "   " }).available).toBe(false);
  });

  it("prefers one-click, then a page, then a mail", () => {
    const both = parseUnsubscribe({
      listUnsubscribe: "<mailto:a@b.c>, <https://x.example/out>",
      listUnsubscribePost: "List-Unsubscribe=One-Click",
    });
    expect(preferredRoute(both)!.kind).toBe("http");
    const mailOnly = parseUnsubscribe({ listUnsubscribe: "<mailto:a@b.c>" });
    expect(preferredRoute(mailOnly)!.kind).toBe("mailto");
    expect(preferredRoute(parseUnsubscribe({}))).toBeNull();
  });
});

describe("UndoSendQueue", () => {
  const collect = () => {
    const sent: string[] = [];
    const q = new UndoSendQueue<string>(async (p) => { sent.push(p); }, 50);
    return { sent, q };
  };

  it("does not deliver during the window", async () => {
    const { sent, q } = collect();
    q.enqueue("a");
    await new Promise((r) => setTimeout(r, 10));
    expect(sent).toEqual([]);
  });

  it("delivers when the window closes", async () => {
    const { sent, q } = collect();
    q.enqueue("a");
    await new Promise((r) => setTimeout(r, 80));
    expect(sent).toEqual(["a"]);
  });

  it("cancels only its own entry — a late undo must not stop the NEXT message", async () => {
    const { sent, q } = collect();
    const first = q.enqueue("a");
    expect(q.cancel(first.id)).toBe(true);
    const second = q.enqueue("b");
    expect(q.cancel(first.id)).toBe(false);
    expect(q.current()!.id).toBe(second.id);
    await q.flush();
    expect(sent).toEqual(["b"]);
  });

  it("flushes the earlier message rather than dropping it when a second is queued", async () => {
    const { sent, q } = collect();
    q.enqueue("a");
    q.enqueue("b");
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual(["a"]);
  });

  it("flush is idempotent — background and timer must not send twice", async () => {
    const { sent, q } = collect();
    q.enqueue("a");
    await Promise.all([q.flush(), q.flush()]);
    await new Promise((r) => setTimeout(r, 80));
    expect(sent).toEqual(["a"]);
  });

  it("counts down and never goes negative", () => {
    const entry = { id: 1, payload: "x", dueAt: 1000 };
    expect(secondsLeft(entry, 0)).toBe(1);
    expect(secondsLeft(entry, 500)).toBe(1);
    expect(secondsLeft(entry, 5000)).toBe(0);
  });
});
