import { describe, it, expect, vi } from "vitest";
import { createWindowBus, OWNER_LABEL, type BusTransport } from "./windowBus";

/**
 * The wire every auxiliary window's mutation rides on (multi-window P0/P1).
 *
 * A dropped write is the one failure this design must not have, so what is
 * pinned here is not the happy path but the four ways a request can go wrong:
 * the owner throws, the owner never answers, a stale reply arrives, and a
 * window hears its own broadcast.
 */

/** An in-memory bus wire: every transport on it sees every emission. */
function createWire() {
  const listeners = new Map<string, Set<{ label: string; fn: (payload: unknown) => void }>>();
  const make = (label: string): BusTransport => ({
    label,
    async emit(event, payload) {
      for (const entry of listeners.get(event) ?? []) entry.fn(payload);
    },
    async emitTo(target, event, payload) {
      for (const entry of listeners.get(event) ?? []) if (entry.label === target) entry.fn(payload);
    },
    async listen(event, handler) {
      const entry = { label, fn: handler };
      const set = listeners.get(event) ?? new Set();
      set.add(entry);
      listeners.set(event, set);
      return () => set.delete(entry);
    },
  });
  return { make };
}

describe("window bus", () => {
  it("carries a request to the owner and the result back", async () => {
    const wire = createWire();
    const owner = createWindowBus(wire.make(OWNER_LABEL));
    const aux = createWindowBus(wire.make("aux-1"));

    const written: Array<{ path: string; content: string }> = [];
    await owner.handle("write", async (args) => {
      written.push(args);
    });

    await aux.request("write", { path: "Note.md", content: "hello" });
    expect(written).toEqual([{ path: "Note.md", content: "hello" }]);
  });

  it("rejects the caller when the owner's handler throws", async () => {
    const wire = createWire();
    const owner = createWindowBus(wire.make(OWNER_LABEL));
    const aux = createWindowBus(wire.make("aux-1"));

    await owner.handle("write", async () => {
      throw new Error("disk is full");
    });

    // The failure must reach the window that asked. A resolved promise here
    // would let an editor believe it saved.
    await expect(aux.request("write", { path: "A.md", content: "x" })).rejects.toThrow(/disk is full/);
  });

  it("gives up rather than hanging when the owner never answers", async () => {
    vi.useFakeTimers();
    try {
      const wire = createWire();
      const aux = createWindowBus(wire.make("aux-1"), 50);
      // No owner on the wire at all.
      const p = aux.request("write", { path: "A.md", content: "x" });
      const assertion = expect(p).rejects.toThrow(/timed out|timeout/i);
      await vi.advanceTimersByTimeAsync(60);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a reply for a request it is not waiting for", async () => {
    const wire = createWire();
    const transport = wire.make("aux-1");
    const aux = createWindowBus(transport);
    const owner = createWindowBus(wire.make(OWNER_LABEL));
    await owner.handle("mkdir", async () => {});

    // One real round trip so the reply listener exists…
    await aux.request("mkdir", { path: "Folder" });
    // …then a reply nobody is waiting for. It must not throw.
    await expect(
      transport.emit("pv:rpc-reply", { id: "does-not-exist", ok: false, error: "boom" }),
    ).resolves.toBeUndefined();
  });

  it("does not deliver a window its own broadcast", async () => {
    const wire = createWire();
    const owner = createWindowBus(wire.make(OWNER_LABEL));
    const aux = createWindowBus(wire.make("aux-1"));

    const ownerHeard: string[] = [];
    const auxHeard: string[] = [];
    await owner.onBroadcast("note-saved", ({ path }) => ownerHeard.push(path));
    await aux.onBroadcast("note-saved", ({ path }) => auxHeard.push(path));

    await owner.broadcast("note-saved", { path: "A.md" });

    // Tauri delivers an emission to the sender too; without the filter the
    // owner's own refresh would bounce back into it.
    expect(ownerHeard).toEqual([]);
    expect(auxHeard).toEqual(["A.md"]);
  });

  it("only routes the channel that was subscribed to", async () => {
    const wire = createWire();
    const owner = createWindowBus(wire.make(OWNER_LABEL));
    const aux = createWindowBus(wire.make("aux-1"));

    const heard: string[] = [];
    await aux.onBroadcast("note-saved", ({ path }) => heard.push(path));
    await owner.broadcast("file-changed", { path: "B.md" });
    await owner.broadcast("note-saved", { path: "A.md" });

    expect(heard).toEqual(["A.md"]);
  });

  it("drops its subscriptions on dispose", async () => {
    const wire = createWire();
    const owner = createWindowBus(wire.make(OWNER_LABEL));
    const aux = createWindowBus(wire.make("aux-1"));

    const heard: string[] = [];
    await aux.onBroadcast("note-saved", ({ path }) => heard.push(path));
    await aux.dispose();
    await owner.broadcast("note-saved", { path: "A.md" });

    expect(heard).toEqual([]);
  });
});
