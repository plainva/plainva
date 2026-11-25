import { beforeEach, describe, expect, it } from "vitest";
import { RootTagWatch } from "../src/sync/webdavRootTag.js";
import { device, world } from "./helpers/davDevice.js";

/**
 * A WebDAV server's vault folder is asked for its own entity tag instead of
 * listing everything only where the server is shown to change that tag with
 * every change below it (`webdavRootTag.ts`). Against a server stand-in whose
 * folders carry a tag of the whole subtree (as Nextcloud and ownCloud), one
 * whose folder tag follows only the entries right inside it (a folder's time
 * on disk), and one without folder tags at all.
 */

beforeEach(() => {
  expect.hasAssertions();
});

const listing = (rootTag: string | undefined, files: Record<string, string>, folders: string[] = []) => ({
  rootTag,
  files: new Map(Object.entries(files)),
  folders,
});

describe("what a full listing tells of the vault folder's tag", () => {
  it("is proven by a change inside a folder that moved the tag while the folder's own entries stayed", () => {
    const watch = new RootTagWatch();
    watch.observe(listing("r1", { "A/a.md": "1", "top.md": "1" }, ["A"]));
    expect(watch.proven).toBe(false);
    watch.observe(listing("r2", { "A/a.md": "2", "top.md": "1" }, ["A"]));
    expect(watch.proven).toBe(true);
  });

  it("is not proven by a change right inside the vault folder, nor by one that came with a new entry there", () => {
    const watch = new RootTagWatch();
    watch.observe(listing("r1", { "A/a.md": "1", "top.md": "1" }, ["A"]));
    // A folder's time on disk moves with an entry coming or going right inside it.
    watch.observe(listing("r2", { "A/a.md": "2", "top.md": "1", "new.md": "1" }, ["A"]));
    expect(watch.proven).toBe(false);
    watch.observe(listing("r3", { "A/a.md": "2", "top.md": "2", "new.md": "1" }, ["A"]));
    expect(watch.proven).toBe(false);
  });

  it("is disproven for good by one change the tag did not follow", () => {
    const watch = new RootTagWatch();
    watch.observe(listing("r1", { "A/a.md": "1" }, ["A"]));
    watch.observe(listing("r2", { "A/a.md": "2" }, ["A"]));
    expect(watch.proven).toBe(true);
    watch.observe(listing("r2", { "A/a.md": "3" }, ["A"]));
    expect(watch.proven).toBe(false);
    expect(watch.disproven).toBe(true);
    watch.observe(listing("r3", { "A/a.md": "4" }, ["A"]));
    expect(watch.proven).toBe(false);
  });

  it("trusts no tag that moves while nothing changed, nor a listing without one", () => {
    const unsteady = new RootTagWatch();
    unsteady.observe(listing("r1", { "A/a.md": "1" }, ["A"]));
    unsteady.observe(listing("r2", { "A/a.md": "2" }, ["A"]));
    unsteady.observe(listing("r3", { "A/a.md": "2" }, ["A"]));
    expect(unsteady.proven).toBe(false);
    const without = new RootTagWatch();
    without.observe(listing("r1", { "A/a.md": "1" }, ["A"]));
    without.observe(listing("r2", { "A/a.md": "2" }, ["A"]));
    without.observe(listing(undefined, { "A/a.md": "3" }, ["A"]));
    expect(without.proven).toBe(false);
  });
});

/** The PROPFINDs of the server from `from` on, by the depth they asked for. */
const depths = (dav: { propfinds: Array<{ depth: string }> }, from: number) => dav.propfinds.slice(from).map((p) => p.depth);

