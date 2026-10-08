import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BackupVaultAdapter,
  BundleCommentStore,
  ConflictAwareVaultAdapter,
  DEFAULT_AI_APP_SETTINGS,
  EMPTY_INSTRUCTION_APPROVALS,
  EMPTY_SKILL_TESTS,
  QueueingVaultAdapter,
  SyncQueue,
  SyncStateRepository,
  VersionHistoryService,
  effectivePolicy,
  notePolicyFrom,
  parsePolicyFile,
  planCommentDecision,
  readConversationRecord,
  readFrontmatterPath,
  type CommentOperationService,
  type ConversationRecord,
  type EgressChunk,
  type FolderPolicyRule,
  type IDatabaseAdapter,
  type InstructionApprovals,
  type LedgerEntry,
  type SkillTestRecords,
  type WorkspaceCommentRecord,
} from "@plainva/core";
import {
  AiSession,
  CHAT_TOOL_NAMES,
  captureVocabularyOf,
  createVaultToolExecutor,
  createWriteDraftStore,
  furtherToolNames,
  noteMovePlan,
  noteRenamePlan,
  proposeSuggestionRound,
  readTextShape,
  type AiVaultHost,
  type DraftCreator,
  type VaultToolDeps,
  type VaultWriteDeps,
} from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { LocalVaultAdapter } from "../../../../packages/core/src/vault/LocalVaultAdapter";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import { desktopCommentOperations } from "../services/commentOperations";
import { CLOUD, fakeEgress } from "./mcpSessionHarness";
import { memoryFiles } from "./mcpTestHost";
import { setGateJournalFolder } from "./writeGateJournal";

/**
 * A vault on a real disk for the gate of the writing tools (plan KI-Harness
 * P5-7): the real file adapter under the real version history, above it the
 * desktop's own chain — the sync queue and the conflict guard, on a real
 * SQLite index —, the comment files a vault really has, the DESKTOP's own
 * wiring of the operation that accepts a suggestion, and the real session in
 * front of a scripted model. What a test reads back is bytes, and what waits
 * to be synced.
 *
 * The one thing that is the test's own is the user: `decide` does what the
 * editor does on "Accept" and "Decline" — it takes the note as the editor
 * holds it and runs the planned decision through the comment service.
 *
 * A test file that uses this mocks the desktop's journal module with
 * `gateJournal` (see `aiWriteGate.test.ts`): the journal of comment
 * operations lives in the app's data, behind Tauri.
 */

export interface GateOptions {
  /** Folder rules of the vault, as `.agent/policy.yml` would hold them. */
  policy?: string;
  /** The device this vault's comments are written on. */
  device?: string;
  /** A clock for the version history: a test moves it to cross, or not to cross, the snapshot interval. */
  now?: () => number;
  /** What the user answers in the app's own delete dialog. */
  confirmDelete?: boolean;
  /**
   * A second device on the same vault folder — a folder both devices sync to: its own comments file, its own
   * journal, the same notes. `notes` is ignored then.
   */
  beside?: { root: string };
}

const roots: string[] = [];
const databases: IDatabaseAdapter[] = [];

/** Removes every vault a test made. Call it from `afterEach`. */
export async function removeGateVaults(): Promise<void> {
  await Promise.all(databases.splice(0).map((db) => db.close().catch(() => {})));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

/** The hash the conflict guard keeps of a text: SHA-256 over its UTF-8 bytes. */
const textHash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** Every file below `dir`, by its path relative to it, with its bytes as a latin1 string — so two readings compare byte for byte. */
async function bytesBelow(dir: string, prefix = ""): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(out, await bytesBelow(join(dir, entry.name), rel));
    else out[rel] = (await readFile(join(dir, entry.name))).toString("latin1");
  }
  return out;
}

