import { describe, expect, it } from "vitest";
import { device, world } from "../helpers/davDevice.js";

/**
 * A deletion or a move this device queued, against a remote another device
 * changed meanwhile (Fehlerliste 0.9.0 A1, Sammelplan § 3.103 no. 2).
 *
 * Uploads have named the version they expect since § 3.103; a DELETE and a
 * MOVE did not. A device that deleted a note offline removed, once online,
 * the version another device had written in between — the change was gone on
 * the server and, at the next listing, on the other device too. A MOVE onto a
 * name another device had just created replaced that file.
 *
 * Decided (16.11.): a file the other device changed meanwhile is not deleted;
 * it comes back and is compared again. A move never replaces a file at its
 * destination: both files stay, and the destination is compared as two
 * devices' new files are.
 *
 * The real core throughout (adapter chain, indexer, queue, engine, worker,
 * WebDAV target, SQLite, folders) against a byte-exact in-memory server that
 * evaluates preconditions as a real one does.
 */

const START = "# Plan\n\none\ntwo\nthree\n";
const EDITED = "# Plan\n\none\ntwo — changed on B\nthree\n";

describe("a deletion queued here, a change made there", () => {
  it("does not delete the version another device wrote meanwhile: it comes back here", async () => {
    const { dav, remote } = world();
    const a = await device(dav), b = await device(dav);
    await a.put("Note.md", START);
    await a.cycle();
    await b.cycle();

    // A deletes the note (offline: nothing goes out yet), B changes it and uploads.
    await a.remove("Note.md");
    await b.app.writeTextFile("Note.md", EDITED);
    await b.cycle();
    expect(remote("Note.md")).toBe(EDITED);

    await a.cycle();
    await a.cycle();
    await b.cycle();
    // The version that came back is one more download; the index's echo of it settles here.
    await a.cycle();

    expect(remote("Note.md")).toBe(EDITED);
    expect(await b.text("Note.md")).toBe(EDITED);
    expect(await a.text("Note.md")).toBe(EDITED);
    expect(await a.queue.getPendingOperations()).toEqual([]);
  });

  it("still deletes the version it saw last", async () => {
    const { dav, remote } = world();
    const a = await device(dav), b = await device(dav);
    await a.put("Note.md", START);
    await a.cycle();
    await b.cycle();
    await a.remove("Note.md");
    await a.cycle();
    expect(remote("Note.md")).toBeNull();
    expect(await a.queue.getPendingOperations()).toEqual([]);
  });

  it("asks right before the deletion where the entity tags are weak, which an If-Match never matches", async () => {
    const { dav, remote } = world({ weakEtags: true });
    const a = await device(dav), b = await device(dav);
    await a.put("Note.md", START);
    await a.cycle();
    await b.cycle();
    await a.remove("Note.md");
    await b.app.writeTextFile("Note.md", EDITED);
    await b.cycle();
    await a.cycle();
    await a.cycle();
    expect(remote("Note.md")).toBe(EDITED);
    expect(await a.text("Note.md")).toBe(EDITED);
  });

  it("deletes as before on a server that evaluates no precondition, while it still holds what this device saw", async () => {
    const { dav, remote } = world({ conditions: "ignore" });
    const a = await device(dav), b = await device(dav);
    await a.put("Note.md", START);
    await a.cycle();
    await b.cycle();
    await a.remove("Note.md");
    await a.cycle();
    expect(remote("Note.md")).toBeNull();
    expect(await a.queue.getPendingOperations()).toEqual([]);
  });
});

describe("a move queued here, a new file of that name there", () => {
  it("does not replace the other device's file: the cloud keeps it, this device keeps both, and the old name goes", async () => {
    const { dav, remote } = world();
    const a = await device(dav), b = await device(dav);
    await a.put("Old.md", START);
    await a.cycle();
    await b.cycle();

    await a.app.renameItem("Old.md", "New.md");
    await b.app.writeTextFile("New.md", "# Made on B\n");
    await b.cycle();

    await a.cycle();
    await a.cycle();
    await b.cycle();
    await a.cycle();

    expect(remote("Old.md")).toBeNull();
    // Nothing of either text is lost — on the server and on both devices.
    const everywhere = async (needle: string) => {
      const onServer = [...dav.files.entries()].filter(([, f]) => new TextDecoder().decode(f.bytes).includes(needle)).map(([p]) => p);
      const onA = (await Promise.all((await a.files()).map(async (p) => ((await a.text(p)).includes(needle) ? p : null)))).filter(Boolean);
      const onB = (await Promise.all((await b.files()).map(async (p) => ((await b.text(p)).includes(needle) ? p : null)))).filter(Boolean);
      return { onServer: onServer.length > 0, onA: onA.length > 0, onB: onB.length > 0 };
    };
    // B's file stays everywhere. This device's text meets it as two devices'
    // new files of one name do: kept here beside it as a conflict copy, which
    // the person resolves — nothing of either is lost.
    expect(await everywhere("# Made on B")).toEqual({ onServer: true, onA: true, onB: true });
    expect((await everywhere("# Plan")).onA).toBe(true);
    expect(remote("New.md")).toBe("# Made on B\n");
    expect(await a.files()).not.toContain("Old.md");
    expect(await b.files()).not.toContain("Old.md");
    expect(await a.queue.getPendingOperations()).toEqual([]);
  });

  it("moves as before where the destination is free", async () => {
    const { dav, remote } = world();
    const a = await device(dav), b = await device(dav);
    await a.put("Old.md", START);
    await a.cycle();
    await b.cycle();
    await a.app.renameItem("Old.md", "New.md");
    await a.cycle();
    expect(remote("Old.md")).toBeNull();
    expect(remote("New.md")).toBe(START);
    await b.cycle();
    expect(await b.files()).toEqual(["New.md"]);
  });
});
