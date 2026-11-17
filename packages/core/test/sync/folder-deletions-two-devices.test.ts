import { describe, expect, it } from "vitest";
import { device, world } from "../helpers/davDevice.js";
import type { ByteExactDav } from "../helpers/byteExactDav.js";

/**
 * A folder this device deletes, against a remote another device put a note
 * into meanwhile (Fehlerliste 0.9.0 F44).
 *
 * A DELETE of a folder takes everything below it, on every service. Queued
 * for an empty folder gone from this device (A2), for a folder deleted in the
 * app with its notes, or for the old name of a folder whose move the remote
 * refused, it took the other device's new note with it — on the server and,
 * at the next listing, on every device. Now a folder goes only while the
 * remote holds no file in it; this device's own files go one by one, each on
 * the version it saw last; and what is left is the other device's, and comes
 * back here.
 *
 * The real core throughout (adapter chain, indexer, queue, engine, worker,
 * WebDAV target, SQLite, folders) against a byte-exact in-memory server.
 */

const NOTE = "# from A\n";

/** Thirty notes elsewhere, so that no deletion here is a large share of the vault. */
async function filled(d: Awaited<ReturnType<typeof device>>) {
  for (let i = 0; i < 30; i++) await d.app.writeTextFile(`fill/F${i}.md`, `# F${i}\n`);
}

/** Runs `before` once, right before the first request of one of `methods` for the folder `name`. */
function onceBefore(dav: ByteExactDav, methods: string[], name: string, before: () => Promise<void>) {
  const original = dav.fetch;
  dav.fetch = async (input, init) => {
    const m = (init?.method ?? "GET").toUpperCase();
    if (methods.includes(m) && decodeURIComponent(String(input)).replace(/\/$/, "").endsWith(`/${name}`)) {
      dav.fetch = original;
      await before();
    }
    return original(input, init);
  };
}

describe("an empty folder deleted here, a note put into it there", () => {
  it("the note stays when it reached the server before the deletion's retry", async () => {
    const { dav, remote } = world();
    const a = await device(dav), b = await device(dav);
    await filled(a);
    await a.app.createDir("Ordner");
    await a.cycle();
    await b.cycle();
    await b.cycle();

    await b.removeDir("Ordner");
    // The deletion's first try does not reach the server.
    const original = dav.fetch;
    dav.fetch = async (input, init) => {
      if ((init?.method ?? "GET").toUpperCase() === "DELETE" && decodeURIComponent(String(input)).replace(/\/$/, "").endsWith("/Ordner")) {
        dav.fetch = original;
        return new Response(null, { status: 503 });
      }
      return original(input, init);
    };
    await b.cycle();
    dav.fetch = original;

    await a.app.writeTextFile("Ordner/Neu.md", NOTE);
    await a.cycle();
    for (let i = 0; i < 3; i++) {
      await b.db.execute("UPDATE offline_queue SET next_retry_at = 0");
      await b.cycle();
    }
    await a.cycle();

    expect(remote("Ordner/Neu.md")).toBe(NOTE);
    expect(await a.text("Ordner/Neu.md")).toBe(NOTE);
    expect(await b.text("Ordner/Neu.md")).toBe(NOTE);
  });

  it("the note stays when it reached the server between this device's listing and its deletion", async () => {
    const { dav, remote } = world();
    const a = await device(dav), b = await device(dav);
    await filled(a);
    await a.app.createDir("Ordner");
    await a.cycle();
    await b.cycle();
    await b.cycle();

    await b.removeDir("Ordner");
    await a.app.writeTextFile("Ordner/Neu.md", NOTE);
    // A's upload lands after B listed the server, right before B's first request about the folder.
    onceBefore(dav, ["PROPFIND", "DELETE"], "Ordner", () => a.cycle());
    await b.cycle();
    for (let i = 0; i < 2; i++) {
      await a.cycle();
      await b.cycle();
    }

    expect(remote("Ordner/Neu.md")).toBe(NOTE);
    expect(await a.text("Ordner/Neu.md")).toBe(NOTE);
    expect(await b.text("Ordner/Neu.md")).toBe(NOTE);
  });
});

