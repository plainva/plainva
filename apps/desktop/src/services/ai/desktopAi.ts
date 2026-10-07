import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, mkdir, remove } from "@tauri-apps/plugin-fs";
import i18n from "@plainva/ui/i18n";
import { acpToolbox, AI_POLICY_DIMENSIONS, MCP_OAUTH_CLIENT_DOCUMENT } from "@plainva/core";
import type { AiAppSettings, CommentOperationService, IDatabaseAdapter, IVaultAdapter, VaultQueryService, WorkspaceCommentRecord } from "@plainva/core";
import type { LocalEmbeddings, LocalGists } from "@plainva/ui";
import {
  aiDefaultSettings,
  AiSession,
  aiVaultKey,
  calendarDay,
  capturedNotePath,
  captureVocabularyOf,
  machineProposals,
  noteMovePlan,
  noteRenamePlan,
  adapterInstructionIO,
  adapterInstructionWriter,
  createAcpDeviceStore,
  createAiVaultHost,
  createMcpDeviceStore,
  createVaultPolicy,
  databaseTaskRows,
  entryPlaceOf,
  flushPendingSave,
  getPlatformServices,
  journalToday,
  noteDisplayName,
  parseRecentsFile,
  plannerRowsFromTasks,
  postThreadReply,
  prepareTaskNote,
  profileDefault,
  proposeSuggestionRound,
  situationFrom,
  vaultMailSource,
  withCloudDenied,
  withNoteRule,
  writeCapturedNote,
  type AiFileStore,
  type AiNavigationCommand,
  type AiVaultHost,
  type SituationEventInput,
  type VaultPolicyHost,
  type VaultWriteDeps,
} from "@plainva/ui";
import { checkedReadTextFile } from "../../adapters/checkedFilesystem";
import { requestCascadeDelete } from "../cascadeDelete";
import { inboxFolderKey, journalMoodPropertyKey } from "../../contexts/VaultContext";
import { buildDailyNotePath, readDailyNoteConfig } from "../dailyNotes";
import { readEditorSelection } from "../editorSelection";
import { getConfiguredNoteType } from "../newNote";
import { getSettingsStore } from "../settingsStore";
import { getTaskDatabasePath } from "../taskDatabase";
import { isOwnerWindow } from "../windowContext";
import { createDesktopAcpHost } from "./desktopAcp";
import { createDesktopAiEgress } from "./desktopAiEgress";
import { createDesktopWebFetcher } from "./desktopAiWeb";
import { createDesktopMcpBrowser, createDesktopMcpHost } from "./desktopMcp";
import { mcpStatus } from "./mcpBridge";

/**
 * The desktop's AI session (plan KI-Harness P1a). AI v1 runs in the central
 * window only: it owns the vault's write paths, and the native egress answers
 * no other window. An auxiliary window gets no session, and its surfaces
 * render nothing.
 */

const SETTINGS_KEY = "ai";

/** Opens the companion from anywhere in the main window (the selection door, plan P1.5). */
export const AI_OPEN_EVENT = "plainva-ai-open";

/**
 * Opens the AI tab on its skills — the settings' "Open skills" (plan
 * KI-Harness P3-5), optionally reviewing one source. The request waits here
 * until the tab takes it, so a tab that mounts only now still sees it.
 */
export const AI_SKILLS_EVENT = "plainva-ai-skills";
let pendingSkills: { review: string | null } | null = null;

export function requestSkillsView(review: string | null = null): void {
  pendingSkills = { review };
  window.dispatchEvent(new CustomEvent(AI_SKILLS_EVENT));
}

export function takeSkillsRequest(): { review: string | null } | null {
  const request = pendingSkills;
  pendingSkills = null;
  return request;
}

/**
 * Opens the AI tab on everything that waits for the user — the toast that
 * says an app left a draft (plan KI-Harness P5-5). Like the skills request,
 * it waits here until the tab takes it.
 */
export const AI_WAITING_EVENT = "plainva-ai-waiting";
let pendingWaiting = false;

export function requestWaitingView(): void {
  pendingWaiting = true;
  window.dispatchEvent(new CustomEvent(AI_WAITING_EVENT));
}

export function takeWaitingRequest(): boolean {
  const request = pendingWaiting;
  pendingWaiting = false;
  return request;
}

let aiRootPromise: Promise<{ dir: string; rootId: string }> | null = null;

