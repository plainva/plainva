import { describe, expect, it } from "vitest";
import { device, world } from "../helpers/davDevice.js";

/**
 * An empty folder deleted outside Plainva — in the file manager, by another
 * program (Fehlerliste 0.9.0 A2).
 *
 * Folders have no sync row. The index sees files, so nothing queued the
 * deletion of an empty folder; and the next full listing, which reports every
 * remote folder so that empty ones appear on a new device, created it again
 * here. Now the worker remembers which folders it has seen both here and on
 * the remote: one of those that is gone here was deleted here, and its
 * deletion goes up instead. A folder it never saw here is new on the remote
 * and is created, as before. The rule lives in the core, so it holds for the
 * desktop and the phone alike.
 */

describe("an empty folder deleted outside the app", () => {
  it("stays deleted: its deletion goes up instead of the listing bringing it back", async () => {
    const { dav } = world();
    const a = await device(dav), b = await device(dav);
    await a.app.createDir("Leer");
    await a.cycle();
    expect(dav.folders.has("Leer")).toBe(true);
    await b.cycle();
    expect(await b.exists("Leer")).toBe(true);

    await b.removeDir("Leer");
    await b.cycle();
    await b.cycle();

    expect(await b.exists("Leer")).toBe(false);
    expect(dav.folders.has("Leer")).toBe(false);
    expect(await b.queue.getPendingOperations()).toEqual([]);
  });

  it("also a nested one, with its empty subfolder", async () => {
    const { dav } = world();
    const a = await device(dav);
    await a.app.createDir("Projekte");
    await a.app.createDir("Projekte/Alt");
    await a.cycle();
    await a.cycle();
    await a.removeDir("Projekte");
    await a.cycle();
    await a.cycle();
    expect(await a.exists("Projekte")).toBe(false);
    expect(dav.folders.has("Projekte")).toBe(false);
    expect(dav.folders.has("Projekte/Alt")).toBe(false);
  });

  it("still creates an empty folder the remote has and this device never saw", async () => {
    const { dav } = world();
    const a = await device(dav), b = await device(dav);
    await a.cycle();
    await b.cycle();
    await a.app.createDir("Neu");
    await a.cycle();
    await b.cycle();
    expect(await b.exists("Neu")).toBe(true);
  });

  it("does not delete a folder whose remote copy holds files: those files decide, one by one", async () => {
    const { dav, remote } = world();
    const a = await device(dav), b = await device(dav);
    await a.app.createDir("Ordner");
    await a.cycle();
    await b.cycle();
    // A puts a note into it while B removes the (still empty) folder offline.
    await a.put("Ordner/Notiz.md", "# Notiz\n");
    await a.cycle();
    await b.removeDir("Ordner");
    await b.cycle();
    await b.cycle();
    expect(remote("Ordner/Notiz.md")).toBe("# Notiz\n");
    expect(await b.text("Ordner/Notiz.md")).toBe("# Notiz\n");
  });
});
