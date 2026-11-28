import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    expect(ledger.observe(listing({ "A/B/x.md": "3", "A/B/z.md": "1" }, { "": "r5", A: "a4", "A/B": "b5", "A/B/C": "c1" }))).toEqual({
      kind: "suspect",
      suspects: [{ folder: "A", was: "a4", entry: "A/B/x.md", entryIsFolder: false, entryTag: "3" }],
    });
    // A suspect alone takes the trust, not for good: the target asks again first.
    expect(ledger.trusted).toBe(false);
    expect(ledger.refuted).toBe(false);
    ledger.refute();
    expect(ledger.refuted).toBe(true);
    earn(ledger);
    expect(ledger.trusted).toBe(false);
  });

  it("only doubts where the probe right before saw the old tag and the listing shows changes (a save in between explains it)", () => {
    const ledger = new FolderTagLedger();
    earn(ledger);
    expect(ledger.observe(listing({ "A/B/x.md": "3", "A/B/z.md": "1" }, { "": "r5", A: "a5", "A/B": "b5", "A/B/C": "c1" }), "r4")).toEqual({ kind: "doubt" });
    expect(ledger.trusted).toBe(false);
    expect(ledger.refuted).toBe(false);
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
      expect(ledger.observe(next)).toEqual({ kind: "fine" });
      expect(ledger.trusted).toBe(false);
      expect(ledger.refuted).toBe(false);
    }
  });

  it("a server whose folder tag follows only its own entries is refuted by the first edit below", () => {
    const ledger = new FolderTagLedger();
    ledger.observe(listing({ "A/x.md": "1" }, { "": "r1", A: "a1" }));
    expect(ledger.observe(listing({ "A/x.md": "2" }, { "": "r1", A: "a1" })).kind).toBe("suspect");
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
        // What b alone asks, per cycle.
        const bAsked: string[] = [];
        const bView: ByteExactDav = { ...dav, fetch: (input, init) => {
          if ((init?.method ?? "GET").toUpperCase() === "PROPFIND") bAsked.push(new Headers(init?.headers as HeadersInit | undefined).get("Depth") ?? "infinity");
          return dav.fetch(input, init);
        } };
        return { dav, bAsked, a: await device(dav, { shortcut }), b: await device(bView, { shortcut }) };
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
      let probeOnlyCycles = 0;
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
        for (const s of sides) {
          const from = s.bAsked.length;
          await s.b.cycle();
          if (s === short && !s.bAsked.slice(from).includes("infinity")) probeOnlyCycles++;
        }
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
      process.stdout.write(`L7b ${kind.name}: streaks=${streaks} longest=${maxStreak} b's cycles on the tag alone=${probeOnlyCycles}/${STEPS}\n`);
      expect(await state(short.b)).toBe(await state(full.b));
      expect(await state(short.a)).toBe(await state(full.a));
      expect(maxStreak).toBeLessThanOrEqual(3);
      if (kind.expect === "same") expect(streaks).toBe(0);
      if (kind.expect === "once") expect(streaks).toBeLessThanOrEqual(1);
      if (kind.name.startsWith("subtree (")) {
        // The shortcut did run: the observing device asked the tag alone in a share of its cycles
        // (half the steps change something, and trust takes three clean pairs first).
        expect(probeOnlyCycles).toBeGreaterThan(STEPS * 0.1);
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

/** Every text anywhere: both devices (conflict copies included) and the server. */
async function texts(dav: ByteExactDav, ...devices: Array<Awaited<ReturnType<typeof device>>>) {
  const out = new Set<string>();
  for (const d of devices) for (const f of await d.files()) out.add((await d.text(f)).trim());
  for (const [, f] of dav.files) out.add(new TextDecoder().decode(f.bytes).trim());
  return out;
}

describe("a cycle on the tag alone writes nothing (finding S-1 of 2026-11-27)", () => {
  // A server whose tags follow every WebDAV change, that sees changes made past WebDAV only
  // on a deep listing and does not mark the mount: its view can be stale, and a write
  // checked against it (If-Match) would replace a change it has not seen.
  const stale = () => world({ folderTags: "subtree", lazyScan: true, clock: () => Date.UTC(2026, 10, 1) });

  async function earned(dav: ByteExactDav, shortcut: boolean) {
    const a = await device(dav, { shortcut });
    const b = await device(dav, { shortcut });
    for (const step of [
      () => a.put("N/D/x.md", "x\n"), () => a.put("N/D/x.md", "x2\n"), () => a.put("N/D/y.md", "y\n"),
      () => a.remove("N/D/y.md"), () => a.put("N/D/E/z.md", "z\n"), () => a.put("N/D/E/z.md", "z2\n"),
    ]) { await step(); await a.cycle(); await b.cycle(); }
    // Into the stretch of cycles on the tag alone.
    for (let i = 0; i < 4; i++) await b.cycle();
    return { a, b };
  }

  for (const variant of ["edit", "delete", "rename"] as const) {
    it(`a local ${variant} that meets an outside change keeps the outside change, as without the shortcut`, async () => {
      const kept: Record<string, Set<string>> = {};
      for (const shortcut of [true, false]) {
        const { dav } = stale();
        const { a, b } = await earned(dav, shortcut);
        dav.pastWebdav("N/D/E/z.md", "OUTSIDE\n");
        if (variant === "edit") await b.put("N/D/E/z.md", "LOCAL\n");
        else if (variant === "delete") await b.remove("N/D/E/z.md");
        else { await b.put("N/D/E/moved.md", await b.text("N/D/E/z.md")); await b.remove("N/D/E/z.md"); }
        for (let i = 0; i < 6; i++) { await b.cycle(); await a.cycle(); }
        kept[shortcut ? "with" : "without"] = await texts(dav, a, b);
      }
      expect(kept.without!.has("OUTSIDE")).toBe(true);
      for (const text of kept.without!) expect(kept.with!.has(text)).toBe(true);
    }, 120_000);
  }

  it("a local edit in a cycle that would ask the tag alone lists in full first", async () => {
    const { dav } = world({ folderTags: "subtree", clock: () => Date.UTC(2026, 10, 1) });
    const { b } = await earned(dav, true);
    await b.put("N/D/x.md", "local\n");
    const from = dav.propfinds.length;
    const log = dav.log.length;
    await b.cycle();
    const putAt = dav.log.slice(log).findIndex((l) => l.startsWith("PUT "));
    expect(putAt).toBeGreaterThanOrEqual(0);
    expect(dav.propfinds.slice(from)).toContain("infinity");
    expect(dav.log.slice(log, log + putAt).some((l) => l.startsWith("PROPFIND "))).toBe(true);
  });

  it("a workspace genesis made past WebDAV stops a plain upload, as without the shortcut", async () => {
    const remote: Record<string, string> = {};
    for (const shortcut of [true, false]) {
      const { dav } = stale();
      const { b } = await earned(dav, shortcut);
      dav.pastWebdav(".pvws/genesis.pvgen", "genesis\n");
      await b.put("N/D/x.md", "plain text that must not go up\n");
      for (let i = 0; i < 3; i++) await b.cycle().catch(() => undefined);
      remote[shortcut ? "with" : "without"] = new TextDecoder().decode(dav.files.get("N/D/x.md")!.bytes);
    }
    expect(remote.without).toBe("x2\n");
    expect(remote.with).toBe(remote.without);
  });

  it("a random run where this device and another program change the same files loses nothing the run without the shortcut keeps", async () => {
    for (const options of [{ folderTags: "subtree" as const, lazyScan: true }, { folderTags: "subtree" as const }, { folderTags: "ownEntries" as const, lazyScan: true }]) {
      const sides = await Promise.all([true, false].map(async (shortcut) => {
        const { dav } = world({ ...options, clock: () => Date.UTC(2026, 10, 1) });
        return { dav, a: await device(dav, { shortcut }), b: await device(dav, { shortcut }) };
      }));
      const rnd = random(0xc0ffee);
      const paths = ["N/D/x.md", "N/D/E/y.md", "N/z.md"];
      for (const s of sides) { for (const p of paths) await s.a.put(p, `${p} start\n`); await s.a.cycle(); await s.b.cycle(); }
      for (let step = 0; step < 60; step++) {
        const p = paths[Math.floor(rnd() * paths.length)]!;
        const r = rnd();
        for (const s of sides) {
          if (r < 0.3) s.dav.pastWebdav(p, `outside ${step}\n`);
          else if (r < 0.55 && (await s.b.exists(p))) await s.b.put(p, `local ${step}\n`);
          else if (r < 0.65 && (await s.b.exists(p))) await s.b.remove(p);
          else if (r < 0.75) s.dav.pastWebdav(p, null);
          else if (r < 0.85) await s.a.put(p, `other device ${step}\n`).catch(() => undefined);
        }
        for (const s of sides) { await s.a.cycle(); await s.b.cycle(); }
      }
      for (let i = 0; i < 6; i++) for (const s of sides) { await s.a.cycle(); await s.b.cycle(); }
      const [withShortcut, without] = await Promise.all(sides.map((s) => texts(s.dav, s.a, s.b)));
      for (const text of without!) expect(withShortcut!.has(text)).toBe(true);
    }
  }, 240_000);
});

describe("the minute holds whatever the clock does (finding M-2 of 2026-11-27)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Cycles of b, `stepMs` apart on both clocks (the wall clock set back by `backMs` once trusted), until an outside change arrives. */
  async function cyclesUntilArrival(stepMs: number, backMs: number) {
    let wall = Date.UTC(2026, 10, 1);
    let mono = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => wall);
    vi.spyOn(performance, "now").mockImplementation(() => mono);
    const { dav } = world({ folderTags: "subtree", lazyScan: true, clock: () => Date.UTC(2026, 10, 1) });
    const a = await device(dav);
    const b = await device(dav);
    const tick = () => { wall += stepMs; mono += stepMs; };
    for (const step of [
      () => a.put("N/D/x.md", "x\n"), () => a.put("N/D/x.md", "x2\n"), () => a.put("N/D/y.md", "y\n"),
      () => a.remove("N/D/y.md"), () => a.put("N/D/E/z.md", "z\n"), () => a.put("N/D/E/z.md", "z2\n"),
    ]) { await step(); tick(); await a.cycle(); await b.cycle(); }
    for (let i = 0; i < 4; i++) { tick(); await b.cycle(); }
    wall -= backMs;
    dav.pastWebdav("N/D/E/z.md", "OUTSIDE\n");
    let cycles = 0;
    while (cycles < 12) {
      tick();
      await b.cycle();
      cycles++;
      if ((await b.text("N/D/E/z.md")).includes("OUTSIDE")) break;
    }
    return cycles;
  }

  for (const minutes of [5, 15]) {
    it(`cycles ${minutes} minutes apart: a change the tag did not show arrives in the next cycle, also with the clock set back an hour`, async () => {
      expect(await cyclesUntilArrival(minutes * 60_000, 0)).toBe(1);
      expect(await cyclesUntilArrival(minutes * 60_000, 3_600_000)).toBe(1);
    }, 120_000);
  }

  it("cycles 15 seconds apart: such a change arrives within the minute (four cycles), also with the clock set back", async () => {
    expect(await cyclesUntilArrival(15_000, 0)).toBeLessThanOrEqual(4);
    expect(await cyclesUntilArrival(15_000, 3_600_000)).toBeLessThanOrEqual(4);
  }, 120_000);

  it("cycles 30 seconds apart: such a change arrives within the minute (two cycles), not after the three cycles the count allows", async () => {
    expect(await cyclesUntilArrival(30_000, 0)).toBeLessThanOrEqual(2);
  }, 120_000);
});

describe("only a proven contradiction is kept (decision of 2026-11-27)", () => {
  function setFile(dav: ByteExactDav, p: string, etag: string) {
    const segments = p.split("/");
    for (let i = 1; i < segments.length; i++) dav.folders.add(segments.slice(0, i).join("/"));
    dav.files.set(p, { bytes: new TextEncoder().encode(etag), etag, modified: 1 });
  }
  async function earnOn(dav: ByteExactDav, t: WebDavSyncTarget) {
    setFile(dav, "A/B/x.md", "1"); setFile(dav, "A/B/y.md", "1");
    await t.pull();
    setFile(dav, "A/B/x.md", "2");
    await t.pull();
    setFile(dav, "A/B/x.md", "3"); setFile(dav, "A/B/z.md", "1");
    await t.pull();
    dav.files.delete("A/B/y.md");
    await t.pull();
    dav.folders.add("A/B/C");
    await t.pull();
  }
  const KEY = FOLDER_TAGS_REFUTED_KEY + "https://dav.example.com";
  const targetOn = (dav: ByteExactDav, store: SyncMetaStore, fetchFn?: (i: RequestInfo | URL, init?: RequestInit) => Promise<Response>) => {
    const t = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, fetchFn ?? ((i, init) => dav.fetch(i, init)));
    t.useSyncMeta(store);
    return t;
  };

  it("A1: another device saving between the probe and the due listing is a doubt; the honest server earns the shortcut again", async () => {
    const dav = byteExactDav(undefined, { folderTags: "subtree" });
    const store = memoryStore();
    const t = targetOn(dav, store);
    await earnOn(dav, t);
    expect(await t.getStartCursor()).toBe(ROOT_TAG_CURSOR);
    expect(await t.shouldListFully()).toBe(false);
    setFile(dav, "A/B/x.md", "4");
    await t.pull();
    expect(store.values.has(KEY)).toBe(false);
    expect(await t.getStartCursor()).toBe("");
    await earnOn(dav, t);
    dav.folders.add("A/B/Again");
    await t.pull();
    expect(await t.getStartCursor()).toBe(ROOT_TAG_CURSOR);
  });

  it("A2: a listing that is not one snapshot (the vault folder read before a file another device just saved) is a doubt", async () => {
    const dav = byteExactDav(undefined, { folderTags: "subtree" });
    const store = memoryStore();
    let splice = false;
    const fetchFn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const depth = new Headers(init?.headers as HeadersInit | undefined).get("Depth");
      if (!splice || (init?.method ?? "GET") !== "PROPFIND" || depth !== "infinity") return dav.fetch(input, init);
      splice = false;
      const before = await (await dav.fetch(input, init)).text();
      setFile(dav, "A/B/x.md", "5");
      const after = await (await dav.fetch(input, init)).text();
      const responses = (xml: string) => xml.match(/<d:response>[\s\S]*?<\/d:response>/g) ?? [];
      const head = after.slice(0, after.indexOf("<d:response>"));
      return new Response(`${head}${[responses(before)[0]!, ...responses(after).slice(1)].join("")}</d:multistatus>`, { status: 207 });
    };
    const t = targetOn(dav, store, fetchFn);
    await earnOn(dav, t);
    expect(await t.getStartCursor()).toBe(ROOT_TAG_CURSOR);
    splice = true;
    await t.pull();
    expect(store.values.has(KEY)).toBe(false);
    await earnOn(dav, t);
    dav.folders.add("A/B/Again");
    await t.pull();
    expect(await t.getStartCursor()).toBe(ROOT_TAG_CURSOR);
  });

  for (const kind of ["ownEntries", "twoLevel", "putOnly", "static"] as const) {
    it(`a server whose tags are "${kind}" is proven wrong by asking again, and that is kept`, async () => {
      const dav = byteExactDav(undefined, { folderTags: kind });
      const store = memoryStore();
      const t = targetOn(dav, store);
      setFile(dav, "A/B/C/x.md", "1"); setFile(dav, "A/B/C/y.md", "1");
      await t.pull();
      // A change three levels down; for "putOnly" a deletion (no PUT moves the tags).
      if (kind === "putOnly") dav.files.delete("A/B/C/y.md");
      else setFile(dav, "A/B/C/x.md", "2");
      await t.pull();
      expect(store.values.has(KEY)).toBe(true);
    });
  }

  it("a proven contradiction whose storing fails keeps the shortcut off for the target's life", async () => {
    const dav = byteExactDav(undefined, { folderTags: "ownEntries" });
    const store: SyncMetaStore = { get: async () => null, set: async () => { throw new Error("disk full"); } };
    const t = targetOn(dav, store);
    setFile(dav, "A/x.md", "1");
    await t.pull();
    setFile(dav, "A/x.md", "2");
    await t.pull();
    dav.setFolderTags("subtree");
    await earnOn(dav, t);
    expect(await t.getStartCursor()).toBe("");
    expect(await t.shouldListFully()).toBe(true);
  });

  it("a store that cannot be read keeps the shortcut off", async () => {
    const dav = byteExactDav(undefined, { folderTags: "subtree" });
    const store: SyncMetaStore = { get: async () => { throw new Error("locked"); }, set: async () => undefined };
    const t = targetOn(dav, store);
    await earnOn(dav, t);
    expect(await t.getStartCursor()).toBe("");
    expect(await t.shouldListFully()).toBe(true);
  });
});

