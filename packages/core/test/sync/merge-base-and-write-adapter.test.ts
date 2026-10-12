import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "../helpers/realSqlite.js";
import { byteExactDav, type ByteExactDav } from "../helpers/byteExactDav.js";
import { LocalVaultAdapter } from "../../src/vault/LocalVaultAdapter.js";
import { BackupVaultAdapter } from "../../src/vault/BackupVaultAdapter.js";
import { QueueingVaultAdapter } from "../../src/vault/QueueingVaultAdapter.js";
import { ConflictAwareVaultAdapter, ConflictError } from "../../src/vault/ConflictAwareVaultAdapter.js";
import { SyncStateRepository } from "../../src/vault/SyncStateRepository.js";
import { VaultIndexer } from "../../src/vault/VaultIndexer.js";
import { SyncQueue } from "../../src/sync/SyncQueue.js";
import { SyncEngine } from "../../src/sync/SyncEngine.js";
import { SyncWorker } from "../../src/sync/SyncWorker.js";
import { WebDavSyncTarget } from "../../src/sync/WebDavSyncTarget.js";

/**
 * A change that waits for its upload, and the base it will be merged against
 * (finding 2026-10-11).
 *
 * `base_sha256` and the base text of a sync row say one thing: this is the
 * version this device and the remote last agreed on. Whoever writes one of
 * them without the other makes the row describe two versions, and the next
 * change from another device is merged against a text that is not the common
 * ancestor. Where that text is this device's own current text, the merge finds
 * nothing changed here: the other device's version comes out, every change
 * made here is gone, and no conflict copy is written.
 *
 * Three writers did that, and each is walked here on two devices:
 *  - the write chain, after it merged a change from outside into a write of
 *    the app (a card's checkbox, a property — a write outside an editor);
 *  - the write chain, where it puts right a local marker that an earlier
 *    reading of the file left;
 *  - the sync itself, after it merged both sides: it recorded its result as
 *    the base before the upload of that result had gone through.
 *
 * And the net below them: a sync that finds a base text which is not the
 * version `base_sha256` names does not merge against it — and asks for none
 * where the hash already says that the remote did not change.
 *
 * The real core throughout, as in merge-base-and-index.test.ts: the adapter
 * chain, indexer, queue, engine, worker and the WebDAV target, real SQLite and
 * real folders, against a byte-exact in-memory server. The assertions read the
 * files on both disks and on the server.
 */

// Built at run time: the mark is never typed into this file.
const MARK = String.fromCharCode(0xfeff);
const marked = (text: string) => text.charCodeAt(0) === 0xfeff;

/**
 * The text reader of a platform that hands a file out without its byte order
 * mark — going by its sources, iOS does for a vault in the app's own storage
 * (not run on a device). The bytes keep it.
 */
class MarklessReader extends LocalVaultAdapter {
  override async readTextFile(vaultPath: string): Promise<string> {
    const text = await super.readTextFile(vaultPath);
    return marked(text) ? text.slice(1) : text;
  }
}

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (closers.length > 0) await closers.pop()!();
});

