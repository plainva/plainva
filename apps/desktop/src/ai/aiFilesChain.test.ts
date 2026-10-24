// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ACTIVE_MEMORY_FILE,
  BackupVaultAdapter,
  ConflictAwareVaultAdapter,
  DEFAULT_BACKUP_RETENTION,
  QueueingVaultAdapter,
  SyncQueue,
  SyncStateRepository,
  VaultIndexer,
  addMemoryEntry,
  type IDatabaseAdapter,
} from "@plainva/core";
import { AI_POLICY_FILE, adapterInstructionIO, adapterInstructionWriter, changeFolderRules, createMemoryHost, withRuleValue } from "@plainva/ui";
import { LocalVaultAdapter } from "../../../../packages/core/src/vault/LocalVaultAdapter";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";

/**
 * The assistant's own files of the vault change through the chain's one entry
 * (Sammelplan 3.87): the memory, the rules for assistants, the learning log, a
 * skill's instructions, the folder rules. They used to be read, changed and
 * written back whole — the shape the finding was about: a file another device
 * or program had changed was refused with a conflict copy, and a file with an
 * open conflict lost what the user had typed into it. Read here from the vault
 * itself: real files, a real SQLite, the chain put together the way the vault
 * context does it, and the writer both shells hand the assistant.
 */

let root: string, raw: LocalVaultAdapter, db: IDatabaseAdapter, vaultAdapter: ConflictAwareVaultAdapter, indexer: VaultIndexer;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "plainva-ai-files-"));
  raw = new LocalVaultAdapter(root);
  await raw.initialize();
  db = await realSqlite();
  // VaultContext: the files, above them versions, the sync queue and the conflict check.
  const backup = new BackupVaultAdapter(raw, { policy: DEFAULT_BACKUP_RETENTION, now: () => Date.now() });
  const repo = new SyncStateRepository(db, backup, "desktop-a");
  vaultAdapter = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, new SyncQueue(db)), repo, () => {}, repo, "external-folder");
  indexer = new VaultIndexer(vaultAdapter, db, { isOwnWrite: (path, sha256) => vaultAdapter.wasWrittenByUs(path, sha256) });
});
afterEach(async () => {
  await db.close();
  await rm(root, { recursive: true, force: true });
});

/** A vault as it stands after it was opened: its files on disk, each known to the index and to the chain. */
async function openVault(texts: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(texts)) await raw.writeTextFile(path, text);
  await indexer.indexVaultFull("open, empty index");
}
/** What another device or another program left reaches the disk below the chain — as a pull writes it, or a second app. */
const landedFromOutside = (path: string, text: string) => raw.writeTextFile(path, text);
const conflictCopies = async (folder: string) => (await readdir(join(root, folder))).filter((name) => name.includes(".CONFLICT"));
const prefs = { load: async () => ({ on: true }), save: async () => {} };
const meta = { added: "2026-10-24", by: "user" as const, source: null, deny: [] };
const add = (text: string) => (file: string | null) => {
  const changed = addMemoryEntry(file, "active", text, meta);
  return changed.ok ? changed.text : null;
};

const MEMORY = "# Active memory\n\n- I work from Hamburg.\n";
const THEIRS = "# Active memory\n\n- I work from Hamburg.\n- I travel on Fridays.\n";