describe("a folder deleted in the app, a note put into it there", () => {
  it("the notes this device had go, the other device's new note stays and comes back", async () => {
    const { dav, remote } = world();
    const a = await device(dav), b = await device(dav);
    await filled(a);
    await a.app.createDir("Projekt");
    await a.app.writeTextFile("Projekt/Alt.md", "# old\n");
    await a.cycle();
    await a.cycle();
    await b.cycle();
    expect(await b.text("Projekt/Alt.md")).toBe("# old\n");

    // B puts a note into the folder; A, before it has seen it, deletes the folder.
    await b.app.writeTextFile("Projekt/Neu.md", "# from B\n");
    await b.cycle();
    await a.app.deleteItem("Projekt", true, { confirmed: true });
    for (let i = 0; i < 3; i++) {
      await a.cycle();
      await b.cycle();
    }

    expect(remote("Projekt/Alt.md")).toBeNull();
    expect(remote("Projekt/Neu.md")).toBe("# from B\n");
    expect(await b.text("Projekt/Neu.md")).toBe("# from B\n");
    expect(await a.text("Projekt/Neu.md")).toBe("# from B\n");
    expect(await a.exists("Projekt/Alt.md")).toBe(false);
    expect(await b.exists("Projekt/Alt.md")).toBe(false);
  });

  it("an empty folder deleted in the app with its notes still goes from the server", async () => {
    const { dav, remote } = world();
    const a = await device(dav), b = await device(dav);
    await filled(a);
    await a.app.createDir("Projekt");
    await a.app.createDir("Projekt/Unter");
    await a.app.writeTextFile("Projekt/Unter/Alt.md", "# old\n");
    // A folder first, then the folder below it, then the note in it.
    for (let i = 0; i < 3; i++) await a.cycle();
    await b.cycle();
    expect(await b.text("Projekt/Unter/Alt.md")).toBe("# old\n");
    await a.app.deleteItem("Projekt", true, { confirmed: true });
    for (let i = 0; i < 3; i++) {
      await a.cycle();
      await b.cycle();
    }

    expect(remote("Projekt/Unter/Alt.md")).toBeNull();
    expect(dav.folders.has("Projekt")).toBe(false);
    // The other device mirrors the note's deletion; an emptied folder the
    // remote no longer lists stays there as it does at main (not mirrored).
    expect(await b.exists("Projekt/Unter/Alt.md")).toBe(false);
  });
});

describe("a folder whose move the remote refused", () => {
  it("deletes only this device's own files at the old name, never the folder with the other device's note", async () => {
    const { dav, remote } = world();
    const a = await device(dav), b = await device(dav);
    await filled(a);
    await a.app.createDir("Projekt");
    await a.app.writeTextFile("Projekt/P1.md", "# P1\n");
    await a.app.createDir("Archiv");
    await a.cycle();
    await b.cycle();
    await b.cycle();
    // B, before A's move reaches the server: an empty destination, a new note in the source.
    await b.app.createDir("Archiv/Projekt");
    await b.app.writeTextFile("Projekt/B.md", "# from B\n");
    await b.cycle();

    await a.app.renameItem("Projekt", "Archiv/Projekt");
    await a.indexer.relocatePathInIndex("Projekt", "Archiv/Projekt");
    for (let i = 0; i < 4; i++) {
      await a.cycle();
      await b.cycle();
    }

    const server = [...dav.files.keys()].filter((p) => !p.startsWith("fill/")).sort();
    expect(server.filter((p) => p.endsWith("B.md"))).toHaveLength(1);
    expect(remote(server.find((p) => p.endsWith("B.md"))!)).toBe("# from B\n");
    expect(remote("Archiv/Projekt/P1.md")).toBe("# P1\n");
    expect(remote("Projekt/P1.md")).toBeNull();
    for (const d of [a, b]) {
      expect((await d.files()).filter((p) => p.endsWith("B.md"))).toHaveLength(1);
    }
  });
});

describe("a folder rename whose queue entry was given up", () => {
  it("ends with the folder under its new name only — on the server and on both devices", async () => {
    const { dav } = world();
    const a = await device(dav, { queueing: { giveUpAfterMs: 0, retryAtMs: [] } }), b = await device(dav);
    await filled(a);
    await a.app.createDir("Alt");
    await a.app.writeTextFile("Alt/N.md", "# N\n");
    await a.cycle();
    await a.cycle();
    await b.cycle();
    expect(await b.text("Alt/N.md")).toBe("# N\n");

    const { vi } = await import("vitest");
    vi.spyOn(a.queue, "queueRename").mockRejectedValueOnce(new Error("database is locked"));
    await expect(a.app.renameItem("Alt", "Neu")).rejects.toThrow("database is locked");
    await a.indexer.relocatePathInIndex("Alt", "Neu");
    for (let i = 0; i < 4; i++) {
      await a.cycle();
      await b.cycle();
    }

    expect(dav.files.has("Neu/N.md")).toBe(true);
    expect(dav.files.has("Alt/N.md")).toBe(false);
    expect(dav.folders.has("Alt")).toBe(false);
    expect(await a.exists("Alt")).toBe(false);
    // The other device mirrors the note's move; the emptied old folder stays
    // there, as an emptied folder the remote no longer lists does at main.
    expect(await b.exists("Alt/N.md")).toBe(false);
    for (const d of [a, b]) expect(await d.text("Neu/N.md")).toBe("# N\n");
  });
});

