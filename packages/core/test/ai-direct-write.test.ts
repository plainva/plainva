import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realSqlite } from "./helpers/realSqlite.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { BackupVaultAdapter, DEFAULT_BACKUP_RETENTION } from "../src/vault/BackupVaultAdapter.js";
import { QueueingVaultAdapter } from "../src/vault/QueueingVaultAdapter.js";
import { ConflictAwareVaultAdapter } from "../src/vault/ConflictAwareVaultAdapter.js";
import { SyncStateRepository } from "../src/vault/SyncStateRepository.js";
import { VersionHistoryService } from "../src/vault/VersionHistoryService.js";
import { VaultPermissionDeniedError } from "../src/vault/IVaultAdapter.js";
import { AI_VERSIONS_FILE, readAiVersionMarks } from "../src/vault/versionOrigins.js";
import { SyncQueue } from "../src/sync/SyncQueue.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { applyDirectChange, keepBeforeMaking, madeDirectly, recordApplied, undoDirectChange, type DirectWriteFiles } from "../src/ai/writes/direct.js";
import { readAppliedWrites, type AppliedWrite, type RunWrites } from "../src/ai/history.js";

/**
 * "Apply directly" (plan "KI direkt schreiben", W1) through the real chain both
 * shells put together: real files, versions, the sync queue and the conflict
 * check. A change the user let the assistant write goes in only with a version
 * before it, only onto the note as the assistant read it, never onto a note
 * with an open conflict or one open with unsaved keystrokes — and "Undo" puts
 * the version back only where nobody changed the note since.
 */

const NOTE = "Projects/Alpha.md";
const BEFORE = "# Alpha\n\nThe old line.\n";
const AFTER = "# Alpha\n\nThe new line.\n";
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

let root: string, raw: LocalVaultAdapter, db: IDatabaseAdapter, repo: SyncStateRepository, chain: ConflictAwareVaultAdapter, backup: BackupVaultAdapter;
let history: VersionHistoryService;
let clock: number;
let changed: string[], discarded: string[];
let unsaved: Set<string>;
let snapshotFails: boolean;

function deps(files: DirectWriteFiles["files"] = chain): DirectWriteFiles {
  return {
    files,
    snapshot: async (path, origin) => {
      if (snapshotFails) throw new Error("disk full");
      return backup.ensureSnapshot(path, origin ? { origin } : {});
    },
    unsaved: (path) => unsaved.has(path),
    changed: async (path) => {
      changed.push(path);
    },
    readVersion: (backupPath) => history.readVersionText(backupPath),
    discard: async (path) => {
      discarded.push(path);
      await raw.deleteItem(path);
      return true;
    },
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "plainva-ai-direct-"));
  raw = new LocalVaultAdapter(root);
  await raw.initialize();
  db = await realSqlite();
  // The versions layer takes one version per interval; a direct write takes its own whatever the interval says.
  clock = Date.now();
  repo = new SyncStateRepository(db, raw, "device-a");
  backup = new BackupVaultAdapter(raw, { policy: DEFAULT_BACKUP_RETENTION, now: () => clock++ });
  chain = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, new SyncQueue(db)), repo, undefined, repo, "local");
  history = new VersionHistoryService(raw);
  changed = [];
  discarded = [];
  unsaved = new Set();
  snapshotFails = false;
});
afterEach(async () => {
  await db.close();
  await rm(root, { recursive: true, force: true });
});

async function synced(text = BEFORE, path = NOTE): Promise<void> {
  await raw.writeTextFile(path, text);
  await repo.updateLocalHashAndBaseText(path, sha(text), text);
  await repo.updateBaseState(path, sha(text), "etag-1");
}

