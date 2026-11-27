import { beforeEach, describe, expect, it } from "vitest";
import { FolderTagLedger, FOLDER_TAGS_REFUTED_KEY, type FolderTagListing } from "../../src/sync/webdavFolderTags.js";
import { ROOT_TAG_CURSOR, WebDavSyncTarget } from "../../src/sync/WebDavSyncTarget.js";
import type { SyncMetaStore } from "../../src/sync/ISyncTarget.js";
import { byteExactDav, type ByteExactDav, type ByteExactDavOptions } from "../helpers/byteExactDav.js";
import { device, world } from "../helpers/davDevice.js";

/**
 * Plan L7b (decision of 2026-11-27): a WebDAV cycle may ask the vault
 * folder's tag alone where the server has shown, in its own full listings,
 * that its folder tags follow every change below them. A foreign change
 * arrives at most once per device and host, and at most three cycles (one
 * minute at the 15 s default) later than with a full listing every cycle;
 * nothing is deleted or downloaded on a probe's word.
 */

beforeEach(() => {
  expect.hasAssertions();
});

const listing = (files: Record<string, string>, folders: Record<string, string | undefined>, mounted: boolean | undefined = false): FolderTagListing => ({
  files: new Map(Object.entries(files)),
  folders: new Map(Object.entries(folders)),
  mounted,
});

describe("the folder-tag ledger", () => {
  /** Three clean pairs: an edit, a creation, a deletion and a folder, all two levels down. */
  function earn(ledger: FolderTagLedger) {
    ledger.observe(listing({ "A/B/x.md": "1", "A/B/y.md": "1" }, { "": "r1", A: "a1", "A/B": "b1" }));
    ledger.observe(listing({ "A/B/x.md": "2", "A/B/y.md": "1", "A/B/z.md": "1" }, { "": "r2", A: "a2", "A/B": "b2" }));
    ledger.observe(listing({ "A/B/x.md": "2", "A/B/z.md": "1" }, { "": "r3", A: "a3", "A/B": "b3" }));
    ledger.observe(listing({ "A/B/x.md": "2", "A/B/z.md": "1" }, { "": "r4", A: "a4", "A/B": "b4", "A/B/C": "c1" }));
  }

  it("is earned by three clean pairs covering every kind of change, at the deepest level", () => {
    const ledger = new FolderTagLedger();
    earn(ledger);
    expect(ledger.trusted).toBe(true);
    expect(ledger.rootTag).toBe("r4");
  });

  it("is not earned by fewer pairs, or without a deletion", () => {
    const ledger = new FolderTagLedger();
    ledger.observe(listing({ "A/B/x.md": "1" }, { "": "r1", A: "a1", "A/B": "b1" }));
    ledger.observe(listing({ "A/B/x.md": "2" }, { "": "r2", A: "a2", "A/B": "b2" }));
    ledger.observe(listing({ "A/B/x.md": "3", "A/B/y.md": "1" }, { "": "r3", A: "a3", "A/B": "b3" }));
    ledger.observe(listing({ "A/B/x.md": "4", "A/B/y.md": "1" }, { "": "r4", A: "a4", "A/B": "b4", "A/B/C": "c" }));
    expect(ledger.trusted).toBe(false);
  });

  it("is not earned by two clean pairs, even with every kind of change", () => {
    const ledger = new FolderTagLedger();
    ledger.observe(listing({ "A/B/x.md": "1", "A/B/y.md": "1" }, { "": "r1", A: "a1", "A/B": "b1" }));
    ledger.observe(listing({ "A/B/x.md": "2", "A/B/z.md": "1" }, { "": "r2", A: "a2", "A/B": "b2" }));
    ledger.observe(listing({ "A/B/x.md": "2", "A/B/z.md": "1" }, { "": "r3", A: "a3", "A/B": "b3", "A/B/C": "c1" }));
    expect(ledger.trusted).toBe(false);
  });

  it("is refuted for good by one folder above a change that kept its tag", () => {
    const ledger = new FolderTagLedger();
    earn(ledger);
    expect(ledger.observe(listing({ "A/B/x.md": "3", "A/B/z.md": "1" }, { "": "r5", A: "a4", "A/B": "b5", "A/B/C": "c1" }))).toBe("contradiction");
    expect(ledger.refuted).toBe(true);
    earn(ledger);
    expect(ledger.trusted).toBe(false);
  });

  it("is refuted where the probe right before saw the old tag and the listing shows changes", () => {
    const ledger = new FolderTagLedger();
    earn(ledger);
    expect(ledger.observe(listing({ "A/B/x.md": "3", "A/B/z.md": "1" }, { "": "r5", A: "a5", "A/B": "b5", "A/B/C": "c1" }), "r4")).toBe("contradiction");
  });

  it("starts again on noise, a folder without a tag, or a mount; none of them is a contradiction", () => {
    for (const next of [
      listing({ "A/B/x.md": "2", "A/B/z.md": "1" }, { "": "r5", A: "a5", "A/B": "b4", "A/B/C": "c1" }), // noise: nothing changed below A
      listing({ "A/B/x.md": "3", "A/B/z.md": "1" }, { "": "r5", A: "a5", "A/B": undefined, "A/B/C": "c1" }),
      listing({ "A/B/x.md": "3", "A/B/z.md": "1" }, { "": "r5", A: "a5", "A/B": "b5", "A/B/C": "c1" }, true),
      { ...listing({ "A/B/x.md": "3", "A/B/z.md": "1" }, { "": "r5", A: "a5", "A/B": "b5", "A/B/C": "c1" }), mounted: undefined },
    ]) {
      const ledger = new FolderTagLedger();
      earn(ledger);
      expect(ledger.observe(next)).toBeUndefined();
      expect(ledger.trusted).toBe(false);
      expect(ledger.refuted).toBe(false);
    }
  });

  it("a server whose folder tag follows only its own entries is refuted by the first edit below", () => {
    const ledger = new FolderTagLedger();
    ledger.observe(listing({ "A/x.md": "1" }, { "": "r1", A: "a1" }));
    expect(ledger.observe(listing({ "A/x.md": "2" }, { "": "r1", A: "a1" }))).toBe("contradiction");
  });
});

