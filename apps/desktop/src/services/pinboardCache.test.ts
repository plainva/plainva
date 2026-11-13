import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

describe("one pinboard cache per vault, in both shells", () => {
  // The cache is kept per index object. The database screen, the board and the
  // close of a vault must name the SAME object: the phone's board once took the
  // reader while its database screen took the view (performance plan L3), and
  // the entry page lost the board's active label (CI smoke, 13.11.).
  it("is keyed by the index as it is shown (the view), never by the reader", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === "dist") continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.|\.spec\./.test(name)) files.push(full);
      }
    };
    for (const shell of ["apps/desktop/src", "apps/mobile/src"]) walk(join(root, shell));
    // Each call's argument, read to its closing parenthesis.
    const argument = (text: string, open: number): string => {
      let depth = 1;
      for (let i = open + 1; i < text.length; i++) {
        if (text[i] === "(") depth++;
        else if (text[i] === ")" && --depth === 0) return text.slice(open + 1, i);
      }
      return text.slice(open + 1);
    };
    const calls = files.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return [...text.matchAll(/\b(?:clearPinboardCache|pinboardCache)\(/g)].map((m) => argument(text, m.index! + m[0].length - 1));
    });
    expect(calls.length).toBeGreaterThanOrEqual(5);
    expect(calls.filter((call) => /queryService/.test(call.replace(/queryService\??\.view\(\)/g, "")))).toEqual([]);
  });
});