describe("a change the user let go directly", () => {
  it("is written with a version before it, and the assistant's text is a version of its own, marked AI", async () => {
    await synced();
    // A version a moment ago: within the interval, which a direct write does not wait for.
    await chain.writeTextFile(NOTE, BEFORE);
    const outcome = await applyDirectChange(deps(), NOTE, BEFORE, AFTER);
    expect(outcome.ok).toBe(true);
    expect(await raw.readTextFile(NOTE)).toBe(AFTER);
    if (!outcome.ok) return;
    expect(await history.readVersionText(outcome.before)).toBe(BEFORE);
    expect(outcome.after).toBe(sha(AFTER));
    const versions = await history.listVersions(NOTE);
    expect(versions.map((v) => v.origin ?? "")).toEqual(["ai", ""]);
    expect(await history.readVersionText(versions[0]!.backupPath)).toBe(AFTER);
    expect(changed).toEqual([NOTE]);
  });

  it("keeps the file's line ends and byte order mark: only the changed line differs", async () => {
    const mark = String.fromCharCode(0xfeff);
    await synced(`${mark}# Alpha\r\n\r\nThe old line.\r\n`);
    const outcome = await applyDirectChange(deps(), NOTE, BEFORE, AFTER);
    expect(outcome.ok).toBe(true);
    expect(await raw.readTextFile(NOTE)).toBe(`${mark}# Alpha\r\n\r\nThe new line.\r\n`);
  });

  it("is not written into a note open with unsaved keystrokes", async () => {
    await synced();
    unsaved.add(NOTE);
    expect(await applyDirectChange(deps(), NOTE, BEFORE, AFTER)).toEqual({ ok: false, fallback: "unsaved" });
    expect(await raw.readTextFile(NOTE)).toBe(BEFORE);
    expect(await history.listVersions(NOTE)).toEqual([]);
  });

  it("is not written onto a note with an open conflict, nor into its working copy", async () => {
    await synced();
    const theirs = "# Alpha\n\nAnother device's line.\n";
    const mine = "# Alpha\n\nTyped here.\n";
    await raw.writeTextFile(NOTE, theirs);
    await chain.writeEditorText(NOTE, mine, BEFORE);
    const session = await chain.getConflictSession(NOTE);
    expect(session).not.toBeNull();
    expect(await applyDirectChange(deps(), NOTE, theirs, AFTER)).toEqual({ ok: false, fallback: "conflict" });
    expect(await raw.readTextFile(NOTE)).toBe(theirs);
    expect(await raw.readTextFile(session!.workingCopyPath)).toBe(mine);
  });

  it("is not written where no version could be kept first", async () => {
    await synced();
    snapshotFails = true;
    expect(await applyDirectChange(deps(), NOTE, BEFORE, AFTER)).toEqual({ ok: false, fallback: "snapshot" });
    expect(await raw.readTextFile(NOTE)).toBe(BEFORE);
  });

  it("is not written over a note that changed since the assistant read it", async () => {
    await synced("# Alpha\n\nSomebody else's line.\n");
    expect(await applyDirectChange(deps(), NOTE, BEFORE, AFTER)).toEqual({ ok: false, fallback: "changed" });
    expect(await raw.readTextFile(NOTE)).toBe("# Alpha\n\nSomebody else's line.\n");
  });

  it("is a suggestion where the vault does not let it be written (no write right)", async () => {
    await synced();
    const denied: DirectWriteFiles["files"] = {
      exists: (path) => chain.exists(path),
      readTextFile: (path) => chain.readTextFile(path),
      writeTextFile: async (path) => {
        throw new VaultPermissionDeniedError(path);
      },
      updateTextFile: async (path) => {
        throw new VaultPermissionDeniedError(path);
      },
    };
    expect(await applyDirectChange(deps(denied), NOTE, BEFORE, AFTER)).toEqual({ ok: false, fallback: "rights" });
    expect(await raw.readTextFile(NOTE)).toBe(BEFORE);
  });
});