/** `<appData>/ai` — registered once as a write root of the atomic write command. */
async function aiRoot(): Promise<{ dir: string; rootId: string }> {
  if (!aiRootPromise) {
    aiRootPromise = (async () => {
      const dir = await join(await appDataDir(), "ai");
      if (!(await exists(dir))) await mkdir(dir, { recursive: true });
      const rootId = await invoke<string>("register_write_root", { path: dir });
      return { dir, rootId };
    })().catch((error: unknown) => {
      aiRootPromise = null;
      throw error;
    });
  }
  return aiRootPromise;
}

export const desktopAiFiles: AiFileStore = {
  async read(relPath) {
    const { rootId } = await aiRoot();
    return checkedReadTextFile(rootId, relPath);
  },
  async write(relPath, text) {
    const { rootId } = await aiRoot();
    await invoke("write_file_atomic", { rootId, relPath, contents: text, encoding: "utf8" });
  },
  async remove(relPath) {
    const { dir } = await aiRoot();
    const file = await join(dir, ...relPath.split("/"));
    if (await exists(file)) await remove(file);
  },
  async removeDir(relPath) {
    const { dir } = await aiRoot();
    const folder = await join(dir, ...relPath.split("/"));
    if (await exists(folder)) await remove(folder, { recursive: true });
  },
};

/** Removes the AI data of one vault — part of "forget app data". */
export async function forgetAiVaultData(vaultPath: string): Promise<void> {
  await desktopAiFiles.removeDir(aiVaultKey(vaultPath));
}

function englishLanguageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? "English";
  } catch {
    return "English";
  }
}

let session: AiSession | null = null;

/** The one AI session of this process; null outside the central window. */
export function getDesktopAiSession(defaults: AiAppSettings = aiDefaultSettings()): AiSession | null {
  if (!isOwnerWindow()) return null;
  if (!session) {
    session = new AiSession({
      egress: createDesktopAiEgress(() => ({
        title: i18n.t("ai.add.confirmTitle"),
        message: i18n.t("ai.add.confirmMessage"),
        confirm: i18n.t("ai.add.confirmAction"),
        cancel: i18n.t("common.cancel"),
      })),
      async loadSettings() {
        const store = await getPlatformServices().loadSettings();
        return store.get(SETTINGS_KEY);
      },
      async saveSettings(settings) {
        const store = await getPlatformServices().loadSettings();
        await store.set(SETTINGS_KEY, settings);
        await store.save();
      },
      defaults,
      language: () => englishLanguageName(i18n.language || "en"),
      today: () => calendarDay(),
      now: () => new Date(),
      newId: () => crypto.randomUUID(),
      label: (key, vars) => i18n.t(key, vars),
      // The assistant's page fetch (plan KI-Harness P4): native, like the egress.
      web: createDesktopWebFetcher(),
      // Foreign MCP servers (plan KI-Harness P4.5): the native registry, and what was approved on this device.
      mcp: {
        native: createDesktopMcpHost(),
        // Signing in to a remote server: the system's browser, and back through a port on this computer.
        browser: createDesktopMcpBrowser(),
        clientDocument: MCP_OAUTH_CLIENT_DOCUMENT,
        store: createMcpDeviceStore(desktopAiFiles),
        version: async () => (await getPlatformServices().appVersion?.()) ?? "",
      },
      // External agents (plan KI-Harness P4.6): the native registry and the start of an agent's program in the vault's folder.
      acp: {
        native: createDesktopAcpHost(),
        store: createAcpDeviceStore(desktopAiFiles),
        version: async () => (await getPlatformServices().appVersion?.()) ?? "",
        // Plainva's own tools, as the helper every MCP client on this computer starts — only while the user has them switched on.
        // Handing it over grants nothing: the app asks which folders this client may read, as for every client.
        async toolbox() {
          const status = await mcpStatus();
          return status.running && status.helperPath ? acpToolbox(status.helperPath, status.identifier) : null;
        },
      },
    });
    void session.load();
  }
  return session;
}