describe("the assistant's own files, changed where they lie", () => {
  it("a memory file another program changed takes the entry as it is now: its line stays, and there is no conflict copy", async () => {
    await openVault({ [ACTIVE_MEMORY_FILE]: MEMORY });
    await landedFromOutside(ACTIVE_MEMORY_FILE, THEIRS);
    const memory = createMemoryHost(adapterInstructionIO(vaultAdapter), adapterInstructionWriter(vaultAdapter), prefs);
    await memory.update!("active", add("Answer in German."));
    expect(await raw.readTextFile(ACTIVE_MEMORY_FILE)).toBe(`${THEIRS}- Answer in German. <!-- plainva: added=2026-10-24; by=user -->\n`);
    expect(await conflictCopies(".agent")).toEqual([]);
  });

  it("a memory file with an open conflict takes the entry in both versions: what was typed here stays", async () => {
    await openVault({ [ACTIVE_MEMORY_FILE]: MEMORY });
    // The file was open in the editor, and both sides changed the same line: the editor's save opens a conflict.
    const theirs = "# Active memory\n\n- I work from Bremen.\n";
    await landedFromOutside(ACTIVE_MEMORY_FILE, theirs);
    const mine = "# Active memory\n\n- I work from Hamburg and Kiel.\n";
    const saved = await vaultAdapter.writeEditorText(ACTIVE_MEMORY_FILE, mine, MEMORY);
    if (!saved.session) throw new Error("the save did not open a conflict");
    const memory = createMemoryHost(adapterInstructionIO(vaultAdapter), adapterInstructionWriter(vaultAdapter), prefs);
    await memory.update!("active", add("Answer in German."));
    const line = "- Answer in German. <!-- plainva: added=2026-10-24; by=user -->\n";
    expect(await raw.readTextFile(ACTIVE_MEMORY_FILE)).toBe(`${theirs}${line}`);
    expect(await raw.readTextFile(saved.session.workingCopyPath)).toBe(`${mine}${line}`);
  });

  it("a memory file that is not there is made, its folder with it", async () => {
    await openVault({ "Notes/Plan.md": "# Plan\n" });
    const memory = createMemoryHost(adapterInstructionIO(vaultAdapter), adapterInstructionWriter(vaultAdapter), prefs);
    expect(await memory.update!("active", add("Answer in German."))).toContain("- Answer in German.");
    expect(await raw.readTextFile(ACTIVE_MEMORY_FILE)).toContain("- Answer in German. <!-- plainva: added=2026-10-24; by=user -->");
  });

  it("keeps the line ends and the byte order mark of the file", async () => {
    const bom = String.fromCharCode(0xfeff);
    const windows = `${bom}# Active memory\r\n\r\n- I work from Hamburg.\r\n`;
    await openVault({ [ACTIVE_MEMORY_FILE]: windows });
    const memory = createMemoryHost(adapterInstructionIO(vaultAdapter), adapterInstructionWriter(vaultAdapter), prefs);
    await memory.update!("active", add("Answer in German."));
    const bytes = await raw.readBinaryFile(ACTIVE_MEMORY_FILE);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toBe("# Active memory\r\n\r\n- I work from Hamburg.\r\n- Answer in German. <!-- plainva: added=2026-10-24; by=user -->\r\n");
  });

  it("a step on the folder rules lands on the rules as they lie in the file: a rule another device saved stays", async () => {
    await openVault({ [AI_POLICY_FILE]: "folders:\n  Finance/:\n    cloud: deny\n" });
    // The settings page read the file; then another device saved a rule of its own.
    await landedFromOutside(AI_POLICY_FILE, "folders:\n  Finance/:\n    cloud: deny\n  Journal/:\n    web: deny\n");
    const rules = await changeFolderRules(vaultAdapter, (current) => withRuleValue(current, "Clients", "cloud", "deny"));
    expect(rules.map((rule) => rule.folder).sort()).toEqual(["Clients/", "Finance/", "Journal/"]);
    const text = await raw.readTextFile(AI_POLICY_FILE);
    expect(text).toContain("Journal/");
    expect(text).toContain("Clients/");
    expect(await conflictCopies(".agent")).toEqual([]);
  });

  it("the folder rules of a vault that has none yet are made", async () => {
    await openVault({ "Notes/Plan.md": "# Plan\n" });
    expect(await changeFolderRules(vaultAdapter, (current) => withRuleValue(current, "Finance", "cloud", "deny"))).toEqual([{ folder: "Finance/", cloud: "deny" }]);
    expect(await raw.readTextFile(AI_POLICY_FILE)).toContain("Finance/");
  });
});
