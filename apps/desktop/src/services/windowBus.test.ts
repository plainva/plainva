import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BROADCAST_SCOPE, RPC_SCOPE, createWindowBus, OWNER_LABEL, type BusTransport } from "./windowBus";

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

    await owner.broadcast("note-saved", { path: "A.md" }, null);

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
    await owner.broadcast("file-changed", { path: "B.md" }, null);
    await owner.broadcast("note-saved", { path: "A.md" }, null);

    expect(heard).toEqual(["A.md"]);
  });

  it("drops its subscriptions on dispose", async () => {
    const wire = createWire();
    const owner = createWindowBus(wire.make(OWNER_LABEL));
    const aux = createWindowBus(wire.make("aux-1"));

    const heard: string[] = [];
    await aux.onBroadcast("note-saved", ({ path }) => heard.push(path));
    await aux.dispose();
    await owner.broadcast("note-saved", { path: "A.md" }, null);

    expect(heard).toEqual([]);
  });
});

/**
 * Two vaults in one process (stage D).
 *
 * From the moment a second vault can be open, an unaddressed message is a
 * guess. These pin the two halves of the answer: a window ignores what is not
 * about its vault, and a request is served by the runtime the caller named —
 * never by whichever of them replies first.
 */
describe("window bus addressing (stage D)", () => {
  it("delivers a vault message only to the windows on that vault", async () => {
    const wire = createWire();
    const owner = createWindowBus(wire.make(OWNER_LABEL), undefined, () => "/A");
    const onA = createWindowBus(wire.make("full-1"), undefined, () => "/A");
    const onB = createWindowBus(wire.make("full-2"), undefined, () => "/B");

    const heardA: string[] = [];
    const heardB: string[] = [];
    await onA.onBroadcast("index-changed", ({ paths }) => heardA.push(...paths));
    await onB.onBroadcast("index-changed", ({ paths }) => heardB.push(...paths));

    await owner.broadcast("index-changed", { paths: ["A.md"], structural: false }, "/A");

    // The window on B refreshing here would re-query a tree that never moved —
    // and on a large vault that is a visible stall for a change it cannot see.
    expect(heardA).toEqual(["A.md"]);
    expect(heardB).toEqual([]);
  });

  it("delivers an app message to every window whatever vault it shows", async () => {
    const wire = createWire();
    const owner = createWindowBus(wire.make(OWNER_LABEL), undefined, () => "/A");
    const onB = createWindowBus(wire.make("full-2"), undefined, () => "/B");

    const heard: string[] = [];
    await onB.onBroadcast("settings-changed", ({ domain }) => heard.push(domain));
    await owner.broadcast("settings-changed", { domain: "appearance" }, null);

    // A theme change belongs to the process. Filtering it by vault would leave
    // the second window in the old colours. An unaddressed message reaches
    // everyone on purpose — a channel somebody forgot to address must arrive
    // rather than vanish, so the classification is asserted here as well.
    expect(heard).toEqual(["appearance"]);
    expect(BROADCAST_SCOPE["settings-changed"]).toBe("app");
  });

  it("lets the runtime the caller named serve the write, and only that one", async () => {
    const wire = createWire();
    const runtimeA = createWindowBus(wire.make(OWNER_LABEL), undefined, () => "/A");
    const client = createWindowBus(wire.make("full-2"), undefined, () => "/B");

    const toA: string[] = [];
    const toB: string[] = [];
    // Both runtimes live in the central window and register the same kind.
    await runtimeA.handle("write", async ({ path }) => { toA.push(path); }, { vaultPath: "/A" });
    await runtimeA.handle("write", async ({ path }) => { toB.push(path); }, { vaultPath: "/B" });

    await client.request("write", { path: "Note.md", content: "x" });

    // The wrong runtime answering means the wrong adapter chain: the write would
    // land in another vault, or in none at all.
    expect(toB).toEqual(["Note.md"]);
    expect(toA).toEqual([]);
  });

  it("leaves an unaddressed request to the handlers that belong to no vault", async () => {
    const wire = createWire();
    const owner = createWindowBus(wire.make(OWNER_LABEL));
    const stray = createWindowBus(wire.make("compose-1"), 20, () => null);

    const bound: string[] = [];
    await owner.handle("write", async ({ path }) => { bound.push(path); }, { vaultPath: "/A" });

    // A window that names no vault cannot be guessed at: a bound handler that
    // took the request would pick a vault on the caller's behalf.
    await expect(stray.request("write", { path: "N.md", content: "x" })).rejects.toThrow(/timed out/);
    expect(bound).toEqual([]);
  });

  it("hands the caller's vault to the handlers that route by it", async () => {
    const wire = createWire();
    const owner = createWindowBus(wire.make(OWNER_LABEL), undefined, () => "/A");
    const client = createWindowBus(wire.make("full-2"), undefined, () => "/B");

    let seen: string | null = "unset";
    await owner.handle("focus-content", async (_args, _from, vaultPath) => {
      seen = vaultPath;
      return false;
    });

    await client.request("focus-content", { path: "N.md" });

    // "Who has this file open" is a question about the ASKING window's vault,
    // not about the one the central window happens to show.
    expect(seen).toBe("/B");
    expect(RPC_SCOPE["focus-content"]).toBe("app");
  });
});

/**
 * The guard that keeps the address from rotting away again.
 *
 * The classification is enforced by the compiler — a `Record` over the map keys
 * cannot miss one — and the third argument of `broadcast` cannot be forgotten
 * because it is required. Both of those are only guards while they keep their
 * shape, so that shape is what is pinned here: widening either map to `string`
 * would silently turn a compile error back into a runtime surprise.
 */
describe("addressing guard (stage D)", () => {
  const source = readFileSync(fileURLToPath(new URL("./windowBus.ts", import.meta.url)), "utf8");

  it("classifies every channel and every request kind, checked by the compiler", () => {
    expect(source).toContain('export const BROADCAST_SCOPE: Record<BroadcastChannel, "vault" | "app">');
    expect(source).toContain('export const RPC_SCOPE: Record<RpcKind, "vault" | "app">');
    // Every key of the two maps really is a message kind, so a stale entry left
    // behind by a removed channel shows up as a compile error too.
    expect(Object.keys(BROADCAST_SCOPE).length).toBeGreaterThan(0);
    expect(Object.keys(RPC_SCOPE).length).toBeGreaterThan(0);
  });

  it("makes the address of a broadcast impossible to forget", () => {
    // Required, not optional: a new emitter has to decide which vault it means,
    // and `null` is one of the two answers rather than the absence of one.
    expect(source).toMatch(/broadcast<C extends BroadcastChannel>\(\s*channel: C,\s*payload: BroadcastMap\[C\],\s*vaultPath: string \| null,/);
  });
});
