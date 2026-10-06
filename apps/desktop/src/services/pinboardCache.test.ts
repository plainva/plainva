import { describe, expect, it, vi } from "vitest";
import { PinboardCache, clearPinboardCache, pinboardCache } from "../../../../packages/ui/src/base/pinboardCache";
const row = (path: string, revision = "one") => ({ "file.path": path, "file.revision": revision });
const data = (content = "saved text") => ({ content, tags: ["tag"], ctime: 1 });

describe("pinboard navigation cache", () => {
  it("reloads only changed revisions and coalesces overlapping requests", async () => {
    const cache = new PinboardCache();
    const source = { getCardData: vi.fn(async (paths: string[]) => Object.fromEntries(paths.map((path) => [path, data()]))) };
    const rows = [row("a.md"), row("b.md")];
    await Promise.all([cache.load(source, rows), cache.load(source, rows)]);
    await cache.load(source, rows);
    expect(source.getCardData).toHaveBeenCalledTimes(1);
    await cache.load(source, [row("a.md", "two"), row("b.md")]);
    expect(source.getCardData).toHaveBeenLastCalledWith(["a.md"]);
  });
  it("does not mistake missing indexed text or a failed query for an empty note", async () => {
    const cache = new PinboardCache();
    const source = { getCardData: vi.fn().mockResolvedValueOnce({ "a.md": { ...data(""), indexStatus: "missing" } }).mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ "a.md": data("") }) };
    await cache.load(source, [row("a.md")]);
    expect(cache.get(row("a.md"))).toBeUndefined();
    await expect(cache.load(source, [row("a.md")])).rejects.toThrow("offline");
    expect(cache.get(row("a.md"))).toBeUndefined();
    await cache.load(source, [row("a.md")]);
    expect(cache.get(row("a.md"))?.content).toBe("");
  });
  it("bounds previews and retains chips, search, heights and the scroll anchor per view", async () => {
    const cache = new PinboardCache(2);
    const source = { getCardData: async (paths: string[]) => Object.fromEntries(paths.map((path) => [path, data()])) };
    await cache.load(source, [row("a"), row("b"), row("c")]);
    expect(cache.get(row("a"))).toBeUndefined();
    expect(cache.get(row("c"))).toBeDefined();
    Object.assign(cache.session("board#one"), { labels: ["one"], search: "word", scrollTop: 700, anchor: { path: "c", offset: -30 } });
    cache.session("board#one").heights.set("c", 222);
    expect(cache.session("board#two").labels).toEqual([]);
    expect(cache.session("board#one")).toMatchObject({ labels: ["one"], search: "word", scrollTop: 700, anchor: { path: "c", offset: -30 } });
    expect(cache.session("board#one").heights.get("c")).toBe(222);
  });
  it("never takes a card away while the board shows it, whatever the budget says", async () => {
    // TestFlight 2026-10-04: a board of long notes read its last cards and
    // dropped its first to stay under the byte budget - the first were the
    // ones on screen, and they stood as placeholders.
    const source = { getCardData: async (paths: string[]) => Object.fromEntries(paths.map((path) => [path, data("x".repeat(1000))])) };
    const byCount = new PinboardCache(2);
    byCount.keep(["a", "b"]);
    await byCount.load(source, [row("a"), row("b"), row("c"), row("d")]);
    expect(byCount.get(row("a"))).toBeDefined();
    expect(byCount.get(row("b"))).toBeDefined();
    // What is not on screen still pays for the budget.
    expect(byCount.get(row("c"))).toBeUndefined();
    const byBytes = new PinboardCache(384, 3000);
    byBytes.keep(["a", "b"]);
    await byBytes.load(source, [row("a"), row("b"), row("c"), row("d")]);
    expect(byBytes.get(row("a"))?.content.length).toBe(1000);
    expect(byBytes.get(row("b"))).toBeDefined();
    // Once the board has moved on, the next load makes room again.
    byBytes.keep(["e"]);
    await byBytes.load(source, [row("e")]);
    expect(byBytes.get(row("e"))).toBeDefined();
    expect(byBytes.get(row("a"))).toBeUndefined();
  });
  it("rejects old completions after a newer revision and after vault disposal", async () => {
    const owner = {};
    const cache = pinboardCache(owner);
    let finish!: (result: Record<string, ReturnType<typeof data>>) => void;
    const older = cache.load({ getCardData: () => new Promise((resolve) => { finish = resolve; }) }, [row("a")]);
    await cache.load({ getCardData: async () => ({ a: data("new") }) }, [row("a", "two")]);
    finish({ a: data("old") }); await older;
    expect(cache.get(row("a", "two"))?.content).toBe("new");
    const pending = cache.load({ getCardData: () => new Promise((resolve) => { finish = resolve; }) }, [row("b")]);
    clearPinboardCache(owner);
    finish({ b: data("late") }); await pending;
    expect(cache.get(row("b"))).toBeUndefined();
    expect(pinboardCache(owner)).not.toBe(cache);
  });
});
