import { describe, it, expect, vi } from "vitest";
import { DeletionJournal, parseDeletionJournal, serializeDeletionJournal, mergeDeletionEntries, pruneDeletionEntries, DELETION_JOURNAL_RETENTION_MS, type DeletionJournalEntry } from "../../src/sync/deletionJournal.js";
import { OwnDeletionRegister } from "../../src/sync/ownDeletions.js";
import { DriveSyncTarget } from "../../src/sync/DriveSyncTarget.js";
import { SyncRootMissingError } from "../../src/sync/errorKind.js";
import { EncryptingSyncTarget } from "../../src/settingsSync/EncryptingSyncTarget.js";
import type { FetchFn } from "../../src/sync/WebDavSyncTarget.js";

/** The building blocks behind plan A1–A4 (finding 2026-09-20). */

function fakeVault(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    exists: vi.fn(async (p: string) => files.has(p)),
    readTextFile: vi.fn(async (p: string) => files.get(p) ?? ""),
    writeTextFile: vi.fn(async (p: string, c: string) => void files.set(p, c)),
  } as any;
}

describe("deletion journal — retractions", () => {
  it("a retraction voids the entries it covers, and a later deletion counts again", async () => {
    let clock = 1_000;
    const journal = new DeletionJournal(fakeVault(), "dev-A", { now: () => clock });
    await journal.recordPaths(["notes/a.md", "folder"]);
    expect(journal.explainsPath("notes/a.md")).not.toBeNull();
    expect(journal.explainsPath("folder/child.md")).not.toBeNull();

    clock = 2_000;
    expect(await journal.retractPaths(["notes/a.md", "folder/child.md", "never/journaled.md"])).toEqual(["notes/a.md", "folder/child.md"]);
    expect(journal.explainsPath("notes/a.md")).toBeNull();
    // Only the child was seen alive; its sibling is still covered by the folder entry.
    expect(journal.explainsPath("folder/child.md")).toBeNull();
    expect(journal.explainsPath("folder/other.md")).not.toBeNull();
    expect(journal.activePathEntries().map((e) => e.path)).toEqual(["folder"]);

    clock = 3_000;
    await journal.recordPaths(["notes/a.md"]);
    expect(journal.explainsPath("notes/a.md")?.deletedAt).toBe(3_000);
  });

  it("travels in the file, survives a merge with a copy that lacks it, and ages out by its own time", () => {
    const entries: DeletionJournalEntry[] = [
      { kind: "path", path: "a.md", deletedAt: 1_000, deviceId: "A" },
      { kind: "retract", path: "a.md", retractedAt: 2_000, deviceId: "B" },
    ];
    expect(parseDeletionJournal(serializeDeletionJournal(entries))).toEqual(entries);
    // Another device still holds only the (wrong) deletion: the union keeps the retraction.
    expect(mergeDeletionEntries([entries[0]], entries)).toEqual(entries);
    const afterEntryAged = pruneDeletionEntries(entries, 1_500 + DELETION_JOURNAL_RETENTION_MS);
    expect(afterEntryAged).toEqual([entries[1]]);
  });

  it("a client from before retractions reads the rest of the file", () => {
    // What that client does: it keeps the kinds it knows and skips the others.
    const text = JSON.stringify({ format: "plainva-deletions", version: 1, entries: [
      { kind: "path", path: "a.md", deletedAt: 1, deviceId: "A" },
      { kind: "something-newer", path: "b.md", at: 2, deviceId: "A" },
    ] });
    expect(parseDeletionJournal(text)).toEqual([{ kind: "path", path: "a.md", deletedAt: 1, deviceId: "A" }]);
  });
});

describe("own deletions register", () => {
  it("answers once for a marked path and never for another", () => {
    const own = new OwnDeletionRegister();
    own.mark("Notes\\a.md");
    expect(own.consume("Notes/b.md")).toBe(false);
    expect(own.consume("Notes/a.md")).toBe(true);
    // A note recreated under the same name and deleted by the user is the user's deletion.
    expect(own.consume("Notes/a.md")).toBe(false);
  });

  it("covers every file below a marked folder, forgets an unmarked path, and expires", () => {
    let clock = 0;
    const own = new OwnDeletionRegister(1_000, () => clock);
    own.mark("Archive");
    expect(own.consume("Archive/2024/a.md")).toBe(true);
    expect(own.consume("Archive/2024/b.md")).toBe(true);

    own.mark("x.md");
    own.unmark("x.md");
    expect(own.consume("x.md")).toBe(false);

    own.mark("late.md");
    clock = 5_000;
    expect(own.consume("late.md")).toBe(false);
    expect(own.size).toBe(0);
  });
});

function res(body: any, status = 200) {
  return { ok: status >= 200 && status < 300, status, statusText: "", headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body), arrayBuffer: async () => new ArrayBuffer(0) } as any;
}
const FOLDER = "application/vnd.google-apps.folder";
const isFolderLookup = (u: string) => u.includes("/drive/v3/files?") && decodeURIComponent(u).includes(`mimeType='${FOLDER}'`);