async function device(dav: ByteExactDav, options: { marklessReader?: boolean } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-merge-base-writer-"));
  const db = await realSqlite();
  closers.push(async () => {
    await db.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const raw = options.marklessReader ? new MarklessReader(root) : new LocalVaultAdapter(root);
  await raw.initialize();
  const backup = new BackupVaultAdapter(raw);
  const queue = new SyncQueue(db);
  const repo = new SyncStateRepository(db);
  const merged: string[] = [];
  const app = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, queue), repo, (p) => void merged.push(p));
  // The shells' hooks queue without waiting; here one after the other (one
  // connection, one transaction at a time).
  let queued: Promise<unknown> = Promise.resolve();
  const later = (work: () => Promise<unknown>) => { queued = queued.then(work); };
  const indexer = new VaultIndexer(raw, db, {
    isOwnWrite: (p, sha256) => app.wasWrittenByUs(p, sha256),
    onExternalModification: (p) => later(() => queue.queueWrite(p)),
    onNewLocalFile: (p) => later(() => queue.queueWrite(p)),
    onLocalFileDeleted: (p) => later(() => queue.queueDelete(p)),
  });
  // This device's line to the server: its uploads can be refused for a while.
  const uplink = { refused: false };
  const target = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, (input, init) =>
    uplink.refused && (init?.method ?? "GET").toUpperCase() === "PUT"
      ? Promise.resolve(new Response("", { status: 503 }))
      : dav.fetch(input, init));
  target.allowRootCreation = false;
  const engine = new SyncEngine(queue, target, app, repo);
  const worker = new SyncWorker(engine, target, repo, backup, queue, 60_000);
  (worker as unknown as { isRunning: boolean }).isRunning = true;
  const pulled: string[] = [];
  worker.onFilesChanged = (paths) => void pulled.push(...paths);
  const file = (p: string) => path.join(root, p);
  return {
    app, repo, db, uplink,
    /** The paths the write chain merged a change from outside into. */
    merged,
    /** What a shell does around a cycle: the pass over the vault, the cycle, and the index told what the cycle wrote. */
    async cycle() {
      await indexer.indexVaultFull();
      await queued;
      await worker.runCycle();
      for (const p of pulled.splice(0)) await indexer.indexPath(p);
      await queued;
    },
    /** Another program writes the file: exactly these bytes, past the app. */
    async put(p: string, text: string) {
      await fs.mkdir(path.dirname(file(p)), { recursive: true });
      await fs.writeFile(file(p), text, "utf8");
    },
    async text(p: string) { return fs.readFile(file(p), "utf8"); },
    async files() { return (await fs.readdir(root)).filter((name) => !name.startsWith(".")).sort(); },
    async copies() { return (await fs.readdir(root)).filter((name) => name.includes(".CONFLICT")).sort(); },
    /** The row as the next sync will find it. */
    async row(p: string) {
      const state = await repo.getSyncState(p);
      return { base: state?.base_text ?? null, baseSha: state?.base_sha256 ?? null, localSha: state?.local_sha256 ?? null };
    },
  };
}

function world() {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const dav = byteExactDav();
  const remote = (p: string) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(dav.files.get(p)!.bytes);
  return { dav, remote };
}

/** Two devices that both hold the file, in sync, each with the file in its index. */
async function synced(p: string, content: string, options: { marklessReader?: boolean } = {}) {
  const w = world();
  const a = await device(w.dav), b = await device(w.dav, options);
  await a.put(p, content);
  await a.cycle();
  await b.cycle();
  return { ...w, a, b };
}

const sha = async (text: string) => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

/** `text` with the line that reads `from` reading `to`; the line ends and the mark stay. */
const line = (text: string, from: string, to: string) => {
  const lines = text.split(/(?<=\n)/);
  const at = lines.findIndex((l) => l.replace(/\r?\n$/, "").replace(MARK, "") === from);
  if (at < 0) throw new Error(`no line "${from}"`);
  lines[at] = lines[at]!.replace(from, to);
  return lines.join("");
};

/** One file as both devices hold it — a note, and a text file that is no note, with a mark and "\r\n". */
const cases = [
  { name: "Note.md", start: "# Plan\n\none\ntwo\nthree\nfour\nfive\nsix\nseven\n" },
  { name: "Settings.ini", start: `${MARK}[view]\r\none\r\ntwo\r\nthree\r\nfour\r\nfive\r\nsix\r\nseven\r\n` },
] as const;