export interface DesktopVaultInput {
  vaultPath: string;
  adapter: IVaultAdapter;
  query: VaultQueryService;
  encrypted: () => boolean;
  /** The path open in the focused pane, if it is a note. */
  activePath: () => string | null;
  /** The document open in the focused pane — a note or a database. */
  documentPath: () => string | null;
  /** Every path open in a tab of this window. */
  openPaths: () => string[];
  /** Appointments between two instants (the PIM cache); empty without one. */
  events: (from: Date, to: Date) => Promise<SituationEventInput[]>;
  /** Navigation the assistant may trigger: views and notes, nothing that changes data. */
  commands: () => AiNavigationCommand[];
  /** The vault's index database, where the mail client keeps its offline copy; null while there is none. */
  db: () => IDatabaseAdapter | null | undefined;
  /** The vault's comment service: where an AI suggestion round is written (plan P1.5). */
  commentOperations: () => CommentOperationService | null;
  /** Makes a note the assistant's "Keep as a note" wrote known to the index and the file tree (plan P4-6). */
  noteCreated?: (path: string) => Promise<void>;
  /** The vault's search by meaning, for the context package (plan P2b); null while there is none. */
  semantic?: () => LocalEmbeddings | null;
  /** The vault's gists by the model on this computer, for the context package (plan P2b-3); null while there are none. */
  gists?: () => LocalGists | null;
  /** The shell's own ways of doing what a plan or a draft asks for (plan P5); absent, the assistant proposes nothing here. */
  writes?: DesktopWriteHost;
  /** Every open remark of the vault by note — the comments overview's own query —, for the list of open proposals (plan P5). */
  listComments?: () => Promise<ReadonlyMap<string, readonly WorkspaceCommentRecord[]>>;
  /** The names the vault's comments keep for their authors, by author id: an app at the MCP server is known by the name it signed with. */
  authorNames?: () => Promise<ReadonlyMap<string, string>>;
}

/**
 * What the window does for a plan and a draft (plan KI-Harness P5): each is
 * the way the app itself does it — the file tree's rename and move, the task
 * view's capture, the journal's entry —, so unsaved text lands first, links
 * and tabs follow, and the index and the tree hear of it.
 */
export interface DesktopWriteHost {
  /** The new path, or null where the note stayed what it was. */
  rename(path: string, title: string): Promise<string | null>;
  move(path: string, folder: string): Promise<string | null>;
  /**
   * A task from a captured line, read with `day` as "today"; the path of what
   * was written. `atProvider`: also in the provider list its database names,
   * through the one service every way of creating a task uses.
   */
  createTask(text: string, day: string, atProvider: boolean): Promise<string>;
  /** The name of that provider list, or null where the task database names none. */
  taskList(): Promise<string | null>;
  addJournal(entry: { text: string; day: string; time: string; task: boolean }): Promise<string>;
}

/** Where an answer kept as a note goes while the vault names no inbox folder of its own. Asked when it is needed: nothing of another package runs while this module loads. */
const defaultInboxFolder = () => profileDefault<string>("inboxFolder") ?? "Inbox";

let currentPolicy: VaultPolicyHost | null = null;

/** The policy of the vault the session reads — the settings invalidate it after writing the rules. */
export function currentAiPolicy(): VaultPolicyHost | null {
  return currentPolicy;
}