describe("the window between the folder check and the DELETE (second review)", () => {
  it("an empty folder deleted outside the app is not deleted where the remote cannot refuse it — a note put there stays", async () => {
    const { dav, remote } = world();
    const a = await device(dav), b = await device(dav);
    await filled(a);
    await a.app.createDir("Ordner");
    await a.cycle();
    await b.cycle();
    await b.cycle();

    await b.removeDir("Ordner");
    await a.app.writeTextFile("Ordner/Neu.md", NOTE);
    // A's upload lands after B's check of the folder, right before B's DELETE.
    onceBefore(dav, ["DELETE"], "Ordner", () => a.cycle());
    await b.cycle();
    for (let i = 0; i < 2; i++) {
      await a.cycle();
      await b.cycle();
    }

    expect(remote("Ordner/Neu.md")).toBe(NOTE);
    expect(await a.text("Ordner/Neu.md")).toBe(NOTE);
    expect(await b.text("Ordner/Neu.md")).toBe(NOTE);
  });

  it("a folder whose deletion was queued before its files' waits behind them and goes", async () => {
    const { dav } = world();
    const a = await device(dav);
    await filled(a);
    await a.app.createDir("Projekt");
    await a.app.writeTextFile("Projekt/P1.md", "# P1\n");
    await a.cycle();
    await a.cycle();
    expect(dav.files.has("Projekt/P1.md")).toBe(true);

    // The shells queue a folder and its files one by one, in no fixed order.
    await a.removeDir("Projekt");
    await a.queue.queueDeletePaths(["Projekt"]);
    for (let i = 0; i < 3; i++) await a.cycle();

    expect(dav.files.has("Projekt/P1.md")).toBe(false);
    expect(dav.folders.has("Projekt")).toBe(false);
    expect(await a.exists("Projekt")).toBe(false);
    expect(await a.queue.getPendingOperations()).toEqual([]);
  });
});

describe("a folder deleted on another device", () => {
  it("does not stay behind empty here once its notes are gone", async () => {
    const { dav, remote } = world();
    const a = await device(dav), b = await device(dav);
    await filled(a);
    await a.app.createDir("Projekt");
    await a.app.writeTextFile("Projekt/Alt.md", "# old\n");
    for (let i = 0; i < 2; i++) await a.cycle();
    await b.cycle();
    await b.cycle();
    expect(await b.text("Projekt/Alt.md")).toBe("# old\n");

    await b.app.deleteItem("Projekt", true, { confirmed: true });
    for (let i = 0; i < 3; i++) {
      await b.cycle();
      await a.cycle();
    }

    expect(remote("Projekt/Alt.md")).toBeNull();
    expect(dav.folders.has("Projekt")).toBe(false);
    expect(await a.exists("Projekt")).toBe(false);
    expect(await b.exists("Projekt")).toBe(false);
  });

  it("stays here while it holds a note of this device, and that note brings it back", async () => {
    const { dav, remote } = world();
    const a = await device(dav), b = await device(dav);
    await filled(a);
    await a.app.createDir("Projekt");
    await a.app.writeTextFile("Projekt/Alt.md", "# old\n");
    for (let i = 0; i < 2; i++) await a.cycle();
    await b.cycle();
    await b.cycle();

    await b.app.deleteItem("Projekt", true, { confirmed: true });
    await b.cycle();
    await a.app.writeTextFile("Projekt/Neu.md", "# new on A\n");
    for (let i = 0; i < 3; i++) {
      await a.cycle();
      await b.cycle();
    }

    expect(await a.text("Projekt/Neu.md")).toBe("# new on A\n");
    expect(remote("Projekt/Neu.md")).toBe("# new on A\n");
  });
});

describe("a folder rename given up before its notes were uploaded", () => {
  it("leaves no empty old folder behind, on the server or here", async () => {
    const { dav } = world();
    const a = await device(dav, { queueing: { giveUpAfterMs: 0, retryAtMs: [] } });
    await filled(a);
    await a.app.createDir("Alt");
    await a.cycle();
    await a.cycle();
    expect(dav.folders.has("Alt")).toBe(true);
    // A note in it, indexed but not uploaded yet.
    await a.app.writeTextFile("Alt/N.md", "# N\n");
    await a.indexer.indexVaultFull();

    const { vi } = await import("vitest");
    vi.spyOn(a.queue, "queueRename").mockRejectedValueOnce(new Error("database is locked"));
    await expect(a.app.renameItem("Alt", "Neu")).rejects.toThrow("database is locked");
    await a.indexer.relocatePathInIndex("Alt", "Neu");
    for (let i = 0; i < 4; i++) await a.cycle();

    expect(dav.files.get("Neu/N.md") !== undefined).toBe(true);
    expect(dav.folders.has("Alt")).toBe(false);
    expect(await a.exists("Alt")).toBe(false);
    expect(await a.text("Neu/N.md")).toBe("# N\n");
  });
});