export async function gateVault(notes: Record<string, string>, options: GateOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), "plainva-write-gate-"));
  roots.push(root);
  const vaultRoot = options.beside?.root ?? join(root, "vault");
  const device = options.device ?? "desktop";
  // What is this device's own: its journal of comment operations, and the key its write lanes go by.
  const deviceKey = options.beside ? `${vaultRoot}::${device}` : vaultRoot;
  setGateJournalFolder(deviceKey, join(root, "journal"));
  const raw = new LocalVaultAdapter(vaultRoot);
  await raw.initialize();
  const backup = new BackupVaultAdapter(raw, options.now ? { now: options.now } : {});
  if (!options.beside) for (const [path, text] of Object.entries(notes)) await raw.writeTextFile(path, text);
  // The chain the desktop writes a note through (`VaultContext`): the conflict guard over the sync queue over the
  // version history. The index is this device's own, as it is in the app's data.
  const db = await realSqlite();
  databases.push(db);
  const syncRepo = new SyncStateRepository(db, backup, device);
  const files = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, new SyncQueue(db)), syncRepo, undefined, syncRepo, "external-folder");

  // The comment store reads and writes below the queue, as the desktop's does (`raw: state.backupAdapter`).
  const store = new BundleCommentStore({ vault: backup, vaultKey: deviceKey, deviceId: async () => device, mode: async () => ({ kind: "plain" as const }) });
  // The desktop's own service: the text shape of a file, the write lane, and the version before an accept —
  // over the whole chain, as `VaultContext` hands it `state.vaultAdapter`.
  const service: CommentOperationService = desktopCommentOperations({
    vaultPath: deviceKey,
    adapter: files,
    store,
    backup,
    assertCurrent: () => {},
    ensureAuthorName: async () => {},
    noteWritten: async () => {},
  });

  const rules: FolderPolicyRule[] = options.policy ? parsePolicyFile(options.policy).rules : [];
  const title = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
  const read = async (path: string): Promise<string | null> => ((await backup.exists(path)) ? backup.readTextFile(path) : null);
  // As the shells' policy host decides it: the folder rules, and the note's own rule — read from the file where
  // the caller has no text at hand (a place, a link's target).
  const policyOf = async (path: string, text?: string) => {
    const content = text ?? (await read(path).catch(() => null)) ?? "";
    const plainva = readFrontmatterPath(content, ["plainva"]);
    return effectivePolicy(path, notePolicyFrom(plainva === undefined ? {} : { plainva }), rules);
  };
  const notePaths = async () => (await backup.listDir("", true)).filter((file) => !file.isDirectory && /\.md$/i.test(file.path) && !file.path.startsWith(".plainva/")).map((file) => file.path.replace(/\\/g, "/"));
  const acts: string[] = [];
  const created: string[] = [];

  const writes: VaultWriteDeps = {
    sealed: () => false,
    // As both shells hand it over: the file as it lies on disk.
    current: read,
    propose: (round) => proposeSuggestionRound(service, round),
    folderExists: async (folder) => folder === "" || backup.exists(folder),
    taskVocabulary: () => captureVocabularyOf((key) => i18n.t(key), "en"),
    draftPlace: async (kind, day) => (kind === "task" ? "Tasks/task.md" : `Daily/${day}.md`),
    renamePlan: (path, name) => noteRenamePlan({ getBacklinks: async () => [] as never }, (candidate) => backup.exists(candidate), path, name),
    // What the app does itself after a yes goes the way the app's own renames, moves and deletions go: the chain.
    rename: async (path, name) => {
      const target = `${path.slice(0, path.lastIndexOf("/") + 1)}${name}.md`;
      await files.renameItem(path, target);
      acts.push(`rename ${path} -> ${target}`);
      return target;
    },
    movePlan: (path, folder) => noteMovePlan((candidate) => backup.exists(candidate), path, folder),
    move: async (path, folder) => {
      const target = `${folder ? `${folder}/` : ""}${path.slice(path.lastIndexOf("/") + 1)}`;
      await files.renameItem(path, target);
      acts.push(`move ${path} -> ${target}`);
      return target;
    },
    requestDelete: async (path) => {
      acts.push(`delete dialog ${path}`);
      if (options.confirmDelete !== true) return false;
      await files.deleteItem(path, false, { confirmed: true });
      return true;
    },
    setRule: async (path, rule, set) => {
      acts.push(`rule ${rule} ${set ? "into" : "out of"} ${path}`);
      return false;
    },
    entryPlace: async () => null,
  };
  const deps: VaultToolDeps = {
    search: async () => [],
    readNote: read,
    resolveLink: async (target) => (await notePaths()).find((path) => title(path).toLowerCase() === target.toLowerCase() || path.toLowerCase() === `${target.toLowerCase()}.md`) ?? null,
    policyOf,
    taskRows: async () => [],
    todayKey: () => "2026-10-08",
    commands: () => [],
    writes,
  };

  const saved = new Map<string, ConversationRecord>();
  let ledger: LedgerEntry[] = [];
  let approvals: InstructionApprovals = EMPTY_INSTRUCTION_APPROVALS;
  let tests: SkillTestRecords = EMPTY_SKILL_TESTS;
  const appData = memoryFiles();
  const note = async (path: string) => {
    const text = await read(path);
    return text === null ? null : { path, title: title(path), text };
  };
  const creates: DraftCreator = {
    // As the app makes a note: under a free name in the folder, never over a file.
    async note({ folder, stem, content }) {
      const path = `${folder ?? "Inbox"}/${stem}.md`;
      if (await backup.exists(path)) throw new Error("a file of that name is there");
      await files.writeTextFile(path, content);
      created.push(path);
      return path;
    },
    async task() {
      throw new Error("no task database in this vault");
    },
    async journal() {
      throw new Error("no journal in this vault");
    },
    entryPlace: async () => null,
    placeDenies: async () => [],
  };
  const host: AiVaultHost = {
    conversations: {
      list: async () => [...saved.values()].map((record) => ({ id: record.id, title: record.title, updatedAt: record.updatedAt, providerId: record.providerId, model: record.model })),
      load: async (id) => (saved.has(id) ? readConversationRecord(JSON.parse(JSON.stringify(saved.get(id)))) : null),
      save: async (record) => void saved.set(record.id, JSON.parse(JSON.stringify(record))),
      remove: async (id) => void saved.delete(id),
      removeAll: async () => saved.clear(),
    },
    ledger: { load: async () => ledger, save: async (entries) => void (ledger = [...entries]) },
    activeNote: async () => null,
    readNote: note,
    async situation() {
      return { now: "2026-10-08 10:00", weekday: "Thursday", calendarDay: "2026-10-08", journalDay: "2026-10-08", active: null, tabs: [], tasks: [], events: [], dailyNote: null };
    },
    candidates: async () => [],
    policy: { policyOf, resolveLink: deps.resolveLink },
    tools(recipient, scope, redact, web, narrowed, foreign, writing) {
      const more = furtherToolNames(deps);
      return { names: CHAT_TOOL_NAMES, more, executor: createVaultToolExecutor(deps, { recipient, webTools: web === true }, scope, redact, { more, ...(narrowed ? { narrowed } : {}), ...(foreign ? { foreign } : {}) }, writing) };
    },
    instructions: {
      scan: async () => [],
      scanOne: async () => null,
      readFile: async () => null,
      approvals: { load: async () => approvals, save: async (value) => void (approvals = value) },
    },
    skillTests: { load: async () => tests, save: async (value) => void (tests = value) },
    drafts: createWriteDraftStore(appData, "vault-gate"),
    creates,
    proposals: async () => [],
  };

  /** The note as the editor holds it: what "Accept" plans against. */
  const asEdited = async (path: string) => readTextShape(await backup.readTextFile(path)).text;
  const records = (path: string) => store.list(path);
  const open = async (path: string) => (await records(path)).filter((record) => record.suggestion && !record.resolvedAt);
  /**
   * The user's decision on suggestions of a note — all that wait, or the ones `pick` keeps —, as the editor makes
   * it: the note as it is held, the plan, the comment service.
   */
  const decide = async (path: string, outcome: "applied" | "declined", pick: (waiting: WorkspaceCommentRecord[]) => WorkspaceCommentRecord[] = (waiting) => waiting) => {
    const chosen = pick(await open(path));
    return service.run(await service.prepare(planCommentDecision(path, await asEdited(path), chosen, outcome)));
  };
  const history = new VersionHistoryService(backup);
  /** The versions kept of a note, newest first, each with its exact text. */
  const versions = async (path: string) => Promise.all((await history.listVersions(path)).map(async (version) => ({ ...version, text: await history.readVersionText(version.backupPath) })));
  /** Puts a kept version back, as the version history's "Restore" does: what is there now is kept first. */
  const restore = async (path: string, backupPath: string) =>
    history.restoreVersion({ backupPath, targetPath: path, writeAdapter: backup, beforeWrite: () => backup.forceBackup(path) });

  return {
    root: vaultRoot,
    raw,
    backup,
    /** The chain a note is written through: the conflict guard, the sync queue, the version history. */
    files,
    store,
    service,
    host,
    acts,
    created,
    appData,
    /** What waits to be synced to the other devices, in the order it was queued: "write Projects/Offer.md", "rename a.md -> b.md". */
    queued: async () =>
      (await db.query<{ file_path: string; operation: string; new_path: string | null }>("SELECT file_path, operation, new_path FROM offline_queue ORDER BY id")).map(
        (row) => `${row.operation} ${row.file_path}${row.new_path ? ` -> ${row.new_path}` : ""}`,
      ),
    /** Notes the note as synced with the text it has now — the state a syncing vault is in between two changes. */
    synced: async (path: string) => {
      const text = await backup.readTextFile(path);
      await syncRepo.updateLocalHashAndBaseText(path, textHash(text), text);
    },
    /** A file's text exactly as it lies on disk; null where there is none. */
    disk: read,
    /** Every file of the vault that is no bookkeeping of Plainva's, byte for byte. */
    notes: async () => Object.fromEntries(Object.entries(await bytesBelow(vaultRoot)).filter(([path]) => !path.startsWith(".plainva/"))),
    /** Everything below the vault's folder, Plainva's own files included. */
    everything: () => bytesBelow(vaultRoot),
    exists: async (path: string) => {
      try {
        await stat(join(vaultRoot, path));
        return true;
      } catch {
        return false;
      }
    },
    asEdited,
    records,
    open,
    decide,
    versions,
    restore,
  };
}

export type GateVault = Awaited<ReturnType<typeof gateVault>>;

/** The real session in front of a scripted model, with this vault attached. The send overview is approved as it comes. */
export async function gateSession(script: EgressChunk[][], vault: GateVault, model: { providerId: string; model: string } = CLOUD) {
  const fake = fakeEgress(script);
  let ids = 0;
  let stored: unknown = { ...DEFAULT_AI_APP_SETTINGS, enabled: true, providers: ["anthropic", "ollama"], profiles: { balanced: model } };
  const s = new AiSession({
    egress: fake.egress,
    loadSettings: async () => stored,
    saveSettings: async (settings) => void (stored = settings),
    defaults: DEFAULT_AI_APP_SETTINGS,
    language: () => "English",
    today: () => "2026-10-08",
    now: () => new Date("2026-10-08T10:00:00Z"),
    newId: () => `id-${String(++ids).padStart(4, "0")}`,
    label: (key, vars) => (key === "ai.suggestionAuthor" ? `Plainva AI · ${String(vars?.model)}` : key),
  });
  s.subscribe(() => {
    if (s.getState().consent) s.answerConsent(true);
  });
  await s.load();
  await s.attachVault(vault.host);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { s, fake };
}
