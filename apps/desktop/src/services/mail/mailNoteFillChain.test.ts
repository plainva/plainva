// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BackupVaultAdapter, ConflictAwareVaultAdapter, DEFAULT_BACKUP_RETENTION, QueueingVaultAdapter, SyncQueue, SyncStateRepository, VaultIndexer, type IDatabaseAdapter,
} from "@plainva/core";
import { buildEmailNoteContent, captureMailAsNote, type MailMessage } from "@plainva/ui/mail";
import { LocalVaultAdapter } from "../../../../../packages/core/src/vault/LocalVaultAdapter";
import { realSqlite } from "../../../../../packages/core/test/helpers/realSqlite";

/**
 * A second "File as note" fills an empty mail note through the vault's chain
 * (finding 2026-10-09, decision b) — real files, a real SQLite, the chain put
 * together the way the vault context does it (`readChangeWriteChain.test.ts`).
 * What only the chain can show: a note with an open conflict.
 */

let root: string, raw: LocalVaultAdapter, db: IDatabaseAdapter, vaultAdapter: ConflictAwareVaultAdapter, indexer: VaultIndexer;

/** The desktop's database adapter queues its transactions (`TauriDatabaseAdapter`). */
function queueing(inner: IDatabaseAdapter): IDatabaseAdapter {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    ...inner,
    transaction<T>(fn: () => Promise<T>): Promise<T> {
      const turn = tail.then(() => inner.transaction(fn));
      tail = turn.catch(() => {});
      return turn;
    },
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "plainva-mail-fill-"));
  raw = new LocalVaultAdapter(root);
  await raw.initialize();
  db = queueing(await realSqlite());
  const backup = new BackupVaultAdapter(raw, { policy: DEFAULT_BACKUP_RETENTION, now: () => Date.now() });
  const repo = new SyncStateRepository(db, backup, "desktop-a");
  vaultAdapter = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, new SyncQueue(db)), repo, () => {}, repo, "external-folder");
  indexer = new VaultIndexer(vaultAdapter, db, { isOwnWrite: (path, sha256) => vaultAdapter.wasWrittenByUs(path, sha256), onExternalModification: () => {} });
});
afterEach(async () => {
  await db.close();
  await rm(root, { recursive: true, force: true });
});

const PATH = "Mail/2026-07-20 Rechnung Q3.md";
const message: MailMessage = {
  id: "4711",
  subject: "Rechnung Q3",
  from: "Anna Beispiel <anna@example.org>",
  to: "marco@example.org",
  dateTs: new Date(2026, 6, 20, 9, 30).getTime(),
  text: "Hallo,\n\nanbei die Rechnung.\n",
  html: null,
  attachments: [],
};
const FILED = buildEmailNoteContent(message, "acc1", "INBOX", "2026-07-20");
const EMPTY = buildEmailNoteContent({ ...message, text: null }, "acc1", "INBOX", "2026-07-20");
const capture = () => captureMailAsNote({ adapter: vaultAdapter, message, accountId: "acc1", mailbox: "INBOX", folder: "Mail", fillEmpty: true });

/** The empty note as the vault was opened with it: on disk, known to the index and to the chain. */
async function openVault(text: string): Promise<void> {
  await raw.writeTextFile(PATH, text);
  await indexer.indexVaultFull("open, empty index");
}

/**
 * The empty note with an open conflict: it was open in the editor when
 * another device's version arrived, and both had changed its title. The
 * note carries the other device's text, the working copy what was typed here.
 */
async function openConflict(theirs: string, mine: string): Promise<string> {
  await openVault(EMPTY);
  await raw.writeTextFile(PATH, theirs);
  const saved = await vaultAdapter.writeEditorText(PATH, mine, EMPTY);
  if (!saved.session) throw new Error("the save did not open a conflict");
  return saved.session.workingCopyPath;
}

describe("a second capture through the vault's chain", () => {
  it("fills the empty note, with no conflict copy", async () => {
    await openVault(EMPTY);
    expect(await capture()).toEqual({ path: PATH, created: false, filled: true });
    expect(await raw.readTextFile(PATH)).toBe(FILED);
    expect(await vaultAdapter.listConflictSessions()).toEqual([]);
    expect((await readdir(join(root, "Mail"))).filter((name) => name.includes(".CONFLICT"))).toEqual([]);
  });

  it("at an open conflict fills each version only where it is empty: the user's own version with a line in it stays as typed", async () => {
    const theirs = EMPTY.replace("# Rechnung Q3", "# Rechnung Q3 (Anna)");
    const mine = `${EMPTY.replace("# Rechnung Q3", "# Rechnung Q3 (Büro)")}\nMeine Notiz dazu.\n`;
    const copy = await openConflict(theirs, mine);
    expect((await capture()).filled).toBe(true);
    expect(await raw.readTextFile(PATH)).toBe(FILED.replace("# Rechnung Q3", "# Rechnung Q3 (Anna)"));
    expect(await raw.readTextFile(copy)).toBe(mine);
    // The conflict stays what it is until the user decides it.
    expect((await vaultAdapter.getConflictSession(PATH))?.workingCopyPath).toBe(copy);
  });

  it("at an open conflict where both versions are empty, fills both", async () => {
    const theirs = EMPTY.replace("# Rechnung Q3", "# Rechnung Q3 (Anna)");
    const mine = EMPTY.replace("# Rechnung Q3", "# Rechnung Q3 (Büro)");
    const copy = await openConflict(theirs, mine);
    expect((await capture()).filled).toBe(true);
    expect(await raw.readTextFile(PATH)).toBe(FILED.replace("# Rechnung Q3", "# Rechnung Q3 (Anna)"));
    expect(await raw.readTextFile(copy)).toBe(FILED.replace("# Rechnung Q3", "# Rechnung Q3 (Büro)"));
  });
});