describe("a change from outside that the write chain merged into a write of the app", () => {
  for (const c of cases) {
    // What another program wrote, what the app then writes, and what the other device uploads meanwhile.
    const outside = line(c.start, "one", "one outside");
    const here = line(outside, "four", "four here");
    const there = line(c.start, "seven", "seven there");
    const all = line(here, "seven", "seven there");

    it(`${c.name}: the next change from the other device meets both local changes — all three arrive on both devices`, async () => {
      const { a, b, remote } = await synced(c.name, c.start);
      await b.put(c.name, outside);
      // A write outside an editor: the writer read the file a moment ago and changed one line.
      await b.app.writeTextFile(c.name, here);
      expect(b.merged).toEqual([c.name]);
      expect(await b.text(c.name)).toBe(here);
      // The common ancestor is still the version both devices hold — hash and text.
      expect.soft(await b.row(c.name)).toEqual({ base: c.start, baseSha: await sha(c.start), localSha: await sha(here) });

      // Before this device uploads, the other one changes another line and uploads.
      await a.put(c.name, there);
      await a.cycle();
      await b.cycle();
      // It used to end with the other device's version alone: both changes made here gone, no conflict copy.
      expect(await b.text(c.name)).toBe(all);
      expect(remote(c.name)).toBe(all);
      await a.cycle();
      expect(await a.text(c.name)).toBe(all);
      expect(await a.files()).toEqual([c.name]);
      expect(await b.files()).toEqual([c.name]);
    });
  }

  it("a writer that still held the text from before the change from outside fares the same", async () => {
    const c = cases[0];
    const outside = line(c.start, "one", "one outside");
    const both = line(outside, "four", "four here");
    const { a, b, remote } = await synced(c.name, c.start);
    await b.put(c.name, outside);
    await b.app.writeTextFile(c.name, line(c.start, "four", "four here"));
    expect(await b.text(c.name)).toBe(both);
    await a.put(c.name, line(c.start, "seven", "seven there"));
    await a.cycle();
    await b.cycle();
    const all = line(both, "seven", "seven there");
    expect(await b.text(c.name)).toBe(all);
    expect(remote(c.name)).toBe(all);
    await a.cycle();
    expect(await a.text(c.name)).toBe(all);
    expect(await b.copies()).toEqual([]);
  });

  it("the line the app changed, changed on the other device too, is a conflict copy — not a choice made in silence", async () => {
    const c = cases[0];
    const outside = line(c.start, "one", "one outside");
    const here = line(outside, "four", "four here");
    const there = line(c.start, "four", "four there");
    const { a, b, remote } = await synced(c.name, c.start);
    await b.put(c.name, outside);
    await b.app.writeTextFile(c.name, here);
    await a.put(c.name, there);
    await a.cycle();
    await b.cycle();
    // The other device's version is the note; this device's — both of its changes — is kept beside it.
    expect(await b.text(c.name)).toBe(there);
    const kept = await b.copies();
    expect(kept).toHaveLength(1);
    expect(await b.text(kept[0]!)).toBe(here);
    expect(remote(c.name)).toBe(there);
    // The copy's starting version is the one both devices held.
    expect((await b.app.getConflictSession(c.name))?.baseText).toBe(c.start);
  });
});

describe("the price: a second change from outside before the upload", () => {
  it("is not merged in silence — the app's write is kept as a conflict copy, the note keeps what the other program wrote", async () => {
    const c = cases[0];
    const outside = line(c.start, "one", "one outside");
    const here = line(outside, "four", "four here");
    const { a, b, remote } = await synced(c.name, c.start);
    await b.put(c.name, outside);
    await b.app.writeTextFile(c.name, here);

    // The other program again, before this device has uploaded; then the app, outside an editor.
    const outsideAgain = line(here, "six", "six outside");
    const write = line(outsideAgain, "two", "two here");
    await b.put(c.name, outsideAgain);
    // The text the app last knew is the one it merged a moment ago. The row
    // holds the hash of it and no longer the text: that place is the sync's.
    // Without it there is nothing to merge against, and nothing is guessed.
    const refused = await b.app.writeTextFile(c.name, write).then(() => null, (error: unknown) => error);
    expect(refused).toBeInstanceOf(ConflictError);
    expect((refused as Error).message).toContain("base version not found");
    expect(await b.text(c.name)).toBe(outsideAgain);
    const kept = await b.copies();
    expect(kept).toHaveLength(1);
    expect(await b.text(kept[0]!)).toBe(write);

    // Nothing of it is lost on the way to the other device: the note travels as it lies there.
    await b.cycle();
    expect(remote(c.name)).toBe(outsideAgain);
    await a.cycle();
    expect(await a.text(c.name)).toBe(outsideAgain);
    expect(await a.files()).toEqual([c.name]);
  });

  it("is not asked of an editor: its save hands in the text it loaded, and that is merged against", async () => {
    const c = cases[0];
    const outside = line(c.start, "one", "one outside");
    const here = line(outside, "four", "four here");
    const { a, b, remote } = await synced(c.name, c.start);
    await b.put(c.name, outside);
    await b.app.writeTextFile(c.name, here);
    const outsideAgain = line(here, "five", "five outside");
    await b.put(c.name, outsideAgain);

    // The editor loaded the note after the merge and changed a line.
    const saved = await b.app.writeEditorText(c.name, line(here, "two", "two here"), here);
    const both = line(outsideAgain, "two", "two here");
    expect(saved).toEqual({ stored: both, session: null });
    expect(await b.copies()).toEqual([]);

    // The sync's base is untouched by all of it: the other device's change meets every line changed here.
    await a.put(c.name, line(c.start, "seven", "seven there"));
    await a.cycle();
    await b.cycle();
    const all = line(both, "seven", "seven there");
    expect(await b.text(c.name)).toBe(all);
    expect(remote(c.name)).toBe(all);
    await a.cycle();
    expect(await a.text(c.name)).toBe(all);
    expect(await b.copies()).toEqual([]);
  });
});