function memoryStore(): SyncMetaStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, get: async (k) => values.get(k) ?? null, set: async (k, v) => { values.set(k, v); } };
}

describe("the target keeps a contradiction across restarts", () => {
  it("stores it for the host, and a new target on the same store never asks the tag alone", async () => {
    const dav = byteExactDav(undefined, { folderTags: "ownEntries", clock: () => Date.UTC(2026, 10, 1) });
    const store = memoryStore();
    const target = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, (i, init) => dav.fetch(i, init));
    target.useSyncMeta(store);
    dav.folders.add("A");
    dav.files.set("A/x.md", { bytes: new Uint8Array([1]), etag: "1", modified: 1 });
    await target.pull();
    dav.files.set("A/x.md", { bytes: new Uint8Array([2]), etag: "2", modified: 2 });
    await target.pull();
    expect([...store.values.keys()]).toEqual([FOLDER_TAGS_REFUTED_KEY + "https://dav.example.com"]);
    const again = new WebDavSyncTarget({ url: dav.url, user: "v", pass: "q" }, (i, init) => dav.fetch(i, init));
    again.useSyncMeta(store);
    dav.setFolderTags("subtree");
    for (let i = 0; i < 6; i++) {
      dav.files.set(`A/B/n${i}.md`, { bytes: new Uint8Array([i]), etag: `n${i}`, modified: i });
      await again.pull();
    }
    expect(await again.getStartCursor()).toBe("");
    expect(await again.shouldListFully()).toBe(true);
  });

  it("without a store the tag is never trusted", async () => {
    const dav = byteExactDav(undefined, { folderTags: "subtree" });
    const target = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, (i, init) => dav.fetch(i, init));
    expect(await target.getStartCursor()).toBe("");
    expect(await target.pull(ROOT_TAG_CURSOR)).toMatchObject({ needsFullListing: true });
  });
});