describe("a device against the server", () => {
  it("on a server whose folder tag follows the whole subtree: idle cycles ask the tag alone, and a change below is found at once", async () => {
    const { dav, remote } = world({ collectionEtags: "subtree" });
    const a = await device(dav);
    const b = await device(dav);
    await a.put("Notes/Deep/one.md", "one\n");
    await a.cycle();
    await b.cycle();
    // The evidence: a change inside a folder, the vault folder's entries unchanged.
    await a.put("Notes/Deep/one.md", "one, edited\n");
    await a.cycle();
    await b.cycle();
    expect(await b.text("Notes/Deep/one.md")).toBe("one, edited\n");
    await b.cycle();

    // Idle: B lists nothing, it asks the vault folder's tag.
    const before = dav.propfinds.length;
    const requests = dav.log.length;
    for (let i = 0; i < 5; i++) await b.cycle();
    expect(depths(dav, before)).toEqual(["0", "0", "0", "0", "0"]);
    expect(dav.log.length - requests).toBe(5);
    // Another device writes deep inside: the next cycle sees the tag move and lists.
    await a.put("Notes/Deep/two.md", "two\n");
    await a.cycle();
    const probe = dav.propfinds.length;
    await b.cycle(); // the probe: changed, so a full listing is owed at once
    await b.cycle();
    expect(depths(dav, probe)).toContain("infinity");
    expect(await b.text("Notes/Deep/two.md")).toBe("two\n");
    expect(remote("Notes/Deep/two.md")).toBe("two\n");
  });

  it("on a server whose folder tag follows only the entries right inside it: never a shortcut, and a change deep inside is found by the next cycle", async () => {
    const { dav } = world({ collectionEtags: "children" });
    const a = await device(dav);
    const b = await device(dav);
    await a.put("Notes/Deep/one.md", "one\n");
    await a.cycle();
    await b.cycle();
    const before = dav.propfinds.length;
    for (let round = 0; round < 6; round++) {
      // Written anew deep inside: the vault folder's tag does not move.
      await a.put("Notes/Deep/one.md", `one, round ${round}\n`);
      await a.cycle();
      await b.cycle();
      expect(await b.text("Notes/Deep/one.md"), `round ${round}`).toBe(`one, round ${round}\n`);
    }
    // No probe ever: every cycle of either device listed the whole folder.
    expect(depths(dav, before).filter((d) => d === "0")).toEqual([]);
    expect(depths(dav, before).filter((d) => d === "infinity").length).toBeGreaterThanOrEqual(12);
  });

  it("on a server shown to follow, that stops following: the full listing at its fixed time finds the change, and no tag is trusted after", async () => {
    const options = { collectionEtags: "subtree" as "subtree" | "children" };
    const { dav } = world(options);
    const a = await device(dav);
    const b = await device(dav);
    await a.put("Notes/Deep/one.md", "one\n");
    await a.cycle();
    await b.cycle();
    await a.put("Notes/Deep/one.md", "one, edited\n");
    await a.cycle();
    await b.cycle();
    // The cursor is asked for before the listing that brings the evidence: the
    // listing after it seeds the tag, and the cycle after that asks it alone.
    await b.cycle();
    await b.cycle();
    expect(depths(dav, dav.propfinds.length - 1)).toEqual(["0"]);
    // The server changes its ways (another storage behind it, an update).
    options.collectionEtags = "children";
    await a.put("Notes/Deep/one.md", "one, edited where the tag stays\n");
    await a.cycle();
    let cycles = 0;
    while ((await b.text("Notes/Deep/one.md")) !== "one, edited where the tag stays\n" && cycles < 25) {
      await b.cycle();
      cycles++;
    }
    // Within the worker's fixed number of cycles between full listings, not later.
    expect(cycles).toBeGreaterThan(0);
    expect(cycles).toBeLessThanOrEqual(21);
    // That listing met a tag of another form (the stand-in's switch) and could
    // not tell; the next change the tag does not follow is the proof against it.
    await a.put("Notes/Deep/one.md", "and once more\n");
    await a.cycle();
    cycles = 0;
    while ((await b.text("Notes/Deep/one.md")) !== "and once more\n" && cycles < 25) {
      await b.cycle();
      cycles++;
    }
    expect(cycles).toBeLessThanOrEqual(21);
    const after = dav.propfinds.length;
    for (let i = 0; i < 4; i++) await b.cycle();
    // No tag is asked any more; a cursor seeded before the listing that found
    // the proof sends its cycle on to a full listing without a request.
    expect(depths(dav, after).filter((d) => d === "0")).toEqual([]);
    expect(depths(dav, after).length).toBeGreaterThanOrEqual(3);
  });

  it("on a server without folder tags: every cycle lists, as before", async () => {
    const { dav } = world();
    const a = await device(dav);
    const b = await device(dav);
    await a.put("Notes/one.md", "one\n");
    await a.cycle();
    await b.cycle();
    await a.put("Notes/one.md", "one, edited\n");
    await a.cycle();
    const before = dav.propfinds.length;
    await b.cycle();
    await b.cycle();
    expect(await b.text("Notes/one.md")).toBe("one, edited\n");
    expect(depths(dav, before)).toEqual(["infinity", "infinity"]);
  });
});
