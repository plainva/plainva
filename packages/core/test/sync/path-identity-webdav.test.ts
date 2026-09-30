import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebDavSyncTarget } from "../../src/sync/WebDavSyncTarget.js";
import { withPathSpellings } from "../../src/sync/spellingSyncTarget.js";
import type { ISyncTarget, SyncOperation } from "../../src/sync/ISyncTarget.js";
import { SyncQueue } from "../../src/sync/SyncQueue.js";
import { SyncEngine } from "../../src/sync/SyncEngine.js";
import { realSqlite } from "../helpers/realSqlite.js";
import { byteExactDav, type ByteExactDav } from "../helpers/byteExactDav.js";

/**
 * Issue #112 on the wire (ADR 0016). The reporter's HiDrive stores names byte
 * for byte; a folder made in Finder arrives decomposed, the same folder
 * written from elsewhere composed. Plainva names both by the composed
 * identity and must write into the folder the server already holds — never
 * a second, identical-looking one next to it.
 */

const NFC = "Neutralität".normalize("NFC");
const NFD = NFC.normalize("NFD");

const op = (operation: SyncOperation["operation"], file_path: string, extra: Partial<SyncOperation> = {}): SyncOperation => ({
  id: 1, operation, file_path, retry_count: 0, next_retry_at: 0, queued_at: 0,
  ...(operation === "write" ? { content: new TextEncoder().encode("body") } : {}),
  ...extra,
});

describe("WebDAV writes into the spelling the server holds (issue #112)", () => {
  let dav: ByteExactDav;
  let target: ISyncTarget;
  beforeEach(() => {
    expect(NFC).not.toBe(NFD);
    dav = byteExactDav();
    dav.folders.add(NFD);
    dav.files.set(`${NFD}/Notiz.md`, { bytes: new TextEncoder().encode("old"), etag: "e0" });
    target = withPathSpellings(new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, dav.fetch));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  const writes = () => dav.log.filter((l) => !l.startsWith("PROPFIND") && !l.startsWith("GET"));

  it("lists decomposed hrefs under their composed identity", async () => {
    const res = await target.pull();
    expect([...res.etagMap.keys()]).toEqual([`${NFC}/Notiz.md`]);
    expect(res.folders).toEqual([NFC]);
  });

  it("PUTs a new note into the decomposed folder after a listing, without an MKCOL", async () => {
    await target.pull();
    await target.push(op("write", `${NFC}/Neu.md`));
    expect(writes()).toEqual([`PUT ${NFD}/Neu.md`]);
    expect([...dav.folders].sort()).toEqual(["", NFD]);
  });

  it("finds the folder by asking the server when no listing ran yet", async () => {
    await target.push(op("write", `${NFC}/Neu.md`));
    expect(dav.log).toEqual([`PROPFIND `, `PUT ${NFD}/Neu.md`]);
    expect([...dav.folders].sort()).toEqual(["", NFD]);
  });

  it("creates only the missing level below the decomposed folder (ensureDir)", async () => {
    await target.pull();
    await target.push(op("write", `${NFC}/Sub/new.md`));
    expect(writes()).toEqual([
      `PUT ${NFD}/Sub/new.md`,
      `MKCOL ${NFD}`,
      `MKCOL ${NFD}/Sub`,
      `PUT ${NFD}/Sub/new.md`,
    ]);
    expect([...dav.folders].sort()).toEqual(["", NFD, `${NFD}/Sub`].sort());
  });

  it("creates a queued folder inside the decomposed one through the engine", async () => {
    const db = await realSqlite();
    try {
      const queue = new SyncQueue(db);
      await queue.queueMkdir(`${NFC}/Neu`);
      await new SyncEngine(queue, target, { readBinaryFile: async () => new Uint8Array() } as any).processQueue();
      // Level by level, each in the spelling the server holds (405 = exists).
      expect(writes()).toEqual([`MKCOL ${NFD}`, `MKCOL ${NFD}/Neu`]);
      expect(dav.folders.has(NFC)).toBe(false);
    } finally {
      await db.close();
    }
  });

  it("MOVEs and DELETEs the stored spelling", async () => {
    await target.pull();
    await target.push(op("rename", `${NFC}/Notiz.md`, { new_path: `${NFC}/Umbenannt.md` }));
    await target.push(op("delete", `${NFC}/Umbenannt.md`));
    expect(writes()).toEqual([`MOVE ${NFD}/Notiz.md`, `DELETE ${NFD}/Umbenannt.md`]);
    expect(dav.files.size).toBe(0);
    expect([...dav.folders].sort()).toEqual(["", NFD]);
  });

  it("downloads and probes through the stored spelling", async () => {
    await target.pull();
    expect(new TextDecoder().decode((await target.download(`${NFC}/Notiz.md`))!)).toBe("old");
    expect(await target.probeExists!({ path: `${NFC}/Notiz.md` })).toBe("present");
  });

  it("reports a folder the server holds in both spellings as a twin, and writes into the composed one", async () => {
    dav.folders.add(NFC);
    dav.files.set(`${NFC}/Notiz.md`, { bytes: new TextEncoder().encode("composed"), etag: "e1" });
    const res = await target.pull();
    expect([...res.etagMap.keys()].sort()).toEqual([`${NFC}/Notiz.md`, `${NFD}/Notiz.md`].sort());
    await target.push(op("write", `${NFC}/Notiz.md`));
    expect(writes()).toEqual([`PUT ${NFC}/Notiz.md`]);
  });
});

describe("WebDAV hrefs in the other spelling than the configured URL", () => {
  it("accepts a vault folder the server answers decomposed while the URL was typed composed", async () => {
    const fetchFn = vi.fn(async () => new Response(
      `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/${encodeURIComponent(NFD)}/Note.md</d:href>` +
      `<d:propstat><d:prop><d:getetag>"a1"</d:getetag></d:prop></d:propstat></d:response></d:multistatus>`,
      { status: 207 },
    ));
    const target = new WebDavSyncTarget({ url: `https://cloud.example.com/dav/${NFC}`, user: "u", pass: "p" }, fetchFn as any);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const res = await target.pull();
    vi.restoreAllMocks();
    // Before ADR 0016 this refused the whole listing as "not below the vault path".
    expect([...res.etagMap.keys()]).toEqual(["Note.md"]);
  });
});