/** Tiny seeded generator (mulberry32). */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Kind = { name: string; options: ByteExactDavOptions; switchAt?: { step: number; to: ByteExactDavOptions["folderTags"] }; pastWebdav: boolean; expect: "same" | "once" | "bounded" };
const KINDS: Kind[] = [
  { name: "subtree (Nextcloud, ownCloud)", options: { folderTags: "subtree" }, pastWebdav: true, expect: "same" },
  { name: "subtree, changes past WebDAV scanned on a deep listing, mount marked", options: { folderTags: "subtree", lazyScan: true, mounts: new Set(["Ext"]) }, pastWebdav: true, expect: "same" },
  { name: "subtree, changes past WebDAV scanned on a deep listing, no mark", options: { folderTags: "subtree", lazyScan: true }, pastWebdav: true, expect: "bounded" },
  { name: "own entries only (Apache, Synology)", options: { folderTags: "ownEntries" }, pastWebdav: true, expect: "once" },
  { name: "two levels only", options: { folderTags: "twoLevel" }, pastWebdav: true, expect: "once" },
  { name: "PUT only", options: { folderTags: "putOnly" }, pastWebdav: true, expect: "once" },
  { name: "a tag that never moves", options: { folderTags: "static" }, pastWebdav: true, expect: "once" },
  { name: "no folder tags", options: {}, pastWebdav: true, expect: "same" },
  { name: "subtree, then own entries only mid-run", options: { folderTags: "subtree" }, switchAt: { step: 45, to: "ownEntries" }, pastWebdav: true, expect: "once" },
];

async function state(d: Awaited<ReturnType<typeof device>>) {
  const out: string[] = [];
  for (const f of await d.files()) out.push(`${f}=${await d.text(f)}`);
  return out.join("|");
}

describe("a random run: with and without the shortcut against the same history", () => {
  for (const kind of KINDS) {
    it(kind.name, async () => {
      const clock = () => Date.UTC(2026, 10, 1);
      const sides = await Promise.all([true, false].map(async (shortcut) => {
        const { dav } = world({ ...kind.options, clock });
        return { dav, a: await device(dav, { shortcut }), b: await device(dav, { shortcut }) };
      }));
      const [short, full] = sides as [typeof sides[0], typeof sides[0]];
      const rnd = random(0x1a7 + kind.name.length);
      // A's own files, and the files another program keeps on the server: the two never cross, so no
      // conflict copy depends on timing.
      const paths: string[] = [];
      const serverPaths: string[] = [];
      const pick = () => paths[Math.floor(rnd() * paths.length)]!;
      const DIRS = ["Notes", "Notes/Deep", "Notes/Deep/Deeper", "Ext/In"];
      const STEPS = 80;
      let streak = 0;
      let maxStreak = 0;
      let streaks = 0;
      for (let step = 0; step < STEPS; step++) {
        if (kind.switchAt?.step === step) for (const s of sides) s.dav.setFolderTags(kind.switchAt.to);
        // Half the steps change nothing: an idle vault is where the shortcut saves.
        const idle = rnd() < 0.5;
        const r = idle ? 2 : rnd();
        const dir = DIRS[Math.floor(rnd() * DIRS.length)]!;
        if (r < 0.3 || paths.length < 3) {
          const p = `${dir}/n${step}.md`;
          paths.push(p);
          for (const s of sides) await s.a.put(p, `new ${step}\n`);
        } else if (r < 0.6) {
          const p = pick();
          for (const s of sides) await s.a.put(p, `edit ${step}\n`);
        } else if (r < 0.72) {
          const p = paths.splice(Math.floor(rnd() * paths.length), 1)[0]!;
          for (const s of sides) await s.a.remove(p);
        } else if (r < 0.8) {
          const p = `${dir}/F${step}/inside.md`;
          paths.push(p);
          for (const s of sides) await s.a.put(p, `folder ${step}\n`);
        } else if (r < 1 && kind.pastWebdav) {
          // Past WebDAV, on the server itself (another program, an external storage).
          const p = serverPaths.length > 0 && rnd() < 0.5 ? serverPaths[Math.floor(rnd() * serverPaths.length)]! : `Ext/In/server${step}.md`;
          if (!serverPaths.includes(p)) serverPaths.push(p);
          for (const s of sides) s.dav.pastWebdav(p, `server ${step}\n`);
        }
        for (const s of sides) await s.a.cycle();
        for (const s of sides) await s.b.cycle();
        const differs = (await state(short.b)) !== (await state(full.b));
        if (differs) {
          if (streak === 0) streaks++;
          streak++;
          maxStreak = Math.max(maxStreak, streak);
        } else {
          streak = 0;
        }
      }
      for (let i = 0; i < 5; i++) for (const s of sides) { await s.a.cycle(); await s.b.cycle(); }
      process.stdout.write(`L7b ${kind.name}: streaks=${streaks} longest=${maxStreak} probes=${short.dav.propfinds.filter((d) => d === "0").length} full=${short.dav.propfinds.filter((d) => d === "infinity").length} (without: ${full.dav.propfinds.filter((d) => d === "infinity").length})\n`);
      expect(await state(short.b)).toBe(await state(full.b));
      expect(await state(short.a)).toBe(await state(full.a));
      expect(maxStreak).toBeLessThanOrEqual(3);
      if (kind.expect === "same") expect(streaks).toBe(0);
      if (kind.expect === "once") expect(streaks).toBeLessThanOrEqual(1);
      if (kind.name.startsWith("subtree (")) {
        // The shortcut did run (both devices counted; the writing one lists after each of its writes).
        expect(short.dav.propfinds.filter((d) => d === "infinity").length).toBeLessThan(full.dav.propfinds.filter((d) => d === "infinity").length * 0.8);
      }
    }, 240_000);
  }
});