function drive(fetchImpl: (url: string, init: any) => Promise<any>, creds: Record<string, string> = {}) {
  const fetchFn = vi.fn<FetchFn>(fetchImpl as any);
  const target = new DriveSyncTarget({ clientId: "cid", clientSecret: "s", refreshToken: "r", accessToken: "a", ...creds }, fetchFn);
  return { target, fetchFn };
}

describe("Drive — asked about the object, not the search", () => {
  it("probes by id: alive, trashed and unknown id are three different answers", async () => {
    const { target, fetchFn } = drive(async (url) => {
      const u = String(url);
      if (u.includes("/files/alive?")) return res({ id: "alive", trashed: false });
      if (u.includes("/files/binned?")) return res({ id: "binned", trashed: true });
      if (u.includes("/files/nowhere?")) return res({ error: { message: "File not found" } }, 404);
      throw new Error(`unexpected ${u}`);
    });
    expect(await target.probeExists({ path: "a.md", remoteId: "alive" })).toBe("present");
    expect(await target.probeExists({ path: "b.md", remoteId: "binned" })).toBe("absent");
    expect(await target.probeExists({ path: "c.md", remoteId: "nowhere" })).toBe("absent");
    // Never a name search when an id is known.
    expect(fetchFn.mock.calls.every((c: any) => !String(c[0]).includes("/files?q="))).toBe(true);
  });

  it("without an id a search can prove presence, never absence", async () => {
    let found = true;
    const { target } = drive(async (url) => {
      const u = String(url);
      if (isFolderLookup(u)) return res({ files: [{ id: "root", name: "Plainva" }] });
      if (u.includes("/drive/v3/files?")) return res({ files: found ? [{ id: "f1", name: "a.md" }] : [] });
      throw new Error(`unexpected ${u}`);
    });
    expect(await target.probeExists({ path: "a.md" })).toBe("present");
    found = false;
    expect(await target.probeExists({ path: "b.md" })).toBe("unknown");
  });

  it("a full listing carries every file id and its own counters", async () => {
    const { target } = drive(async (url) => {
      // URLSearchParams writes a space as "+".
      const u = decodeURIComponent(String(url).replace(/\+/g, " "));
      if (isFolderLookup(String(url))) return res({ files: [{ id: "rootid-123456", name: "Plainva" }] });
      if (u.includes("'rootid-123456' in parents")) {
        return res({ files: [{ id: "f1", name: "a.md", md5Checksum: "m1" }, { id: "d1", name: "Sub", mimeType: FOLDER }] });
      }
      if (u.includes("'d1' in parents")) return res({ files: [{ id: "f2", name: "b.md", md5Checksum: "m2" }] });
      throw new Error(`unexpected ${u}`);
    });
    const pull = await target.pull();
    expect([...pull.idMap!]).toEqual([["a.md", "f1"], ["Sub/b.md", "f2"]]);
    expect(pull.listing).toMatchObject({ folders: 2, pages: 2, files: 2, rootId: "rootid" });
  });

  it("reports the root it resolved by name, and refuses to create one for a vault that has synced before", async () => {
    const resolved = vi.fn();
    const found = drive(async (url) => {
      if (isFolderLookup(String(url))) return res({ files: [{ id: "root-1", name: "Plainva" }] });
      return res({ files: [] });
    });
    found.target.onRootFolderResolved = resolved;
    await found.target.pull();
    expect(resolved).toHaveBeenCalledWith({ id: "root-1", path: "Plainva", created: false });

    const missing = drive(async (url, init) => {
      if (init.method === "POST") throw new Error("must not create a folder");
      return res({ files: [] });
    });
    missing.target.allowRootCreation = false;
    await expect(missing.target.pull()).rejects.toBeInstanceOf(SyncRootMissingError);
    expect(missing.fetchFn.mock.calls.some((c: any) => c[1].method === "POST")).toBe(false);
  });
});

describe("content encryption keeps the safeguard", () => {
  it("forwards the existence probe of the target it wraps", async () => {
    const inner: any = { push: vi.fn(), pull: vi.fn(), download: vi.fn(), probeExists: vi.fn().mockResolvedValue("present") };
    const wrapped = new EncryptingSyncTarget(inner, { isStrict: () => false } as any);
    expect(await wrapped.probeExists!({ path: "a.md", remoteId: "x" })).toBe("present");
    expect(inner.probeExists).toHaveBeenCalledWith({ path: "a.md", remoteId: "x" });

    const plain = new EncryptingSyncTarget({ push: vi.fn(), pull: vi.fn(), download: vi.fn() } as any, { isStrict: () => false } as any);
    expect(plain.probeExists).toBeUndefined();
  });
});