describe("a wrapper passes the shortcut's three parts together or none (note H-9)", () => {
  it("the content-encryption wrapper passes none, and a WebDAV target inside it hands out no cursor", async () => {
    const { EncryptingSyncTarget } = await import("../../src/settingsSync/EncryptingSyncTarget.js");
    const dav = byteExactDav(undefined, { folderTags: "subtree" });
    const inner = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, (i, init) => dav.fetch(i, init));
    const wrapped = new EncryptingSyncTarget(inner, { isStrict: () => false }) as unknown as Record<string, unknown> & { getStartCursor?: () => Promise<string> };
    const parts = ["shouldListFully", "fullListingCadence", "useSyncMeta"].map((name) => wrapped[name] !== undefined);
    expect(parts).toEqual([false, false, false]);
    expect(await wrapped.getStartCursor!()).toBe("");
  });

  it("the spelling wrapper the worker puts around every target passes all three", async () => {
    const { withPathSpellings } = await import("../../src/sync/spellingSyncTarget.js");
    const dav = byteExactDav(undefined, { folderTags: "subtree" });
    const wrapped = withPathSpellings(new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, (i, init) => dav.fetch(i, init))) as unknown as Record<string, unknown>;
    expect(["shouldListFully", "fullListingCadence", "useSyncMeta"].map((name) => wrapped[name] !== undefined)).toEqual([true, true, true]);
  });
});

describe("the parser takes a tag from a 2xx propstat over one from a failed propstat (note H-1, M5)", () => {
  it("whichever comes first", async () => {
    const { parseMultistatus } = await import("../../src/sync/WebDavSyncTarget.js");
    const [entry] = parseMultistatus(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/Vault/a.md</d:href><d:propstat><d:prop><d:getetag/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat><d:propstat><d:prop><d:getetag>"real"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`);
    expect(entry!.etag).toBe('"real"');
    expect(entry!.answered.getetag).toBe("ok");
  });
});