describe("a cycle on the tag alone", () => {
  async function trustedPair(dav: ByteExactDav) {
    const a = await device(dav);
    const b = await device(dav);
    // Enough changes for three clean pairs of every kind, two levels down and at the deepest level.
    const script: Array<() => Promise<void>> = [
      () => a.put("N/D/x.md", "x\n"),
      () => a.put("N/D/x.md", "x2\n"),
      () => a.put("N/D/y.md", "y\n"),
      () => a.remove("N/D/y.md"),
      () => a.put("N/D/E/z.md", "z\n"),
      () => a.put("N/D/E/z.md", "z2\n"),
    ];
    for (const step of script) { await step(); await a.cycle(); await b.cycle(); }
    return { a, b };
  }

  it("downloads and deletes nothing, and a foreign change below arrives in the next cycle", async () => {
    const { dav } = world({ folderTags: "subtree", clock: () => Date.UTC(2026, 10, 1) });
    const { a, b } = await trustedPair(dav);
    let probeOnly = false;
    for (let i = 0; i < 5 && !probeOnly; i++) {
      const before = dav.propfinds.length;
      const log = dav.log.length;
      await b.cycle();
      if (dav.propfinds.slice(before).join() === "0") {
        probeOnly = true;
        expect(dav.log.slice(log).filter((l) => !l.startsWith("PROPFIND"))).toEqual([]);
      }
    }
    expect(probeOnly).toBe(true);
    await a.put("N/D/E/z.md", "z3\n");
    await a.remove("N/D/x.md");
    await a.cycle();
    await b.cycle();
    expect(await b.text("N/D/E/z.md")).toBe("z3\n");
    expect(await b.exists("N/D/x.md")).toBe(false);
  });

  it("lists in full after this device wrote, and every fourth cycle", async () => {
    const { dav } = world({ folderTags: "subtree", clock: () => Date.UTC(2026, 10, 1) });
    const { b } = await trustedPair(dav);
    for (let i = 0; i < 4; i++) await b.cycle();
    const from = dav.propfinds.length;
    for (let i = 0; i < 8; i++) await b.cycle();
    const fulls = dav.propfinds.slice(from).filter((d) => d === "infinity").length;
    expect(fulls).toBe(2);
    await b.put("N/own.md", "own\n");
    await b.cycle();
    const after = dav.propfinds.length;
    await b.cycle();
    // Straight to the full listing: the tag its own write moved is not asked first.
    expect(dav.propfinds[after]).toBe("infinity");
  });

  it("never rests on the tag where an entry is marked as a mount", async () => {
    const { dav } = world({ folderTags: "subtree", mounts: new Set(["N/D/E"]), clock: () => Date.UTC(2026, 10, 1) });
    const { b } = await trustedPair(dav);
    const from = dav.propfinds.length;
    for (let i = 0; i < 8; i++) await b.cycle();
    expect(dav.propfinds.slice(from).filter((d) => d === "infinity").length).toBe(8);
    expect(dav.propfinds.slice(from)).not.toContain("0");
  });
});