/** The vault side of the session for the open desktop vault. */
export function createDesktopVaultHost(input: DesktopVaultInput): { host: AiVaultHost; policy: VaultPolicyHost } {
  const read = async (path: string): Promise<string | null> => {
    try {
      return (await input.adapter.exists(path)) ? await input.adapter.readTextFile(path) : null;
    } catch {
      return null;
    }
  };
  const note = async (path: string) => {
    if (!/\.md$/i.test(path)) return null;
    await flushPendingSave(path);
    const text = await read(path);
    return text === null ? null : { path, title: noteDisplayName(path), text };
  };
  const policy = createVaultPolicy({
    readFile: read,
    resolveLink: (target) => input.query.resolveNotePath(target),
    encrypted: input.encrypted,
  });
  currentPolicy = policy;
  /** The vault's inbox folder: where a kept answer and a drafted note land while nobody named another place. */
  const inboxFolder = async (): Promise<string> => {
    try {
      return ((await (await getSettingsStore()).get<string>(inboxFolderKey(input.vaultPath))) ?? "").trim() || defaultInboxFolder();
    } catch {
      return defaultInboxFolder();
    }
  };
  const writes = input.writes;
  /** Where a new entry of a database goes and what it carries, decided as the database's own "New entry" decides it. */
  const entryPlace = async (base: string) => entryPlaceOf(await read(base), await getConfiguredNoteType(input.vaultPath).catch(() => "Note"));
  /** The writing tools (plan P5): the dry runs are read from the index here, the acts are the window's own. */
  const writeDeps: VaultWriteDeps | undefined = writes
    ? {
        sealed: input.encrypted,
        async current(path) {
          // The editor's pending keystrokes land first: a proposal is made against the note as it is.
          if (/\.md$/i.test(path)) await flushPendingSave(path);
          return read(path);
        },
        async propose(round) {
          const service = input.commentOperations();
          if (!service) throw new Error("comments are not available in this vault");
          await proposeSuggestionRound(service, round);
        },
        async folderExists(folder) {
          if (!folder) return true;
          try {
            if (!(await input.adapter.exists(folder))) return false;
            await input.adapter.listDir(folder, false);
            return true;
          } catch {
            return false;
          }
        },
        taskVocabulary: () => captureVocabularyOf((key) => i18n.t(key), i18n.language),
        // Where a task or a journal line would land, for the rules of that place: the task database's folder, the daily note.
        async draftPlace(kind, day) {
          if (kind === "task") {
            const dbPath = await getTaskDatabasePath(input.vaultPath).catch(() => null);
            if (dbPath) {
              const prepared = await prepareTaskNote({ adapter: input.adapter, dbPath, title: "task", noteType: "Task" });
              return prepared.ok ? `${prepared.folder}/task.md` : null;
            }
            // Without a task database a task is a line in the journal.
          }
          const date = new Date(`${day}T12:00:00`);
          if (Number.isNaN(date.getTime())) return null;
          const config = await readDailyNoteConfig(input.vaultPath);
          return buildDailyNotePath(date, config.format, config.folder).fullPath;
        },
        renamePlan: (path, title) => noteRenamePlan(input.query, (target) => input.adapter.exists(target), path, title),
        rename: writes.rename,
        movePlan: (path, folder) => noteMovePlan((target) => input.adapter.exists(target), path, folder),
        move: writes.move,
        // The assistant never deletes: this opens the app's own dialog, and that one decides.
        requestDelete: (path) => requestCascadeDelete({ paths: [path] }),
        // A rule of the note itself, after the user's yes: written like "keep on this device" writes its rule.
        async setRule(path, rule, set) {
          await flushPendingSave(path);
          const text = await read(path);
          if (text === null) return false;
          const next = withNoteRule(text, rule, set);
          if (next === text) return false;
          await input.adapter.writeTextFile(path, next);
          return true;
        },
        entryPlace,
      }
    : undefined;
  /** Checkbox tasks and the task database, as every task view reads them. */
  const taskRows = async () => {
    const [db, notes] = await Promise.all([
      getTaskDatabasePath(input.vaultPath)
        .then(async (dbPath) => databaseTaskRows(dbPath ? await read(dbPath) : null, (config) => input.query.queryDatabaseFiles(config)))
        .catch(() => []),
      input.query
        .listTasks()
        .then((tasks) => plannerRowsFromTasks(tasks.filter((task) => !task.excluded)))
        .catch(() => []),
    ]);
    return [...db, ...notes];
  };
  const moodKey = async (): Promise<string | null> => {
    try {
      return ((await (await getSettingsStore()).get<string>(journalMoodPropertyKey(input.vaultPath))) ?? "").trim() || null;
    } catch {
      return null;
    }
  };
  const host = createAiVaultHost({
    files: desktopAiFiles,
    vaultKey: aiVaultKey(input.vaultPath),
    instructionIO: adapterInstructionIO(input.adapter),
    instructionWriter: adapterInstructionWriter(input.adapter),
    policy,
    async activeNote() {
      const path = input.activePath();
      return path ? note(path) : null;
    },
    readNote: note,
    async propose(round) {
      const service = input.commentOperations();
      if (!service) throw new Error("comments are not available in this vault");
      await proposeSuggestionRound(service, round);
    },
    async reply(reply) {
      const service = input.commentOperations();
      if (!service) throw new Error("comments are not available in this vault");
      await postThreadReply(service, reply);
    },
    encrypted: input.encrypted,
    // An external agent's session (plan P4.6): the vault's folder, its files under its rules, and its margin for what the agent proposes.
    agents: {
      activeNote: () => input.activePath(),
      access: {
        root: input.vaultPath,
        async read(path) {
          // The editor's pending keystrokes land first: the agent reads, and is compared with, the note as it is.
          if (/\.md$/i.test(path)) await flushPendingSave(path);
          return read(path);
        },
        async list(folder) {
          try {
            return (await input.adapter.listDir(folder, false)).map((entry) => entry.name);
          } catch {
            return null;
          }
        },
        policyOf: (path, text) => policy.policyOf(path, text),
        async propose(round) {
          const service = input.commentOperations();
          if (!service) throw new Error("comments are not available in this vault");
          await proposeSuggestionRound(service, round);
        },
        // Through the adapter chain like any note: indexed, synced and backed up as one the user made.
        async create(path, content) {
          if (await input.adapter.exists(path)) throw new Error("a file is there already");
          const folder = path.slice(0, Math.max(0, path.lastIndexOf("/")));
          if (folder && !(await input.adapter.exists(folder))) await input.adapter.createDir(folder);
          await input.adapter.writeTextFile(path, content);
          await input.noteCreated?.(path);
        },
        encrypted: input.encrypted,
      },
    },
    // "Keep as a note" (plan P4-6): into the vault's inbox folder, through the adapter chain like any note.
    capture: {
      folder: inboxFolder,
      async write(folder, stem, content) {
        const path = await writeCapturedNote(input.adapter, folder, stem, content);
        await input.noteCreated?.(path);
        return path;
      },
    },
    // "Create" on a draft (plan P5): a note like a kept answer, a task and a journal line the way the window makes them.
    ...(writes
      ? {
          creates: {
            async note({ folder, stem, content }) {
              const path = await writeCapturedNote(input.adapter, folder ?? (await inboxFolder()), stem, content);
              await input.noteCreated?.(path);
              return path;
            },
            task: ({ text, day, atProvider }) => writes.createTask(text, day, atProvider),
            taskList: () => writes.taskList(),
            journal: (entry) => writes.addJournal(entry),
            entryPlace,
            async placeDenies(folder, stem) {
              const effective = await policy.policyOf(capturedNotePath(folder ?? (await inboxFolder()), stem), "");
              return AI_POLICY_DIMENSIONS.filter((dimension) => effective.policy[dimension] === "deny");
            },
          },
        }
      : {}),
    ...(input.listComments
      ? {
          proposals: async () => {
            const names = input.authorNames ? await input.authorNames().catch(() => undefined) : undefined;
            return machineProposals(await input.listComments!(), names);
          },
        }
      : {}),
    gists: () => input.gists?.()?.reader() ?? null,
    async keepOnDevice(path) {
      // The editor's pending keystrokes land first, so the rule is written into the live text.
      await flushPendingSave(path);
      const text = await read(path);
      if (text === null) throw new Error(`No note at ${path}`);
      await input.adapter.writeTextFile(path, withCloudDenied(text));
    },
    async situation() {
      const now = new Date();
      const path = input.documentPath();
      const kind = path && /\.base$/i.test(path) ? "base" : "note";
      const text = path && kind === "note" ? ((await note(path))?.text ?? null) : null;
      const [tasks, events, mood, dailyNotePath] = await Promise.all([
        taskRows(),
        input.events(now, new Date(now.getTime() + 2 * 86_400_000)).catch(() => []),
        moodKey(),
        readDailyNoteConfig(input.vaultPath)
          .then(async (config) => {
            const { fullPath } = buildDailyNotePath(journalToday(now), config.format, config.folder);
            return (await input.adapter.exists(fullPath)) ? fullPath : null;
          })
          .catch(() => null),
      ]);
      return situationFrom({ now, active: path ? { path, kind, text } : null, selection: path ? readEditorSelection() : null, tabs: input.openPaths(), taskRows: tasks, events, dailyNotePath, moodKey: mood });
    },
    retrieval: {
      searchCandidates: (terms, limit) => input.query.searchCandidates(terms, limit),
      linkNeighbors: (path, limit) => input.query.getLinkNeighbors(path, limit),
      recentlyChanged: (limit) => input.query.getRecentlyChangedNotes(limit),
      async recentlyOpened() {
        try {
          return parseRecentsFile(await input.adapter.readTextFile(".plainva/recents.json"));
        } catch {
          return [];
        }
      },
      now: () => Date.now(),
      semanticCandidates: async (question, limit, options) => (await input.semantic?.()?.semanticCandidates(question, limit, options)) ?? [],
      // What sending without a selection would cost (plan P2b-5): the index's sizes, no note read.
      noteSizes: async (paths) => new Map([...(await input.query.fileRecords(paths))].map(([path, record]) => [path, record.size_bytes])),
      // Which notes name a file (plan P4-5): a picture embedded in a note kept from the cloud stays with it.
      notesContaining: (needles) => input.query.notesContaining(needles),
    },
    toolDeps: {
      async search(query, limit, offset) {
        const hits = await input.query.searchFullText(query, limit, offset);
        return hits.map((hit) => ({ path: hit.path, title: hit.title || noteDisplayName(hit.path), snippet: hit.snippet ?? null }));
      },
      readNote: read,
      taskRows,
      todayKey: () => calendarDay(),
      commands: input.commands,
      backlinks: (path) => input.query.getBacklinks(path),
      queryDatabase: (config) => input.query.queryDatabaseFiles(config),
      events: (from, to) => input.events(from, to),
      moodKey,
      // The vault's mail accounts (plan KI-Harness P4-4): found through the tool search, asked for at the first call.
      mail: vaultMailSource(input.vaultPath, input.db),
      ...(writeDeps ? { writes: writeDeps } : {}),
    },
  });
  return { host, policy };
}