describe("Undo", () => {
  it("puts the version back while the note is what the assistant left", async () => {
    await synced();
    const outcome = await applyDirectChange(deps(), NOTE, BEFORE, AFTER);
    if (!outcome.ok) throw new Error("not applied");
    expect(await undoDirectChange(deps(), { path: NOTE, before: outcome.before, after: outcome.after })).toBe("undone");
    expect(await raw.readTextFile(NOTE)).toBe(BEFORE);
    // What the assistant wrote stays in the history.
    const texts = await Promise.all((await history.listVersions(NOTE)).map((v) => history.readVersionText(v.backupPath)));
    expect(texts).toContain(AFTER);
  });

  it("overwrites nothing that changed since: the comparison is offered instead", async () => {
    await synced();
    const outcome = await applyDirectChange(deps(), NOTE, BEFORE, AFTER);
    if (!outcome.ok) throw new Error("not applied");
    await chain.writeTextFile(NOTE, "# Alpha\n\nThe new line, and mine.\n");
    expect(await undoDirectChange(deps(), { path: NOTE, before: outcome.before, after: outcome.after })).toBe("changed");
    expect(await raw.readTextFile(NOTE)).toBe("# Alpha\n\nThe new line, and mine.\n");
  });

  it("waits for a note open with unsaved keystrokes", async () => {
    await synced();
    const outcome = await applyDirectChange(deps(), NOTE, BEFORE, AFTER);
    if (!outcome.ok) throw new Error("not applied");
    unsaved.add(NOTE);
    expect(await undoDirectChange(deps(), { path: NOTE, before: outcome.before, after: outcome.after })).toBe("changed");
    expect(await raw.readTextFile(NOTE)).toBe(AFTER);
  });

  it("takes a note the assistant made away only while it is what it made", async () => {
    await raw.writeTextFile("Inbox/New.md", "# New\n");
    const made = await madeDirectly(deps(), "Inbox/New.md", null);
    expect(made).toEqual({ before: null, after: sha("# New\n") });
    expect(await undoDirectChange(deps(), { path: "Inbox/New.md", before: null, after: made!.after })).toBe("undone");
    expect(discarded).toEqual(["Inbox/New.md"]);
    await raw.writeTextFile("Inbox/Other.md", "# Other\n");
    const other = await madeDirectly(deps(), "Inbox/Other.md", null);
    await raw.writeTextFile("Inbox/Other.md", "# Other\n\nMine now.\n");
    expect(await undoDirectChange(deps(), { path: "Inbox/Other.md", before: null, after: other!.after })).toBe("changed");
    expect(discarded).toEqual(["Inbox/New.md"]);
  });

  it("says when the note is gone", async () => {
    expect(await undoDirectChange(deps(), { path: "Gone.md", before: null, after: sha("x") })).toBe("gone");
  });
});

describe("a line into a note that may be there (the journal's day)", () => {
  it("keeps the note first where it is there, and nothing where it is new", async () => {
    await synced("# 2026-11-06\n", "Journal/2026-11-06.md");
    const kept = await keepBeforeMaking(deps(), "Journal/2026-11-06.md");
    expect(kept.ok).toBe(true);
    if (kept.ok) expect(await history.readVersionText(kept.before!)).toBe("# 2026-11-06\n");
    expect(await keepBeforeMaking(deps(), "Journal/2026-11-07.md")).toEqual({ ok: true, before: null });
    expect(await keepBeforeMaking(deps(), null)).toEqual({ ok: true, before: null });
    unsaved.add("Journal/2026-11-06.md");
    expect(await keepBeforeMaking(deps(), "Journal/2026-11-06.md")).toEqual({ ok: false, fallback: "unsaved" });
  });
});

describe("the record", () => {
  const entry = (patch: Partial<AppliedWrite> = {}): AppliedWrite => ({ path: NOTE, kind: "edit", created: false, passages: 2, properties: 0, before: ".plainva/backups/Projects/Alpha.md.1.bak", after: "h1", by: "chat", ...patch });

  it("keeps one line per note: the version before the first change, the counts added up", () => {
    const writes: RunWrites = { rounds: [], drafts: [], plans: [] };
    recordApplied(writes, entry());
    recordApplied(writes, entry({ passages: 0, properties: 1, before: ".plainva/backups/Projects/Alpha.md.2.bak", after: "h2" }));
    expect(writes.applied).toEqual([entry({ properties: 1, after: "h2" })]);
  });

  it("is read back defensively: unknown kinds and missing hashes are dropped", () => {
    const read = readAppliedWrites([entry(), entry({ undone: true }), { ...entry(), kind: "delete" }, { ...entry(), after: "" }, "junk", entry({ before: null, created: true, by: "folder" })]);
    expect(read).toEqual([entry(), entry({ undone: true }), entry({ before: null, created: true, by: "folder" })]);
  });
});

describe("the marks of the history", () => {
  it("live beside the versions, in a file no reader of the snapshot names takes for one", async () => {
    await raw.writeTextFile(NOTE, BEFORE);
    const kept = await backup.ensureSnapshot(NOTE, { origin: "ai" });
    expect(kept).not.toBeNull();
    expect(await readAiVersionMarks(raw)).toEqual(new Set([kept]));
    expect(await raw.exists(AI_VERSIONS_FILE)).toBe(true);
    // Pruning and the orphan scan never touch it.
    expect(await history.listOrphans()).toEqual([]);
    await history.pruneOldBackups({ maxAgeDays: 1, now: Date.now() + 10 * 86_400_000 });
    expect(await raw.exists(AI_VERSIONS_FILE)).toBe(true);
  });
});