describe("the local marker an earlier reading of the file left", () => {
  // On a platform whose text reader drops the mark, the hash of what the app
  // reads is not the hash of the bytes the sync recorded. The write chain sees
  // that the file itself is unchanged, writes, and puts the marker right.
  const start = `${MARK}[view]\r\none\r\ntwo\r\nthree\r\nfour\r\nfive\r\nsix\r\nseven\r\n`;
  const unmarked = (text: string) => (marked(text) ? text.slice(1) : text);

  it("is put right without touching the merge base — a change made here meets the other device's next change", async () => {
    const { a, b, remote } = await synced("Settings.ini", start, { marklessReader: true });
    // A version from the other device arrives; the index of this device knows the file.
    const second = line(start, "seven", "seven there");
    await a.put("Settings.ini", second);
    await a.cycle();
    await b.cycle();
    expect(await b.text("Settings.ini")).toBe(second);

    // The app writes the file as it reads it: without the mark, one line changed.
    const here = line(unmarked(second), "one", "one here");
    await b.app.writeTextFile("Settings.ini", here);
    expect(await b.copies()).toEqual([]);
    expect(b.merged).toEqual([]);
    // The base is still the version the sync brought — hash and text.
    expect.soft(await b.row("Settings.ini")).toEqual({ base: second, baseSha: await sha(second), localSha: await sha(here) });

    await a.put("Settings.ini", line(second, "four", "four there"));
    await a.cycle();
    await b.cycle();
    // It used to end with the other device's version alone.
    const both = line(here, "four", "four there");
    expect(unmarked(await b.text("Settings.ini"))).toBe(both);
    expect(unmarked(remote("Settings.ini"))).toBe(both);
    await a.cycle();
    expect(unmarked(await a.text("Settings.ini"))).toBe(both);
    expect(await a.files()).toEqual(["Settings.ini"]);
    expect(await b.files()).toEqual(["Settings.ini"]);
  });
});

describe("a merge of both sides whose upload did not go through", () => {
  const c = cases[0];
  const here = line(c.start, "one", "one here");
  const there = line(c.start, "five", "five there");
  const both = line(here, "five", "five there");
  const thereAgain = line(there, "three", "three there");
  const all = line(both, "three", "three there");

  it("keeps the change made here when the other device changes the file once more", async () => {
    const { a, b, remote } = await synced(c.name, c.start);
    await b.app.writeTextFile(c.name, here);
    await a.put(c.name, there);
    await a.cycle();

    // Both sides are merged here; the upload of the result is refused.
    b.uplink.refused = true;
    await b.cycle();
    expect(await b.text(c.name)).toBe(both);
    expect(remote(c.name)).toBe(there);
    // Until that upload is through, the common ancestor is what the server holds.
    expect.soft(await b.row(c.name)).toEqual({ base: there, baseSha: await sha(there), localSha: await sha(both) });

    await a.put(c.name, thereAgain);
    await a.cycle();
    b.uplink.refused = false;
    await b.cycle();
    // It used to end with the other device's version alone: the result of the
    // first merge was taken for the ancestor, and against it nothing had changed here.
    expect(await b.text(c.name)).toBe(all);
    expect(remote(c.name)).toBe(all);
    await a.cycle();
    expect(await a.text(c.name)).toBe(all);
    expect(await a.files()).toEqual([c.name]);
    expect(await b.files()).toEqual([c.name]);
  });

  it("keeps a change that waits for its upload when the server only handed out a new ETag in between", async () => {
    const { a, b, dav, remote } = await synced(c.name, c.start);
    await b.app.writeTextFile(c.name, here);
    // The server re-stamps the unchanged file; this device looks at it and cannot upload.
    dav.files.set(c.name, { bytes: dav.files.get(c.name)!.bytes, etag: "restamped" });
    b.uplink.refused = true;
    await b.cycle();
    expect(await b.text(c.name)).toBe(here);
    expect.soft(await b.row(c.name)).toEqual({ base: c.start, baseSha: await sha(c.start), localSha: await sha(here) });

    await a.put(c.name, there);
    await a.cycle();
    b.uplink.refused = false;
    await b.cycle();
    expect(await b.text(c.name)).toBe(both);
    expect(remote(c.name)).toBe(both);
    await a.cycle();
    expect(await a.text(c.name)).toBe(both);
    expect(await b.copies()).toEqual([]);
  });
});

