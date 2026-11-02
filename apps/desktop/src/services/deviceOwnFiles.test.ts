// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { IVaultAdapter } from "@plainva/core";
import { setPlatformServices, type PlatformServices } from "@plainva/ui";
import { loadRecents, pushRecent, forgetRecent } from "./recents";
import { GraphStateStore } from "./graphState";

/**
 * Pins of the map and the recently opened notes are one device's own
 * (decision E7, Sammelplan § 3.127 Nr. 3). A vault folder that a file service
 * carries between devices (Dropbox, iCloud Drive, a network share) used to
 * carry ONE `recents.json` and ONE `graph.json` for all of them: whoever wrote
 * last had the file. Here two devices share one folder, each with its own id.
 */

let device = "device-A";
setPlatformServices({ deviceId: () => Promise.resolve(device) } as unknown as PlatformServices);

/** One folder, seen by several devices: reads and writes take a turn of the event loop, as a disk does. */
function sharedFolder(files: Record<string, string> = {}) {
  const store: Record<string, string> = { ...files };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const writes: string[] = [];
  const adapter = () =>
    ({
      readTextFile: async (p: string) => {
        await tick();
        if (!(p in store)) throw new Error(`ENOENT ${p}`);
        return store[p];
      },
      writeTextFile: async (p: string, c: string) => {
        await tick();
        store[p] = c;
        writes.push(p);
      },
      exists: async (p: string) => p in store,
      createDir: async () => undefined,
    }) as unknown as IVaultAdapter;
  return { store, writes, adapter };
}

const OLD_RECENTS = JSON.stringify({ items: [{ path: "Old.md", openedAt: 1 }] });

describe("recently opened notes: one list per device", () => {
  it("two devices opening a note at the same moment both keep it — and both keep what the vault had", async () => {
    const folder = sharedFolder({ "A.md": "a", "B.md": "b", "Old.md": "o", ".plainva/recents.json": OLD_RECENTS });
    const onA = folder.adapter(), onB = folder.adapter();
    device = "device-A";
    const a = pushRecent(onA, "A.md", 10);
    device = "device-B";
    const b = pushRecent(onB, "B.md", 11);
    await Promise.all([a, b]);

    device = "device-A";
    expect(await loadRecents(onA, "/vault")).toEqual(["A.md", "Old.md"]);
    device = "device-B";
    expect(await loadRecents(onB, "/vault")).toEqual(["B.md", "Old.md"]);
    // The shared file of older versions is neither written nor deleted.
    expect(folder.store[".plainva/recents.json"]).toBe(OLD_RECENTS);
    expect(folder.writes.sort()).toEqual([".plainva/recents.device-A.json", ".plainva/recents.device-B.json"].sort());
  });

  it("two opens on one device in the same moment both land", async () => {
    const folder = sharedFolder({ "A.md": "a", "B.md": "b" });
    device = "device-A";
    const onA = folder.adapter();
    await Promise.all([pushRecent(onA, "A.md", 1), pushRecent(onA, "B.md", 2)]);
    expect(await loadRecents(onA, "/vault")).toEqual(["B.md", "A.md"]);
  });

  it("once a device has its own list, what an older version writes to the shared file does not change it", async () => {
    const folder = sharedFolder({ "A.md": "a", "Old.md": "o", "Elsewhere.md": "e", ".plainva/recents.json": OLD_RECENTS });
    device = "device-A";
    const onA = folder.adapter();
    await pushRecent(onA, "A.md", 10);
    folder.store[".plainva/recents.json"] = JSON.stringify({ items: [{ path: "Elsewhere.md", openedAt: 99 }] });
    expect(await loadRecents(onA, "/vault")).toEqual(["A.md", "Old.md"]);
    expect(await forgetRecent(onA, "Old.md")).toEqual(["A.md"]);
  });
});

describe("pins of the map: one file per device", () => {
  const OLD_GRAPH = JSON.stringify({ version: 1, vaultLayout: 2, pins: { "base:x.base#Map": { Old: { x: 1, y: 1 } } }, dismissedSuggestions: ["s1"] });

  it("two devices pinning at the same moment both keep their pin — and both keep the pins the vault had", async () => {
    const folder = sharedFolder({ ".plainva/graph.json": OLD_GRAPH });
    device = "device-A";
    const storeA = new GraphStateStore(folder.adapter());
    const loadA = storeA.load();
    device = "device-B";
    const storeB = new GraphStateStore(folder.adapter());
    await Promise.all([loadA, storeB.load()]);
    storeA.setPin("vault", "A", { x: 10, y: 10 });
    storeB.setPin("vault", "B", { x: 20, y: 20 });
    await Promise.all([storeA.flush(), storeB.flush()]);

    device = "device-A";
    const againA = new GraphStateStore(folder.adapter());
    await againA.load();
    device = "device-B";
    const againB = new GraphStateStore(folder.adapter());
    await againB.load();
    expect(againA.getPins("vault")).toEqual({ A: { x: 10, y: 10 } });
    expect(againB.getPins("vault")).toEqual({ B: { x: 20, y: 20 } });
    for (const store of [againA, againB]) {
      expect(store.getPins("base:x.base#Map")).toEqual({ Old: { x: 1, y: 1 } });
      expect(store.isDismissed("s1")).toBe(true);
    }
    expect(folder.store[".plainva/graph.json"]).toBe(OLD_GRAPH);
  });
});
