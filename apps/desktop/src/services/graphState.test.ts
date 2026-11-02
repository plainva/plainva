// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IVaultAdapter } from "@plainva/core";
import { getGraphState, GraphStateStore, suggestionKey } from "./graphState";

function fakeAdapter(initial?: string): IVaultAdapter & { written: Record<string, string> } {
  const written: Record<string, string> = {};
  return {
    written,
    initialize: async () => {},
    dispose: async () => {},
    readTextFile: async (path: string) => {
      if (written[path] !== undefined) return written[path];
      if (initial !== undefined && path === ".plainva/graph.json") return initial;
      throw new Error("not found");
    },
    readBinaryFile: async () => new Uint8Array(),
    writeTextFile: async (path: string, content: string) => {
      written[path] = content;
    },
    writeBinaryFile: async () => {},
    deleteItem: async () => {},
    renameItem: async () => {},
    exists: async () => false,
    getFileInfo: async () => ({ path: "", name: "", isDirectory: false, size: 0, mtime: 0 }),
    listDir: async () => [],
    createDir: async () => {},
  };
}

describe("graphState", () => {
  it("two views loading at once both get the file's pins, and the second one's change keeps them", async () => {
    // The second caller used to get "loaded" over the EMPTY state while the first read was under way:
    // no pins shown, and its first change (the overlay mode a map sets as it opens) wrote the empty state.
    const raw = JSON.stringify({ version: 1, vaultLayout: 2, pins: { "base:a.base#Map": { N: { x: 1, y: 2 } } }, dismissedSuggestions: [] });
    const adapter = fakeAdapter(raw);
    // A disk takes its time: the second view asks while the first read is under way.
    const read = adapter.readTextFile;
    let release!: () => void;
    const disk = new Promise<void>((resolve) => (release = resolve));
    adapter.readTextFile = async (path: string) => {
      await disk;
      return read(path);
    };
    const store = new GraphStateStore(adapter);
    const first = store.load();
    const second = store.load();
    // The second caller waits for the read rather than being answered over the empty state.
    expect(await Promise.race([second.then(() => "answered"), Promise.resolve().then(() => "waiting")])).toBe("waiting");
    release();
    await second;
    expect(store.getPins("base:a.base#Map")).toEqual({ N: { x: 1, y: 2 } });
    store.setMapMode("heatmap");
    await store.flush();
    await first;
    expect(JSON.parse(adapter.written[".plainva/graph.json"]).pins["base:a.base#Map"]).toEqual({ N: { x: 1, y: 2 } });
  });

  it("roundtrips special context and node names without touching prototypes", async () => {
    const raw = '{"version":1,"vaultLayout":2,"pins":{"__proto__":{"constructor":{"x":1,"y":2}},"constructor":{"__proto__":{"x":3,"y":4}}},"pinModes":{"__proto__":false}}';
    const adapter = fakeAdapter(raw), store = new GraphStateStore(adapter);
    const prototype = Object.getOwnPropertyDescriptors(Object.prototype);
    await store.load();
    expect(Object.getPrototypeOf(store.getPins("__proto__"))).toBeNull();
    expect(store.getPins("__proto__").constructor).toEqual({ x: 1, y: 2 });
    expect(store.getPinMode("__proto__")).toBe(false);
    store.setPin("__proto__", "toString", { x: 5, y: 6 });
    store.setPin("constructor", "__proto__", { x: 7, y: 8 });
    store.setPinMode("toString", false);
    await store.flush();
    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(prototype);
    const reopened = new GraphStateStore(adapter);
    await reopened.load();
    expect(reopened.getPins("constructor").__proto__).toEqual({ x: 7, y: 8 });
    expect(reopened.getPins("__proto__").toString).toEqual({ x: 5, y: 6 });
    expect(reopened.getPinMode("toString")).toBe(false);
    expect(reopened.getPins("other")).toEqual({});
  });

  it("rejects malformed pin buckets and non-finite coordinates", async () => {
    const store = new GraphStateStore(fakeAdapter('{"version":1,"vaultLayout":2,"pins":{"array":[],"bad":null,"vault":{"ok":{"x":1,"y":2},"bad":{"x":"3","y":4},"inf":{"x":1e999,"y":2}}}}'));
    await store.load();
    for (const x of [NaN, Infinity, Number.MAX_VALUE]) store.setPin("vault", "bad", { x, y: 0 });
    expect(store.getPins("vault")).toEqual({ ok: { x: 1, y: 2 } });
    expect(store.getPins("array")).toEqual({});
    expect(store.getPins("bad")).toEqual({});
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("loads pins and dismissed keys, treats corrupt files as empty", async () => {
    const good = new GraphStateStore(
      fakeAdapter(
        JSON.stringify({ version: 1, vaultLayout: 2, pins: { vault: { "a.md": { x: 1, y: 2 } } }, dismissedSuggestions: ["k"] })
      )
    );
    await good.load();
    expect(good.getPins("vault")).toEqual({ "a.md": { x: 1, y: 2 } });
    expect(good.isDismissed("k")).toBe(true);

    const corrupt = new GraphStateStore(fakeAdapter("{nope"));
    await corrupt.load();
    expect(corrupt.getPins("vault")).toEqual({});

    const missing = new GraphStateStore(fakeAdapter());
    await missing.load();
    expect(missing.getPins("vault")).toEqual({});
  });

  it("drops flat-era vault pins once (layout generation migration), keeping other contexts", async () => {
    // A pre-A4 file has no vaultLayout stamp: its vault-map pins live in the
    // FLAT layout's coordinate space and would blow up the container circles.
    const adapter = fakeAdapter(
      JSON.stringify({
        version: 1,
        pins: {
          vault: { "a.md": { x: 2000, y: -1500 }, "folder:P": { x: 900, y: 900 } },
          "context:n.md": { "b.md": { x: 3, y: 4 } },
          "base:x#v": { "c.md": { x: 5, y: 6 } },
        },
        dismissedSuggestions: [],
      })
    );
    const store = new GraphStateStore(adapter);
    await store.load();
    expect(store.getPins("vault")).toEqual({}); // discarded
    expect(store.getPins("context:n.md")).toEqual({ "b.md": { x: 3, y: 4 } }); // untouched
    expect(store.getPins("base:x#v")).toEqual({ "c.md": { x: 5, y: 6 } }); // untouched
    // The migration persists the stamped file so it never runs again.
    await vi.advanceTimersByTimeAsync(900);
    const file = JSON.parse(adapter.written[".plainva/graph.json"]);
    expect(file.vaultLayout).toBe(2);
    expect(file.pins.vault).toBeUndefined();

    // A current-generation file is NOT rewritten on load.
    const current = fakeAdapter(
      JSON.stringify({ version: 1, vaultLayout: 2, pins: { vault: { "a.md": { x: 1, y: 2 } } }, dismissedSuggestions: [] })
    );
    const stamped = new GraphStateStore(current);
    await stamped.load();
    await vi.advanceTimersByTimeAsync(900);
    expect(stamped.getPins("vault")).toEqual({ "a.md": { x: 1, y: 2 } });
    expect(current.written[".plainva/graph.json"]).toBeUndefined();
  });

  it("persists debounced writes to .plainva/graph.json and drops empty pin buckets", async () => {
    const adapter = fakeAdapter();
    const store = new GraphStateStore(adapter);
    await store.load();

    store.setPin("vault", "a.md", { x: 10.123, y: -4 });
    store.dismissSuggestion(suggestionKey("mention", "s.md", "t.md"));
    expect(adapter.written[".plainva/graph.json"]).toBeUndefined(); // debounced

    await vi.advanceTimersByTimeAsync(900);
    const file = JSON.parse(adapter.written[".plainva/graph.json"]);
    expect(file.pins.vault["a.md"]).toEqual({ x: 10.12, y: -4 });
    expect(file.dismissedSuggestions).toEqual([suggestionKey("mention", "s.md", "t.md")]);

    store.setPin("vault", "a.md", null);
    await vi.advanceTimersByTimeAsync(900);
    const after = JSON.parse(adapter.written[".plainva/graph.json"]);
    expect(after.pins).toEqual({});
  });

  it("remembers per-context pin mode, defaults on, and drops it when re-enabled", async () => {
    const adapter = fakeAdapter();
    const store = new GraphStateStore(adapter);
    await store.load();
    expect(store.getPinMode("vault")).toBe(true); // default ON

    store.setPinMode("vault", false);
    expect(store.getPinMode("vault")).toBe(false);
    await vi.advanceTimersByTimeAsync(900);
    expect(JSON.parse(adapter.written[".plainva/graph.json"]).pinModes).toEqual({ vault: false });

    store.setPinMode("vault", true);
    expect(store.getPinMode("vault")).toBe(true);
    await vi.advanceTimersByTimeAsync(900);
    expect(JSON.parse(adapter.written[".plainva/graph.json"]).pinModes).toBeUndefined();

    const loaded = new GraphStateStore(
      fakeAdapter(JSON.stringify({ version: 1, pins: {}, dismissedSuggestions: [], pinModes: { "base:x#v": false } }))
    );
    await loaded.load();
    expect(loaded.getPinMode("base:x#v")).toBe(false);
    expect(loaded.getPinMode("other")).toBe(true);
  });

  it("clearPins removes exactly one context and leaves the others", async () => {
    const store = new GraphStateStore(fakeAdapter());
    await store.load();
    store.setPin("vault", "a.md", { x: 1, y: 2 });
    store.setPin("context:x.md", "b.md", { x: 3, y: 4 });
    store.clearPins("vault");
    expect(store.getPins("vault")).toEqual({});
    expect(store.getPins("context:x.md")).toEqual({ "b.md": { x: 3, y: 4 } });
  });

  it("flush writes immediately and getGraphState caches per adapter", async () => {
    const adapter = fakeAdapter();
    const store = getGraphState(adapter);
    expect(getGraphState(adapter)).toBe(store);
    await store.load();
    store.setMapMode("heatmap");
    await store.flush();
    expect(JSON.parse(adapter.written[".plainva/graph.json"]).mapMode).toBe("heatmap");
  });
});
