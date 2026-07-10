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
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("loads pins and dismissed keys, treats corrupt files as empty", async () => {
    const good = new GraphStateStore(
      fakeAdapter(JSON.stringify({ version: 1, pins: { vault: { "a.md": { x: 1, y: 2 } } }, dismissedSuggestions: ["k"] }))
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
