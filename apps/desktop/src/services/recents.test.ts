import { describe, it, expect, beforeEach } from "vitest";
import { loadRecents, pushRecent, forgetRecent, legacyRecentsKey } from "./recents";
import { GRAPH_TAB_PATH, TASKS_TAB_PATH } from "../components/graph/virtualPaths";
import type { IVaultAdapter } from "@plainva/core";

const RECENTS = ".plainva/recents.json";

/** Just enough adapter for the strip: a file map plus the calls it makes. */
function fakeAdapter(files: Record<string, string> = {}) {
  const store = { ...files };
  const adapter = {
    readTextFile: async (p: string) => {
      if (!(p in store)) throw new Error(`ENOENT ${p}`);
      return store[p];
    },
    writeTextFile: async (p: string, c: string) => {
      store[p] = c;
    },
    exists: async (p: string) => p in store,
    createDir: async () => undefined,
  } as unknown as IVaultAdapter;
  return { adapter, store };
}

beforeEach(() => {
  localStorage.clear();
});

describe("recents on the shared contract (C12/S20)", () => {
  it("keeps virtual tabs, which have no file to check", async () => {
    // The maintainer asked for Graph and Tasks to show up in the strip; an
    // existence filter that did not know about them would drop both silently.
    const { adapter } = fakeAdapter({
      [RECENTS]: JSON.stringify({
        items: [
          { path: GRAPH_TAB_PATH, openedAt: 3 },
          { path: TASKS_TAB_PATH, openedAt: 2 },
        ],
      }),
    });
    expect(await loadRecents(adapter, "/v")).toEqual([GRAPH_TAB_PATH, TASKS_TAB_PATH]);
  });

  it("drops a note whose file is gone instead of offering a dead row", async () => {
    const { adapter } = fakeAdapter({
      "Notes/Kept.md": "x",
      [RECENTS]: JSON.stringify({
        items: [
          { path: "Notes/Kept.md", openedAt: 2 },
          { path: "Notes/Renamed.md", openedAt: 1 },
        ],
      }),
    });
    expect(await loadRecents(adapter, "/v")).toEqual(["Notes/Kept.md"]);
  });

  it("keeps an entry it cannot check rather than losing it", async () => {
    const { adapter } = fakeAdapter({
      [RECENTS]: JSON.stringify({ items: [{ path: "Notes/A.md", openedAt: 1 }] }),
    });
    (adapter as unknown as { exists: () => Promise<boolean> }).exists = async () => {
      throw new Error("locked");
    };
    expect(await loadRecents(adapter, "/v")).toEqual(["Notes/A.md"]);
  });

  it("migrates the legacy list once, preserving its order, then clears the key", async () => {
    const { adapter, store } = fakeAdapter({ "a.md": "", "b.md": "", "c.md": "" });
    localStorage.setItem(legacyRecentsKey("/v"), JSON.stringify(["a.md", "b.md", "c.md"]));
    expect(await loadRecents(adapter, "/v")).toEqual(["a.md", "b.md", "c.md"]);
    expect(localStorage.getItem(legacyRecentsKey("/v"))).toBeNull();
    expect(JSON.parse(store[RECENTS]).items.map((i: { path: string }) => i.path)).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("never lets the legacy list overwrite a file that already has entries", async () => {
    // Merging two orderings would invent an order neither side had; the file
    // is the newer truth.
    const { adapter } = fakeAdapter({
      "new.md": "",
      "old.md": "",
      [RECENTS]: JSON.stringify({ items: [{ path: "new.md", openedAt: 9 }] }),
    });
    localStorage.setItem(legacyRecentsKey("/v"), JSON.stringify(["old.md"]));
    expect(await loadRecents(adapter, "/v")).toEqual(["new.md"]);
    expect(localStorage.getItem(legacyRecentsKey("/v"))).toBeNull();
  });

  it("survives a legacy value that is not an array", async () => {
    const { adapter } = fakeAdapter();
    localStorage.setItem(legacyRecentsKey("/v"), "{ broken");
    expect(await loadRecents(adapter, "/v")).toEqual([]);
  });

  it("moves a re-opened path to the front without duplicating it", async () => {
    const { adapter } = fakeAdapter({
      [RECENTS]: JSON.stringify({
        items: [
          { path: "a.md", openedAt: 2 },
          { path: "b.md", openedAt: 1 },
        ],
      }),
    });
    expect(await pushRecent(adapter, "b.md", 5)).toEqual(["b.md", "a.md"]);
  });

  it("caps the list at twenty, the same cap both shells use", async () => {
    const { adapter } = fakeAdapter();
    let list: string[] = [];
    for (let i = 0; i < 25; i++) list = await pushRecent(adapter, `n${i}.md`, i);
    expect(list).toHaveLength(20);
    expect(list[0]).toBe("n24.md");
  });

  it("caps what it hands back, even if the file on disk holds more", async () => {
    // The file can carry more than the cap — hand-edited, or written by an
    // older build. The strip must not grow because of that.
    const files: Record<string, string> = {};
    const items: Array<{ path: string; openedAt: number }> = [];
    for (let i = 0; i < 30; i++) {
      files[`n${i}.md`] = "";
      items.push({ path: `n${i}.md`, openedAt: 30 - i });
    }
    files[".plainva/recents.json"] = JSON.stringify({ items });
    const { adapter } = fakeAdapter(files);
    expect(await loadRecents(adapter, "/v")).toHaveLength(20);
  });

  it("forgets exactly one entry", async () => {
    const { adapter } = fakeAdapter({
      [RECENTS]: JSON.stringify({
        items: [
          { path: "a.md", openedAt: 2 },
          { path: "b.md", openedAt: 1 },
        ],
      }),
    });
    expect(await forgetRecent(adapter, "a.md")).toEqual(["b.md"]);
  });

  it("starts empty when the file is missing or unreadable", async () => {
    const { adapter } = fakeAdapter();
    expect(await loadRecents(adapter, "/v")).toEqual([]);
    const broken = fakeAdapter({ [RECENTS]: "{ not json" });
    expect(await loadRecents(broken.adapter, "/v")).toEqual([]);
  });
});