describe("a base text that is not the version the base hash names", () => {
  const c = cases[0];
  const here = line(c.start, "one", "one here");
  const there = line(c.start, "five", "five there");

  it("is not merged against: the local version is kept as a conflict copy", async () => {
    const { a, b, remote } = await synced(c.name, c.start);
    await b.app.writeTextFile(c.name, here);
    // What a version before 2026-10-12 left behind after a merge in the write
    // chain: this device's own text in the place of the common ancestor.
    await b.db.execute("UPDATE sync_state SET base_text = ? WHERE path = ?", [here, c.name]);
    await a.put(c.name, there);
    await a.cycle();
    await b.cycle();
    // Merged against that text, nothing had changed here — the other device's
    // version came out and the change made here was gone. Now nobody knows the
    // ancestor, and it is treated that way.
    expect(await b.text(c.name)).toBe(there);
    const kept = await b.copies();
    expect(kept).toHaveLength(1);
    expect(await b.text(kept[0]!)).toBe(here);
    expect(remote(c.name)).toBe(there);
    // The copy is kept without a starting version rather than with a wrong one.
    expect((await b.app.getConflictSession(c.name))?.baseText).toBeNull();
    // The row is whole again: the next change from elsewhere merges.
    expect(await b.row(c.name)).toEqual({ base: there, baseSha: await sha(there), localSha: await sha(there) });
  });

  // The remote did not change at all — the server only handed out a new ETag
  // (it re-stamped the file, or it sends no ETag on an upload and the next
  // listing is the first to bring one). The hash says the remote is the
  // ancestor; no text is needed to know that the local change stands.
  for (const [what, left] of [
    ["an older version's text, as a streamed upload leaves it", c.start.replace("seven\n", "")],
    ["this device's own text, as an older version left it", here],
    ["no text at all", null],
  ] as const) {
    it(`a change nobody else touched is no conflict when the server only re-stamped the file — the row holds ${what}`, async () => {
      const { a, b, dav, remote } = await synced(c.name, c.start);
      await b.app.writeTextFile(c.name, here);
      await b.db.execute("UPDATE sync_state SET base_text = ? WHERE path = ?", [left, c.name]);
      dav.files.set(c.name, { bytes: dav.files.get(c.name)!.bytes, etag: "restamped" });
      await b.cycle();
      expect(await b.text(c.name)).toBe(here);
      expect(await b.copies()).toEqual([]);
      expect(remote(c.name)).toBe(here);
      // Uploaded, and the row names and holds what was uploaded.
      expect(await b.row(c.name)).toEqual({ base: here, baseSha: await sha(here), localSha: await sha(here) });
      await a.cycle();
      expect(await a.text(c.name)).toBe(here);
    });
  }

  it("two journals that differ only in their entries are still united", async () => {
    const day = "2026-10-12.md";
    const start = "# Monday\n\n## Journal\n\n- 08:00 woke up\n";
    const mine = `${start}- 09:30 here\n`;
    const theirs = `${start}- 09:10 there\n`;
    const { a, b, remote } = await synced(day, start);
    await b.app.writeTextFile(day, mine);
    await b.db.execute("UPDATE sync_state SET base_text = ? WHERE path = ?", [mine, day]);
    await a.put(day, theirs);
    await a.cycle();
    await b.cycle();
    const united = `${start}- 09:10 there\n- 09:30 here\n`;
    expect(await b.text(day)).toBe(united);
    expect(remote(day)).toBe(united);
    expect(await b.copies()).toEqual([]);
  });
});
